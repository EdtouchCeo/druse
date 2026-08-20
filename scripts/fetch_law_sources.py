# -*- coding: utf-8 -*-
"""웹 수집 소스 → data/sources/*.json 재생성 (교육법 AI용).

  python scripts/fetch_law_sources.py            # 둘 다
  python scripts/fetch_law_sources.py ddeqna     # 든든첵 Q&A만
  python scripts/fetch_law_sources.py decree     # 학폭법 시행령만

수집 대상
- ddeqna : 든든첵 학교폭력 사안처리 Q&A (https://ddeqna.netlify.app/, 대구광역시교육청)
           Next.js 정적 페이지라 별도 API가 없다. 페이지 HTML의 RSC 페이로드
           (self.__next_f.push([1,"..."]))를 이어 붙이면 initialData.allFaqs가 들어 있고,
           긴 답변은 `<id>:T<hex길이>,<본문>` 형태로 따로 스트리밍되어 "$5" 참조로 남는다 → 역참조 복원.
- decree : 학교폭력예방 및 대책에 관한 법률 시행령 (국가법령정보센터)
           `법령/<법령명>` 친화 URL이 iframe src로 lsiSeq를 알려 주고,
           실제 조문 HTML은 lsInfoP.do가 아니라 **lsInfoR.do**가 준다.
           (DRF Open API는 서버 IP 등록이 필요해 이 경로를 쓴다.)

수집 후에는 반드시 인덱스를 다시 만든다 (한 줄씩):
  python scripts/build_law_extras.py
  python scripts/build_law_struct.py
  python scripts/build_embeddings.py "output/web/data/law_search.json" "output/web/data/law_emb.bin" --endpoint https://edtouch.ai/.netlify/functions/embed
"""
import datetime
import html
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE, 'data', 'sources')
UA = {'User-Agent': 'Mozilla/5.0 (EdTouch law dataset collector)'}
TODAY = datetime.date.today().isoformat()

DDEQNA_URL = 'https://ddeqna.netlify.app/'
DECREE_NAME = '학교폭력예방 및 대책에 관한 법률 시행령'
DECREE_URL = 'https://www.law.go.kr/법령/학교폭력예방및대책에관한법률시행령'


def get(url):
    # 법령 친화 URL은 경로에 한글이 들어간다 — 퍼센트 인코딩해야 http.client가 받는다
    url = urllib.parse.quote(url, safe=':/?&=%#')
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode('utf-8', 'replace')


# ── 든든첵 ────────────────────────────────────────────────
def fetch_ddeqna():
    h = get(DDEQNA_URL)
    dec = json.JSONDecoder()
    marker = 'self.__next_f.push([1,'
    parts, i = [], h.find(marker)
    while i != -1:
        obj, end = dec.raw_decode(h, i + len(marker))
        parts.append(obj)
        i = h.find(marker, end)
    payload = ''.join(parts)

    # 별도 스트리밍된 긴 텍스트: <id>:T<hex길이>,<본문>
    refs = {}
    for m in re.finditer(r'(?m)^([0-9a-f]+):T([0-9a-f]+),', payload):
        n = int(m.group(2), 16)
        refs[m.group(1)] = payload[m.end():m.end() + n]

    key = '"initialData":'
    data, _ = dec.raw_decode(payload, payload.find(key) + len(key))
    labels = {l['id']: l for l in data['labels']}

    def deref(v):
        if isinstance(v, str) and re.fullmatch(r'\$[0-9a-f]+', v):
            return refs.get(v[1:], v)
        return v

    items = []
    for f in data['allFaqs']:
        q = (deref(f.get('question')) or '').strip()
        a = (deref(f.get('answer')) or '').strip()
        if not q or not a:
            continue
        if re.fullmatch(r'\$[0-9a-f]+', a):
            raise SystemExit('[FAIL] 본문을 못 찾은 참조 답변: %s (%s)' % (f.get('id'), a))
        part = (f.get('labels') or ['?'])[0]
        items.append({
            'id': f.get('id'),
            'number': f.get('number'),
            'part': part,
            'partName': labels.get(part, {}).get('name', ''),
            'question': q,
            'answer': a,
            'keywords': [k for k in (f.get('keywords') or []) if not k.isdigit()],
        })
    items.sort(key=lambda x: (x['part'], x['number'] or 0))

    out = {
        'source': {
            'name': '든든첵 — 학교폭력 사안처리 Q&A',
            'url': DDEQNA_URL,
            'publisher': '대구광역시교육청 생활인성교육과',
            'collectedAt': TODAY,
            'note': '참고용 안내 자료. 실제 사안처리는 관련 법령 및 당해 연도 교육부·교육청 가이드북·공문을 확인해야 함.',
            'docLabel': '든든첵 학교폭력 사안처리 Q&A(대구광역시교육청)',
        },
        'parts': [{'id': l['id'], 'name': l['name'],
                   'description': l.get('description', ''), 'count': l.get('count')}
                  for l in sorted(data['labels'], key=lambda x: x.get('order', 0))],
        'items': items,
    }
    save('ddeqna_qa.json', out, 'Q&A %d건 / 파트 %d개' % (len(items), len(out['parts'])))


