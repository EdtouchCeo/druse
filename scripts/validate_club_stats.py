#!/usr/bin/env python3
"""Validate the public club snapshot contract and privacy boundary."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


PREFIX = "window.DR_CLUB_STATS_2026_2 = "
FORBIDDEN_KEYS = {
    "advisor", "advisorKey", "location", "requestedLocation", "assignmentTeacher",
    "leader", "viceLeader", "description", "studentIntroduction", "selection",
    "sessions", "applicationUrl", "applicantWorkbookUrl", "sources",
}
FORBIDDEN_TEXT = ("sharepoint.com", "forms.cloud.microsoft", "@", ".xlsx", ".hwpx", ".pdf")
ROOT_KEYS = {"schemaVersion", "term", "snapshotAt", "generatedOn", "phase", "phaseLabel", "privacyNotice", "totals", "ownerSummary", "gradeSummary", "dataQuality", "clubs"}
TOTAL_KEYS = {"clubs", "recruitingClubs", "preorganizedClubs", "totalCapacity", "recruitingCapacity", "studentRoster", "recruitmentEligible", "preconfirmed", "covered", "unrecorded", "round1", "round2"}
CLUB_KEYS = {"id", "name", "group", "groupLabel", "capacity", "gradeCapacityLimit", "grade1Covered", "grade2Covered", "round1NewApplicants", "round2", "confirmed", "selectionPending", "remaining", "status"}


def load(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8").strip()
    if not text.startswith(PREFIX) or not text.endswith(";"):
        raise ValueError("공개 JS 래퍼 형식이 올바르지 않습니다.")
    return json.loads(text[len(PREFIX) : -1]), text


def assert_keys(obj: dict, allowed: set[str], where: str) -> None:
    extras = set(obj) - allowed
    if extras:
        raise ValueError(f"{where}에 허용되지 않은 키가 있습니다: {sorted(extras)}")


def walk_keys(value, path="root"):
    if isinstance(value, dict):
        for key, child in value.items():
            if key in FORBIDDEN_KEYS:
                raise ValueError(f"금지 키 발견: {path}.{key}")
            walk_keys(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            walk_keys(child, f"{path}[{index}]")


def validate(data: dict, raw: str) -> None:
    assert_keys(data, ROOT_KEYS, "root")
    assert_keys(data["totals"], TOTAL_KEYS, "totals")
    for index, club in enumerate(data["clubs"]):
        assert_keys(club, CLUB_KEYS, f"clubs[{index}]")
    walk_keys(data)
    lower = raw.lower()
    for marker in FORBIDDEN_TEXT:
        if marker in lower:
            raise ValueError(f"금지 문자열 발견: {marker}")
    if re.search(r"(?:[A-Za-z]:\\\\|(?:file|https?)://)", raw, re.I):
        raise ValueError("로컬 경로 또는 URL이 공개 데이터에 포함되어 있습니다.")

    if data["schemaVersion"] != 1 or data["phase"] != "round1-complete-round2-not-open":
        raise ValueError("스키마 버전 또는 단계가 올바르지 않습니다.")
    totals = data["totals"]
    expected = {
        "clubs": 29, "recruitingClubs": 28, "preorganizedClubs": 1,
        "totalCapacity": 628, "recruitingCapacity": 607, "studentRoster": 606,
        "recruitmentEligible": 537, "preconfirmed": 69, "covered": 575, "unrecorded": 31,
    }
    for key, value in expected.items():
        if totals[key] != value:
            raise ValueError(f"totals.{key} 불일치")
    if totals["round1"] != {"status": "closed", "newApplicants": 506, "rate": 506 / 537}:
        raise ValueError("1차 지원 집계가 올바르지 않습니다.")
    if totals["round2"] != {"status": "not_open", "applicants": None}:
        raise ValueError("전체 2차 지원은 접수 전/null이어야 합니다.")
    if len(data["clubs"]) != 29:
        raise ValueError("동아리 수는 29개여야 합니다.")
    for club in data["clubs"]:
        if club["round2"] != {"status": "not_open", "applicants": None}:
            raise ValueError(f"{club['name']}의 2차 지원은 접수 전/null이어야 합니다.")

    owner_expected = {"student": (20, 439), "teacher": (8, 168), "preorganized": (1, 21)}
    for code, (count, capacity) in owner_expected.items():
        rows = [club for club in data["clubs"] if club["group"] == code]
        if (len(rows), sum(club["capacity"] for club in rows)) != (count, capacity):
            raise ValueError(f"{code} 주체 합계 불일치")
        summary = next((row for row in data["ownerSummary"] if row["code"] == code), None)
        if not summary or summary["clubs"] != count or (code != "preorganized" and summary.get("capacity") != capacity):
            raise ValueError(f"{code} 주체 요약 불일치")
    if sum(club["round1NewApplicants"] for club in data["clubs"]) != 506:
        raise ValueError("동아리별 1차 신규 지원 합계 불일치")
    grades = data["gradeSummary"]
    for key, expected_total in (("roster", 606), ("recruitmentEligible", 537), ("round1NewApplicants", 506), ("preconfirmed", 69), ("covered", 575), ("unrecorded", 31)):
        if sum(row[key] for row in grades) != expected_total:
            raise ValueError(f"학년별 {key} 합계 불일치")
    statuses = {code: sum(club["status"]["code"] == code for club in data["clubs"]) for code in ("selection_required", "recruiting_available", "preorganized")}
    if statuses != {"selection_required": 15, "recruiting_available": 13, "preorganized": 1}:
        raise ValueError(f"상태별 합계 불일치: {statuses}")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("사용법: python scripts/validate_club_stats.py <공개 JS>")
    path = Path(sys.argv[1])
    data, raw = load(path)
    validate(data, raw)
    print("공개 통계 검증 PASS: 29개 동아리, 개인정보·내부 링크 0건, 합계·단계 불변식 일치")


if __name__ == "__main__":
    main()
