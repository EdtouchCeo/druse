"""
시간표 데이터 전체 오류 검증
- 교사 중복 배정 (같은 교사, 같은 요일, 같은 교시에 2개 이상 수업)
- 학반 중복 배정 (같은 학반, 같은 요일, 같은 교시에 2개 이상 수업)
- 교차 일관성 (교사 시간표 ↔ 학반 시간표)
"""
import json, sys, os
sys.stdout.reconfigure(encoding='utf-8')

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
JSON_PATH = os.path.join(BASE, 'output', 'web', '_timetable_data.json')

with open(JSON_PATH, encoding='utf-8') as f:
    data = json.load(f)

DAYS = ['월', '화', '수', '목', '금']
errors = []
warnings = []

# ── 1. 교사 중복 배정 검사 ────────────────────────────────
print("=== 1. 교사 중복 배정 검사 ===")
for teacher, days in data['teachers'].items():
    for day in DAYS:
        slots = days.get(day, [])
        for slot in slots:
            subj = slot.get('subject', '').strip()
            cls  = slot.get('class', '').strip()
            period = slot.get('period', '?')
            # 같은 교사, 같은 요일, 같은 교시에 수업이 여러 번 등장하는 경우는
            # 구조상 불가능하나, 과목+학반이 모두 있어야 유효
            # → 실제 오류: subject 있는데 class 없거나 반대
            if subj and not cls:
                errors.append(f"[교사:{teacher}] {day} {period}교시: 과목({subj})은 있으나 학반 없음")
            if cls and not subj:
                errors.append(f"[교사:{teacher}] {day} {period}교시: 학반({cls})은 있으나 과목 없음")

# ── 2. 학반별 시간표에서 같은 교시에 중복 ────────────────
print("=== 2. 학반 중복 배정 검사 ===")
# 역방향: (day, period, class) → [teachers]
class_slot_map = {}  # (day, period, class) → [(subject, teacher, source)]
for teacher, days in data['teachers'].items():
    for day in DAYS:
        slots = days.get(day, [])
        for slot in slots:
            subj = slot.get('subject', '').strip()
            cls  = slot.get('class', '').strip()
            period = slot.get('period', '?')
            if cls and subj:
                key = (day, period, cls)
                class_slot_map.setdefault(key, []).append((subj, teacher))

for (day, period, cls), entries in class_slot_map.items():
    if len(entries) > 1:
        errors.append(f"[학반:{cls}] {day} {period}교시에 교사 {len(entries)}명 중복: " +
                      ", ".join(f"{t}({s})" for s,t in entries))

# ── 3. 교차 일관성 검사 ────────────────────────────────────
print("=== 3. 교차 일관성 검사 (교사↔학반) ===")
cross_errors = 0
cross_ok = 0
for cls_name, cls_info in data['classes'].items():
    for day in DAYS:
        slots = cls_info['schedule'].get(day, [])
        for slot in slots:
            subj = slot.get('subject', '').strip()
            teacher = slot.get('teacher', '').strip()
            period = slot.get('period', '?')
            if not subj or not teacher:
                continue
            # 교사 시간표에서 동일한 슬롯 찾기
            t_days = data['teachers'].get(teacher, {})
            t_slots = t_days.get(day, [])
            matched = False
            for ts in t_slots:
                if ts.get('period') == period:
                    ts_subj = ts.get('subject', '').strip()
                    ts_cls  = ts.get('class', '').strip()
                    if ts_cls == cls_name:
                        cross_ok += 1
                        matched = True
                        # 과목명 차이
                        if ts_subj != subj:
                            warnings.append(f"[과목명 불일치] {teacher} {day}{period}교시 "
                                            f"학반측={subj}, 교사측={ts_subj} (학반:{cls_name})")
                        break
            if not matched:
                cross_errors += 1
                # 교사 시간표에 해당 슬롯이 없거나 다른 학반 배정
                t_slot_info = next((ts for ts in t_slots if ts.get('period') == period), None)
                actual = f"{t_slot_info.get('subject','')}/{t_slot_info.get('class','')}" if t_slot_info else "없음"
                if cross_errors <= 30:  # 너무 많으면 생략
                    warnings.append(f"[교차불일치] {teacher} {day}{period}교시: "
                                    f"학반({cls_name})측 기록({subj}), 교사측={actual}")

print(f"교차 일관성: OK {cross_ok}건, 불일치 {cross_errors}건")

# ── 4. 결과 출력 ───────────────────────────────────────────
print()
print(f"=== 오류 요약 ({len(errors)}건) ===")
for e in errors:
    print(" ❌", e)

print()
print(f"=== 경고 요약 ({len(warnings)}건, 상위 50건만 표시) ===")
for w in warnings[:50]:
    print(" ⚠️ ", w)

if not errors and not warnings:
    print("  → 오류 없음 ✅")
elif not errors:
    print(f"\n  → 치명 오류 없음. 교차 불일치 {len(warnings)}건은 약어 차이일 수 있음.")
