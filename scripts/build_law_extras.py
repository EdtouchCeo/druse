# -*- coding: utf-8 -*-
"""law_search.json에 '파일이 아닌 소스'(웹 수집 JSON)를 문서로 덧붙인다.

extract_folder.py는 input 폴더의 pdf/pptx/hwpx만 읽는다. 웹에서 수집한 자료
(국가법령정보센터 조문, 교육청 Q&A 사이트)는 `data/sources/*.json`에 원본 형태로
보관하고, 이 스크립트가 검색 인덱스 뒤에 문서로 덧붙인다.

  python scripts/build_index.py "data/법령지침_raw.md" "output/web/data/law_search.json"
  python scripts/build_law_extras.py          # ← 반드시 build_index 다음에
  python scripts/build_law_struct.py

⚠️ build_index.py를 다시 돌리면 이 문서들이 사라진다. 항상 이어서 실행할 것.

설계 원칙
- **항상 맨 뒤에 덧붙인다**: 앞선 청크의 순서가 보존되므로 build_embeddings.py의
  이어받기(.bin 크기 // 768)가 그대로 유효하다. 새 청크만 임베딩하면 된다.
- **멱등**: 기존 문서는 원래 위치에서 갱신하고, 없는 문서만 맨 뒤에 붙인다.
  뒤에 다른 자료가 추가된 상태에서도 기존 문서·청크 순서를 바꾸지 않는다.
- 원문 무수정: 조문·답변 텍스트는 수집 JSON의 문자열을 그대로 옮긴다.
"""
import io
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(BASE, 'data', 'sources')
IDX = os.path.join(BASE, 'output', 'web', 'data', 'law_search.json')

MAX_CHARS = 900   # build_index.py와 동일 기준

DECREE_JSON = os.path.join(SRC_DIR, 'hakpok_enforcement_decree.json')
QA_JSON = os.path.join(SRC_DIR, 'ddeqna_qa.json')
GUIDE_JSON = os.path.join(SRC_DIR, 'dge_teacher_protection_guide.json')
LECTURE_JSON = os.path.join(SRC_DIR, 'external_lecture_reporting_exemptions.json')


def split_lines(lines, cap=MAX_CHARS):
    """줄 목록을 cap 이하 묶음으로 자른다(줄 경계 보존)."""
    out, cur, n = [], [], 0
    for ln in lines:
        cur.append(ln)
        n += len(ln)
        if n >= cap:
            out.append(cur)
            cur, n = [], 0
    if cur:
        out.append(cur)
    return out


def decree_chunks(path):
    d = json.load(io.open(path, encoding='utf-8'))
    label = d['source']['docLabel']
    chunks = []
    for a in d['articles']:
        no = a['no']
        head = ('제%s조의%s' % tuple(no.split('의'))) if '의' in no else ('제%s조' % no)
        ref = '%s(%s)' % (head, a['title'])
        parts = split_lines(a['text'].split('\n'))
        for pi, part in enumerate(parts):
            text = '\n'.join(part).strip()
            if not text:
                continue
            if pi > 0:
                text = ref + ' (이어짐)\n' + text
            chunks.append([ref, text])
    return label, chunks


def qa_chunks(path):
    d = json.load(io.open(path, encoding='utf-8'))
    label = d['source']['docLabel']
    site = d['source']['url']
    chunks = []
    for it in d['items']:
        ref = 'Q%s · %s' % (it['number'], it['partName'])
        head = 'Q. ' + it['question']
        body = [l for l in it['answer'].split('\n') if l.strip()]
        parts = split_lines(body, MAX_CHARS - len(head) - 4)
        for pi, part in enumerate(parts):
            h = head if pi == 0 else head + ' (이어짐)'
            chunks.append([ref, h + '\nA. ' + '\n'.join(part).strip()])
    return label, chunks, site


def section_chunks(path):
    """쪽 단위 카드(Q&A·안내 절차)를 절 하나당 청크 하나로 만든다.

    글자가 이미지로만 들어 있어 extract_folder.py가 못 읽는 인쇄물(리플렛 등)을
    쪽 판독으로 옮겨 둔 소스가 대상이다. 절이 길면 줄 경계로 나눈다.
    """
    d = json.load(io.open(path, encoding='utf-8'))
    label = d['source']['docLabel']
    chunks = []
    for sec in d['sections']:
        ref = sec['ref']
        parts = split_lines(sec['text'].split(chr(10)))
        for pi, part in enumerate(parts):
            text = chr(10).join(part).strip()
            if not text:
                continue
            if pi > 0:
                text = ref + ' (이어짐)' + chr(10) + text
            chunks.append([ref, text])
    return label, chunks


def merge_extras(data, extras):
    """문서 ID와 기존 위치를 보존한다. 본문 변경 시 전체 임베딩이 필요하다."""
    docs = list(data['docs'])
    chunks = list(data['chunks'])
    for label, chs in extras:
        if label not in docs:
            di = len(docs)
            docs.append(label)
            chunks.extend([[di, ref, text] for ref, text in chs])
            print('[추가] %s: 청크 %d개' % (label, len(chs)))
            continue
        di = docs.index(label)
        old = [c for c in chunks if c[0] == di]
        new = [[di, ref, text] for ref, text in chs]
        if old == new:
            print('[유지] %s: 청크 %d개' % (label, len(chs)))
            continue
        # 대상 문서가 처음 있던 자리에만 새 청크를 넣고 다른 문서는 건드리지 않는다.
        at = next((i for i, c in enumerate(chunks) if c[0] == di), len(chunks))
        previous_chunks = chunks
        chunks = chunks[:at] + new + [c for c in chunks[at:] if c[0] != di]
        if len(chunks) > len(previous_chunks) and chunks[:len(previous_chunks)] == previous_chunks:
            print('[추가] %s: 기존 문서 뒤에 청크 %d개 추가'
                  % (label, len(new) - len(old)))
        else:
            print('[변경] %s: 청크 %d → %d개 — 기존 본문 또는 순서 변경, 전체 임베딩 재생성 필요'
                  % (label, len(old), len(new)))
    return dict(data, docs=docs, chunks=chunks)


def main():
    with io.open(IDX, encoding='utf-8') as f:
        data = json.load(f)
    base_count = len(data['chunks'])

    label_d, ch_d = decree_chunks(DECREE_JSON)
    label_q, ch_q, _site = qa_chunks(QA_JSON)
    label_g, ch_g = section_chunks(GUIDE_JSON)
    label_l, ch_l = section_chunks(LECTURE_JSON)
    extras = [(label_d, ch_d), (label_q, ch_q), (label_g, ch_g), (label_l, ch_l)]
    data = merge_extras(data, extras)
    with io.open(IDX, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print('OUT %s: %d docs, %d chunks (실행 전 %d, 증감 %+d), %d bytes'
          % (IDX, len(data['docs']), len(data['chunks']), base_count, len(data['chunks']) - base_count,
             os.path.getsize(IDX)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
