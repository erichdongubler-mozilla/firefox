// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

use std::mem;
use std::sync::Arc;

use crate::common_metric_data::{CommonMetricDataInternal, DynamicLabelType};
use crate::error_recording::{record_error, test_get_num_recorded_errors, ErrorType};
use crate::histogram::{Functional, Histogram};
use crate::metrics::memory_unit::MemoryUnit;
use crate::metrics::{DistributionData, Metric, MetricType};
use crate::storage::StorageManager;
use crate::CommonMetricData;
use crate::Glean;

// The base of the logarithm used to determine bucketing
const LOG_BASE: f64 = 2.0;

// The buckets per each order of magnitude of the logarithm.
const BUCKETS_PER_MAGNITUDE: f64 = 16.0;

// Set a maximum recordable value of 1 terabyte so the buckets aren't
// completely unbounded.
const MAX_BYTES: u64 = 1 << 40;

/// A memory distribution metric.
///
/// Memory distributions are used to accumulate and store memory sizes.
#[derive(Clone, Debug)]
pub struct MemoryDistributionMetric {
    meta: Arc<CommonMetricDataInternal>,
    memory_unit: MemoryUnit,
}

/// Create a snapshot of the histogram.
///
/// The snapshot can be serialized into the payload format.
pub(crate) fn snapshot(hist: &Histogram<Functional>) -> DistributionData {
    DistributionData {
        // **Caution**: This cannot use `Histogram::snapshot_values` and needs to use the more
        // specialized snapshot function.
        values: hist
            .snapshot()
            .iter()
            .map(|(&k, &v)| (k as i64, v as i64))
            .collect(),
        sum: hist.sum() as i64,
        count: hist.count() as i64,
    }
}

impl MetricType for MemoryDistributionMetric {
    fn meta(&self) -> &CommonMetricDataInternal {
        &self.meta
    }

    fn with_name(&self, name: String) -> Self {
        let mut meta = (*self.meta).clone();
        meta.inner.name = name;
        Self {
            meta: Arc::new(meta),
            memory_unit: self.memory_unit,
        }
    }

    fn with_dynamic_label(&self, label: DynamicLabelType) -> Self {
        let mut meta = (*self.meta).clone();
        meta.inner.dynamic_label = Some(label);
        Self {
            meta: Arc::new(meta),
            memory_unit: self.memory_unit,
        }
    }
}

// IMPORTANT:
//
// When changing this implementation, make sure all the operations are
// also declared in the related trait in `../traits/`.
impl MemoryDistributionMetric {
    /// Creates a new memory distribution metric.
    pub fn new(meta: CommonMetricData, memory_unit: MemoryUnit) -> Self {
        Self {
            meta: Arc::new(meta.into()),
            memory_unit,
        }
    }

    /// Accumulates the provided sample in the metric.
    ///
    /// # Arguments
    ///
    /// * `sample` - The sample to be recorded by the metric. The sample is assumed to be in the
    ///   configured memory unit of the metric.
    ///
    /// ## Notes
    ///
    /// Values bigger than 1 Terabyte (2<sup>40</sup> bytes) are truncated
    /// and an [`ErrorType::InvalidValue`] error is recorded.
    pub fn accumulate(&self, sample: i64) {
        let metric = self.clone();
        crate::launch_with_glean(move |glean| metric.accumulate_sync(glean, sample))
    }

    /// Accumulates the provided sample in the metric synchronously.
    ///
    /// See [`accumulate`](Self::accumulate) for details.
    #[doc(hidden)]
    pub fn accumulate_sync(&self, glean: &Glean, sample: i64) {
        if !self.should_record(glean) {
            return;
        }

        if sample < 0 {
            record_error(
                glean,
                &self.meta,
                ErrorType::InvalidValue,
                "Accumulated a negative sample",
                None,
            );
            return;
        }

        let mut sample = self.memory_unit.as_bytes(sample as u64);

        if sample > MAX_BYTES {
            let msg = "Sample is bigger than 1 terabyte";
            record_error(glean, &self.meta, ErrorType::InvalidValue, msg, None);
            sample = MAX_BYTES;
        }

        // Let's be defensive here:
        // The uploader tries to store some memory distribution metrics,
        // but in tests that storage might be gone already.
        // Let's just ignore those.
        // We do the same for counters and timing distributions.
        // This should never happen in real app usage.
        if let Some(storage) = glean.storage_opt() {
            storage.record_with(glean, &self.meta, |old_value| match old_value {
                Some(Metric::MemoryDistribution(mut hist)) => {
                    hist.accumulate(sample);
                    Metric::MemoryDistribution(hist)
                }
                _ => {
                    let mut hist = Histogram::functional(LOG_BASE, BUCKETS_PER_MAGNITUDE);
                    hist.accumulate(sample);
                    Metric::MemoryDistribution(hist)
                }
            });
        } else {
            log::warn!(
                "Couldn't get storage. Can't record memory distribution '{}'.",
                self.meta.base_identifier()
            );
        }
    }

