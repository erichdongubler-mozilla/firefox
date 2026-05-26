#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["brotli", "cryptography", "darkdetect", "humanize", "rich"]
# ///
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""Decode and display the contents of an ssl_tokens_cache.bin file.

File format (see netwerk/base/ssl_tokens_cache/README.md for full specification):
  magic:   4 bytes  b"STCF"
  version: 1 byte   (2 or 3)
  body:    zlib-compressed bincode-1.3 Vec<PersistedRecord>

Version 2: cert blobs are raw DER.
Version 3: cert blobs are brotli-compressed with a 4-byte little-endian
           original-length prefix.

Run with ``uv run decode_ssl_tokens_cache.py`` for automatic dependency
installation, or ``pip install brotli cryptography darkdetect humanize rich``
for plain Python.
"""

import argparse
import datetime
import io
import struct
import sys
import warnings
import zlib
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import TypeVar, cast

try:
    import darkdetect
    import humanize
    from rich import box as rich_box
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
    from rich.text import Text
    from rich.theme import Theme
except ImportError as e:
    sys.exit(
        f"Missing dependency: {e.name}\n"
        f"Run with: uv run {sys.argv[0]}\n"
        f"Or install manually: pip install darkdetect humanize rich"
    )

_DARK_THEME = Theme({"label": "dim", "cert": "cyan", "live": "green"})
_LIGHT_THEME = Theme({"label": "italic", "cert": "dark_cyan", "live": "dark_green"})

try:
    from cryptography import x509 as _x509
except ImportError:
    _x509 = None  # type: ignore[assignment]

try:
    import brotli as _brotli
except ImportError:
    _brotli = None  # type: ignore[assignment]

MAGIC = b"STCF"
SUPPORTED_VERSIONS = (2, 3)

T = TypeVar("T")


class DecodeError(Exception):
    pass


@dataclass
class Record:
    key: str
    expires: datetime.datetime
    token: bytes
    ev_status: int
    ct_status: int
    overridable_error: int
    server_cert: bytes
    succeeded_cert_chain: list[bytes] | None
    handshake_certs: list[bytes] | None
    built_in_root: bool | None
    size: int = 0


def _decompress_cert(data: bytes) -> bytes:
    """Return raw DER for a version-3 cert blob (4-byte prefix + brotli body)."""
    if len(data) < 4:
        return data
    if _brotli is None:
        return data  # can't decompress; caller will show byte-count fallback
    try:
        return _brotli.decompress(data[4:])
    except Exception:  # pylint: disable=broad-exception-caught
        return data  # corrupt; fall back to raw bytes


class Reader:
    """Minimal bincode-1.3 (little-endian, u64 lengths) stream reader."""

    _U8 = struct.Struct("<B")
    _U16 = struct.Struct("<H")
    _U64 = struct.Struct("<Q")
    _I64 = struct.Struct("<q")

    def __init__(self, data: bytes, version: int = 2):
        self._buf = io.BytesIO(data)
        self._len = len(data)
        self._version = version

    def remaining(self) -> int:
        return self._len - self._buf.tell()

    def _read(self, n: int) -> bytes:
        chunk = self._buf.read(n)
        if len(chunk) != n:
            raise DecodeError(
                f"truncated: need {n} bytes at offset {self._buf.tell()}, "
                f"only {len(chunk)} available"
            )
        return chunk

    def _unpack(self, fmt: struct.Struct) -> int:
        (value,) = fmt.unpack(self._read(fmt.size))
        return cast(int, value)

    def u8(self) -> int:
        return self._unpack(self._U8)

    def u16(self) -> int:
        return self._unpack(self._U16)

    def u64(self) -> int:
        return self._unpack(self._U64)

    def i64(self) -> int:
        return self._unpack(self._I64)

    def read_bool(self) -> bool:
        return bool(self.u8())

    def bytes_vec(self) -> bytes:
        return self._read(self.u64())

    def cert_bytes_vec(self) -> bytes:
        raw = self.bytes_vec()
        return _decompress_cert(raw) if self._version >= 3 else raw

    def vec_of_cert_bytes(self) -> list[bytes]:
        return [self.cert_bytes_vec() for _ in range(self.u64())]

    def option(self, f: Callable[[], T]) -> T | None:
        tag = self.u8()
        if not tag:
            return None
        if tag == 1:
            return f()
        raise DecodeError(f"invalid Option discriminant {tag}")

    def record(self) -> Record:
        start = self._buf.tell()
        self.u64()  # session-internal id, re-assigned on load; not displayed
        key = self.bytes_vec().decode("utf-8", errors="replace")
        prtime = self.i64()
        expires = datetime.datetime.fromtimestamp(
            prtime / 1e6, tz=datetime.timezone.utc
        )
        rec = Record(
            key=key,
            expires=expires,
            token=self.bytes_vec(),
            ev_status=self.u8(),
            ct_status=self.u16(),
            overridable_error=self.u8(),
            server_cert=self.cert_bytes_vec(),
            succeeded_cert_chain=self.option(self.vec_of_cert_bytes),
            handshake_certs=self.option(self.vec_of_cert_bytes),
            built_in_root=self.option(self.read_bool),
        )
        rec.size = self._buf.tell() - start
        return rec

    def records(self) -> list[Record]:
        return [self.record() for _ in range(self.u64())]


@lru_cache(maxsize=256)
def cert_subject(der: bytes) -> str:
    if _x509 is not None:
        try:
            return str(_x509.load_der_x509_certificate(der).subject.rfc4514_string())
        except Exception:  # pylint: disable=broad-exception-caught
            pass
    return f"<{len(der)} bytes DER>"


def _hexdump_text(data: bytes) -> Text:
    t = Text()
    for off in range(0, len(data), 16):
        chunk = data[off : off + 16]
        hex_part = " ".join(f"{b:02x}" for b in chunk)
        asc_part = "".join(chr(b) if 0x20 <= b < 0x7F else "." for b in chunk)
        t.append(f"{off:04x}", style="dim")
        t.append(f"  {hex_part:<47}  ")
        t.append(asc_part, style="dim")
        t.append("\n")
    return t


def _chain_text(chain: list[bytes], verbose: int) -> str:
    count = f"{len(chain)} cert(s)"
    if verbose >= 1:
        subjects = "  ".join(cert_subject(c) for c in chain)
        return f"{count}  {subjects}"
    return count


def print_record(
    idx: int, rec: Record, verbose: int, now: datetime.datetime, console: Console
) -> None:
    expired = rec.expires < now

    tbl = Table(box=None, show_header=False, show_edge=False, padding=(0, 1, 0, 0))
    tbl.add_column(style="label", min_width=11, no_wrap=True)
    tbl.add_column()

    rel = humanize.naturaltime(rec.expires, when=now)
    status = (
        Text("EXPIRED", style="bold red") if expired else Text("live", style="live")
    )
    tbl.add_row(
        "expires",
        Text.assemble(
            rec.expires.strftime("%Y-%m-%d %H:%M:%S UTC"),
            ("  ", ""),
            (f"({rel})", "dim"),
            "  ",
            status,
        ),
    )
    tbl.add_row("token", humanize.naturalsize(len(rec.token)))
    if verbose >= 2:
        tbl.add_row("", _hexdump_text(rec.token))

    flag_parts = [
        f"ev={rec.ev_status}",
        f"ct={rec.ct_status}",
        f"ovr_error={rec.overridable_error}",
        *([] if rec.built_in_root is None else [f"built_in_root={rec.built_in_root}"]),
    ]
    tbl.add_row("flags", "  ".join(flag_parts))

    if rec.server_cert:
        tbl.add_row("server cert", Text(cert_subject(rec.server_cert), style="cert"))
    for label, chain in [
        ("chain", rec.succeeded_cert_chain),
        ("hs certs", rec.handshake_certs),
    ]:
        if chain is not None:
            tbl.add_row(label, _chain_text(chain, verbose))

    console.print(
        Panel(
            tbl,
            title=f"[bold][{idx}][/] {rec.key}  [dim]{humanize.naturalsize(rec.size)}[/]",
            title_align="left",
            box=rich_box.ROUNDED,
            border_style="red" if expired else "default",
        )
    )


def decode(path: str, verbose: int, console: Console) -> None:
    data = Path(path).read_bytes()

    if len(data) < 5:
        raise DecodeError("file too short to contain header")
    magic, version = data[:4], data[4]
    if magic != MAGIC:
        raise DecodeError(f"bad magic: expected {MAGIC!r}, got {magic!r}")
    if version not in SUPPORTED_VERSIONS:
        raise DecodeError(
            f"unsupported version {version} "
            f"(this script handles versions {SUPPORTED_VERSIONS})"
        )

    if version >= 3 and _brotli is None:
        warnings.warn(
            "brotli package not found; cert subjects will show as byte counts",
            stacklevel=2,
        )

    try:
        payload = zlib.decompress(data[5:])
    except zlib.error as e:
        raise DecodeError(f"zlib decompression failed: {e}") from e

    reader = Reader(payload, version)
    records = reader.records()

    if reader.remaining():
        warnings.warn(
            f"{reader.remaining()} trailing bytes after records", stacklevel=2
        )

    now = datetime.datetime.now(datetime.timezone.utc)
    n_expired = sum(r.expires < now for r in records)

    summary = Table(box=None, show_header=False, show_edge=False, padding=(0, 1, 0, 0))
    summary.add_column(style="label")
    summary.add_column()
    summary.add_row("version", str(version))
    summary.add_row("records", f"{len(records)} [dim]({n_expired} expired)[/dim]")
    summary.add_row(
        "payload",
        f"{humanize.naturalsize(len(payload))} uncompressed, "
        f"{humanize.naturalsize(len(data) - 5)} compressed",
    )
    console.print(
        Panel(
            summary, title=f"[bold]{path}[/]", title_align="left", box=rich_box.ROUNDED
        )
    )
    console.print()

    for i, rec in enumerate(records):
        print_record(i, rec, verbose, now, console)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Decode an ssl_tokens_cache.bin file from a Firefox profile."
    )
    parser.add_argument("file", help="path to ssl_tokens_cache.bin")
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help="-v: show cert chain subjects; -vv: also hexdump token bytes",
    )
    parser.add_argument(
        "--no-color",
        action="store_true",
        help="disable color output",
    )
    args = parser.parse_args()

    con = (
        Console(no_color=True, theme=_LIGHT_THEME)
        if args.no_color
        else Console(theme=_DARK_THEME if darkdetect.isDark() else _LIGHT_THEME)
    )

    try:
        decode(args.file, args.verbose, con)
    except (DecodeError, OSError) as e:
        Console(stderr=True).print(f"[bold red]error:[/] {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
