/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

//! Various stuff for CSS property use counters.

use crate::properties::{property_counts, CountedUnknownProperty, NonCustomPropertyId};
use std::cell::Cell;

#[cfg(target_pointer_width = "64")]
const BITS_PER_ENTRY: usize = 64;

#[cfg(target_pointer_width = "32")]
const BITS_PER_ENTRY: usize = 32;

/// One bit per each non-custom CSS property.
#[derive(Debug, Default, Clone)]
pub struct CountedUnknownPropertyUseCounters {
    storage:
        [Cell<usize>; (property_counts::COUNTED_UNKNOWN - 1 + BITS_PER_ENTRY) / BITS_PER_ENTRY],
}

/// One bit per each non-custom CSS property.
#[derive(Debug, Default, Clone)]
pub struct NonCustomPropertyUseCounters {
    storage: [Cell<usize>; (property_counts::NON_CUSTOM - 1 + BITS_PER_ENTRY) / BITS_PER_ENTRY],
}

/// A custom style use counter that we may want to record.
#[derive(Copy, Clone, Debug)]
#[repr(u32)]
pub enum CustomUseCounter {
    /// Whether we are likely to be using relative URIs that depend on our path depth.
    MaybeHasPathBaseUriDependency = 0,
    /// Whether we are likely to be using relative URIs that depend on our full URI.
    MaybeHasFullBaseUriDependency,
    /// Dummy value, used for indexing purposes.
    Last,
}

impl CustomUseCounter {
    #[inline]
    fn bit(self) -> usize {
        self as usize
    }
}

/// One bit for each custom use counter.
#[derive(Debug, Default, Clone)]
pub struct CustomUseCounters {
    storage:
        [Cell<usize>; ((CustomUseCounter::Last as usize) - 1 + BITS_PER_ENTRY) / BITS_PER_ENTRY],
}

macro_rules! use_counters_methods {
    ($id: ident) => {
        /// Returns the bucket a given property belongs in, and the bitmask for that
        /// property.
        #[inline(always)]
        fn bucket_and_pattern(id: $id) -> (usize, usize) {
            let bit = id.bit();
            let bucket = bit / BITS_PER_ENTRY;
            let bit_in_bucket = bit % BITS_PER_ENTRY;
            (bucket, 1 << bit_in_bucket)
        }

        /// Record that a given property ID has been parsed.
        #[inline]
        pub fn record(&self, id: $id) {
            let (bucket, pattern) = Self::bucket_and_pattern(id);
            let bucket = &self.storage[bucket];
            bucket.set(bucket.get() | pattern)
        }

        /// Returns whether a given property ID has been recorded
        /// earlier.
        #[inline]
        pub fn recorded(&self, id: $id) -> bool {
            let (bucket, pattern) = Self::bucket_and_pattern(id);
            self.storage[bucket].get() & pattern != 0
        }

        /// Merge `other` into `self`.
        #[inline]
        fn merge(&self, other: &Self) {
            for (bucket, other_bucket) in self.storage.iter().zip(other.storage.iter()) {
                bucket.set(bucket.get() | other_bucket.get())
            }
        }
    };
}

impl CountedUnknownPropertyUseCounters {
    use_counters_methods!(CountedUnknownProperty);
}

impl NonCustomPropertyUseCounters {
    use_counters_methods!(NonCustomPropertyId);
}

impl CustomUseCounters {
    use_counters_methods!(CustomUseCounter);
}

/// The use-counter data related to a given document we want to store.
#[derive(Debug, Default, Clone)]
pub struct UseCounters {
    /// The counters for non-custom properties that have been parsed in the
    /// document's stylesheets.
    pub non_custom_properties: NonCustomPropertyUseCounters,
    /// The counters for css properties which we haven't implemented yet.
    pub counted_unknown_properties: CountedUnknownPropertyUseCounters,
    /// Custom counters for virtually everything else.
    pub custom: CustomUseCounters,
}

impl UseCounters {
    /// Merge the use counters.
    ///
    /// Used for parallel parsing, where we parse off-main-thread.
    #[inline]
    pub fn merge(&self, other: &Self) {
        self.non_custom_properties
            .merge(&other.non_custom_properties);
        self.counted_unknown_properties
            .merge(&other.counted_unknown_properties);
        self.custom.merge(&other.custom);
    }
}
