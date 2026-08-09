# -*- coding: utf-8 -*-
"""지식베이스 위키 카드 → wiki_search.json + wiki_struct.json

edtouch.ai 「수·평·기 AI」(dataset key: wiki)용 RAG 인덱스를 만든다.
입력은 Obsidian 볼트의 `30_Wiki/{Concepts,Entities,Guides,Maps}/*.md`.

사용:
  python scripts/build_wiki_index.py --vault "<볼트경로>" --out-dir "<edtouch01>/v2/public/edu"
                                     [--report] [--dry-run]

⚠️ 산출물은 **edtouch01에만** 둔다. law/curr/neis와 달리 이 데이터셋의 원본은 daeryun이
   아니라 지식베이스 볼트이고, daeryun.life에는 「수·평·기 AI」를 등록하지 않으므로
   output/web/data/에 두면 쓰지도 않는 사이트에서 공개 배포될 뿐이다.
   (스크립트만 다른 빌드 스크립트와 함께 여기 둔다)

게시 게이트(중요):
  프론트매터 `publish: true`인 카드만 나간다(옵트인). 생략 = 미게시.
  산출물은 인증 없이 내려받는 정적 파일이므로 3자 저작 파생 카드가 실리면 안 된다.
  판정 기준 전문: 지식베이스/.claude/skills/kb-ingest/references/card-schema.md §게시 정책

청킹:
  H2 절 단위 + 형제 블록 그리디 병합. breadcrumb 포함 **1,200자 하드 캡**.
  ask.js가 컨텍스트를 8개 × 1200자로 자르므로 캡을 지키면 무손실이 보장된다.
  (build_embeddings.py의 MAX_CHARS=2000도 자동으로 안 걸린다)

불변식(위반 시 exit 1):
  B 모든 청크 ≤ 1200자
  C struct의 모든 인용문이 해당 문서 청크의 부분문자열
  D 별칭 중복 없음
  E 미게시 카드 본문이 search.json에 부재
  F 게시 본문에 `본교|대륜고|우리 학교` 잔존 없음 (publicBody 재서술 누락 검출)
  G docs 원소 유일
  (A: bin 크기 == 청크수×768 은 build_wiki_emb.py가 검사)
"""
import argparse
import io
import json
import os
import re
import sys

CARD_DIRS = ['Concepts', 'Entities', 'Guides', 'Maps']
TYPE_BY_DIR = {'Concepts': 'concept', 'Entities': 'entity', 'Guides': 'guide', 'Maps': 'map'}

CHUNK_CAP = 1200          # ask.js slice(0,1200)와 동일 — 넘으면 LLM 입력이 잘린다
BODY_TARGET = 1050        # breadcrumb 여유를 둔 본문 목표치
MIN_CHARS = 30            # 너무 짧은 조각은 앞 블록에 붙거나 버린다

# 내부 기준 검출 — 두 단계로 나눈다.
#  STRICT: 학교 고유 명칭. 전국 규정으로 오독되면 실제 피해가 나므로 절 단위 확인을 강제한다.
#          해소는 publicBody(재서술) 또는 publicAllow(검토 결과 안전한 언급) 중 하나.
#  WEAK  : 일상 표현이라 오탐이 많다("우리 학교를 소개하는 다국어 콘텐츠 제작하기"는 과제 예시문).
#          차단하지 않고 경고만 남긴다.
INTERNAL_STRICT_RE = re.compile(r'본교|대륜고')
INTERNAL_WEAK_RE = re.compile(r'우리\s*학교|우리\s*부서')
SUMMARY_SECTIONS = ('정의', '개요', '목적')


# ── 프론트매터 파서 (PyYAML 없이, 볼트가 쓰는 형태만 지원) ────────────────────

def _unquote(s):
    s = (s or '').strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in '"\'':
        return s[1:-1]
    return s


