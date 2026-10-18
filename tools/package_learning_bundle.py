#!/usr/bin/env python3
"""Package a verified pinned learning bundle; never execute bundled code."""
import argparse
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import zipfile

sys.dont_write_bytecode = True
PUBLIC_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PUBLIC_ROOT / "support"))
from studyailab_core.core import Bundle, Invalid, canonical

REQUIRED_SUPPORT = {
    "support/studyailab.py", "support/host-instructions.md",
    "support/studyailab_core/__init__.py", "support/studyailab_core/core.py",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def package(directory, output):
    """Return a value-only receipt; existing targets are never replaced."""
    source = Path(directory).absolute()
    # Do not resolve away any link in the caller's bundle path.
    require(all(not p.is_symlink() for p in (source, *source.parents)), "Symlink bundle path")
    bundle = Bundle(source / "manifest.json")
    m = bundle.manifest
    require(m.get("support_files_included") is True, "Bundled support is required")
    require(all(name in bundle.files and bundle.files[name]["role"] == "support-code"
                for name in REQUIRED_SUPPORT), "Incomplete support files")
    require({name for name, entry in bundle.files.items() if entry["role"] == "support-code"}
            == REQUIRED_SUPPORT, "Unexpected support code")
    destination = Path(output).absolute()
    require(destination.suffix == ".zip", "Output must be a zip file")
    # Resolve system aliases such as macOS /tmp, then reject user-selected leaf links.
    require(not destination.is_symlink(), "Symlink output")
    require(all(not p.is_symlink() or str(p) in {"/tmp", "/var"} for p in destination.parents),
            "Symlink output parent")
    parent = destination.parent.resolve(strict=True)
    require(parent.is_dir(), "Output parent must exist")
    destination = parent / destination.name
    receipt_path = parent / (destination.name + ".sha256.json")
    require(not destination.is_relative_to(PUBLIC_ROOT) and
            not destination.is_relative_to(source), "Output must be outside source repositories and bundle")
    # Reject output into another Git checkout, including its ignored folders.
    require(not any((p / ".git").exists() for p in (parent, *parent.parents)), "Output must be outside Git checkouts")
    require(not destination.exists() and not receipt_path.exists() and not receipt_path.is_symlink(),
            "Output already exists")
    root = "studyailab-" + m["content_revision"]
    require(all(c.isalnum() or c in "_.-" for c in root), "Invalid archive root")
    paths = ["manifest.json", *bundle.files]
    # The validated original bytes, including the original manifest, are preserved.
    entries = {}
    for name in sorted(paths):
        entries[name] = ((source / name).read_bytes() if name == "manifest.json"
                         else bundle.payload(name))
    # Revalidate after all reads, so ordinary concurrent source updates fail closed.
    again = Bundle(source / "manifest.json")
    require(again.manifest == m and (source / "manifest.json").read_bytes() == entries["manifest.json"],
            "Bundle changed during packaging")
    with tempfile.TemporaryDirectory(prefix=".studyailab-package-", dir=parent) as temporary:
        staged = Path(temporary) / "bundle.zip"
        with zipfile.ZipFile(staged, "w", compression=zipfile.ZIP_STORED) as archive:
            for name, raw in sorted(entries.items()):
                info = zipfile.ZipInfo(root + "/" + name, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (0o100644 << 16)
                info.compress_type = zipfile.ZIP_STORED
                archive.writestr(info, raw)
        raw = staged.read_bytes()
        receipt = {"schema_version": 1, "book_id": m["book_id"], "edition_id": m["edition_id"],
                   "content_revision": m["content_revision"], "bundle_sha256": m["bundle_sha256"],
                   "archive_root": root, "archive_file": destination.name,
                   "archive_byte_length": len(raw), "archive_sha256": hashlib.sha256(raw).hexdigest(),
                   "archive_entries": len(entries), "compression": "stored",
                   "support_files_included": True, "project_executed": False, "actual_host_verified": False}
        staged_receipt = Path(temporary) / "receipt.json"
        staged_receipt.write_bytes(canonical(receipt) + b"\n")
        linked = False
        try:
            # Atomic no-clobber publication on the output volume; never follow leaf symlinks.
            os.link(staged, destination)
            linked = True
            os.link(staged_receipt, receipt_path)
        except OSError:
            if linked:
                destination.unlink()
            raise
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True, help="Pinned directory containing manifest.json")
    parser.add_argument("--output", type=Path, required=True, help="New .zip outside Git repositories")
    args = parser.parse_args()
    try:
        receipt = package(args.bundle, args.output)
    except (Invalid, ValueError, OSError, KeyError, TypeError):
        sys.stderr.write("Study AI Lab: packaging validation failed; check pinned input and new external output.\n")
        return 2
    sys.stdout.buffer.write(canonical(receipt) + b"\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
