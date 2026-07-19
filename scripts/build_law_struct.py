# -*- coding: utf-8 -*-
"""law_struct.json 생성 — 법령 AI 결정 주입용 구조화 사전.

law_search.json(조문 단위 청크)에서 법령류 문서만 골라
{ 법령명 → 조문번호 → 조문 전문 } 사전을 만든다.
질문에 「법령명 + 제N조」가 감지되면 RAG 의미검색 대신 해당 조문 원문을
근거 최상단에 결정적으로 주입한다 (curr_struct.json과 동일 사상).

사용: python scripts/build_law_struct.py
입력: output/web/data/law_search.json
출력: output/web/data/law_struct.json
검증: 모든 조문 텍스트는 law_search.json 청크의 원문 그대로(부분문자열) — 환각 0.
"""
import json
import io
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, 'output', 'web', 'data', 'law_search.json')
OUT = os.path.join(BASE, 'output', 'web', 'data', 'law_struct.json')

# 법령류 문서(조문 구조를 가진 것)만 — 안내자료·기재요령·별표·서식은 제외
# name: docs 배열의 정확한 문서명 / aliases: 질문 감지용 별칭(공백·중점 제거 후 비교)
STATUTES = [
    {
        'name': '초ㆍ중등교육법',
        'aliases': ['초중등교육법', '초·중등교육법', '초ㆍ중등교육법'],
    },
    {
        'name': '초ㆍ중등교육법 시행령',
        'aliases': ['초중등교육법시행령', '초·중등교육법시행령', '초ㆍ중등교육법시행령'],
    },
    {
        'name': '국가공무원 복무규정',
        'aliases': ['국가공무원복무규정', '복무규정'],
    },
    {
        'name': '교원휴가에 관한 예규',
        'aliases': ['교원휴가에관한예규', '교원휴가예규', '교원휴가'],
    },
    {
        'name': '학교폭력예방 및 대책에 관한 법률',
        'aliases': ['학교폭력예방및대책에관한법률', '학교폭력예방법', '학폭법', '학교폭력법'],
    },
]

ART_RE = re.compile(r'^제(\d+)조(?:의(\d+))?')


def main():
    with io.open(SRC, encoding='utf-8') as f:
        d = json.load(f)
    docs = d['docs']
    chunks = d['chunks']

    laws = []
    for st in STATUTES:
        if st['name'] not in docs:
            print('[warn] docs에 없음:', st['name'])
            continue
        di = docs.index(st['name'])
        articles = []
        seen = set()
        for c in chunks:
            if c[0] != di:
                continue
            text = (c[2] or '').strip()
            m = ART_RE.match(text)
            if not m:
                continue
            no = m.group(1) + ('의' + m.group(2) if m.group(2) else '')
            if no in seen:
                continue  # 동일 조문 분할 청크는 첫 청크만 (조문 헤더 포함본)
            seen.add(no)
            # 조문 제목 추출 (제N조(제목) ...)
            tm = re.match(r'^제\d+조(?:의\d+)?\s*\(([^)]*)\)', text)
            articles.append({
                'no': no,
                'title': tm.group(1) if tm else '',
                'text': text,
            })
        laws.append({
            'name': st['name'],
            'doc': di,
            'aliases': st['aliases'],
            'articles': articles,
        })
        print(f"[ok] {st['name']}: 조문 {len(articles)}개")

    out = {'version': 1, 'laws': laws}
    # 검증: 모든 text가 원본 청크에서 왔는지 (구성상 자명하지만 재확인)
    chunk_texts = set()
    for c in chunks:
        chunk_texts.add((c[2] or '').strip())
    bad = 0
    for law in laws:
        for a in law['articles']:
            if a['text'] not in chunk_texts:
                bad += 1
    if bad:
        print('[FAIL] 원문 불일치', bad)
        return 1

    with io.open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    total = sum(len(l['articles']) for l in laws)
    print('saved', OUT, '| 법령', len(laws), '| 조문', total, '| 크기', os.path.getsize(OUT))
    return 0


if __name__ == '__main__':
    sys.exit(main())
