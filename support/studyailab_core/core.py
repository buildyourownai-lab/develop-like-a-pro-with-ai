"""Strict bundle reads and local observation records; Python 3.10 stdlib only."""
import base64
import hashlib
import json
import os
import re
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from . import VERSION


class Invalid(ValueError):
    """Safe, value-free validation error."""


def require(condition, message):
    if not condition:
        raise Invalid(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def text(data):
    require(not data.startswith(b"\xef\xbb\xbf") and b"\r" not in data,
            "Expected UTF-8 without BOM and LF line endings")
    try:
        return data.decode("utf-8", errors="strict")
    except UnicodeError:
        raise Invalid("Invalid UTF-8") from None


def parse_json(data):
    def pairs(items):
        result = {}
        for k, v in items:
            require(k not in result, "Duplicate JSON key")
            result[k] = v
        return result
    try:
        return json.loads(text(data), object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(Invalid("Invalid JSON number")))
    except (ValueError, TypeError, RecursionError):
        raise Invalid("Invalid JSON document") from None


def slug(value):
    require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}", value),
            "Invalid identifier")
    return value


def sha(value):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value), "Invalid SHA256")
    return value


def relative(value):
    require(isinstance(value, str) and value and "\\" not in value and ":" not in value,
            "Invalid relative path")
    p = PurePosixPath(value)
    require(not p.is_absolute() and all(x not in ("", ".", "..") for x in value.split("/")),
            "Unsafe relative path")
    return value


def safe_path(root, name, allow_state=False):
    relative(name)
    parts = PurePosixPath(name).parts
    for part in parts:
        lower = part.lower()
        require(lower not in {".git", "node_modules", ".venv", "venv", "__pycache__", ".ssh", ".aws", ".azure", ".gnupg", ".codex", ".claude"},
                "Excluded path")
        require(not lower.startswith(".env") and not lower.endswith((".pem", ".key", ".p12", ".pfx"))
                and lower not in {"credentials", "credentials.json", "secrets.json", ".secrets", ".npmrc", ".netrc", "id_rsa", "id_ed25519"},
                "Credential paths are forbidden")
        require(allow_state or lower != ".studyailab", "State is not a product input")
    root = Path(root)
    require(root.is_dir() and not root.is_symlink(), "Root must be an existing real directory")
    current = root
    for part in parts:
        current = current / part
        require(not current.is_symlink(), "Symlink is forbidden")
    return current


def read_file(root, name, allow_state=False, limit=16 * 1024 * 1024):
    p = safe_path(root, name, allow_state)
    require(p.is_file() and p.stat().st_size <= limit, "Missing or oversized file")
    return p.read_bytes()


def read_json(root, name, allow_state=False):
    return parse_json(read_file(root, name, allow_state))


