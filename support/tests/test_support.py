import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studyailab_core.core import (Bundle, Invalid, Project, assemble_chunks,
                                 canonical, digest, parse_json, read_file)


class SupportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name).resolve()
        self.bundle_root = self.base / "bundle"
        self.bundle_root.mkdir()
        self.project_root = self.base / "reader 한글 space"
        self.project_root.mkdir()
        self.project = Project(self.project_root)
        self.make_bundle()
        self.bundle = Bundle(self.bundle_root / "manifest.json", "test", "edition")
        (self.project_root / "product.txt").write_bytes(b"product-v1\n")
        (self.project_root / "evidence").mkdir()
        (self.project_root / "evidence/result.txt").write_bytes(b"redacted observation\n")

    def make_bundle(self, mutator=None):
        objective = {"id": "g1", "required": True, "depends_on": [], "evidence_types": ["file-inspection", "test-run"],
                     "expected_outcome": "pass", "environment": "local-or-manual", "expiry_hours": None}
        c = {"book_id": "test", "edition_id": "edition", "chapter_id": "01", "objectives": [objective],
             "prompt_guide": {"entries": [{"id": "p1", "kind": "main", "target": "coding-assistant",
              "before": "before", "after": "after", "when": "when", "objective_ids": ["g1"],
              "path": "chapters/01/prompts/p1.txt", "sha256": digest(b"  exact \ntext  "),
              "byte_sha256": digest(b"  exact \ntext  ")}]},
             "hint_topics": [{"id": "h1", "steps": [{"level": i, "path": "chapters/01/hints/" + str(i) + ".txt",
                             "byte_sha256": digest(("step" + str(i)).encode())} for i in range(1, 5)]}]}
        if mutator:
            mutator(c)
        files = {"chapters/01/contract.json": canonical(c) + b"\n",
                 "chapters/01/prompts/p1.txt": b"  exact \ntext  "}
        files.update({"chapters/01/hints/" + str(i) + ".txt": ("step" + str(i)).encode() for i in range(1, 5)})
        m = {"schema_version": 1, "supported_engine_schema": [1], "required_support_version": "1.0.0",
             "book_id": "test", "edition_id": "edition", "content_revision": "r1", "chapter_ids": ["01"],
             "fingerprint_policy": {"id": "explicit-file-list-v1", "method": "explicit-inspected-inputs", "require_nonempty": True},
             "files": []}
        for name, raw in sorted(files.items()):
            p = self.bundle_root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(raw)
            m["files"].append({"path": name, "byte_length": len(raw), "byte_sha256": digest(raw),
                               "role": "fixture", "media_type": "text/plain"})
        m["bundle_sha256"] = digest(canonical(m))
        (self.bundle_root / "manifest.json").write_bytes(canonical(m) + b"\n")

    def evidence(self, **changes):
        result = {"id": "e1", "objective_id": "g1", "book": "test", "edition": "edition", "revision": "r1",
                  "contract_sha256": self.bundle.contract_hash("01"), "kind": "file-inspection", "expected": "pass",
                  "observed_outcome": "pass", "environment": "local", "observer": "assistant",
                  "observed_at": datetime.now(timezone.utc).isoformat(),
                  "verification": "recorded-observation-not-independent-attestation", "redacted": True,
                  "validity_scope": "current_condition", "artifact": {"path": "evidence/result.txt",
                  "byte_sha256": digest((self.project_root / "evidence/result.txt").read_bytes())},
                  "inspected_inputs": [{"path": "product.txt", "byte_sha256": digest(b"product-v1\n")}]}
        result.update(changes)
        return result

    def test_empty_progress_never_passes_and_reads_do_not_create_state(self):
        p = self.project.progress(self.bundle, "01")
        self.assertEqual((p["completed"], p["chapter_complete"]), (0, False))
        self.assertFalse((self.project_root / ".studyailab").exists())

    def test_exact_prompt_and_single_hint_do_not_leak_solution(self):
        self.assertEqual(self.bundle.prompt("01", "p1")["text"], "  exact \ntext  ")
        self.assertEqual(self.bundle.hint("01", "h1", 1)["text"], "step1")
        with self.assertRaises(Invalid):
            self.bundle.hint("01", "h1", 4)
        self.assertEqual(self.bundle.hint("01", "h1", 4, True)["text"], "step4")

    def test_preview_then_append_and_file_change_stales(self):
        e = self.evidence()
        self.assertFalse(self.project.record(self.bundle, "01", e)["applied"])
        self.assertFalse((self.project_root / ".studyailab").exists())
        self.project.record(self.bundle, "01", e, True)
        self.assertTrue(self.project.progress(self.bundle, "01")["chapter_complete"])
        (self.project_root / "product.txt").write_bytes(b"changed")
        self.assertFalse(self.project.progress(self.bundle, "01")["chapter_complete"])

    def test_latest_fail_does_not_fallback_to_pass(self):
        self.project.record(self.bundle, "01", self.evidence(), True)
        self.project.record(self.bundle, "01", self.evidence(id="e2", observed_outcome="fail"), True)
        self.assertEqual(self.project.progress(self.bundle, "01")["objectives"]["g1"]["status"], "failed")

    def test_live_goal_cannot_use_simulation(self):
        self.make_bundle(lambda c: c["objectives"][0].update(environment="actual-account-or-service"))
        self.bundle = Bundle(self.bundle_root / "manifest.json")
        self.project.record(self.bundle, "01", self.evidence(environment="simulation"), True)
        self.assertFalse(self.project.progress(self.bundle, "01")["chapter_complete"])

    def test_future_unknown_observer_and_missing_inputs_rejected(self):
        invalid = [self.evidence(observed_at=(datetime.now(timezone.utc) + timedelta(days=1)).isoformat()),
                   self.evidence(observer="invented"), self.evidence(inspected_inputs=[]), self.evidence(redacted=False)]
        for e in invalid:
            with self.subTest(e=e["id"]), self.assertRaises(Invalid):
                self.project.record(self.bundle, "01", e, True)

    def test_location_copy_rejected(self):
        self.project.record(self.bundle, "01", self.evidence(), True)
        other = self.base / "copy"
        shutil.copytree(self.project_root, other)
        with self.assertRaises(Invalid):
            Project(other).progress(self.bundle, "01")

    def test_explicit_rebind_preview_preserves_history(self):
        self.project.record(self.bundle, "01", self.evidence(), True)
        other = self.base / "moved"
        shutil.copytree(self.project_root, other)
        moved = Project(other)
        e = self.evidence(id="e2")
        self.assertFalse(moved.record(self.bundle, "01", e, rebind=True)["applied"])
        with self.assertRaises(Invalid):
            moved.state()
        moved.record(self.bundle, "01", e, True, True)
        self.assertEqual(len(moved.state()["rebind_history"]), 1)
        self.assertEqual(len(moved.observations(self.bundle, "01")), 2)

    def test_append_only_and_lock(self):
        self.project.record(self.bundle, "01", self.evidence(), True)
        with self.assertRaises(Invalid):
            self.project.record(self.bundle, "01", self.evidence(), True)
        (self.project_root / ".studyailab/record.lock").write_bytes(b"busy")
        with self.assertRaises(Invalid):
            self.project.record(self.bundle, "01", self.evidence(id="e2"), True)

    def test_historical_snapshot_survives_product_change_and_detects_tampering(self):
        self.make_bundle(lambda c: c["objectives"][0].update(evidence_semantics="historical_learning_event", expected_outcome="fail"))
        self.bundle = Bundle(self.bundle_root / "manifest.json")
        e = self.evidence(validity_scope="historical_learning_event", expected="fail", observed_outcome="fail")
        with self.assertRaises(Invalid):
            self.project.record(self.bundle, "01", e, True)
        e["inspected_inputs"] = [{"path": "evidence/result.txt", "byte_sha256": e["artifact"]["byte_sha256"]}]
        self.project.record(self.bundle, "01", e, True)
        (self.project_root / "product.txt").write_bytes(b"fixed")
        self.assertTrue(self.project.progress(self.bundle, "01")["chapter_complete"])
        (self.project_root / "evidence/result.txt").write_bytes(b"altered")
        self.assertFalse(self.project.progress(self.bundle, "01")["chapter_complete"])

    def test_explicit_expected_failure_contract_maps_fail_only(self):
        self.make_bundle(lambda c: c["objectives"][0].update(evidence_semantics="historical_learning_event", expected_outcome="expected-failure-observed"))
        self.bundle = Bundle(self.bundle_root / "manifest.json")
        e = self.evidence(validity_scope="historical_learning_event", expected="expected-failure-observed", observed_outcome="fail")
        e["inspected_inputs"] = [{"path": "evidence/result.txt", "byte_sha256": e["artifact"]["byte_sha256"]}]
        self.project.record(self.bundle, "01", e, True)
        self.assertTrue(self.project.progress(self.bundle, "01")["chapter_complete"])
        e.update(id="e2", observed_outcome="pass", observed_at=datetime.now(timezone.utc).isoformat())
        self.project.record(self.bundle, "01", e, True)
        self.assertFalse(self.project.progress(self.bundle, "01")["chapter_complete"])

    def test_contract_revision_change_and_expiry_block_previous_success(self):
        old = self.evidence()
        self.project.record(self.bundle, "01", old, True)
        self.make_bundle(lambda c: c["objectives"][0].update(expiry_hours=1))
        revised = Bundle(self.bundle_root / "manifest.json")
        self.assertFalse(self.project.progress(revised, "01")["chapter_complete"])
        self.bundle = revised
        expired = self.evidence(id="e2", observed_at=(datetime.now(timezone.utc) - timedelta(hours=2)).isoformat())
        self.project.record(self.bundle, "01", expired, True)
        self.assertFalse(self.project.progress(self.bundle, "01")["chapter_complete"])

    def test_incomplete_dependencies_block_valid_later_observation(self):
        def update(c):
            second = copy.deepcopy(c["objectives"][0])
            second.update(id="g2", depends_on=["g1"])
            c["objectives"].append(second)
        self.make_bundle(update)
        self.bundle = Bundle(self.bundle_root / "manifest.json")
        self.project.record(self.bundle, "01", self.evidence(objective_id="g2"), True)
        self.assertEqual(self.project.progress(self.bundle, "01")["objectives"]["g2"]["status"], "blocked")

    def test_corrupt_store_never_returns_completed(self):
        self.project.record(self.bundle, "01", self.evidence(), True)
        state = self.project_root / self.project.evidence_path(self.bundle, "01")
        state.write_bytes(b'{"broken":')
        with self.assertRaises(Invalid):
            self.project.progress(self.bundle, "01")

    def test_secret_paths_symlink_traversal_rejected_without_reading(self):
        (self.project_root / ".env").write_bytes(b"synthetic-do-not-read")
        (self.project_root / "link").symlink_to(self.project_root / "product.txt")
        for name in [".env", "../outside", "/etc/passwd", "link", "a\\b", "x/.git/config"]:
            with self.subTest(name=name), self.assertRaises(Invalid):
                read_file(self.project_root, name)
        (self.project_root / ".studyailab").symlink_to(self.base / "outside")
        with self.assertRaises(Invalid):
            self.project.record(self.bundle, "01", self.evidence(), True)

    def test_bundle_corruption_extra_symlink_and_duplicate_paths(self):
        path = self.bundle_root / "chapters/01/prompts/p1.txt"
        path.write_bytes(b"changed")
        with self.assertRaises(Invalid):
            Bundle(self.bundle_root / "manifest.json")
        self.make_bundle()
        (self.bundle_root / "extra").write_bytes(b"extra")
        with self.assertRaises(Invalid):
            Bundle(self.bundle_root / "manifest.json")
        (self.bundle_root / "extra").unlink()
        path.unlink()
        path.symlink_to(self.project_root / "product.txt")
        with self.assertRaises(Invalid):
            Bundle(self.bundle_root / "manifest.json")

    def test_zero_required_and_dependency_cycle_rejected(self):
        for mutation in [lambda c: c["objectives"][0].update(required=False),
                         lambda c: c["objectives"][0].update(depends_on=["g1"])]:
            self.make_bundle(mutation)
            with self.assertRaises(Invalid):
                Bundle(self.bundle_root / "manifest.json")

    def test_json_duplicate_bom_crlf_invalid_utf8_rejected(self):
        for raw in [b'{"a":1,"a":2}', b'\xef\xbb\xbf{}', b'{}\r\n', b'\xff', b'{"a":NaN}']:
            with self.assertRaises(Invalid):
                parse_json(raw)

    def test_chunk_integrity_order_and_revision(self):
        import base64
        data = ["한글 ".encode(), "끝".encode()]
        chunks = []
        offset = 0
        for i, raw in enumerate(data):
            chunks.append({"schema_version": 1, "status": "ok", "book_id": "test", "edition_id": "edition",
                           "bundle_sha256": "a" * 64, "content_revision": "r1", "data": {
                           "status": "chunk", "encoding": "utf-8", "chunk_index": i, "chunk_count": 2,
                           "byte_offset": offset, "byte_length": sum(map(len, data)), "byte_sha256": digest(b"".join(data)),
                           "chunk_byte_length": len(raw), "chunk_sha256": digest(raw),
                           "chunk_base64": base64.b64encode(raw).decode()}})
            offset += len(raw)
        self.assertEqual(assemble_chunks(chunks, "r1", digest(b"".join(data)), offset), "한글 끝")
        for bad in [chunks[::-1], chunks[:1], [{**chunks[0], "content_revision": "r2"}, chunks[1]]]:
            with self.assertRaises(Invalid):
                assemble_chunks(bad, "r1", digest(b"".join(data)), offset)

    def test_real_remote_sdk_chunk_snapshot_and_tampering(self):
        fixture = json.loads((Path(__file__).parent / "remote-contract-chunks.json").read_text(encoding="utf-8"))
        metadata, chunks = fixture["metadata"], fixture["chunks"]
        raw = assemble_chunks(chunks, metadata["content_revision"], metadata["data"]["byte_sha256"], metadata["data"]["byte_length"])
        self.assertEqual(json.loads(raw)["chapter_id"], "01")
        for key, value in [("byte_offset", 1), ("chunk_byte_length", 1), ("chunk_sha256", "0" * 64),
                           ("byte_sha256", "0" * 64), ("chunk_count", 999), ("chunk_base64", "%%%%")]:
            bad = copy.deepcopy(chunks)
            bad[0]["data"][key] = value
            with self.subTest(key=key), self.assertRaises(Invalid):
                assemble_chunks(bad, metadata["content_revision"], metadata["data"]["byte_sha256"], metadata["data"]["byte_length"])
        for key in ["content_revision", "edition_id", "bundle_sha256"]:
            bad = copy.deepcopy(chunks)
            bad[-1][key] = "different"
            with self.subTest(key=key), self.assertRaises(Invalid):
                assemble_chunks(bad, metadata["content_revision"], metadata["data"]["byte_sha256"], metadata["data"]["byte_length"])

    def test_verify_chunks_cli_accepts_saved_raw_responses_and_rejects_tampering(self):
        import contextlib
        import io
        spec = importlib.util.spec_from_file_location("studyailab_cli", Path(__file__).resolve().parents[1] / "studyailab.py")
        cli = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cli)
        fixture = json.loads((Path(__file__).parent / "remote-contract-chunks.json").read_text(encoding="utf-8"))

        def run(meta, chunks):
            files = []
            for name, value in [("meta.json", meta)] + [(f"c{i}.json", c) for i, c in enumerate(chunks)]:
                (self.base / name).write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
                files.append(str(self.base / name))
            raw, err = io.BytesIO(), io.StringIO()
            out = io.TextIOWrapper(raw, encoding="utf-8")
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = cli.main(["verify-chunks", "--metadata", files[0], "--chunks", *files[1:]])
            out.flush()
            return code, raw.getvalue().decode("utf-8")

        code, out = run(fixture["metadata"], fixture["chunks"])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual((result["status"], result["byte_length"]), ("verified_chunks", 12291))
        self.assertEqual(json.loads(result["contract_text"])["chapter_id"], "01")
        bad = copy.deepcopy(fixture["chunks"])
        bad[1]["data"]["chunk_sha256"] = "0" * 64
        self.assertEqual(run(fixture["metadata"], bad)[0], 2)
        self.assertEqual(run(fixture["metadata"], fixture["chunks"][:1])[0], 2)
        bad = copy.deepcopy(fixture["chunks"])
        bad[1]["bundle_sha256"] = "f" * 64
        self.assertEqual(run(fixture["metadata"], bad)[0], 2)

    def test_utf8_base64_and_mixed_wire_chunks_reconstruct_identical_bytes(self):
        import base64
        fixture = json.loads((Path(__file__).parent / "remote-contract-chunks.json").read_text(encoding="utf-8"))
        metadata, binary = fixture["metadata"], fixture["chunks"]
        utf8 = copy.deepcopy(binary)
        for envelope in utf8:
            d = envelope["data"]
            d["chunk_encoding"] = "utf8"
            d["text"] = base64.b64decode(d.pop("chunk_base64")).decode("utf-8")
        def assemble(chunks):
            return assemble_chunks(chunks, metadata["content_revision"], metadata["data"]["byte_sha256"], metadata["data"]["byte_length"])
        expected = assemble(binary)
        self.assertEqual(assemble(utf8), expected)
        mixed = [copy.deepcopy(utf8[0])] + copy.deepcopy(binary[1:])
        self.assertEqual(assemble(mixed), expected)
        bad = copy.deepcopy(utf8)
        bad[0]["data"]["text"] += "broken"
        with self.assertRaises(Invalid):
            assemble(bad)
        bad = copy.deepcopy(utf8)
        bad[0]["data"]["chunk_base64"] = binary[0]["data"]["chunk_base64"]
        with self.assertRaises(Invalid):
            assemble(bad)

    def test_non_live_goal_simulation_never_verifies(self):
        self.project.record(self.bundle, "01", self.evidence(environment="simulation"), True)
        self.assertFalse(self.project.progress(self.bundle, "01")["chapter_complete"])

    def test_observer_matches_timestamp_selected_evidence(self):
        later = self.evidence(observer="reader")
        self.project.record(self.bundle, "01", later, True)
        older = self.evidence(id="e2", observer="assistant", observed_at=(datetime.now(timezone.utc) - timedelta(hours=1)).isoformat())
        self.project.record(self.bundle, "01", older, True)
        self.assertEqual(self.project.progress(self.bundle, "01")["objectives"]["g1"]["observation_source"], "reader")

    def test_command_timeout_and_exit_contradiction(self):
        now = datetime.now(timezone.utc).isoformat()
        e = self.evidence(kind="test-run")
        e["command"] = {"argv": ["python", "test.py"], "exit_code": 1, "timeout": False,
                        "started_at": now, "ended_at": now, "stdout": e["artifact"], "stderr": e["artifact"]}
        e["observed_at"] = now
        with self.assertRaises(Invalid):
            self.project.record(self.bundle, "01", e, True)
        e["command"]["timeout"] = True
        self.project.record(self.bundle, "01", e, True)
        self.assertFalse(self.project.progress(self.bundle, "01")["chapter_complete"])


if __name__ == "__main__":
    unittest.main()
