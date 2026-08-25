# -*- coding: utf-8 -*-
"""청크 순서가 바뀐 인덱스의 임베딩을, 기존 벡터를 본문으로 재사용해 다시 만든다.

build_embeddings.py의 이어받기는 `.bin 크기 // 768`로 완료 개수를 세므로 **청크가 뒤에만
추가될 때**만 유효하다. 문서가 목록 가운데(파일명 정렬상 앞쪽)에 새로 들어오면 그 뒤 청크가
전부 밀려 이어받기를 쓸 수 없고, 그렇다고 전부 다시 만들면 멀쩡한 벡터 수천 개를 버리게 된다.

이 스크립트는 **청크 본문이 같으면 벡터도 같다**는 성질을 이용해 옛 (json, bin) 짝에서
본문→벡터 사전을 만들고, 새 인덱스에서 처음 보는 본문만 임베딩한다. 위치 이동은 무시된다.

  python scripts/build_embeddings_reuse.py <새_search.json> <새_emb.bin> \
         --prev <옛_search.json> <옛_emb.bin> [--endpoint <embed 함수 URL>]

⚠️ 옛 bin은 반드시 옛 json과 짝이어야 한다(크기 == 청크수 × 768로 확인한다).
   task type은 옛 벡터와 같아야 하므로 endpoint는 문서용(doc:true) 경로를 쓴다.
"""
import io
import json
import os
import sys

DIM = 768


def load_pairs(json_path, bin_path):
    with io.open(json_path, encoding='utf-8') as f:
        chunks = json.load(f)['chunks']
    blob = open(bin_path, 'rb').read()
    if len(blob) != len(chunks) * DIM:
        sys.exit('오류: 옛 짝이 맞지 않음 — bin %d != 청크 %d × %d'
                 % (len(blob), len(chunks), DIM))
    table = {}
    for i, c in enumerate(chunks):
        table.setdefault(c[2], blob[i * DIM:(i + 1) * DIM])
    return table


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 2:
        sys.exit(__doc__)
    new_json, new_bin = args[0], args[1]
    prev_json = prev_bin = endpoint = None
    for i, a in enumerate(sys.argv):
        if a == '--prev' and i + 2 < len(sys.argv):
            prev_json, prev_bin = sys.argv[i + 1], sys.argv[i + 2]
        if a == '--endpoint' and i + 1 < len(sys.argv):
            endpoint = sys.argv[i + 1]
    if not prev_json:
        sys.exit('오류: --prev <옛_json> <옛_bin> 이 필요합니다.')

    table = load_pairs(prev_json, prev_bin)
    with io.open(new_json, encoding='utf-8') as f:
        chunks = json.load(f)['chunks']

    vectors = [table.get(c[2]) for c in chunks]
    missing = [i for i, v in enumerate(vectors) if v is None]
    print('청크 %d개 — 재사용 %d, 새로 생성 %d'
          % (len(chunks), len(chunks) - len(missing), len(missing)))

    if missing:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import build_embeddings as B
        if not endpoint and not B.API_KEY:
            sys.exit('오류: GEMINI_API_KEY 또는 --endpoint 가 필요합니다.')
        step = B.FN_BATCH if endpoint else 1
        done = 0
        for s in range(0, len(missing), step):
            idxs = missing[s:s + step]
            texts = [chunks[i][2] for i in idxs]
            if endpoint:
                vecs = B.embed_batch_via_fn(texts, endpoint)
            else:
                vecs = [B.embed_one(t) for t in texts]
            for i, v in zip(idxs, vecs):
                if len(v) != DIM:
                    sys.exit('오류: 임베딩 차원 %d != %d' % (len(v), DIM))
                vectors[i] = B.quantize(v)      # 기존 벡터와 같은 양자화를 써야 한다
            done += len(idxs)
            sys.stdout.write('\r  %d/%d' % (done, len(missing)))
            sys.stdout.flush()
        print()

    bad = [i for i, v in enumerate(vectors) if v is None or len(v) != DIM]
    if bad:
        sys.exit('오류: 벡터가 비었거나 길이가 다름 — 청크 %s' % bad[:5])
    with open(new_bin, 'wb') as f:
        for v in vectors:
            f.write(v)
    size = os.path.getsize(new_bin)
    print('완료: %s (%s bytes = %d × %d) — 불변식 %s'
          % (new_bin, format(size, ','), len(chunks), DIM,
             'OK' if size == len(chunks) * DIM else '위반!!'))


if __name__ == '__main__':
    main()