class Bundle:
    def __init__(self, manifest, book=None, edition=None):
        path = Path(manifest)
        # Check original components before resolve, including a symlinked parent.
        absolute = path.absolute()
        require(all(not p.is_symlink() for p in (absolute, *absolute.parents)), "Symlinked bundle path")
        self.root = absolute.parent
        self.manifest = read_json(self.root, absolute.name)
        m = self.manifest
        require(isinstance(m, dict) and m.get("schema_version") == 1,
                "Unsupported manifest schema")
        require(m.get("supported_engine_schema") == [1] and m.get("required_support_version") == VERSION,
                "Unsupported support version")
        for key in ("book_id", "edition_id", "content_revision"):
            slug(m.get(key))
        require(book is None or book == m["book_id"], "Book mismatch")
        require(edition is None or edition == m["edition_id"], "Edition mismatch")
        policy = m.get("fingerprint_policy", {})
        require(policy.get("id") == "explicit-file-list-v1" and
                policy.get("method") == "explicit-inspected-inputs" and
                policy.get("require_nonempty") is True, "Unsupported fingerprint policy")
        sha(m.get("bundle_sha256"))
        require(digest(canonical({k: v for k, v in m.items() if k != "bundle_sha256"})) == m["bundle_sha256"],
                "Manifest digest mismatch")
        require(isinstance(m.get("files"), list) and m["files"], "Empty manifest")
        self.files = {}
        for item in m["files"]:
            require(isinstance(item, dict), "Invalid manifest file")
            name = relative(item.get("path"))
            require(name not in self.files, "Duplicate manifest path")
            require(type(item.get("byte_length")) is int and 0 <= item["byte_length"] <= 16 * 1024 * 1024,
                    "Invalid manifest byte length")
            sha(item.get("byte_sha256"))
            require(isinstance(item.get("role"), str) and item["role"], "Missing manifest role")
            self.files[name] = item
        require(list(self.files) == sorted(self.files), "Manifest files must be sorted")
        require(isinstance(m.get("chapter_ids"), list) and m["chapter_ids"] and
                len(set(m["chapter_ids"])) == len(m["chapter_ids"]), "Empty or duplicate chapters")
        self.contracts = {}
        for name in self.files:
            self.payload(name)
        # Reject additional unclassified files and directories containing links.
        actual = set()
        for directory, dirs, files in os.walk(self.root, followlinks=False):
            for name in dirs + files:
                p = Path(directory) / name
                require(not p.is_symlink(), "Bundle contains symlink")
            for name in files:
                p = Path(directory) / name
                if p != absolute:
                    actual.add(p.relative_to(self.root).as_posix())
        require(actual == set(self.files), "Bundle contains unclassified or missing files")
        for chapter in m["chapter_ids"]:
            slug(chapter)
            name = "chapters/" + chapter + "/contract.json"
            c = parse_json(self.payload(name))
            require(c.get("book_id") == m["book_id"] and c.get("edition_id") == m["edition_id"]
                    and c.get("chapter_id") == chapter, "Contract identity mismatch")
            self.validate_contract(c)
            self.contracts[chapter] = c
        if "counts" in m:
            require(m["counts"] == {"chapters": len(self.contracts),
                    "objectives": sum(len(c["objectives"]) for c in self.contracts.values()),
                    "prompts": sum(len(c["prompt_guide"]["entries"]) for c in self.contracts.values())},
                    "Manifest counts mismatch")

    def payload(self, name):
        require(name in self.files, "File is not in manifest")
        item = self.files[name]
        raw = read_file(self.root, name)
        require(len(raw) == item["byte_length"] and digest(raw) == item["byte_sha256"],
                "File digest or length mismatch")
        if item.get("media_type", "").startswith(("text/", "application/json")):
            text(raw)
        return raw

    def validate_contract(self, c):
        objectives = c.get("objectives")
        require(isinstance(objectives, list) and objectives, "Missing objectives")
        ids = []
        for o in objectives:
            require(isinstance(o, dict), "Invalid objective")
            ids.append(slug(o.get("id")))
            require(type(o.get("required")) is bool and o.get("expected_outcome") in {"pass", "fail", "expected-failure-observed"},
                    "Invalid objective condition")
            require(isinstance(o.get("depends_on"), list) and isinstance(o.get("evidence_types"), list)
                    and o["evidence_types"], "Missing objective dependencies or evidence types")
            require(o.get("evidence_semantics", "current_condition") in
                    {"current_condition", "historical_learning_event"}, "Unknown evidence semantics")
        require(len(set(ids)) == len(ids) and any(o["required"] for o in objectives), "Duplicate or zero required objectives")
        graph = {o["id"]: o["depends_on"] for o in objectives}
        done, active = set(), set()
        def visit(node):
            require(node in graph and node not in active, "Invalid dependency graph")
            if node in done:
                return
            active.add(node)
            for dependency in graph[node]:
                visit(dependency)
            active.remove(node)
            done.add(node)
        for node in ids:
            visit(node)
        prompts = c.get("prompt_guide", {}).get("entries")
        require(isinstance(prompts, list) and prompts, "Missing prompt guide")
        pids = set()
        for entry in prompts:
            pid = slug(entry.get("id"))
            require(pid not in pids, "Duplicate prompt ID")
            pids.add(pid)
            require(entry.get("kind") in {"main", "conditional", "tutor"}
                    and entry.get("target") in {"coding-assistant", "service-chat", "tool-command"}, "Invalid prompt kind or target")
            for key in ("when", "before", "after"):
                require(isinstance(entry.get(key), str) and entry[key], "Incomplete prompt guide")
            require(all(i in graph for i in entry.get("objective_ids", [])), "Unknown prompt objective")
            raw = self.payload(entry.get("path"))
            require(digest(raw) == entry.get("byte_sha256") == entry.get("sha256"), "Prompt digest mismatch")
        for topic in c.get("hint_topics", []):
            slug(topic.get("id"))
            levels = set()
            for step in topic.get("steps", []):
                require(step.get("level") in {1, 2, 3, 4} and step["level"] not in levels, "Invalid hint levels")
                levels.add(step["level"])
                require(digest(self.payload(step.get("path"))) == step.get("byte_sha256"), "Hint digest mismatch")
            require(levels == {1, 2, 3, 4}, "Incomplete hint steps")

    def chapter(self, chapter):
        require(chapter in self.contracts, "Unknown chapter")
        return self.contracts[chapter]

    def contract_hash(self, chapter):
        return self.files["chapters/" + chapter + "/contract.json"]["byte_sha256"]

    def prompt(self, chapter, prompt_id):
        for entry in self.chapter(chapter)["prompt_guide"]["entries"]:
            if entry["id"] == prompt_id:
                return {**entry, "text": text(self.payload(entry["path"])), "executed": False}
        raise Invalid("Unknown prompt")

    def hint(self, chapter, topic_id, level, explicit_solution=False):
        require(level in {1, 2, 3} or (level == 4 and explicit_solution), "Explicit solution request required")
        for topic in self.chapter(chapter).get("hint_topics", []):
            if topic["id"] == topic_id:
                for step in topic["steps"]:
                    if step["level"] == level:
                        return {"topic": topic_id, "level": level, "text": text(self.payload(step["path"])), "executed": False}
        raise Invalid("Unknown hint")


