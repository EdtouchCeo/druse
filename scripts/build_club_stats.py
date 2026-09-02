#!/usr/bin/env python3
"""Build a privacy-safe public club statistics snapshot from the internal source."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


PHASE = "round1-complete-round2-not-open"
PREFIX = "window.CLUB_DATA ="
OUTPUT_PREFIX = "window.DR_CLUB_STATS_2026_2 = "


def load_source(path: Path) -> dict:
    text = path.read_text(encoding="utf-8").strip()
    if not text.startswith(PREFIX):
        raise ValueError("원천 파일의 window.CLUB_DATA 래퍼를 확인할 수 없습니다.")
    payload = text[len(PREFIX) :].strip()
    if payload.endswith(";"):
        payload = payload[:-1].rstrip()
    data = json.loads(payload)
    if not isinstance(data, dict) or not isinstance(data.get("clubs"), list):
        raise ValueError("원천 동아리 데이터 구조가 올바르지 않습니다.")
    return data


def club_status(club: dict, grade_limit: int) -> dict:
    if not club.get("recruiting"):
        return {"code": "preorganized", "label": "기조직"}
    applicants = club["applicants"]
    needs_selection = (
        applicants["waiting"] > 0
        or applicants["grade1"] + applicants["grade2"] > club["capacity"]
        or applicants["grade1"] > grade_limit
        or applicants["grade2"] > grade_limit
    )
    if needs_selection:
        return {"code": "selection_required", "label": "선발·학년 조정 필요"}
    if applicants["remaining"] > 0:
        return {"code": "recruiting_available", "label": "충원 가능"}
    return {"code": "organized", "label": "구성 완료"}


def build_public(source: dict, phase: str) -> dict:
    if phase != PHASE:
        raise ValueError(f"지원하지 않는 단계입니다: {phase}")

    meta = source["meta"]
    grade_limit = meta["gradeCapacityLimit"]
    public_clubs = []
    for club in source["clubs"]:
        applicants = club["applicants"]
        recruiting = bool(club.get("recruiting"))
        group = "preorganized" if not recruiting else ("student" if club["owner"] == "학생" else "teacher")
        public_clubs.append(
            {
                "id": club["id"],
                "name": club["name"],
                "group": group,
                "groupLabel": {
                    "student": "학생 주도",
                    "teacher": "교사 주도",
                    "preorganized": "기조직",
                }[group],
                "capacity": club["capacity"],
                "gradeCapacityLimit": grade_limit,
                "grade1Covered": applicants["grade1"],
                "grade2Covered": applicants["grade2"],
                "round1NewApplicants": applicants["newApplicant"],
                "round2": {"status": "not_open", "applicants": None},
                "confirmed": applicants["confirmed"],
                "selectionPending": applicants["waiting"],
                "remaining": applicants["remaining"],
                "status": club_status(club, grade_limit),
            }
        )

    grade_rows = []
    for grade, key in ((1, "1학년"), (2, "2학년")):
        row = meta["gradeSummary"][key]
        grade_rows.append(
            {
                "grade": grade,
                "roster": row["studentRoster"],
                "recruitmentEligible": row["studentRoster"] - row["preconfirmed"],
                "round1NewApplicants": row["newApplicant"],
                "preconfirmed": row["preconfirmed"],
                "covered": row["covered"],
                "unrecorded": row["unrecorded"],
            }
        )

    owner_labels = {
        "student": "학생 주도 일반모집",
        "teacher": "교사 주도 일반모집",
        "preorganized": "기조직",
    }
    owner_summary = []
    for code in ("student", "teacher", "preorganized"):
        rows = [club for club in public_clubs if club["group"] == code]
        summary = {"code": code, "label": owner_labels[code], "clubs": len(rows)}
        if code != "preorganized":
            summary["capacity"] = sum(club["capacity"] for club in rows)
        owner_summary.append(summary)

    public = {
        "schemaVersion": 1,
        "term": meta["term"],
        "snapshotAt": meta["snapshotAt"] + ":00+09:00",
        "generatedOn": meta["generatedOn"],
        "phase": phase,
        "phaseLabel": "1차 집계 완료 · 2차 접수 전",
        "privacyNotice": "학생 개인정보 없이 집계 자료만 제공합니다.",
        "totals": {
            "clubs": meta["totalClubCount"],
            "recruitingClubs": meta["recruitingClubCount"],
            "preorganizedClubs": meta["preorganizedClubCount"],
            "totalCapacity": meta["totalCapacity"],
            "recruitingCapacity": meta["recruitingCapacity"],
            "studentRoster": meta["studentRosterCount"],
            "recruitmentEligible": meta["recruitmentEligibleCount"],
            "preconfirmed": meta["preconfirmedStudentCount"],
            "covered": meta["coveredStudentCount"],
            "unrecorded": meta["unrecordedStudentCount"],
            "round1": {
                "status": "closed",
                "newApplicants": meta["newApplicantCount"],
                "rate": meta["applicationRate"],
            },
            "round2": {"status": "not_open", "applicants": None},
        },
        "ownerSummary": owner_summary,
        "gradeSummary": grade_rows,
        "dataQuality": {
            "responseRows": meta["responseRowCount"],
            "uniqueResponses": meta["uniqueResponseCount"],
            "duplicatesExcluded": meta["duplicateResponseCount"],
            "rosterMismatchesExcluded": meta["unmatchedResponseCount"],
            "preconfirmedDuplicatesExcluded": meta["fixedStudentResponseCount"],
        },
        "clubs": public_clubs,
    }
    assert_invariants(public)
    return public


def assert_invariants(data: dict) -> None:
    totals = data["totals"]
    expected = {
        "clubs": 29,
        "recruitingClubs": 28,
        "preorganizedClubs": 1,
        "totalCapacity": 628,
        "recruitingCapacity": 607,
        "studentRoster": 606,
        "recruitmentEligible": 537,
        "preconfirmed": 69,
        "covered": 575,
        "unrecorded": 31,
    }
    for key, value in expected.items():
        if totals[key] != value:
            raise ValueError(f"합계 불일치: totals.{key}={totals[key]} (기대 {value})")
    if totals["round1"]["newApplicants"] != 506:
        raise ValueError("신규 1차 지원 합계는 506명이어야 합니다.")
    if abs(totals["round1"]["rate"] - 506 / 537) > 1e-12:
        raise ValueError("1차 지원률 분모·분자가 일치하지 않습니다.")

    clubs = data["clubs"]
    owner_checks = {
        "student": (20, 439),
        "teacher": (8, 168),
        "preorganized": (1, 21),
    }
    for group, (count, capacity) in owner_checks.items():
        rows = [club for club in clubs if club["group"] == group]
        if len(rows) != count or sum(club["capacity"] for club in rows) != capacity:
            raise ValueError(f"주체별 집계 불일치: {group}")
    if sum(club["round1NewApplicants"] for club in clubs) != 506:
        raise ValueError("동아리별 신규 1차 지원 합계가 506명이 아닙니다.")
    if sum(row["roster"] for row in data["gradeSummary"]) != totals["studentRoster"]:
        raise ValueError("학년별 재적 합계가 전체와 다릅니다.")
    for key in ("recruitmentEligible", "round1NewApplicants", "preconfirmed", "covered", "unrecorded"):
        total_key = "round1" if key == "round1NewApplicants" else key
        total_value = totals[total_key]["newApplicants"] if key == "round1NewApplicants" else totals[total_key]
        if sum(row[key] for row in data["gradeSummary"]) != total_value:
            raise ValueError(f"학년별 {key} 합계가 전체와 다릅니다.")
    status_counts = {}
    for club in clubs:
        code = club["status"]["code"]
        status_counts[code] = status_counts.get(code, 0) + 1
    if status_counts != {"selection_required": 15, "recruiting_available": 13, "preorganized": 1}:
        raise ValueError(f"상태 분류 불일치: {status_counts}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--phase", required=True)
    args = parser.parse_args()

    public = build_public(load_source(args.source), args.phase)
    rendered = OUTPUT_PREFIX + json.dumps(public, ensure_ascii=False, indent=2) + ";\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(rendered, encoding="utf-8", newline="\n")
    temporary.replace(args.output)
    print(f"공개 통계 스냅샷 생성 완료: {args.output} ({len(public['clubs'])}개 동아리)")


if __name__ == "__main__":
    main()
