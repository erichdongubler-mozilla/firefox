/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Types needed to marshal [`server`](crate::server) errors back to C++ in Firefox. The main type
//! of this module is [`ErrorBuffer`](crate::server::ErrorBuffer).

use std::{
    borrow::Cow,
    error::Error,
    fmt::{self, Debug, Display, Formatter},
    os::raw::c_char,
    ptr,
};

use nsstring::nsCString;
use serde::{Deserialize, Serialize};
use wgc::id;
use wgt::error::WebGpuError;

/// A non-owning representation of `mozilla::webgpu::ErrorBuffer` in C++, passed as an argument to
/// other functions in [this module](self).
///
/// C++ callers of Rust functions (presumably in `WebGPUParent.cpp`) that expect one of these
/// structs can create a `mozilla::webgpu::ErrorBuffer` object, and call its `ToFFI` method to
/// construct a value of this type, available to C++ as `mozilla::webgpu::ffi::WGPUErrorBuffer`. If
/// we catch a `Result::Err` in other functions of [this module](self), the error is converted to
/// this type.
#[repr(C)]
pub struct ErrorBuffer {
    /// The type of error that `string` is associated with. If this location is set to
    /// [`ErrorBufferType::None`] after being passed as an argument to a function in [this module](self),
    /// then the remaining fields are guaranteed to not have been altered by that function from
    /// their original state.
    r#type: *mut ErrorBufferType,
    /// The (potentially truncated) message associated with this error. A fixed-capacity,
    /// null-terminated UTF-8 string buffer owned by C++.
    ///
    /// When we convert WGPU errors to this type, we render the error as a string, copying into
    /// `message` up to `capacity - 1`, and null-terminate it.
    message: *mut c_char,
    message_capacity: usize,
    device_id: *mut wgc::id::DeviceId,
}

impl ErrorBuffer {
    /// Fill this buffer with the textual representation of `error`.
    ///
    /// If the error message is too long, truncate it to `self.capacity`. In either case, the error
    /// message is always terminated by a zero byte.
    ///
    /// Note that there is no explicit indication of the message's length, only the terminating zero
    /// byte. If the textual form of `error` itself includes a zero byte (as Rust strings can), then
    /// the C++ code receiving this error message has no way to distinguish that from the
    /// terminating zero byte, and will see the message as shorter than it is.
    pub(crate) fn init<'a>(&mut self, error: impl WebGpuError, device_id: id::DeviceId) {
        let ErrMsg {
            message,
            r#type: err_ty,
        } = ErrMsg::from_webgpu(error);

        let Some(err_ty) = err_ty.sanitize() else {
            return; // Device lost, will be surfaced via callback.
        };

        unsafe { *self.device_id = device_id };

        // SAFETY: We presume the pointer provided by the caller is safe to write to.
        unsafe { *self.r#type = err_ty };

        if matches!(err_ty, ErrorBufferType::None) {
            log::warn!("{message}");
            return;
        }

        assert_ne!(self.message_capacity, 0);
        // Since we need to store a nul terminator after the content, the
        // content length must always be strictly less than the buffer's
        // capacity.
        let length = if message.len() >= self.message_capacity {
            // Thanks to the structure of UTF-8, `std::is_char_boundary` is
            // O(1), so this should examine a few bytes at most.
            //
            // The largest value in this range is `self.message_capacity - 1`,
            // which is a safe length.
            let truncated_length = (0..self.message_capacity)
                .rfind(|&offset| message.is_char_boundary(offset))
                .unwrap_or(0);
            log::warn!(
                "Error message's length {} reached capacity {}, truncating to {}",
                message.len(),
                self.message_capacity,
                truncated_length,
            );
            truncated_length
        } else {
            message.len()
        };
        unsafe {
            ptr::copy_nonoverlapping(message.as_ptr(), self.message as *mut u8, length);
            *self.message.add(length) = 0;
        }
    }
}

pub struct OwnedErrorBuffer {
    device_id: Option<id::DeviceId>,
    ty: ErrorBufferType,
    message: nsCString,
}