def assemble_chunks(chunks, revision, expected_sha, total_bytes):
    """Verify actual MCP structuredContent envelopes obtained by the host."""
    require(isinstance(chunks, list) and chunks, "No chunks")
    output = bytearray()
    identity = None
    for i, envelope in enumerate(chunks):
        require(isinstance(envelope, dict) and envelope.get("schema_version") == 1
                and envelope.get("content_revision") == revision and envelope.get("status") == "ok",
                "Chunk envelope or revision mismatch")
        current_identity = tuple(envelope.get(k) for k in ("book_id", "edition_id", "bundle_sha256"))
        require(all(isinstance(v, str) and v for v in current_identity), "Missing chunk identity")
        if identity is None:
            identity = current_identity
        require(identity == current_identity, "Mixed chunk identity")
        c = envelope.get("data")
        require(isinstance(c, dict) and c.get("status") == "chunk" and c.get("encoding") == "utf-8"
                and c.get("chunk_index") == i and c.get("chunk_count") == len(chunks)
                and c.get("byte_offset") == len(output) and c.get("byte_length") == total_bytes
                and c.get("byte_sha256") == expected_sha, "Chunk ordering or metadata mismatch")
        wire_encoding = c.get("chunk_encoding", "base64")
        try:
            if wire_encoding == "base64":
                require("text" not in c and isinstance(c.get("chunk_base64"), str), "Ambiguous chunk encoding")
                raw = base64.b64decode(c["chunk_base64"], validate=True)
            elif wire_encoding == "utf8":
                require("chunk_base64" not in c and isinstance(c.get("text"), str), "Ambiguous chunk encoding")
                raw = c["text"].encode("utf-8", errors="strict")
            else:
                raise Invalid("Unsupported chunk encoding")
        except (KeyError, ValueError, UnicodeError):
            raise Invalid("Invalid chunk encoding") from None
        require(0 < len(raw) <= 8192 and digest(raw) == c.get("chunk_sha256")
                and c.get("chunk_byte_length") == len(raw), "Chunk digest or bounds mismatch")
        text(raw)
        output.extend(raw)
    require(len(output) == total_bytes and digest(output) == expected_sha, "Incomplete combined payload")
    return text(bytes(output))


