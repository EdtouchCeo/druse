# -*- coding: utf-8 -*-
"""wiki_search.json → wiki_emb.bin (콘텐츠 해시 캐시 방식)

⚠️ build_embeddings.py를 위키에 쓰지 말 것.
   그 스크립트의 이어받기는 `.bin 크기 // DIM`으로 완료 개수를 세는데, 이는
   **청크 순서가 안정적 prefix라는 가정**이다. 위키는 카드에 문단 하나만 추가돼도
   그 카드 이후 모든 청크가 밀리므로 가정이 깨지고, 벡터와 텍스트가 어긋난 채
   조용히 틀린 답을 낸다 — 불변식 `bin == 청크수×768`도 통과해 검출조차 안 된다.

여기서는 청크 텍스트의 sha1을 키로 벡터를 캐시하고, 매번 **새 순서대로 처음부터**
bin을 쓴다. 순서 변경·삽입·삭제에 무관하게 정확하며, 카드 몇 장만 고친 재빌드는
캐시 적중률이 높아 30초 안에 끝난다(운영상 재빌드가 실제로 돌아가려면 필요한 조건).

사용 A — 로컬 키 (GEMINI_API_KEY 환경변수):
  python scripts/build_wiki_emb.py "output/web/data/wiki_search.json" \
                                   "output/web/data/wiki_emb.bin"

사용 B — 배포된 embed 함수 경유 (로컬 키 없을 때):
  python scripts/build_wiki_emb.py "output/web/data/wiki_search.json" \
         "output/web/data/wiki_emb.bin" --endpoint https://edtouch.ai/.netlify/functions/embed
  함수의 배치 모드({texts, doc:true})는 build_embeddings.py와 **같은 RETRIEVAL_DOCUMENT·768차원**을
  쓰므로 벡터 공간이 일치한다. 한 번에 8개까지만 받으므로 배치를 8로 맞춘다.

  옵션: --no-cache   캐시를 무시하고 전량 재생성
        --cache PATH 캐시 파일 경로 (기본 tmp/wiki_emb_cache.jsonl)

캐시 파일은 커밋 대상이 아니다. 유실되면 전체 재생성으로 자연 폴백한다.
"""
import argparse
import base64
import hashlib
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_embeddings import embed_one, quantize, DIM, MODEL, API_KEY, WORKERS  # noqa: E402

BATCH = 200
FN_BATCH = 8      # embed.js가 한 요청에서 처리하는 최대 개수


def embed_batch_via_fn(texts, url, attempt=0):
    """배포된 embed 함수의 배치 모드. RETRIEVAL_DOCUMENT·768차원으로 로컬 경로와 동일."""
    payload = json.dumps({'texts': texts, 'doc': True}).encode('utf-8')
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


def sha1(text):
    return hashlib.sha1(text.encode('utf-8')).hexdigest()


def load_cache(path):
    cache = {}
    if not os.path.exists(path):
        return cache
    with io.open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                blob = base64.b64decode(rec['v'])
                if len(blob) == DIM:
                    cache[rec['h']] = blob
            except Exception:
                continue  # 손상된 줄은 버리고 재생성
    return cache


def build(chunk_json, out_bin, cache_path, use_cache=True, endpoint=None):
    if not endpoint and not API_KEY:
        print('오류: GEMINI_API_KEY 환경변수 또는 --endpoint 가 필요합니다.')
        return 1
    with io.open(chunk_json, encoding='utf-8') as f:
        chunks = json.load(f)['chunks']
    texts = [c[2] for c in chunks]
    total = len(texts)
    hashes = [sha1(t) for t in texts]

    cache = load_cache(cache_path) if use_cache else {}
    need = []
    seen = set()
    for h, t in zip(hashes, texts):
        if h not in cache and h not in seen:
            seen.add(h)
            need.append((h, t))
    print('임베딩: %d청크 (고유 %d) · 캐시 적중 %d · 신규 %d · %s'
          % (total, len(set(hashes)), len(set(hashes)) - len(need), len(need),
             ('함수 경유 ' + endpoint) if endpoint else '모델 %s(%dd)' % (MODEL, DIM)))

    if need:
        os.makedirs(os.path.dirname(cache_path) or '.', exist_ok=True)
        with ThreadPoolExecutor(max_workers=WORKERS) as ex, \
                io.open(cache_path, 'a', encoding='utf-8') as cf:
            if endpoint:
                groups = [need[i:i + FN_BATCH] for i in range(0, len(need), FN_BATCH)]
                done = 0
                for gi in range(0, len(groups), WORKERS):
                    wave = groups[gi:gi + WORKERS]
                    results = list(ex.map(
                        lambda g: embed_batch_via_fn([t for _h, t in g], endpoint), wave))
                    for g, vecs in zip(wave, results):
                        for (h, _t), v in zip(g, vecs):
                            if len(v) != DIM:
                                print('오류: 임베딩 차원 %d != %d' % (len(v), DIM))
                                return 1
                            blob = quantize(v)
                            cache[h] = blob
                            cf.write(json.dumps({'h': h, 'v': base64.b64encode(blob).decode()}) + '\n')
                        done += len(g)
                    cf.flush()
                    print('  %d/%d' % (done, len(need)), flush=True)
            else:
                for i in range(0, len(need), BATCH):
                    batch = need[i:i + BATCH]
                    vecs = list(ex.map(lambda p: embed_one(p[1]), batch))
                    for (h, _t), v in zip(batch, vecs):
                        if len(v) != DIM:
                            print('오류: 임베딩 차원 %d != %d' % (len(v), DIM))
                            return 1
                        blob = quantize(v)
                        cache[h] = blob
                        cf.write(json.dumps({'h': h, 'v': base64.b64encode(blob).decode()}) + '\n')
                    cf.flush()
                    print('  %d/%d' % (min(i + BATCH, len(need)), len(need)), flush=True)

    # 항상 새 순서대로 처음부터 쓴다 — 이어붙이지 않는다
    os.makedirs(os.path.dirname(out_bin) or '.', exist_ok=True)
    with open(out_bin, 'wb') as out:
        for h in hashes:
            out.write(cache[h])

    size = os.path.getsize(out_bin)
    expect = total * DIM
    if size != expect:
        print('[FAIL] 불변식 A 위반: %d bytes != %d×%d = %d' % (size, total, DIM, expect))
        return 1
    print('완료: %s  (%s bytes = %d×%d int8) — 불변식 A 통과'
          % (out_bin, format(size, ','), total, DIM))
    return 0


def main():
    ap = argparse.ArgumentParser(description='wiki_search.json → wiki_emb.bin (해시 캐시)')
    ap.add_argument('chunk_json')
    ap.add_argument('out_bin')
    ap.add_argument('--cache', default=os.path.join('tmp', 'wiki_emb_cache.jsonl'))
    ap.add_argument('--no-cache', action='store_true')
    ap.add_argument('--endpoint', help='배포된 embed 함수 URL (로컬 GEMINI_API_KEY 없을 때)')
    a = ap.parse_args()
    return build(a.chunk_json, a.out_bin, a.cache,
                 use_cache=not a.no_cache, endpoint=a.endpoint)


if __name__ == '__main__':
    sys.exit(main())
