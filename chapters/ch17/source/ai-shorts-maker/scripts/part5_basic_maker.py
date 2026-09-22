#!/usr/bin/env python3
"""PART 5 기본 Video Maker의 자연어 입력 계약.

Claude가 자연어를 이해한 결과를 검증된 제작 기본값과 합친다. 이 모듈은
고정 명령어 parser가 아니며 경영 분석용 production_evidence를 저장하지 않는다.
"""

from __future__ import annotations

from typing import Any, Dict


ALLOWED_CONDITIONS = {
    "topic",
    "scenario",
    "target_duration_seconds",
    "voice_direction",
    "music",
    "visual_direction",
    "subtitle_direction",
}

VERIFIED_DEFAULTS: Dict[str, Any] = {
    "scenario": "질문으로 시작해 사실과 결과를 순서대로 설명",
    "target_duration_seconds": 60,
    "voice_direction": "한국어로 또렷하고 차분하게",
    "music": "권리가 확인된 배경음악을 목소리보다 작게 사용",
    "visual_direction": "세로 화면, 장면별 핵심 대상과 자막 안전 영역 확보",
    "subtitle_direction": "문장 단위 Burn-in 한글 자막",
}


def resolve_basic_maker_request(
    natural_language_request: str,
    claude_interpretation: Dict[str, Any],
) -> Dict[str, Any]:
    """자연어를 Claude가 해석한 결과에 PART 5 기본 제작 규칙을 적용한다."""
    if not isinstance(natural_language_request, str) or not natural_language_request.strip():
        raise ValueError("natural language request is required")
    if not isinstance(claude_interpretation, dict):
        raise ValueError("Claude interpretation must be an object")
    unknown = set(claude_interpretation) - ALLOWED_CONDITIONS
    if unknown:
        raise ValueError("unsupported maker conditions: %s" % ", ".join(sorted(unknown)))

    specified = {key: value for key, value in claude_interpretation.items() if value is not None}
    topic = specified.get("topic")
    if not isinstance(topic, str) or not topic.strip():
        raise ValueError("topic must be understood from the request")

    applied = {**VERIFIED_DEFAULTS, **specified}
    return {
        "request": natural_language_request.strip(),
        "applied_conditions": applied,
        "user_specified": sorted(specified),
        "defaulted": sorted(set(VERIFIED_DEFAULTS) - set(specified)),
        "output_contract": "MP4_AND_REVIEW_HANDOFF",
        "management_evidence_recorded": False,
    }
