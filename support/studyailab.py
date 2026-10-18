#!/usr/bin/env python3
"""Offline support CLI. JSON stdout; safe value-free errors; no project execution."""
import argparse
import sys
from pathlib import Path

sys.dont_write_bytecode = True

from studyailab_core import VERSION
from studyailab_core.core import Bundle, Invalid, Project, assemble_chunks, canonical, parse_json, read_json, require


def verify_chunks(metadata_path, chunk_paths):
    """Per-chunk and combined UTF-8 byte length/SHA check of saved MCP contract responses."""
    require(metadata_path and chunk_paths, "Metadata and chunk files are required")
    meta = parse_json(Path(metadata_path).read_bytes())
    data = meta.get("data") if isinstance(meta, dict) else None
    require(isinstance(data, dict) and data.get("status") == "chunked"
            and data.get("chunk_count") == len(chunk_paths), "Chunk metadata mismatch")
    chunks = [parse_json(Path(p).read_bytes()) for p in chunk_paths]
    contract = assemble_chunks(chunks, meta.get("content_revision"), data.get("byte_sha256"), data.get("byte_length"))
    for c in chunks:
        require(all(c.get(k) == meta.get(k) for k in ("book_id", "edition_id", "bundle_sha256")), "Chunk identity mismatch")
    return {"status": "verified_chunks", "chunk_count": len(chunks), "byte_length": data["byte_length"],
            "byte_sha256": data["byte_sha256"], "content_revision": meta["content_revision"],
            "contract_text": contract}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["doctor", "inspect", "prompt", "hint", "progress", "record", "verify-bundle", "verify-chunks"])
    parser.add_argument("--bundle", help="Pinned manifest.json path (required except verify-chunks)")
    parser.add_argument("--book")
    parser.add_argument("--edition")
    parser.add_argument("--metadata", help="verify-chunks: saved raw 'chunked' MCP response file")
    parser.add_argument("--chunks", nargs="+", help="verify-chunks: saved raw chunk response files, in index order")
    parser.add_argument("--chapter")
    parser.add_argument("--project")
    parser.add_argument("--prompt-id")
    parser.add_argument("--topic")
    parser.add_argument("--level", type=int, default=1)
    parser.add_argument("--explicit-solution", action="store_true")
    parser.add_argument("--evidence", help="Redacted JSON path relative to project")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--rebind", action="store_true", help="Explicit record request after project move; preserves history")
    args = parser.parse_args(argv)
    try:
        if sys.version_info < (3, 10):
            raise Invalid("Python 3.10 or newer required")
        if (args.apply or args.rebind) and args.command != "record":
            raise Invalid("Apply is only available for record")
        if args.command == "verify-chunks":
            result = verify_chunks(args.metadata, args.chunks)
            sys.stdout.buffer.write(canonical(result) + b"\n")
            return 0
        require(args.bundle and args.book and args.edition, "Bundle, book and edition are required")
        bundle = Bundle(args.bundle, args.book, args.edition)
        result = {"support_version": VERSION, "book_id": args.book, "edition_id": args.edition,
                  "content_revision": bundle.manifest["content_revision"], "bundle_sha256": bundle.manifest["bundle_sha256"]}
        if args.command in {"verify-bundle", "doctor"}:
            if args.command == "doctor" and args.project:
                Project(args.project).state()
            result.update({"status": "verified_bundle", "chapter_count": len(bundle.contracts),
                           "project_executed": False, "actual_host_verified": False})
        else:
            bundle.chapter(args.chapter)
            if args.command == "inspect":
                result["data"] = bundle.chapter(args.chapter)
            elif args.command == "prompt":
                result["data"] = bundle.prompt(args.chapter, args.prompt_id)
            elif args.command == "hint":
                result["data"] = bundle.hint(args.chapter, args.topic, args.level, args.explicit_solution)
            else:
                if not args.project:
                    raise Invalid("Project is required")
                project = Project(args.project)
                if args.command == "progress":
                    result["data"] = project.progress(bundle, args.chapter)
                else:
                    evidence = read_json(project.root, args.evidence)
                    result["data"] = project.record(bundle, args.chapter, evidence, args.apply, args.rebind)
        sys.stdout.buffer.write(canonical(result) + b"\n")
        return 0
    except (Invalid, OSError, ValueError, TypeError, KeyError, RecursionError):
        # Do not echo supplied values, paths, file content or provider errors.
        sys.stderr.write("Study AI Lab: validation failed; check pinned files, required arguments and redacted evidence.\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
