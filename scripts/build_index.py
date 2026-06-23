# -*- coding: utf-8 -*-
"""raw md → 검색 인덱스 JSON (청크 단위, 출처/위치 참조 포함).

사용법:
  python scripts/build_index.py <raw md경로> <출력json경로>

예:
  python scripts/build_index.py "data/법령지침_raw.md" "output/web/data/law_search.json"
  python scripts/build_index.py "data/교육과정_raw.md" "output/web/data/curr_search.json"

출력 JSON 구조: {"docs":[문서라벨...], "chunks":[[docIdx, ref, text], ...]}
  - 법령(제N조 패턴)은 조문 단위로, 그 외는 페이지/길이 기준으로 분할
  - 웹페이지의 통합검색 JS가 이 파일을 fetch 하여 키워드 검색에 사용
"""
import sys, os, re, json

ART_RE = re.compile(r'^제\d+조(?:의\d+)?')
PAGE_RE = re.compile(r'^\[(?:p\.(\d+)|슬라이드\s*(\d+))\]')
MAX_CHARS = 900   # 청크 최대 길이
MIN_CHARS = 40    # 너무 짧은 청크 무시

def short_label(fname):
    s = os.path.splitext(fname)[0]
    # [별표 N]/[별책 N]/[붙임] 등 머리표 보존, 괄호 메타(호수/날짜) 제거
    s = re.sub(r'\((?:법률|대통령령|예규)\)', '', s)
    s = re.sub(r'\(제[\d]+[호ㆍ\d]*\)', '', s)
    s = re.sub(r'\(\d{8}\)', '', s)
    s = re.sub(r'_국가교육위원회.*$', '', s)
    s = re.sub(r'\s{2,}', ' ', s).strip()
    return s

def split_docs(md):
    # '# 📄 <파일명>' 기준 분할
    parts = re.split(r'(?m)^# 📄 (.+)$', md)
    docs = []
    # parts[0]=intro, then (name, body) 반복
    for i in range(1, len(parts), 2):
        name = parts[i].strip()
        body = parts[i+1] if i+1 < len(parts) else ''
        docs.append((name, body))
    return docs

def chunk_doc(body):
    """문단/조문/페이지 경계 기준 청크 생성. 반환: [(ref, text), ...]"""
    chunks = []
    cur, cur_len = [], 0
    cur_ref = ''
    page_ref = ''

    def flush():
        nonlocal cur, cur_len
        if cur:
            text = '\n'.join(cur).strip()
            if len(text) >= MIN_CHARS:
                chunks.append((cur_ref or page_ref, text))
            cur, cur_len = [], 0

    for raw in body.split('\n'):
        line = raw.rstrip()
        if not line.strip():
            continue
        m = PAGE_RE.match(line)
        if m:
            page_ref = ('p.' + m.group(1)) if m.group(1) else ('슬라이드 ' + m.group(2))
            continue
        if ART_RE.match(line):
            flush()
            # 조문 제목: 제N조(제목) 형태에서 60자까지
            cur_ref = line[:60]
        cur.append(line)
        cur_len += len(line)
        if cur_len >= MAX_CHARS:
            flush()
            cur_ref = ''  # 길이초과 분할 시 조 참조 해제(다음 조 만날 때 갱신)
    flush()
    return chunks

def build(raw_path, out_path):
    md = open(raw_path, encoding='utf-8').read()
    docs = split_docs(md)
    doc_labels = []
    chunks = []  # [docIdx, ref, text]
    for di, (name, body) in enumerate(docs):
        doc_labels.append(short_label(name))
        for ref, text in chunk_doc(body):
            chunks.append([di, ref, text])
    data = {'docs': doc_labels, 'chunks': chunks}
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as w:
        json.dump(data, w, ensure_ascii=False, separators=(',', ':'))
    size = os.path.getsize(out_path)
    print(f'OUT {out_path}: {len(docs)} docs, {len(chunks)} chunks, {size:,} bytes')

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__); sys.exit(1)
    build(sys.argv[1], sys.argv[2])
