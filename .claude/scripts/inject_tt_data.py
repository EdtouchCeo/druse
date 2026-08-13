"""index.html의 시간표 데이터 3줄만 교체(학기 교체용).

parse_timetable.py 실행 후 사용:
  python .claude/scripts/parse_timetable.py
  python .claude/scripts/inject_tt_data.py

교체 대상 (시간표 검색 JS 블록 안)
  const TT={...}   시간표 데이터        ← _timetable_compact.json
  const ALI={...}  교사명 별칭          ← _timetable_alias.json
  const TL=[...]   자동완성 교사 명단   ← 교사 키 정렬

UI·로직은 건드리지 않는다. 각 선언이 정확히 한 줄에 하나씩 있어야 한다.
"""
import json
import os

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HTML = os.path.join(BASE, 'output', 'web', 'index.html')
WEB = os.path.join(BASE, 'output', 'web')


def load(name):
    with open(os.path.join(WEB, name), encoding='utf-8') as f:
        return json.load(f)


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))


def main():
    tt = load('_timetable_compact.json')
    ali = load('_timetable_alias.json')
    tl = sorted(tt['t'])

    with open(HTML, encoding='utf-8') as f:
        lines = f.read().split('\n')

    targets = [
        ('const TT={"t":', 'const TT=%s;' % dumps(tt), 'TT 데이터'),
        ('const ALI={', 'const ALI=%s;' % dumps(ali), 'ALI 별칭'),
        ('const TL=[', 'const TL=%s;' % dumps(tl), 'TL 자동완성'),
    ]
    for prefix, new, label in targets:
        hits = [i for i, l in enumerate(lines) if l.strip().startswith(prefix)]
        if len(hits) != 1:
            raise SystemExit('%s: %d곳 매칭 — 중단' % (label, len(hits)))
        i = hits[0]
        indent = lines[i][:len(lines[i]) - len(lines[i].lstrip())]   # 원래 들여쓰기 유지
        print('  %s (line %d): %d → %d자' % (label, i + 1, len(lines[i]), len(indent + new)))
        lines[i] = indent + new

    with open(HTML, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print('주입 완료: 교사 %d명 / 학급 %d반 / 별칭 %d건' % (len(tt['t']), len(tt['c']), len(ali)))


if __name__ == '__main__':
    main()
