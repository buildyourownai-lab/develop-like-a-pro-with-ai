#!/usr/bin/env python3
"""16장 Storyboard용 Pexels 후보를 검색하고 검토 자료를 만든다."""

from __future__ import annotations

import argparse
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STORYBOARD = ROOT / "prototypes/youtube-shorts/chapter-16/storyboard.json"
DEFAULT_SECRET_FILE = ROOT / ".secrets/chapter-16.env"
DEFAULT_OUTDIR = ROOT / "artifacts/chapter-16/pexels-candidates"


def load_secret(path: Path, name: str) -> str:
    if value := os.environ.get(name):
        return value
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip() == name:
                return value.strip()
    raise SystemExit(f"{name}이 없습니다: {path}")


def request_json(url: str, api_key: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={"Authorization": api_key, "User-Agent": "chapter-16/1.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "chapter-16/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        destination.write_bytes(response.read())


def main() -> None:
    parser = argparse.ArgumentParser(description="Pexels 세로 영상 후보 검색")
    parser.add_argument("--storyboard", type=Path, default=DEFAULT_STORYBOARD)
    parser.add_argument("--secret-file", type=Path, default=DEFAULT_SECRET_FILE)
    parser.add_argument("--outdir", type=Path, default=DEFAULT_OUTDIR)
    parser.add_argument("--per-page", type=int, default=8)
    args = parser.parse_args()

    api_key = load_secret(args.secret_file, "PEXELS_API_KEY")
    board = json.loads(args.storyboard.read_text(encoding="utf-8"))
    args.outdir.mkdir(parents=True, exist_ok=True)
    all_results: list[dict] = []

    for scene in board["scenes"]:
        query = scene["search_queries"][0]
        params = urllib.parse.urlencode({
            "query": query,
            "orientation": "portrait",
            "size": "medium",
            "per_page": args.per_page,
        })
        payload = request_json(f"https://api.pexels.com/videos/search?{params}", api_key)
        scene_dir = args.outdir / f"scene-{scene['scene']:02d}"
        scene_dir.mkdir(exist_ok=True)
        candidates: list[dict] = []

        for video in payload.get("videos", []):
            files = [
                item for item in video.get("video_files", [])
                if item.get("file_type") == "video/mp4" and item.get("width") and item.get("height")
            ]
            files.sort(key=lambda item: (item["height"] < item["width"], -item["height"]))
            selected_file = files[0] if files else None
            candidate = {
                "id": video["id"],
                "duration": video.get("duration"),
                "width": video.get("width"),
                "height": video.get("height"),
                "url": video.get("url"),
                "creator": video.get("user", {}).get("name"),
                "creator_url": video.get("user", {}).get("url"),
                "preview_image": video.get("image"),
                "video_file": {
                    "id": selected_file.get("id"),
                    "width": selected_file.get("width"),
                    "height": selected_file.get("height"),
                    "quality": selected_file.get("quality"),
                    "file_type": selected_file.get("file_type"),
                    "link": selected_file.get("link"),
                } if selected_file else None,
            }
            candidates.append(candidate)
            if candidate["preview_image"]:
                download(candidate["preview_image"], scene_dir / f"{video['id']}.jpg")

        result = {
            "scene": scene["scene"],
            "query": query,
            "expected_seconds": scene["expected_seconds"],
            "candidates": candidates,
        }
        (scene_dir / "candidates.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        all_results.append(result)
        print(f"Scene {scene['scene']}: {query} → {len(candidates)} candidates")

    (args.outdir / "all-candidates.json").write_text(
        json.dumps(all_results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
