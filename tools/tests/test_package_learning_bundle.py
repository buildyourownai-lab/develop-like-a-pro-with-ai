import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("package_bundle", ROOT / "tools/package_learning_bundle.py")
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)
canonical = packager.canonical
sha = lambda raw: hashlib.sha256(raw).hexdigest()


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.bundle = self.root / "pinned"
        self.bundle.mkdir()
        prompt = b"exact prompt \n"
        contract = {"book_id": "fixture", "edition_id": "edition", "chapter_id": "01",
                    "objectives": [{"id": "g1", "required": True, "expected_outcome": "pass",
                                    "depends_on": [], "evidence_types": ["file-inspection"]}],
                    "prompt_guide": {"entries": [{"id": "p1", "kind": "main", "target": "coding-assistant",
                    "when": "when", "before": "before", "after": "after", "objective_ids": ["g1"],
                    "path": "chapters/01/prompt.txt", "byte_sha256": sha(prompt), "sha256": sha(prompt)}]},
                    "hint_topics": []}
        payloads = {"chapters/01/contract.json": canonical(contract) + b"\n", "chapters/01/prompt.txt": prompt}
        for name in packager.REQUIRED_SUPPORT:
            payloads[name] = (ROOT / name).read_bytes()
        self.manifest = {"schema_version": 1, "book_id": "fixture", "edition_id": "edition",
                         "content_revision": "fixture-r1", "supported_engine_schema": [1],
                         "required_support_version": "1.0.0", "chapter_ids": ["01"], "support_files_included": True,
                         "fingerprint_policy": {"id": "explicit-file-list-v1", "method": "explicit-inspected-inputs", "require_nonempty": True},
                         "files": []}
        for name, raw in sorted(payloads.items()):
            p = self.bundle / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(raw)
            self.manifest["files"].append({"path": name, "byte_length": len(raw), "byte_sha256": sha(raw),
                "role": "support-code" if name in packager.REQUIRED_SUPPORT else "fixture",
                "media_type": "text/plain; charset=utf-8"})
        self.save_manifest()

    def save_manifest(self):
        self.manifest.pop("bundle_sha256", None)
        self.manifest["bundle_sha256"] = sha(canonical(self.manifest))
        (self.bundle / "manifest.json").write_bytes(canonical(self.manifest) + b"\n")

    def output(self, name="release.zip"):
        directory = self.root / (name + "-dir")
        directory.mkdir()
        return directory / name

    def test_reproducible_zip_receipt_fixed_metadata_and_exact_bytes(self):
        a = self.output()
        b = self.root / "other"
        b.mkdir()
        b = b / "release.zip"
        first = packager.package(self.bundle, a)
        # Real filesystem timestamps do not affect the archive.
        for path in self.bundle.rglob("*"):
            if path.is_file():
                os.utime(path, (1700000000, 1800000000))
        second = packager.package(self.bundle, b)
        self.assertEqual(a.read_bytes(), b.read_bytes())
        self.assertEqual(first, second)
        self.assertEqual(json.loads(Path(str(a) + ".sha256.json").read_text()), first)
        self.assertEqual(first["archive_sha256"], sha(a.read_bytes()))
        with zipfile.ZipFile(a) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(archive.namelist(), sorted(archive.namelist()))
            for info in archive.infolist():
                self.assertTrue(info.filename.startswith("studyailab-fixture-r1/"))
                self.assertEqual(info.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertEqual(info.external_attr >> 16, 0o100644)
                self.assertEqual(info.compress_type, zipfile.ZIP_STORED)
                name = info.filename.split("/", 1)[1]
                self.assertEqual(archive.read(info), (self.bundle / name).read_bytes())

    def test_extracted_support_runs_in_isolation_without_bytecode_or_source_checkout(self):
        output = self.output()
        receipt = packager.package(self.bundle, output)
        extracted = self.root / "extracted"
        with zipfile.ZipFile(output) as archive:
            archive.extractall(extracted)
        base = extracted / receipt["archive_root"]
        env = dict(os.environ)
        env.pop("PYTHONPATH", None)
        env.pop("PYTHONDONTWRITEBYTECODE", None)
        run = subprocess.run([sys.executable, str(base / "support/studyailab.py"), "verify-bundle",
              "--bundle", str(base / "manifest.json"), "--book", "fixture", "--edition", "edition"],
              cwd=base, env=env, capture_output=True, check=True, text=True)
        value = json.loads(run.stdout)
        self.assertEqual(value["bundle_sha256"], receipt["bundle_sha256"])
        self.assertFalse(value["project_executed"])
        self.assertFalse(value["actual_host_verified"])
        self.assertFalse(list(base.rglob("__pycache__")))

    def test_corrupt_hash_and_traversal_fail_without_output(self):
        output = self.output()
        path = self.bundle / "chapters/01/prompt.txt"
        original = path.read_bytes()
        path.write_bytes(b"corrupt")
        with self.assertRaises((ValueError, OSError)):
            packager.package(self.bundle, output)
        self.assertFalse(output.exists())
        path.write_bytes(original)
        self.manifest["files"][0]["path"] = "../escape"
        self.save_manifest()
        with self.assertRaises((ValueError, OSError)):
            packager.package(self.bundle, output)
        self.assertFalse(output.exists())

    def test_input_and_output_symlinks_and_unlisted_files_are_rejected(self):
        output = self.output()
        link = self.root / "linked"
        link.symlink_to(self.bundle, target_is_directory=True)
        with self.assertRaises(ValueError):
            packager.package(link, output)
        extra = self.bundle / "extra"
        extra.write_bytes(b"unexpected")
        with self.assertRaises(ValueError):
            packager.package(self.bundle, output)
        extra.unlink()
        inner = self.bundle / "chapters/01/prompt.txt"
        inner.unlink()
        inner.symlink_to(self.root / "outside")
        with self.assertRaises(ValueError):
            packager.package(self.bundle, output)
        inner.unlink()
        inner.write_bytes(b"exact prompt \n")
        output.symlink_to(self.root / "outside")
        with self.assertRaises(ValueError):
            packager.package(self.bundle, output)
        output.unlink()
        alias = self.root / "output-alias"
        alias.symlink_to(output.parent, target_is_directory=True)
        with self.assertRaises(ValueError):
            packager.package(self.bundle, alias / "test.zip")

    def test_missing_support_and_wrong_manifest_fail_closed(self):
        self.manifest["schema_version"] = 99
        self.save_manifest()
        with self.assertRaises(ValueError):
            packager.package(self.bundle, self.output("schema.zip"))
        self.manifest["schema_version"] = 1
        self.manifest["support_files_included"] = False
        self.save_manifest()
        with self.assertRaises(ValueError):
            packager.package(self.bundle, self.output())
        self.manifest["support_files_included"] = True
        self.manifest["files"] = [f for f in self.manifest["files"] if f["path"] != "support/host-instructions.md"]
        (self.bundle / "support/host-instructions.md").unlink()
        self.save_manifest()
        with self.assertRaises(ValueError):
            packager.package(self.bundle, self.output("missing.zip"))

    def test_existing_outputs_and_git_checkout_are_never_overwritten(self):
        output = self.output()
        output.write_bytes(b"keep")
        with self.assertRaises(ValueError):
            packager.package(self.bundle, output)
        self.assertEqual(output.read_bytes(), b"keep")
        output.unlink()
        receipt = Path(str(output) + ".sha256.json")
        receipt.write_bytes(b"keep receipt")
        with self.assertRaises(ValueError):
            packager.package(self.bundle, output)
        self.assertEqual(receipt.read_bytes(), b"keep receipt")
        self.assertFalse(output.exists())
        (self.root / ".git").mkdir()
        with self.assertRaises(ValueError):
            packager.package(self.bundle, output.parent / "tracked.zip")


if __name__ == "__main__":
    unittest.main()