# ── 학폭법 시행령 ─────────────────────────────────────────
def fetch_decree():
    frame = get(DECREE_URL)
    m = re.search(r'lsInfoP\.do\?([^"]+)', frame)
    if not m:
        raise SystemExit('[FAIL] 법령 본문 프레임을 찾지 못했습니다.')
    params = html.unescape(m.group(1))
    body = get('https://www.law.go.kr/LSW/lsInfoR.do?' + params)

    flat = html.unescape(re.sub(r'<[^>]+>', ' ', body))
    ver = re.search(r'\[시행[^\]]*\]\s*\[(대통령령[^\]]*)\]', flat)
    eff = re.search(r'efYd=(\d{8})', params)

    seg = body[body.find('<div id="conScroll"'):]
    seg = re.sub(r'(?is)<script.*?</script>', '', seg)
    seg = re.sub(r'(?is)<style.*?</style>', '', seg)
    seg = re.sub(r'(?i)<br\s*/?>', '\n', seg)
    seg = re.sub(r'(?i)</(p|div|tr|li|h\d|td)>', '\n', seg)
    txt = html.unescape(re.sub(r'<[^>]+>', '', seg))
    txt = re.sub(r'[ \t\xa0​]+', ' ', txt)
    lines = [l.strip() for l in txt.split('\n') if l.strip()]

    start = next(i for i, l in enumerate(lines) if l.startswith('제1조('))
    end = len(lines)
    for i in range(start, len(lines)):
        # 부칙·별표부터는 본칙이 아니고, 링크·버튼 텍스트가 섞여 들어온다
        if '부 칙' in lines[i] or lines[i].startswith('[별표'):
            end = i
            break

    art_re = re.compile(r'^제(\d+)조(?:의(\d+))?\s*\(([^)]*)\)')
    arts, cur = [], None
    for line in lines[start:end]:
        mm = art_re.match(line)
        if mm:
            if cur:
                arts.append(cur)
            no = mm.group(1) + ('의' + mm.group(2) if mm.group(2) else '')
            cur = {'no': no, 'title': mm.group(3), 'lines': [line]}
        elif cur:
            cur['lines'].append(line)
    if cur:
        arts.append(cur)
    for a in arts:
        a['text'] = '\n'.join(a.pop('lines'))

    bad = [a['no'] for a in arts if re.search(r'href|src=|AJAX|</', a['text'])]
    if bad or len(arts) < 30:
        raise SystemExit('[FAIL] 조문 추출 이상 — 조문 %d개, 잡음 %s' % (len(arts), bad))

    eff_date = eff.group(1) if eff else ''
    out = {
        'source': {
            'name': DECREE_NAME,
            'lawType': '대통령령',
            'promulgation': ver.group(1).strip() if ver else '',
            'effectiveDate': ('%s-%s-%s' % (eff_date[:4], eff_date[4:6], eff_date[6:])) if eff_date else '',
            'url': DECREE_URL,
            'sourceUrl': 'https://www.law.go.kr/LSW/lsInfoR.do?' + params,
            'publisher': '법제처 국가법령정보센터',
            'collectedAt': TODAY,
            'scope': '본칙 전문(부칙·별표 제외)',
            'docLabel': DECREE_NAME,
        },
        'articles': arts,
    }
    save('hakpok_enforcement_decree.json', out,
         '조문 %d개 / %s' % (len(arts), out['source']['promulgation']))


def save(name, obj, note):
    os.makedirs(OUT_DIR, exist_ok=True)
    p = os.path.join(OUT_DIR, name)
    with io.open(p, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    print('[ok] %s — %s (%d bytes)' % (name, note, os.path.getsize(p)))


if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if what in ('all', 'ddeqna'):
        fetch_ddeqna()
    if what in ('all', 'decree'):
        fetch_decree()
    print('→ 이어서: build_law_extras.py → build_law_struct.py → build_embeddings.py')
