//! Functionality for splitting CTS tests at certain paths into more tests and files in
//! [`crate::main`].

use std::collections::BTreeMap;

use indexmap::IndexSet;

/// The value portion of a key-value pair used in [`crate::main`] to split tests into more tests or
/// files.
#[derive(Debug)]
pub(crate) struct TestGroupSplit<'a> {
    pub wildcard_entry: Option<TestSplit<'a>>,
    pub specific_tests_by_name: BTreeMap<&'static str, TestSplit<'a>>,
}

impl<'a> TestGroupSplit<'a> {
    pub fn single(
        test_path: &'static str,
        param_names: &'static [&'static str],
        divide_into: DivideInto,
    ) -> Self {
        Self {
            wildcard_entry: None,
            specific_tests_by_name: [(test_path, TestSplit::new(param_names, divide_into))]
                .into_iter()
                .collect(),
        }
    }

    pub fn multiple(
        specific_tests_by_name: impl IntoIterator<Item = (&'static str, TestSplit<'a>)>,
    ) -> Self {
        Self {
            wildcard_entry: None,
            specific_tests_by_name: specific_tests_by_name.into_iter().collect(),
        }
    }

    pub(crate) fn get_test_for_wpt<'b>(&'b mut self, test_name: &str) -> Option<&'b TestSplit<'a>> {
        let Self {
            wildcard_entry,
            specific_tests_by_name,
        } = self;
        specific_tests_by_name
            .get_mut(test_name)
            .or(wildcard_entry.as_mut())
            .map(|entry| {
                entry.seen.wpt_files = true;
                &*entry
            })
    }
}

#[derive(Debug)]
pub(crate) struct TestSplit<'a> {
    pub divide_into: DivideInto,
    param_names: IndexSet<&'static str>,
    observed_param_values: IndexSet<Vec<&'a str>>,
    seen: SeenIn,
}

impl TestSplit<'_> {
    pub fn new(param_names: &'static [&'static str], divide_into: DivideInto) -> Self {
        Self {
            divide_into,
            param_names: param_names.iter().copied().collect(),
            observed_param_values: Default::default(),
            seen: SeenIn::nowhere(),
        }
    }

    pub fn observed_param_values(
        &self,
    ) -> impl Iterator<Item = impl Iterator<Item = (&str, &str)> + Clone> + Clone {
        self.observed_param_values
            .iter()
            .map(|values| self.param_names.iter().copied().zip(values.iter().copied()))
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum DivideInto {
    /// Place new test entries as siblings in the same file.
    TestsInSameFile,
    // /// Place new test entries as siblings in the same file.
    // TestsInSeparateFiles,
}

/// An [`Entry::seen`].
#[derive(Debug, Default)]
pub(crate) struct SeenIn {
    pub listing: bool,
    pub wpt_files: bool,
}

impl SeenIn {
    /// Default value: all seen locations set to `false`.
    pub fn nowhere() -> Self {
        Self::default()
    }
}

impl<'a> TestGroupSplit<'a> {
    /// Accumulates a line from the test listing script in upstream CTS.
    ///
    /// Line is expected to have a full CTS test path, including at least one case parameter, i.e.:
    ///
    /// ```
    /// webgpu:path,to,test,group:test:param1="value1";…
    /// ```
    ///
    /// Note that `;…` is not strictly necessary, when there is only a single case parameter for
    /// the test.
    ///
    /// See [`crate::main`] for more details on how upstream CTS' listing script is invoked.
    pub(crate) fn process_listing_line(
        &mut self,
        test_group_and_later_path: &'a str,
    ) -> miette::Result<()> {
        let Self {
            wildcard_entry,
            specific_tests_by_name,
        } = self;

        let [_webgpu, _test_group, test_name, rest] =
            crate::split_at_colons(test_group_and_later_path)?;

        let entry = if let Some(state) = specific_tests_by_name.get_mut(test_name) {
            let &mut TestSplit {
                divide_into: _,
                param_names: ref expected_param_names,
                ref mut observed_param_values,
                seen: _,
            } = state;

            let param_values = expected_param_names
                .iter()
                .map(|expected_name| {
                    // NOTE: This only parses strings with no escaped characters. We may need different
                    // values later, at which point we'll have to consider what to do here.
                    let (ident, rest) = rest.split_once("=").ok_or_else(|| {
                        miette::diagnostic!("failed to get start of {expected_name:?} param. value")
                    })?;

                    if ident != *expected_name {
                        return Err(miette::diagnostic!(
                            "expected {:?}, got {:?}",
                            expected_name,
                            ident
                        ));
                    }

                    Ok(rest
                        .split_once(';')
                        .map(|(value, _rest)| value)
                        .unwrap_or(rest))

                    // TODO: parse as JSON?
                })
                .collect::<Result<_, _>>()?;

            observed_param_values.insert(param_values);
            Some(state)
        } else {
            wildcard_entry.as_mut()
        };
        if let Some(entry) = entry {
            entry.seen.listing = true;
        }

        Ok(())
    }
}

/// Iterate over `entries`' [`seen` members](Entry::seen), accumulating one of their fields and
/// panicking if any are `false`
///
/// Used in [`crate::main`] to check that a specific [`Entry::seen`] fields have been set to `true`
/// for each entry configured.
pub(crate) fn assert_seen<'a>(
    what: &'static str,
    entries: impl Iterator<Item = (&'a &'a str, &'a TestGroupSplit<'a>)>,
    mut in_: impl FnMut(&'a SeenIn) -> &'a bool,
) {
    let mut unseen = Vec::new();
    entries
        .flat_map(|(test_group, entry)| {
            entry
                .wildcard_entry
                .as_ref()
                .map(|entry| ((test_group, None), &entry.seen))
                .into_iter()
                .chain(
                    entry
                        .specific_tests_by_name
                        .iter()
                        .map(move |(test_name, entry)| {
                            ((test_group, Some(test_name)), &entry.seen)
                        }),
                )
        })
        .for_each(|(test_path, seen)| {
            if !*in_(seen) {
                unseen.push(test_path);
            }
        });
    if !unseen.is_empty() {
        panic!(
            concat!(
                "did not find the following test split config. entries ",
                "in {}: {:#?}",
            ),
            what, unseen
        );
    }
}