    /// Accumulates the provided signed samples in the metric.
    ///
    /// This is required so that the platform-specific code can provide us with
    /// 64 bit signed integers if no `u64` comparable type is available. This
    /// will take care of filtering and reporting errors for any provided negative
    /// sample.
    ///
    /// Please note that this assumes that the provided samples are already in
    /// the "unit" declared by the instance of the metric type (e.g. if the the
    /// instance this method was called on is using [`MemoryUnit::Kilobyte`], then
    /// `samples` are assumed to be in that unit).
    ///
    /// # Arguments
    ///
    /// * `samples` - The vector holding the samples to be recorded by the metric.
    ///
    /// ## Notes
    ///
    /// Discards any negative value in `samples` and report an [`ErrorType::InvalidValue`]
    /// for each of them.
    ///
    /// Values bigger than 1 Terabyte (2<sup>40</sup> bytes) are truncated
    /// and an [`ErrorType::InvalidValue`] error is recorded.
    pub fn accumulate_samples(&self, samples: Vec<i64>) {
        let metric = self.clone();
        crate::launch_with_glean(move |glean| metric.accumulate_samples_sync(glean, samples))
    }

    /// Accumulates the provided signed samples in the metric synchronously.
    ///
    /// See [`accumulate_samples`](Self::accumulate_samples) for details.
    #[doc(hidden)]
    pub fn accumulate_samples_sync(&self, glean: &Glean, samples: Vec<i64>) {
        if !self.should_record(glean) {
            return;
        }

        let mut num_negative_samples = 0;
        let mut num_too_log_samples = 0;

        glean.storage().record_with(glean, &self.meta, |old_value| {
            let mut hist = match old_value {
                Some(Metric::MemoryDistribution(hist)) => hist,
                _ => Histogram::functional(LOG_BASE, BUCKETS_PER_MAGNITUDE),
            };

            for &sample in samples.iter() {
                if sample < 0 {
                    num_negative_samples += 1;
                } else {
                    let sample = sample as u64;
                    let mut sample = self.memory_unit.as_bytes(sample);
                    if sample > MAX_BYTES {
                        num_too_log_samples += 1;
                        sample = MAX_BYTES;
                    }

                    hist.accumulate(sample);
                }
            }
            Metric::MemoryDistribution(hist)
        });

        if num_negative_samples > 0 {
            let msg = format!("Accumulated {} negative samples", num_negative_samples);
            record_error(
                glean,
                &self.meta,
                ErrorType::InvalidValue,
                msg,
                num_negative_samples,
            );
        }

        if num_too_log_samples > 0 {
            let msg = format!(
                "Accumulated {} samples larger than 1TB",
                num_too_log_samples
            );
            record_error(
                glean,
                &self.meta,
                ErrorType::InvalidValue,
                msg,
                num_too_log_samples,
            );
        }
    }

    /// Gets the currently stored value synchronously.
    #[doc(hidden)]
    pub fn get_value<'a, S: Into<Option<&'a str>>>(
        &self,
        glean: &Glean,
        ping_name: S,
    ) -> Option<DistributionData> {
        let queried_ping_name = ping_name
            .into()
            .unwrap_or_else(|| &self.meta().inner.send_in_pings[0]);

        match StorageManager.snapshot_metric_for_test(
            glean.storage(),
            queried_ping_name,
            &self.meta.identifier(glean),
            self.meta.inner.lifetime,
        ) {
            Some(Metric::MemoryDistribution(hist)) => Some(snapshot(&hist)),
            _ => None,
        }
    }