def _parse_flow_list(s):
    """[a, b, "c, d"] → ['a','b','c, d']"""
    s = s.strip()
    if s.startswith('['):
        s = s[1:]
    if s.endswith(']'):
        s = s[:-1]
    out, cur, quote = [], '', None
    for ch in s:
        if quote:
            if ch == quote:
                quote = None
            else:
                cur += ch
            continue
        if ch in '"\'':
            quote = ch
            continue
        if ch == ',':
            v = cur.strip()
            if v:
                out.append(v)
            cur = ''
            continue
        cur += ch
    v = cur.strip()
    if v:
        out.append(v)
    return out


def parse_frontmatter(raw):
    """(meta dict, body str) 반환. 프론트매터가 없으면 ({}, raw)."""
    lines = raw.split('\n')
    if not lines or lines[0].strip() != '---':
        return {}, raw
    end = -1
    for i in range(1, len(lines)):
        if lines[i].strip() == '---':
            end = i
            break
    if end < 0:
        return {}, raw
    block, body = lines[1:end], '\n'.join(lines[end + 1:])

    meta = {}
    i = 0
    while i < len(block):
        line = block[i]
        if not line.strip() or line.lstrip().startswith('#') or line[:1] in (' ', '\t'):
            i += 1
            continue
        m = re.match(r'^([A-Za-z_][\w-]*)\s*:\s*(.*)$', line)
        if not m:
            i += 1
            continue
        key, val = m.group(1), m.group(2).rstrip()
        if val == '':
            # 들여쓴 하위 맵(publicBody) 수집
            sub, j = {}, i + 1
            while j < len(block) and (block[j][:1] in (' ', '\t') or not block[j].strip()):
                sm = re.match(r'^\s+(.+?)\s*:\s*(.*)$', block[j])
                if sm:
                    sub[_unquote(sm.group(1))] = _unquote(sm.group(2))
                j += 1
            meta[key] = sub if sub else ''
            i = j
            continue
        if val.startswith('['):
            buf = val
            while buf.count('[') > buf.count(']') and i + 1 < len(block):
                i += 1
                buf += ' ' + block[i].strip()
            meta[key] = _parse_flow_list(buf)
        else:
            meta[key] = _unquote(val)
        i += 1
    return meta, body


def is_true(v):
    return str(v).strip().lower() in ('true', 'yes', '1')


def as_list(v):
    if isinstance(v, list):
        return [x for x in (s.strip() for s in v) if x]
    v = (v or '').strip()
    return [v] if v else []


# ── 본문 정리 ────────────────────────────────────────────────────────────────

WIKILINK_ALIAS_RE = re.compile(r'\[\[([^\]|]+)\|([^\]]+)\]\]')
WIKILINK_RE = re.compile(r'\[\[([^\]]+)\]\]')


def strip_wikilinks(s):
    s = WIKILINK_ALIAS_RE.sub(r'\2', s)
    return WIKILINK_RE.sub(r'\1', s)


def split_sections(body):
    """H1 제거 후 H2 단위로 [(제목, 본문)] 반환. H2 앞 서두는 ('', 서두)."""
    body = re.sub(r'(?m)^#\s+.*$', '', body, count=1)
    parts = re.split(r'(?m)^##\s+(.+?)\s*$', body)
    out = []
    lead = parts[0].strip()
    if lead:
        out.append(('', lead))
    for i in range(1, len(parts), 2):
        name = parts[i].strip()
        text = (parts[i + 1] if i + 1 < len(parts) else '').strip()
        out.append((name, text))
    return out


def split_blocks(text):
    """빈 줄 기준 블록 분할. 표는 빈 줄이 없으므로 자연히 한 덩어리로 남는다."""
    return [b.strip() for b in re.split(r'\n\s*\n', text) if b.strip()]


