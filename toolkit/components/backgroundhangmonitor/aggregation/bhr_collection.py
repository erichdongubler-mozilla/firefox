# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""BigQuery reader for the BHR aggregation pipeline.

Streams hang-report pings from BigQuery for a given build-date window,
filtered down to the columns the downstream pipeline actually consumes.

Ported from the original python_mozetl/mozetl/bhr_collection/bhr_collection.py. The
SQL and FARM_FINGERPRINT-based deterministic sampling are unchanged. The
PySpark BigQuery connector has been replaced with the google-cloud-bigquery
Python client; rows are yielded one at a time rather than materialised into
a Spark DataFrame so memory stays bounded at production sample sizes
(~500K rows × ~5-10 KB each would otherwise need 3-5 GB on a single worker).

The google-cloud-bigquery import is deferred to the call site so this
module can be imported in environments where the package isn't installed
(e.g. unit tests that mock the client). Production runs need the package
present in the runtime — that's handled by the TaskCluster Docker image
in a later phase of the migration.
"""

from datetime import timedelta

_BQ_TABLE = "moz-fx-data-shared-prod.firefox_desktop_stable.hang_report_v1"
_MAX_SAMPLE_SLICES = 10000

# Top-level ping fields fetched from BigQuery. Returned in `slash/key` form
# because downstream code (process_hangs, process_module, etc.) expects this
# same shape. exclude_modules drops the hangs_modules column for the cases
# where module info isn't needed downstream.
_BASE_PROPERTIES = (
    "client_info/os",
    "client_info/os_version",
    "client_info/architecture",
    "client_info/app_build",
)


def _properties_for(exclude_modules):
    if exclude_modules:
        return list(_BASE_PROPERTIES) + ["metrics/object/hangs_reports"]
    return list(_BASE_PROPERTIES) + [
        "metrics/object/hangs_modules",
        "metrics/object/hangs_reports",
    ]


def get_prop(val, prop):
    """Walk a slash-delimited property path on a dict-like or Row-like value.

    Returns None if any intermediate node is None, matching the behaviour of
    the python_mozetl version. Works on plain dicts (used in tests) and on
    google.cloud.bigquery.Row objects (used in production).
    """
    if val is None:
        return None

    for key in prop.split("/"):
        val = val[key]
        if val is None:
            return None
    return val


def get_ping_properties(ping, properties):
    return {prop: get_prop(ping, prop) for prop in properties}


def properties_are_not_none(ping, properties):
    return all(ping[prop] is not None for prop in properties)


def ping_is_valid(ping):
    if not isinstance(ping["client_info/os_version"], str):
        return False
    if not isinstance(ping["client_info/os"], str):
        return False
    if not isinstance(ping["client_info/app_build"], str):
        return False
    if ping["metrics/object/hangs_reports"] is None:
        return False
    return True


def compute_sample_slices(sample_size):
    """Translate a fractional sample-size into a discrete slice count.

    The BigQuery query uses ``ABS(MOD(FARM_FINGERPRINT(document_id), 10000)) < N``
    to deterministically sample pings. N here is the slice count: sample-size
    1.0 → 10000 slices (everything), 0.5 → 5000, 0.0002 → 2, etc. Clamped to
    at least 1 so a misconfigured 0 doesn't accidentally read zero rows.
    """
    raw = _MAX_SAMPLE_SLICES * sample_size
    return int(max(min(raw, _MAX_SAMPLE_SLICES), 1))


def build_query_sql(date, end_date, sample_slices):
    """Build the BigQuery SQL string. Pure function — no client needed.

    Exposed (rather than inlined into get_data) so tests can verify the
    SQL shape without mocking the BQ client.
    """
    submission_start = date - timedelta(days=5)
    submission_end = end_date + timedelta(days=5)
    return f"""
    SELECT
      client_info,
      ping_info,
      metrics
    FROM
      `{_BQ_TABLE}`
    WHERE
      -- Use document_id to sample
      ABS(MOD(FARM_FINGERPRINT(document_id), {_MAX_SAMPLE_SLICES})) < {sample_slices}
      AND submission_timestamp BETWEEN '{submission_start}' AND '{submission_end}'
    """


def _make_client(billing_project):
    """Construct a google-cloud-bigquery client. This replaces the legacy PySpark.

    Imported lazily so the rest of this module can be imported without
    google-cloud-bigquery installed (useful for unit tests, which mock the
    client). Production runs need the package available.
    """
    from google.cloud import bigquery

    return bigquery.Client(project=billing_project)


def get_data(date, sample_size, billing_project, end_date=None, exclude_modules=False):
    """Stream BHR pings from BigQuery, filtered to the active build-date window.

    Args:
        date: datetime.date marking the start of the build-id window
        sample_size: float in [0, 1]; fraction of pings to read
        billing_project: GCP project to bill the BQ query against
        end_date: datetime.date for the end of the build-id window
            (default: same as date — a single-day window)
        exclude_modules: skip the hangs_modules column if True

    Yields:
        Dicts with slash/style keys (one per matching ping) — the same shape
        the rest of the aggregation pipeline expects.
    """
    if end_date is None:
        end_date = date

    date_str = date.strftime("%Y%m%d")
    end_date_str = end_date.strftime("%Y%m%d")

    sample_slices = compute_sample_slices(sample_size)
    sql = build_query_sql(date, end_date, sample_slices)
    properties = _properties_for(exclude_modules)

    client = _make_client(billing_project)
    query_job = client.query(sql)

    total = 0
    kept = 0
    for row in query_job.result():
        total += 1
        ping = get_ping_properties(row, properties)
        if not properties_are_not_none(ping, properties):
            continue
        build_date = ping["client_info/app_build"][:8]
        if build_date < date_str or build_date > end_date_str:
            continue
        kept += 1
        yield ping

    print(f"{total} results total")
    print(f"{kept} results after build-date filter")