impl OwnedErrorBuffer {
    pub fn new() -> Self {
        Self {
            device_id: None,
            ty: ErrorBufferType::None,
            message: nsCString::new(),
        }
    }

    pub(crate) fn init_from_msg<'a>(&mut self, error: ErrMsg<'a>, device_id: id::DeviceId) {
        assert!(self.device_id.is_none());

        let ErrMsg {
            message,
            r#type: ty,
        } = error;

        let Some(ty) = ty.sanitize() else {
            return; // Device lost, will be surfaced via callback.
        };

        self.device_id = Some(device_id);
        self.ty = ty;
        self.message = nsCString::from(message.as_ref());
    }

    pub(crate) fn init(&mut self, error: impl WebGpuError, device_id: id::DeviceId) {
        self.init_from_msg(ErrMsg::from_webgpu(error), device_id);
    }

    pub(crate) fn get_inner_data(&self) -> Option<(id::DeviceId, ErrorBufferType, &nsCString)> {
        Some((self.device_id?, self.ty, &self.message))
    }
}

pub fn error_to_string(error: impl Error) -> String {
    use std::fmt::Write;
    let mut message = format!("{}", error);
    let mut e = error.source();
    while let Some(source) = e {
        write!(message, ", caused by: {}", source).unwrap();
        e = source.source();
    }
    message
}

/// Corresponds to an optional discriminant of [`GPUError`] type in the WebGPU API. Strongly
/// correlates to [`GPUErrorFilter`]s.
///
/// [`GPUError`]: https://gpuweb.github.io/gpuweb/#gpuerror
/// [`GPUErrorFilter`]: https://gpuweb.github.io/gpuweb/#enumdef-gpuerrorfilter
#[repr(u8)]
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub(crate) enum ErrorBufferType {
    None = 0,
    DeviceLost = 1,
    Internal = 2,
    OutOfMemory = 3,
    Validation = 4,
}

impl ErrorBufferType {
    /// Returns `None` if `self` is Self::DeviceLost`]. Otherwise, returns `Some(self)`.
    ///
    /// # Panics
    ///
    /// Panics if `self` is [`Self::None`].
    pub(crate) fn sanitize(self) -> Option<Self> {
        match self {
            ErrorBufferType::None => panic!(),
            ErrorBufferType::DeviceLost => return None,
            ErrorBufferType::Internal => {}
            ErrorBufferType::OutOfMemory => {}
            ErrorBufferType::Validation => {}
        }
        Some(self)
    }
}

impl From<wgt::error::ErrorType> for ErrorBufferType {
    fn from(value: wgt::error::ErrorType) -> Self {
        match value {
            wgt::error::ErrorType::Internal => ErrorBufferType::Internal,
            wgt::error::ErrorType::OutOfMemory => ErrorBufferType::OutOfMemory,
            wgt::error::ErrorType::Validation => ErrorBufferType::Validation,
            wgt::error::ErrorType::DeviceLost { reason: _ } => ErrorBufferType::DeviceLost,
        }
    }
}

/// Representation an error whose error message is already rendered as a [`&str`], and has no error
/// sources. Used for convenience in [`server`](crate::server) code.
#[derive(Clone, Debug)]
pub(crate) struct ErrMsg<'a> {
    pub(crate) message: Cow<'a, str>,
    pub(crate) r#type: ErrorBufferType,
}

impl Display for ErrMsg<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let Self { message, r#type: _ } = self;
        write!(f, "{message}")
    }
}

impl Error for ErrMsg<'_> {}

impl<T> From<T> for ErrMsg<'static>
where
    T: WebGpuError,
{
    fn from(value: T) -> Self {
        Self::from_webgpu(value)
    }
}

impl ErrMsg<'static> {
    pub(crate) fn from_webgpu<T>(error: T) -> Self
    where
        T: WebGpuError,
    {
        Self {
            r#type: error.webgpu_error_type().into(),
            message: error_to_string(error).into(),
        }
    }

    pub(crate) fn oom() -> Self {
        Self {
            message: "Out of memory".into(),
            r#type: ErrorBufferType::OutOfMemory,
        }
    }
}