def split_long_block(block, limit):
    """limit 초과 블록을 쪼갠다. 표는 헤더 2행을 반복하며 행 단위로."""
    if len(block) <= limit:
        return [block]
    lines = block.split('\n')
    is_table = sum(1 for l in lines if l.strip().startswith('|')) >= max(2, len(lines) // 2)
    out = []
    if is_table and len(lines) >= 3:
        header = lines[:2]
        head_len = sum(len(l) + 1 for l in header)
        cur = list(header)
        cur_len = head_len
        for l in lines[2:]:
            if cur_len + len(l) + 1 > limit and len(cur) > len(header):
                out.append('\n'.join(cur))
                cur, cur_len = list(header), head_len
            cur.append(l)
            cur_len += len(l) + 1
        if len(cur) > len(header):
            out.append('\n'.join(cur))
        return out or [block[:limit]]
    # 일반 블록: 줄 → 문장 순으로 그리디 분할
    units = []
    for l in lines:
        if len(l) <= limit:
            units.append(l)
        else:
            units.extend(re.findall(r'[^.!?。]{1,%d}[.!?。]?' % limit, l) or [l[:limit]])
    cur, cur_len = [], 0
    for u in units:
        if cur and cur_len + len(u) + 1 > limit:
            out.append('\n'.join(cur))
            cur, cur_len = [], 0
        cur.append(u)
        cur_len += len(u) + 1
    if cur:
        out.append('\n'.join(cur))
    return out


def merge_blocks(blocks, limit):
    """형제 블록을 limit까지 그리디 병합 — 같은 슬롯에 더 많은 근거를 싣는다."""
    out, cur, cur_len = [], [], 0
    for b in blocks:
        for piece in split_long_block(b, limit):
            if cur and cur_len + len(piece) + 2 > limit:
                out.append('\n\n'.join(cur))
                cur, cur_len = [], 0
            cur.append(piece)
            cur_len += len(piece) + 2
    if cur:
        out.append('\n\n'.join(cur))
    return out


def build_ref(section, ctype, confidence, status):
    ref = section or '개요'
    ref += ' · ' + ctype
    if str(status).strip() == 'needs-review':
        ref += ' · ⚠검토중'
    if str(confidence).strip() == 'low':
        ref += ' · ⚠미검증'
    return ref[:78]


# ── MOC 파싱 ─────────────────────────────────────────────────────────────────

ITEM_RE = re.compile(r'^-\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]\s*[—\-–]\s*(.+)$')
GOVERN_RE = re.compile(r'상위\s*규범|이 카드가 이긴다|판단 기준|총론')


def parse_moc(title, secs):
    """MOC 절 목록 → {intro, order, sections[], boundary[], relations[]}

    ⚠️ 반드시 **publicBody 치환을 마친** 절을 넘길 것. 원본 절을 넘기면 게시본에서
    삭제한 절(운영 메모 등)의 문장이 struct에 남아 불변식 C가 깨진다.
    """
    intro = ''
    order = ''
    sections, boundary, relations = [], [], []
    for name, text in secs:
        if name == '':
            intro = strip_wikilinks(re.sub(r'\s+', ' ', text)).strip()[:900]
            for sent in re.split(r'(?<=[.!?。])\s+', text):
                if '순서' in sent:
                    order = strip_wikilinks(re.sub(r'\s+', ' ', sent)).strip()[:400]
                    break
            continue
        items = []
        for line in text.split('\n'):
            m = ITEM_RE.match(line.strip())
            if m:
                items.append({
                    'card': m.group(1).strip(),
                    'note': strip_wikilinks(re.sub(r'\s+', ' ', m.group(2))).strip()[:400],
                })
        if not items:
            continue
        if '경계' in name:
            boundary.extend(items)
        elif '다른 맵' in name or '관계' in name:
            relations.extend([{'map': it['card'], 'note': it['note']} for it in items])
        else:
            sections.append({'name': name, 'items': items})
    return {'title': title, 'intro': intro, 'order': order,
            'sections': sections, 'boundary': boundary, 'relations': relations}


# ── 메인 빌드 ────────────────────────────────────────────────────────────────

def load_cards(vault):
    root = os.path.join(vault, '30_Wiki')
    cards = []
    for d in CARD_DIRS:
        folder = os.path.join(root, d)
        if not os.path.isdir(folder):
            continue
        for fn in sorted(os.listdir(folder)):
            if not fn.endswith('.md'):
                continue
            path = os.path.join(folder, fn)
            with io.open(path, encoding='utf-8') as f:
                raw = f.read()
            meta, body = parse_frontmatter(raw)
            title = _unquote(meta.get('title') or os.path.splitext(fn)[0])
            cards.append({
                'file': fn, 'dir': d, 'path': path, 'raw_body': body,
                'meta': meta, 'title': title,
                'type': _unquote(meta.get('type') or TYPE_BY_DIR[d]),
                'published': is_true(meta.get('publish')),
                'status': _unquote(meta.get('status') or 'active'),
                'confidence': _unquote(meta.get('confidence') or ''),
                'tags': as_list(meta.get('tags')),
                'aliases': as_list(meta.get('aliases')),
                'source': as_list(meta.get('source')),
                'public_body': meta.get('publicBody') if isinstance(meta.get('publicBody'), dict) else {},
                'public_replace': meta.get('publicReplace') if isinstance(meta.get('publicReplace'), dict) else {},
            })
    return cards


def apply_public_body(sections, overrides):
    """게시용 절 치환 — 원본 카드는 건드리지 않는다."""
    if not overrides:
        return sections, []
    used = []
    out = []
    for name, text in sections:
        if name in overrides:
            out.append((name, overrides[name]))
            used.append(name)
        else:
            out.append((name, text))
    return out, used


def build(vault, out_dir, report=False, dry_run=False, simulate=None):
    cards = load_cards(vault)
    if simulate is not None:
        # 프론트매터에 publish를 쓰기 전에 후보 집합을 시험한다 (항상 dry-run).
        missing = simulate - {c['title'] for c in cards}
        if missing:
            print('[warn] 시뮬레이션 목록에 없는 카드 %d장: %s' % (len(missing), ', '.join(sorted(missing)[:5])))
        for c in cards:
            c['published'] = c['title'] in simulate
    published = [c for c in cards if c['published'] and c['status'] != 'outdated']
    skipped_outdated = [c for c in cards if c['published'] and c['status'] == 'outdated']

    pub_titles = {c['title'] for c in published}
    docs, chunks = [], []
    struct_cards, struct_maps = [], []
    warn_internal, warn_unused_override, warn_dup_alias = [], [], []

    for c in published:
        di = len(docs)
        docs.append(c['title'])
        # 게시용 치환 2단: ① 문장 단위(publicReplace) ② 절 단위(publicBody)
        # 긴 절 안의 문장 하나만 일반화하면 되는 경우가 대부분이라 ①이 주력이고,
        # ②는 절을 통째로 들어내거나(빈 값) 다시 쓸 때만 쓴다.
        body = c['raw_body']
        for find, repl in c['public_replace'].items():
            if find not in body:
                warn_unused_override.append((c['title'], 'publicReplace: ' + find[:40]))
                continue
            body = body.replace(find, repl)
        sections = split_sections(body)
        sections, used = apply_public_body(sections, c['public_body'])
        for k in c['public_body']:
            if k not in used:
                warn_unused_override.append((c['title'], 'publicBody: ' + k))

        # head 청크 — 별칭·태그·신뢰도를 한 곳에 모아 표현 변형 질의를 받아낸다
        head_bits = ['『%s』(%s)' % (c['title'], c['type'])]
        if c['tags']:
            head_bits.append('태그: ' + ', '.join(c['tags']))
        if c['confidence']:
            head_bits.append('신뢰도: ' + c['confidence'])
        head = ' | '.join(head_bits)
        if c['aliases']:
            head += '\n다른 이름: ' + ', '.join(c['aliases'])
        summary = ''
        for name, text in sections:
            if name in SUMMARY_SECTIONS or (not summary and name == ''):
                blocks = split_blocks(strip_wikilinks(text))
                if blocks:
                    summary = blocks[0]
                if name in SUMMARY_SECTIONS:
                    break
        if summary:
            head += '\n\n' + summary
        head = head[:CHUNK_CAP]
        chunks.append([di, build_ref('카드 정보', c['type'], c['confidence'], c['status']), head])

        section_names = []
        for name, text in sections:
            if not text.strip():
                continue
            if name:
                section_names.append(name)
            crumb = '『%s』 › %s' % (c['title'], name or '서두')
            limit = CHUNK_CAP - len(crumb) - 1
            if limit < 200:
                crumb = '『%s』' % c['title']
                limit = CHUNK_CAP - len(crumb) - 1
            clean = strip_wikilinks(text)
            for piece in merge_blocks(split_blocks(clean), min(BODY_TARGET, limit)):
                if len(piece) < MIN_CHARS:
                    continue
                chunks.append([di, build_ref(name, c['type'], c['confidence'], c['status']),
                               crumb + '\n' + piece])

        struct_cards.append({
            'title': c['title'], 'type': c['type'], 'doc': di,
            'tags': c['tags'], 'confidence': c['confidence'], 'status': c['status'],
            'aliases': c['aliases'],
            'summary': summary[:600],
            'sections': section_names,
        })

        if c['type'] == 'map':
            m = parse_moc(c['title'], sections)   # 치환 후 절 — 원본 body가 아니다
            m['doc'] = di
            m['aliases'] = c['aliases']
            struct_maps.append(m)

    # cardIndex — 맵이 부여한 우선순위·경계 판정을 카드에서 역참조
    card_index = {}
    for m in struct_maps:
        for sec in m['sections']:
            for it in sec['items']:
                e = card_index.setdefault(it['card'], {'maps': [], 'governs': False, 'boundaryNote': ''})
                if m['title'] not in e['maps']:
                    e['maps'].append(m['title'])
                if GOVERN_RE.search(it['note']):
                    e['governs'] = True
        for it in m['boundary']:
            e = card_index.setdefault(it['card'], {'maps': [], 'governs': False, 'boundaryNote': ''})
            if not e['boundaryNote']:
                e['boundaryNote'] = it['note']

    # 미게시 카드 안내 — 이름 + MOC 항목 설명(사용자 자작)만. 본문은 절대 싣지 않는다.
    unpublished = {}
    for m in struct_maps:
        for sec in m['sections']:
            for it in sec['items']:
                if it['card'] not in pub_titles and it['card'] not in unpublished:
                    unpublished[it['card']] = it['note']
    for m in struct_maps:
        for sec in m['sections']:
            for it in sec['items']:
                it['published'] = it['card'] in pub_titles

    struct = {
        'version': 1,
        'builtAt': '',
        'cardCount': len(published),
        'chunkCount': len(chunks),
        'cards': struct_cards,
        'maps': struct_maps,
        'cardIndex': card_index,
        'unpublished': unpublished,
    }

    # ── 불변식 검사 ──────────────────────────────────────────────────────────
    fails = []

    over = [c for c in chunks if len(c[2]) > CHUNK_CAP]
    if over:
        fails.append('B 청크 %d개가 %d자 초과 (최대 %d자)' % (len(over), CHUNK_CAP, max(len(c[2]) for c in over)))

    # C: 공백만 정규화해 비교 — struct는 한 줄로 접어 담고 청크는 줄바꿈을 보존하므로
    #    문자 그대로 비교하면 정상 인용도 불일치로 잡힌다. 내용 위조는 여전히 검출된다.
    def norm(s):
        return re.sub(r'\s+', ' ', s or '').strip()

    by_doc = {}
    for di, _ref, text in chunks:
        by_doc.setdefault(di, []).append(text)
    joined = {di: norm('\n'.join(v)) for di, v in by_doc.items()}

    bad_quotes = []
    for sc in struct_cards:
        if sc['summary'] and norm(sc['summary']) not in joined.get(sc['doc'], ''):
            bad_quotes.append('card summary: ' + sc['title'])
    for m in struct_maps:
        blob = joined.get(m['doc'], '')
        for field in ('intro', 'order'):
            if m[field] and norm(m[field]) not in blob:
                bad_quotes.append('map %s: %s' % (field, m['title']))
        for sec in m['sections']:
            for it in sec['items']:
                if norm(it['note']) not in blob:
                    bad_quotes.append('map note: %s / %s' % (m['title'], it['card']))
        for it in m['boundary']:
            if norm(it['note']) not in blob:
                bad_quotes.append('map boundary: %s / %s' % (m['title'], it['card']))
    if bad_quotes:
        fails.append('C struct 인용문 %d건이 청크 원문과 불일치 (예: %s)' % (len(bad_quotes), bad_quotes[0]))

    # D: 같은 별칭이 두 카드를 가리키면 최장일치가 임의로 갈린다 → 그 별칭을 양쪽에서
    #    제거하고 경고만 남긴다(카드 제목으로는 여전히 매칭된다). 차단 사유는 아니다.
    alias_owner, dup_alias = {}, []
    for sc in struct_cards:
        for a in sc['aliases'] + [sc['title']]:
            key = re.sub(r'\s+', '', a)
            if key in alias_owner and alias_owner[key] != sc['title']:
                dup_alias.append((a, alias_owner[key], sc['title']))
            alias_owner.setdefault(key, sc['title'])
    if dup_alias:
        drop = {re.sub(r'\s+', '', a) for a, _x, _y in dup_alias}
        for sc in struct_cards:
            sc['aliases'] = [a for a in sc['aliases'] if re.sub(r'\s+', '', a) not in drop]
        warn_dup_alias.extend(dup_alias)

    unpub_titles = {c['title'] for c in cards if not c['published']}
    leaked = [t for t in unpub_titles if t in docs]
    if leaked:
        fails.append('E 미게시 카드가 docs에 유출: ' + ', '.join(leaked[:3]))

    allow_by_card = {c['title']: set(as_list(c['meta'].get('publicAllow')))
                     | set(c['public_body'].keys()) for c in published}
    strict_hits = set()
    for di, ref, text in chunks:
        title = docs[di]
        sec = ref.split(' · ')[0]
        for rx, strict in ((INTERNAL_STRICT_RE, True), (INTERNAL_WEAK_RE, False)):
            for m in rx.finditer(text):
                s, e = max(0, m.start() - 25), min(len(text), m.end() + 45)
                ctx = ('…' + text[s:e] + '…').replace('\n', ' ')
                if strict and sec not in allow_by_card.get(title, set()):
                    strict_hits.add((title, sec))
                    warn_internal.append(('FAIL', title, sec, m.group(0), ctx))
                elif not strict:
                    warn_internal.append(('warn', title, sec, m.group(0), ctx))
    if strict_hits:
        fails.append('F 게시 본문에 학교 고유 명칭 — 카드×절 %d곳 미확인 '
                     '(publicBody 재서술 또는 publicAllow 등재 필요)' % len(strict_hits))

    if len(set(docs)) != len(docs):
        fails.append('G docs 중복 — 카드 제목이 유일하지 않음')

    # ── 리포트 ───────────────────────────────────────────────────────────────
    if report or fails or dry_run:
        print('── 게시 게이트 ──')
        print('  전체 %d장 · 게시 %d장 · 미게시 %d장' % (len(cards), len(published), len(cards) - len(published)))
        if skipped_outdated:
            print('  outdated 제외: ' + ', '.join(c['title'] for c in skipped_outdated))
        print('── MOC 커버리지 ──')
        for m in struct_maps:
            items = [it for sec in m['sections'] for it in sec['items']]
            got = sum(1 for it in items if it['published'])
            print('  %-28s %d/%d 게시' % (m['title'], got, len(items)))
        if unpublished:
            print('  미게시 참조 카드 %d장 (이름+한 줄만 노출)' % len(unpublished))
        print('── 청크 ──')
        if chunks:
            lens = sorted(len(c[2]) for c in chunks)
            print('  %d개 · 중앙값 %d자 · 최대 %d자' % (len(chunks), lens[len(lens) // 2], lens[-1]))
        if warn_internal:
            print('── 내부 기준 표현 ──')
            seen_sec = set()
            for level, t, sec, term, ctx in warn_internal:
                if (level, t, sec) in seen_sec:
                    continue
                seen_sec.add((level, t, sec))
                mark = '⛔' if level == 'FAIL' else '·'
                print('  %s [%s] %s › %s' % (mark, term, t, sec))
                print('       %s' % ctx[:150])
        if warn_dup_alias:
            print('── ⚠ 별칭 중복 (양쪽에서 제거됨 — 카드 제목으로는 매칭) ──')
            for a, x, y in warn_dup_alias:
                print('  %s ← %s / %s' % (a, x, y))
        if warn_unused_override:
            print('── ⚠ 매칭 안 된 publicBody 키 ──')
            for t, k in warn_unused_override:
                print('  %s: %s' % (t, k))

    if fails:
        print('\n[FAIL] 불변식 위반')
        for f in fails:
            print('  · ' + f)
        return 1

    if dry_run:
        print('\n[dry-run] 파일을 쓰지 않았습니다.')
        return 0
    if not published:
        print('\n[FAIL] 게시 카드가 0장입니다 — 프론트매터에 publish: true를 부여하세요.')
        return 1

    os.makedirs(out_dir, exist_ok=True)
    sp = os.path.join(out_dir, 'wiki_search.json')
    tp = os.path.join(out_dir, 'wiki_struct.json')
    with io.open(sp, 'w', encoding='utf-8') as f:
        json.dump({'docs': docs, 'chunks': chunks}, f, ensure_ascii=False, separators=(',', ':'))
    with io.open(tp, 'w', encoding='utf-8') as f:
        json.dump(struct, f, ensure_ascii=False, separators=(',', ':'))
    print('\nOUT %s: %d docs, %d chunks, %s bytes'
          % (sp, len(docs), len(chunks), format(os.path.getsize(sp), ',')))
    print('OUT %s: 카드 %d · 맵 %d · 미게시참조 %d · %s bytes'
          % (tp, len(struct_cards), len(struct_maps), len(unpublished), format(os.path.getsize(tp), ',')))
    print('다음: python scripts/build_wiki_emb.py "%s" "%s"' % (sp, os.path.join(out_dir, 'wiki_emb.bin')))
    return 0


def main():
    ap = argparse.ArgumentParser(description='지식베이스 위키 → wiki_search.json + wiki_struct.json')
    ap.add_argument('--vault', required=True, help='지식베이스 볼트 루트 경로')
    ap.add_argument('--out-dir', required=True,
                    help='산출 폴더 — edtouch01/v2/public/edu 를 지정한다(위 주의 참조)')
    ap.add_argument('--report', action='store_true', help='게시·MOC 커버리지·청크 분포 리포트 출력')
    ap.add_argument('--dry-run', action='store_true', help='검사만 하고 파일을 쓰지 않음')
    ap.add_argument('--simulate', metavar='LIST',
                    help='게시 후보 카드명 목록 파일(한 줄 1개, # 주석 허용). '
                         '프론트매터 publish를 무시하고 이 집합으로 시험한다 — 항상 dry-run.')
    a = ap.parse_args()
    if not os.path.isdir(os.path.join(a.vault, '30_Wiki')):
        print('오류: 30_Wiki 폴더를 찾을 수 없습니다 —', a.vault)
        return 1
    sim = None
    if a.simulate:
        with io.open(a.simulate, encoding='utf-8') as f:
            sim = {l.strip() for l in f
                   if l.strip() and not l.strip().startswith('#')}
        print('[simulate] 게시 후보 %d장 — 파일은 쓰지 않습니다.' % len(sim))
    return build(a.vault, a.out_dir, report=a.report,
                 dry_run=a.dry_run or sim is not None, simulate=sim)


if __name__ == '__main__':
    sys.exit(main())
