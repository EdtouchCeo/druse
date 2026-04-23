"""
교사별/학반별 시간표 XLS 파싱 스크립트
출력: output/web/_timetable_data.json
"""
import openpyxl
import json
import sys
import os

DAYS = ['월', '화', '수', '목', '금']
PERIODS = 7

def parse_teacher_schedule(filepath):
    wb = openpyxl.load_workbook(filepath, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    total_cols = ws.max_column

    teachers = {}

    # 교사 블록 헤더 위치 탐색 ('교사 시간표' 셀)
    for row_i, row in enumerate(rows):
        for col_i, cell in enumerate(row):
            if cell == '교사 시간표':
                # 교사 이름: 다음 행 col+3
                if row_i + 1 < len(rows) and col_i + 3 < len(rows[row_i + 1]):
                    name = rows[row_i + 1][col_i + 3]
                    if not name or not str(name).strip():
                        continue
                    name = str(name).strip()

                    # 교시 데이터 파싱: row+3부터 2행씩 7교시
                    schedule = {d: [] for d in DAYS}
                    base = row_i + 3  # 1교시 시작행

                    for period in range(1, PERIODS + 1):
                        subj_row = base + (period - 1) * 2
                        class_row = subj_row + 1
                        if subj_row >= len(rows):
                            break

                        for d_idx, day in enumerate(DAYS):
                            col = col_i + 1 + d_idx
                            if col < len(rows[subj_row]):
                                subj = rows[subj_row][col]
                                cls = rows[class_row][col] if class_row < len(rows) else None
                                schedule[day].append({
                                    'period': period,
                                    'subject': str(subj).strip() if subj else '',
                                    'class': str(cls).strip() if cls else ''
                                })

                    teachers[name] = schedule

    return teachers


def parse_class_schedule(filepath):
    wb = openpyxl.load_workbook(filepath, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))

    classes = {}

    # 학반 블록 헤더 위치 탐색 ('학반 시간표' 셀)
    for row_i, row in enumerate(rows):
        for col_i, cell in enumerate(row):
            if cell == '학반 시간표':
                # 학반 정보: 다음 행 col+3 (예: "1-1 안홍엽")
                if row_i + 1 < len(rows) and col_i + 3 < len(rows[row_i + 1]):
                    class_info = rows[row_i + 1][col_i + 3]
                    if not class_info or not str(class_info).strip():
                        continue
                    class_info = str(class_info).strip()

                    # 학반 이름 (예: "1-1"), 담임 (예: "안홍엽")
                    parts = class_info.split(' ', 1)
                    class_name = parts[0]
                    homeroom = parts[1] if len(parts) > 1 else ''

                    # 교시 데이터 파싱
                    schedule = {d: [] for d in DAYS}
                    base = row_i + 3

                    for period in range(1, PERIODS + 1):
                        subj_row = base + (period - 1) * 2
                        teacher_row = subj_row + 1
                        if subj_row >= len(rows):
                            break

                        for d_idx, day in enumerate(DAYS):
                            col = col_i + 1 + d_idx
                            if col < len(rows[subj_row]):
                                subj = rows[subj_row][col]
                                teacher = rows[teacher_row][col] if teacher_row < len(rows) else None
                                schedule[day].append({
                                    'period': period,
                                    'subject': str(subj).strip() if subj else '',
                                    'teacher': str(teacher).strip() if teacher else ''
                                })

                    classes[class_name] = {
                        'homeroom': homeroom,
                        'schedule': schedule
                    }

    return classes


def main():
    base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    teacher_file = os.path.join(base, 'input', '교사별 시간표(2026-1).xlsx')
    class_file = os.path.join(base, 'input', '학반별 시간표(2026-1).xlsx')
    out_file = os.path.join(base, 'output', 'web', '_timetable_data.json')

    print(f"교사별 시간표 파싱: {teacher_file}")
    teachers = parse_teacher_schedule(teacher_file)
    print(f"  → {len(teachers)}명 추출")

    print(f"학반별 시간표 파싱: {class_file}")
    classes = parse_class_schedule(class_file)
    print(f"  → {len(classes)}반 추출")

    data = {
        'teachers': teachers,
        'classes': classes
    }

    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"저장 완료: {out_file}")
    return data


if __name__ == '__main__':
    main()
