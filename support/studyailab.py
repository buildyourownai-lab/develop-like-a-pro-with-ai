#!/usr/bin/env python3
"""Offline support CLI. JSON stdout; safe value-free errors; no project execution."""
import argparse
import sys

sys.dont_write_bytecode = True

from studyailab_core import VERSION
from studyailab_core.core import Bundle, Invalid, Project, canonical, read_json


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["doctor", "inspect", "prompt", "hint", "progress", "record", "verify-bundle"])
    parser.add_argument("--bundle", required=True, help="Pinned manifest.json path")
    parser.add_argument("--book", required=True)
    parser.add_argument("--edition", required=True)
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
