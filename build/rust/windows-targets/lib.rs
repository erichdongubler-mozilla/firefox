// Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
// http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
// <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. This file may not be copied, modified, or distributed
// except according to those terms.

#![no_std]

#[doc(hidden)]
pub mod reexport {
    pub mod windows_link {
        pub use windows_link::*;
    }
}

#[macro_export]
macro_rules! link {
    ($library:literal $abi:literal $($link_name:literal)? $(#[$doc:meta])? fn $($function:tt)*) => {
        $crate::reexport::windows_link::link!($library $abi $($link_name)? fn $($function)*);
    }
}