def timestamp(value):
    require(isinstance(value, str), "Missing timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise Invalid("Invalid timestamp") from None
    require(parsed.tzinfo is not None and parsed.utcoffset().total_seconds() == 0,
            "Timestamp must be UTC")
    return parsed


def binding(project_id, project):
    return digest((project_id + "\0" + str(Path(project).resolve())).encode("utf-8"))


def input_fingerprint(project, inputs):
    require(isinstance(inputs, list) and inputs, "Explicit inspected inputs required")
    names = []
    for item in inputs:
        require(isinstance(item, dict), "Invalid inspected input")
        name = relative(item.get("path"))
        sha(item.get("byte_sha256"))
        require(digest(read_file(project, name)) == item["byte_sha256"], "Inspected input changed")
        names.append(name)
    require(names == sorted(set(names)), "Inspected inputs must be unique and sorted")
    return digest(canonical({"policy": "explicit-file-list-v1", "files": inputs}))


def validate_observation(bundle, chapter, project, e, check_current=True):
    require(isinstance(e, dict), "Invalid evidence")
    for k in ("id", "objective_id"):
        slug(e.get(k))
    require(e.get("book") == bundle.manifest["book_id"] and e.get("edition") == bundle.manifest["edition_id"]
            and e.get("revision") == bundle.manifest["content_revision"]
            and e.get("contract_sha256") == bundle.contract_hash(chapter), "Evidence contract mismatch")
    objectives = {o["id"]: o for o in bundle.chapter(chapter)["objectives"]}
    require(e["objective_id"] in objectives, "Unknown evidence objective")
    o = objectives[e["objective_id"]]
    require(e.get("kind") in o["evidence_types"], "Evidence kind not accepted")
    require(e.get("expected") == o["expected_outcome"] and e.get("observed_outcome") in {"pass", "fail", "blocked"},
            "Invalid expected or observed outcome")
    require(e.get("environment") in {"local", "manual", "live", "simulation"}
            and e.get("observer") in {"reader", "assistant", "automated-test"}, "Unknown observation source")
    require(e.get("verification") == "recorded-observation-not-independent-attestation", "Observation is not an attestation")
    require(e.get("validity_scope") == o.get("evidence_semantics", "current_condition"), "Evidence semantics mismatch")
    at = timestamp(e.get("observed_at"))
    require(at <= datetime.now(timezone.utc), "Future evidence")
    require(e.get("redacted") is True, "Evidence must be redacted before submission")
    artifact = e.get("artifact")
    require(isinstance(artifact, dict), "Missing evidence artifact")
    sha(artifact.get("byte_sha256"))
    require(digest(read_file(project, artifact.get("path"))) == artifact["byte_sha256"], "Evidence artifact changed")
    historical = e["validity_scope"] == "historical_learning_event"
    require(isinstance(e.get("inspected_inputs"), list) and e["inspected_inputs"], "Missing inspected inputs")
    if historical:
        # A snapshot receipt is distinct from mutable product input.
        require(artifact["path"].startswith("evidence/") and
                all(i.get("path", "").startswith("evidence/") for i in e["inspected_inputs"]),
                "Historical observations require separate evidence snapshots")
    if check_current or historical:
        fingerprint = input_fingerprint(project, e["inspected_inputs"])
        if "input_fingerprint" in e:
            require(e["input_fingerprint"] == fingerprint, "Input scope fingerprint mismatch")
    if e["kind"] == "test-run":
        command = e.get("command")
        require(isinstance(command, dict) and isinstance(command.get("argv"), list)
                and command["argv"] and all(isinstance(a, str) for a in command["argv"]), "Missing command identity")
        require(type(command.get("exit_code")) is int and type(command.get("timeout")) is bool,
                "Missing command outcome")
        require(timestamp(command.get("started_at")) <= timestamp(command.get("ended_at")) <= at,
                "Invalid command times")
        for key in ("stdout", "stderr"):
            log = command.get(key)
            require(isinstance(log, dict) and digest(read_file(project, log.get("path"))) == log.get("byte_sha256"),
                    "Missing redacted command logs")
        if not command["timeout"]:
            require((command["exit_code"] == 0) == (e["observed_outcome"] == "pass"), "Exit code contradicts observed outcome")
    return o


class Project:
    def __init__(self, root):
        self.root = Path(root).absolute()
        require(self.root.is_dir() and all(not p.is_symlink() for p in (self.root, *self.root.parents)),
                "Project must be an existing real directory")

    def state(self, allow_moved=False):
        path = safe_path(self.root, ".studyailab/project.json", True)
        if not path.exists():
            return None
        state = read_json(self.root, ".studyailab/project.json", True)
        require(isinstance(state, dict) and state.get("schema_version") == 1
                and isinstance(state.get("contexts"), dict), "Invalid project state")
        slug(state.get("project_id"))
        require(allow_moved or binding(state["project_id"], self.root) == state.get("local_location_sha256"), "Project moved or copied; explicit rebind required")
        return state

    def evidence_path(self, bundle, chapter):
        for v in (bundle.manifest["book_id"], bundle.manifest["edition_id"], chapter):
            slug(v)
        return ".studyailab/evidence/{}/{}/{}.json".format(bundle.manifest["book_id"], bundle.manifest["edition_id"], chapter)

    def observations(self, bundle, chapter):
        name = self.evidence_path(bundle, chapter)
        if not safe_path(self.root, name, True).exists():
            return []
        result = read_json(self.root, name, True)
        require(isinstance(result, list) and all(isinstance(e, dict) for e in result), "Invalid evidence store")
        ids = [e.get("id") for e in result]
        require(len(ids) == len(set(ids)), "Duplicate stored evidence ID")
        return result

    def record(self, bundle, chapter, evidence, apply=False, rebind=False):
        initial_state = self.state(allow_moved=rebind)
        validate_observation(bundle, chapter, self.root, evidence)
        previous = self.observations(bundle, chapter)
        require(evidence["id"] not in {e["id"] for e in previous}, "Evidence IDs are append-only")
        entry = dict(evidence)
        entry["input_fingerprint"] = input_fingerprint(self.root, entry["inspected_inputs"])
        if not apply:
            return {"status": "preview", "applied": False, "rebind_requested": rebind, "observation": entry}
        state_dir = safe_path(self.root, ".studyailab", True)
        state_dir.mkdir(exist_ok=True)
        lock = safe_path(self.root, ".studyailab/record.lock", True)
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            raise Invalid("Record busy; retry after existing operation finishes") from None
        try:
            os.close(fd)
            # Reload under lock, never overwrite another writer's observation.
            state = self.state(allow_moved=rebind)
            latest = self.observations(bundle, chapter)
            require(latest == previous, "Concurrent evidence changed")
            require(state == initial_state, "Concurrent project state changed")
            validate_observation(bundle, chapter, self.root, entry)
            if state is None:
                pid = uuid.uuid4().hex
                state = {"schema_version": 1, "project_id": pid, "local_location_sha256": binding(pid, self.root), "contexts": {}}
            if rebind:
                require(initial_state is not None, "No existing binding to rebind")
                # Rebinding validates the submitted current files, preserves prior observations,
                # and records the old opaque binding without retaining an absolute path.
                state.setdefault("rebind_history", []).append({"previous_location_sha256": state["local_location_sha256"],
                                                              "at": datetime.now(timezone.utc).isoformat()})
                state["local_location_sha256"] = binding(state["project_id"], self.root)
            key = bundle.manifest["book_id"] + "/" + bundle.manifest["edition_id"]
            state["contexts"][key] = {"chapter": chapter, "revision": bundle.manifest["content_revision"]}
            self.atomic_write(".studyailab/project.json", state)
            self.atomic_write(self.evidence_path(bundle, chapter), latest + [entry])
        finally:
            lock.unlink()
        return {"status": "recorded", "applied": True, "id": entry["id"], "verification": entry["verification"]}

    def atomic_write(self, name, value):
        target = safe_path(self.root, name, True)
        target.parent.mkdir(parents=True, exist_ok=True)
        # Recheck created components before opening a temporary output.
        safe_path(self.root, name, True)
        fd, temp = tempfile.mkstemp(prefix=".pending-", dir=target.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(canonical(value) + b"\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp, target)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)

    def progress(self, bundle, chapter):
        state = self.state()
        observations = self.observations(bundle, chapter)
        require(state is not None or not observations, "Orphan evidence without project identity")
        contract = bundle.chapter(chapter)
        results = {}
        objectives = {o["id"]: o for o in contract["objectives"]}
        def evaluate(oid):
            if oid in results:
                return results[oid]
            o = objectives[oid]
            status, reason = "unconfirmed", "No observation"
            candidates = [e for e in observations if e.get("objective_id") == oid]
            selected = None
            if candidates:
                # Validate chronology, including malformed/future entries; do not hide behind an older pass.
                try:
                    for e in candidates:
                        require(timestamp(e.get("observed_at")) <= datetime.now(timezone.utc), "Future evidence")
                    e = max(enumerate(candidates), key=lambda pair: (timestamp(pair[1]["observed_at"]), pair[0]))[1]
                    selected = e
                    validate_observation(bundle, chapter, self.root, e)
                    if e["observed_outcome"] == "blocked":
                        status, reason = "blocked", "Observation blocked"
                    elif e["observed_outcome"] != ("fail" if o["expected_outcome"] == "expected-failure-observed" else o["expected_outcome"]):
                        status, reason = "failed", "Observed outcome differs from expected"
                    elif e["environment"] == "simulation":
                        status, reason = "blocked", "Simulation is not actual objective evidence"
                    elif o.get("environment") == "actual-account-or-service" and e["environment"] != "live":
                        status, reason = "blocked", "Live observation required"
                    elif e["kind"] == "test-run" and e["command"]["timeout"]:
                        status, reason = "failed", "Command timed out"
                    elif o.get("expiry_hours") is not None and (datetime.now(timezone.utc) - timestamp(e["observed_at"])).total_seconds() > o["expiry_hours"] * 3600:
                        status, reason = "stale", "Observation expired"
                    else:
                        status, reason = "verified", "Recorded observation; not independent attestation"
                except (Invalid, KeyError, TypeError, ValueError):
                    status, reason = "stale", "Invalid, changed or incompatible observation"
            for dependency in o["depends_on"]:
                if evaluate(dependency)["status"] != "verified":
                    status, reason = "blocked", "Required dependency is not verified"
            results[oid] = {"status": status, "reason": reason,
                            "observation_source": selected.get("observer") if selected else None}
            return results[oid]
        for oid in objectives:
            evaluate(oid)
        required = [o for o in contract["objectives"] if o["required"]]
        completed = sum(results[o["id"]]["status"] == "verified" for o in required)
        return {"completed": completed, "required_total": len(required), "chapter_complete": completed == len(required),
                "objectives": results, "next_candidates": [o["id"] for o in required if results[o["id"]]["status"] != "verified"],
                "verification": "recorded-observation-not-independent-attestation"}