    /// **Test-only API (exported for FFI purposes).**
    ///
    /// Gets the currently stored value.
    ///
    /// This doesn't clear the stored value.
    ///
    /// # Arguments
    ///
    /// * `ping_name` - the optional name of the ping to retrieve the metric
    ///                 for. Defaults to the first value in `send_in_pings`.
    ///
    /// # Returns
    ///
    /// The stored value or `None` if nothing stored.
    pub fn test_get_value(&self, ping_name: Option<String>) -> Option<DistributionData> {
        crate::block_on_dispatcher();
        crate::core::with_glean(|glean| self.get_value(glean, ping_name.as_deref()))
    }

    /// **Exported for test purposes.**
    ///
    /// Gets the number of recorded errors for the given metric and error type.
    ///
    /// # Arguments
    ///
    /// * `error` - The type of error
    ///
    /// # Returns
    ///
    /// The number of errors reported.
    pub fn test_get_num_recorded_errors(&self, error: ErrorType) -> i32 {
        crate::block_on_dispatcher();

        crate::core::with_glean(|glean| {
            test_get_num_recorded_errors(glean, self.meta(), error).unwrap_or(0)
        })
    }

    /// **Experimental:** Start a new histogram buffer associated with this memory distribution metric.
    ///
    /// A histogram buffer accumulates in-memory.
    /// Data is recorded into the metric on drop.
    pub fn start_buffer(&self) -> LocalMemoryDistribution<'_> {
        LocalMemoryDistribution::new(self)
    }

    fn commit_histogram(&self, histogram: Histogram<Functional>, errors: usize) {
        let metric = self.clone();
        crate::launch_with_glean(move |glean| {
            if errors > 0 {
                let msg = format!("Accumulated {} samples larger than 1TB", errors);
                record_error(
                    glean,
                    &metric.meta,
                    ErrorType::InvalidValue,
                    msg,
                    Some(errors as i32),
                );
            }

            glean
                .storage()
                .record_with(glean, &metric.meta, move |old_value| {
                    let mut hist = match old_value {
                        Some(Metric::MemoryDistribution(hist)) => hist,
                        _ => Histogram::functional(LOG_BASE, BUCKETS_PER_MAGNITUDE),
                    };

                    hist.merge(&histogram);
                    Metric::MemoryDistribution(hist)
                });
        });
    }
}

/// **Experimental:** A histogram buffer associated with a specific instance of a [`MemoryDistributionMetric`].
///
/// Accumulation happens in-memory.
/// Data is merged into the metric on [`Drop::drop`].
#[derive(Debug)]
pub struct LocalMemoryDistribution<'a> {
    histogram: Histogram<Functional>,
    metric: &'a MemoryDistributionMetric,
    errors: usize,
}

impl<'a> LocalMemoryDistribution<'a> {
    /// Create a new histogram buffer referencing the memory distribution it will record into.
    fn new(metric: &'a MemoryDistributionMetric) -> Self {
        let histogram = Histogram::functional(LOG_BASE, BUCKETS_PER_MAGNITUDE);
        Self {
            histogram,
            metric,
            errors: 0,
        }
    }

    /// Accumulates one sample into the histogram.
    ///
    /// The provided sample must be in the "unit" declared by the instance of the metric type
    /// (e.g. if the instance this method was called on is using [`crate::MemoryUnit::Kilobyte`], then
    /// `sample` is assumed to be in kilobytes).
    ///
    /// Accumulation happens in-memory only.
    pub fn accumulate(&mut self, sample: u64) {
        let mut sample = self.metric.memory_unit.as_bytes(sample);
        if sample > MAX_BYTES {
            self.errors += 1;
            sample = MAX_BYTES;
        }
        self.histogram.accumulate(sample)
    }

    /// Abandon this histogram buffer and don't commit accumulated data.
    pub fn abandon(mut self) {
        // Replace any recordings with an empty histogram.
        self.histogram.clear();
    }
}

impl Drop for LocalMemoryDistribution<'_> {
    fn drop(&mut self) {
        if self.histogram.is_empty() {
            return;
        }

        // We want to move that value.
        // A `0/0` histogram doesn't allocate.
        let buffer = mem::replace(&mut self.histogram, Histogram::functional(0.0, 0.0));
        self.metric.commit_histogram(buffer, self.errors);
    }
}
