# -*- coding: utf-8 -*-
"""검색 인덱스(JSON)의 각 청크를 임베딩하여 int8 양자화 .bin으로 저장.
   (클라이언트 의미검색 RAG용 — 브라우저가 이 .bin을 받아 코사인 유사도로 top-k 선택)

사용법 (GEMINI_API_KEY 환경변수 필요):
  set GEMINI_API_KEY=...        (Windows CMD)  /  export GEMINI_API_KEY=...  (bash)
  python scripts/build_embeddings.py "output/web/data/law_search.json"  "output/web/data/law_emb.bin"
  python scripts/build_embeddings.py "output/web/data/curr_search.json" "output/web/data/curr_emb.bin"

- 임베딩 모델: 기본 gemini-embedding-001, 출력 768차원(outputDimensionality).
  (EMBED_MODEL / EMBED_DIM 환경변수로 변경 가능. 프론트의 EMB_DIM, embed.js와 반드시 일치)
- 출력: 청크 순서대로 [int8 × DIM] 을 이어붙인 바이너리. (정규화 후 ×127 양자화)
- 이어받기: 중간에 끊겨도 같은 명령을 다시 실행하면 .bin 크기를 보고 남은 청크만 진행.
  (청크를 **맨 뒤에만 덧붙인** 경우에도 그대로 유효 — 새 청크만 임베딩된다.)
- 로컬 키가 없을 때: `--endpoint https://edtouch.ai/.netlify/functions/embed` 로
  배포된 embed 함수를 경유한다. 함수의 배치 모드({texts, doc:true})는 여기와 같은
  RETRIEVAL_DOCUMENT·768차원이라 벡터 공간이 일치한다(한 요청 최대 8개).
- 생성된 .bin 두 개를 커밋·푸시하면 챗봇이 자동으로 의미검색으로 전환됨.
"""
import sys, os, json, math, time, urllib.request, urllib.error
from array import array
from concurrent.futures import ThreadPoolExecutor

API_KEY = os.environ.get('GEMINI_API_KEY')
MODEL = os.environ.get('EMBED_MODEL', 'gemini-embedding-001')
DIM = int(os.environ.get('EMBED_DIM', '768'))
MAX_CHARS = 2000
BATCH = 200       # 한 번에 처리(이어받기 단위)
WORKERS = 8       # 동시 요청 수
TASK = 'RETRIEVAL_DOCUMENT'

def embed_one(text, attempt=0):
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:embedContent?key={API_KEY}'
    payload = {
        'model': f'models/{MODEL}',
        'content': {'parts': [{'text': (text or ' ')[:MAX_CHARS]}]},
        'taskType': TASK,
        'outputDimensionality': DIM,
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            res = json.load(r)
        return res['embedding']['values']
    except urllib.error.HTTPError as e:
        if e.code in (429, 500, 502, 503, 504) and attempt < 6:
            time.sleep(min(2 ** attempt, 30))
            return embed_one(text, attempt + 1)
        raise RuntimeError(f'HTTP {e.code}: {e.read().decode("utf-8", "ignore")[:300]}')
    except (urllib.error.URLError, TimeoutError) as e:
        if attempt < 6:
            time.sleep(min(2 ** attempt, 30))
            return embed_one(text, attempt + 1)
        raise

def quantize(vec):
    n = math.sqrt(sum(x * x for x in vec)) or 1.0
    q = [max(-127, min(127, int(round(x / n * 127)))) for x in vec]
    return array('b', q).tobytes()

FN_BATCH = 8      # embed.js가 한 요청에서 처리하는 최대 개수


def embed_batch_via_fn(texts, url, attempt=0):
    payload = json.dumps({'texts': [(t or ' ')[:MAX_CHARS] for t in texts],
                          'doc': True}).encode('utf-8')
    req = urllib.request.Request(url, data=payload,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            res = json.load(r)
        vecs = res.get('embeddings') or []
        if len(vecs) != len(texts):
            raise RuntimeError('배치 응답 개수 불일치 %d != %d' % (len(vecs), len(texts)))
        return vecs
    except urllib.error.HTTPError as e:
        if e.code in (429, 500, 502, 503, 504) and attempt < 6:
            time.sleep(min(2 ** attempt, 30))
            return embed_batch_via_fn(texts, url, attempt + 1)
        raise RuntimeError('HTTP %d: %s' % (e.code, e.read().decode('utf-8', 'ignore')[:200]))
    except (urllib.error.URLError, TimeoutError):
        if attempt < 6:
            time.sleep(min(2 ** attempt, 30))
            return embed_batch_via_fn(texts, url, attempt + 1)
        raise


def build(chunk_json, out_bin, endpoint=None):
    if not endpoint and not API_KEY:
        print('오류: GEMINI_API_KEY 환경변수(또는 --endpoint)가 필요합니다.'); sys.exit(1)
    chunks = json.load(open(chunk_json, encoding='utf-8'))['chunks']
    total = len(chunks)
    # 이어받기: 기존 .bin 크기로 완료 개수 계산
    done = 0
    if os.path.exists(out_bin):
        done = os.path.getsize(out_bin) // DIM
        if done > total:
            print(f'경고: 기존 {out_bin}이 더 큽니다. 삭제 후 다시 실행하세요.'); sys.exit(1)
    print(f'임베딩: {chunk_json} — {total}개 청크, 모델 {MODEL}({DIM}d), 시작 {done}부터')
    mode = 'ab' if done else 'wb'
    with open(out_bin, mode) as out, ThreadPoolExecutor(max_workers=WORKERS) as ex:
        i = done
        while i < total:
            batch = chunks[i:i + BATCH]
            if endpoint:
                groups = [batch[k:k + FN_BATCH] for k in range(0, len(batch), FN_BATCH)]
                vecs = [v for g in ex.map(
                    lambda g: embed_batch_via_fn([c[2] for c in g], endpoint), groups) for v in g]
            else:
                vecs = list(ex.map(lambda c: embed_one(c[2]), batch))
            for v in vecs:
                if len(v) != DIM:
                    print(f'오류: 임베딩 차원 {len(v)} != 설정 {DIM}. EMBED_DIM을 {len(v)}로 맞추세요.'); sys.exit(1)
                out.write(quantize(v))
            out.flush()
            i += len(batch)
            print(f'  {i}/{total}', flush=True)
    size = os.path.getsize(out_bin)
    print(f'완료: {out_bin}  ({size:,} bytes = {total}×{DIM} int8)')

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    ep = None
    for i, a in enumerate(sys.argv):
        if a == '--endpoint' and i + 1 < len(sys.argv):
            ep = sys.argv[i + 1]
            if ep in args:
                args.remove(ep)
    if len(args) != 2:
        print(__doc__); sys.exit(1)
    build(args[0], args[1], ep)
