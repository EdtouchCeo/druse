# -*- coding: utf-8 -*-
"""검색 인덱스(JSON)의 각 청크를 임베딩하여 int8 양자화 .bin으로 저장.
   (클라이언트 의미검색 RAG용 — 브라우저가 이 .bin을 받아 코사인 유사도로 top-k 선택)

사용법 (GEMINI_API_KEY 환경변수 필요):
  set GEMINI_API_KEY=...        (Windows CMD)  /  export GEMINI_API_KEY=...  (bash)
  python scripts/build_embeddings.py "output/web/data/law_search.json"  "output/web/data/law_emb.bin"
  python scripts/build_embeddings.py "output/web/data/curr_search.json" "output/web/data/curr_emb.bin"

- 임베딩 모델: 기본 text-embedding-004 (768차원). EMBED_MODEL 환경변수로 변경 가능.
- 출력: 청크 순서대로 [int8 × 768] 을 이어붙인 바이너리. (정규화 후 ×127 양자화)
- 생성된 .bin 두 개를 커밋·푸시하면 챗봇이 자동으로 의미검색으로 전환됨.
"""
import sys, os, json, math, time, urllib.request, urllib.error
from array import array

API_KEY = os.environ.get('GEMINI_API_KEY')
MODEL = os.environ.get('EMBED_MODEL', 'text-embedding-004')
DIM = int(os.environ.get('EMBED_DIM', '768'))
BATCH = 100
MAX_CHARS = 2000

def embed_batch(texts, attempt=0):
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:batchEmbedContents?key={API_KEY}'
    reqs = [{'model': f'models/{MODEL}', 'content': {'parts': [{'text': t[:MAX_CHARS]}]}} for t in texts]
    data = json.dumps({'requests': reqs}).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            res = json.load(r)
        return [e['values'] for e in res['embeddings']]
    except urllib.error.HTTPError as e:
        if attempt < 3:
            time.sleep(2 * (attempt + 1))
            return embed_batch(texts, attempt + 1)
        raise RuntimeError(f'HTTP {e.code}: {e.read().decode("utf-8", "ignore")[:300]}')

def quantize(vec):
    n = math.sqrt(sum(x * x for x in vec)) or 1.0
    q = [max(-127, min(127, int(round(x / n * 127)))) for x in vec]
    return array('b', q).tobytes()

def build(chunk_json, out_bin):
    if not API_KEY:
        print('오류: GEMINI_API_KEY 환경변수가 필요합니다.'); sys.exit(1)
    data = json.load(open(chunk_json, encoding='utf-8'))
    chunks = data['chunks']
    total = len(chunks)
    print(f'임베딩 시작: {chunk_json} — {total}개 청크, 모델 {MODEL}({DIM}d)')
    with open(out_bin, 'wb') as out:
        done = 0
        for i in range(0, total, BATCH):
            batch = chunks[i:i + BATCH]
            embs = embed_batch([c[2] for c in batch])
            for e in embs:
                if len(e) != DIM:
                    print(f'경고: 임베딩 차원 {len(e)} != 설정 {DIM}. EMBED_DIM을 {len(e)}로 맞추세요.'); sys.exit(1)
                out.write(quantize(e))
            done += len(batch)
            print(f'  {done}/{total}', flush=True)
            time.sleep(0.1)
    size = os.path.getsize(out_bin)
    print(f'완료: {out_bin}  ({size:,} bytes = {total}×{DIM} int8)')

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__); sys.exit(1)
    build(sys.argv[1], sys.argv[2])
