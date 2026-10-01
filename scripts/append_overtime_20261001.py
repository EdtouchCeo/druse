"""Append the four source documents without changing any existing law chunks.

Run from any directory. Default input: input/teacher/법령지침.
Optional --input and --index support an isolated validation directory.
"""
import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path
from lxml import etree
from extract_folder import extract_pdf, normalize
from build_index import chunk_doc, short_label
import build_index
from build_law_extras import merge_extras

BASE = Path(__file__).resolve().parents[1]

def local(el):
    return etree.QName(el).localname

def render(el):
    tag = local(el)
    if tag == 't':
        # HWPX puts actual text after fwSpace/lineBreak in child tails.
        out = el.text or ''
        for child in el:
            out += ('\n' if local(child) == 'lineBreak' else ' ') + (child.tail or '')
        return out
    if tag == 'tbl':
        return '\n' + '\n'.join(render(row) for row in el if local(row) == 'tr') + '\n'
    if tag == 'tr':
        return ' | '.join(render(cell).strip().replace('\n', ' / ') for cell in el if local(cell) == 'tc')
    if tag == 'p':
        return ''.join(render(child) for child in el) + '\n'
    return ''.join(render(child) for child in el)

def extract_hwpx(path):
    out = []
    with zipfile.ZipFile(path) as z:
        names = sorted((n for n in z.namelist() if re.fullmatch(r'Contents/section\d+\.xml', n)),
                       key=lambda n: int(re.search(r'\d+', n).group()))
        for name in names:
            root = etree.fromstring(z.read(name))
            text = normalize(render(root))
            # Every literal text fragment must survive; only whitespace and table separators added.
            compact = re.sub(r'\s+', '', text)
            for node in root.iter():
                if local(node) == 't':
                    for frag in node.itertext():
                        assert re.sub(r'\s+', '', normalize(frag)) in compact, (path, frag)
            out.append('\n'.join(line.rstrip() for line in text.splitlines() if line.strip()))
    return '\n\n'.join(out)

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input', type=Path, default=BASE/'input/teacher/법령지침')
    ap.add_argument('--index', type=Path, default=BASE/'output/web/data/law_search.json')
    args = ap.parse_args()
    files = sorted(p for p in args.input.iterdir() if '대륜고등학교-11014' in p.name and p.suffix.lower() in ('.pdf', '.hwpx'))
    assert len(files) == 4, len(files)
    data = json.loads(args.index.read_text(encoding='utf-8'))
    old = json.loads(args.index.read_text(encoding='utf-8'))
    sources, extras, raw = [], [], []
    for i, path in enumerate(files):
        body = normalize(extract_pdf(path) if path.suffix.lower() == '.pdf' else extract_hwpx(path)).strip()
        assert len(body) > 500, path
        label = short_label(path.name)
        if i == 0:
            context = '중등교육과-18574(2026.9.30.) · 대륜고등학교-11014(2026.10.1.) · 제도개선 예정 안내'
        elif i == 1:
            context = '2026.9.30. 안내 붙임1 · 현 제도와 개선안 비교 · 교원 확인시스템 도입시기 추후 안내'
        elif i == 2:
            context = '2026.9.30. 안내 붙임2 · 나이스 기능 적용일 2026.9.1.'
        else:
            context = '2026.9.30. 안내 붙임3 · 인사혁신처예규 제220호(2026.7.31.) 발췌 · 개선안 이전 지침'
        # The default 40-character cutoff would drop the final effective-date note.
        build_index.MIN_CHARS = 1
        indexed_body = body.split('[p.2]')[0].strip() if i == 0 else body
        parts = chunk_doc(indexed_body)
        if len(parts) > 1 and len(parts[-1][1]) < 40:
            ref, tail = parts.pop()
            parts[-1] = (parts[-1][0], parts[-1][1]+'\n'+tail)
        chs = [(context + (' · '+ref if ref else ''), text) for ref,text in parts]
        # The chunker must not silently discard a short final paragraph.
        compact = re.sub(r'\s+|\[p\.\d+\]', '', indexed_body)
        joined = re.sub(r'\s+', '', ''.join(text for _, text in chs))
        assert compact == joined, path
        if i == 2:
            image_source = BASE/'data/sources/overtime_neis_image_transcription.json'
            if not image_source.exists():
                raise RuntimeError('Reviewed image transcription is required: '+str(image_source))
            image_data = json.loads(image_source.read_text(encoding='utf-8'))
            chs += [(context+' · '+s['ref'], s['text']) for s in image_data['sections']]
        extras.append((label,chs))
        sources.append({'file':path.name, 'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                        'docLabel':label, 'context':context, 'chars':len(body),
                        'excludedFromIndex':'PDF p.2 결재·배포·공개 연락처. 시행·접수번호와 날짜는 ref에 보존.' if i == 0 else '',
                        'sections':[{'ref':ref,'text':text} for ref,text in chs]})
        raw.append('# 📄 '+path.name+'\n\n'+body)
    result = merge_extras(data, extras)
    assert result['docs'][:len(old['docs'])] == old['docs']
    assert result['chunks'][:len(old['chunks'])] == old['chunks'], 'Existing chunks changed: full rebuild required'
    args.index.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    (BASE/'data').mkdir(exist_ok=True)
    (BASE/'data/sources').mkdir(exist_ok=True)
    (BASE/'data/overtime_20261001_raw.md').write_text('\n'.join(line.rstrip() for line in '\n\n'.join(raw).splitlines())+'\n',encoding='utf-8')
    (BASE/'data/sources/overtime_20261001.json').write_text(json.dumps({'documents':sources},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'docs':len(result['docs']),'chunks':len(result['chunks']),
                      'sources':[{'file':s['file'],'chars':s['chars'],'chunks':len(s['sections'])} for s in sources]},ensure_ascii=False,indent=2))

if __name__ == '__main__':
    main()
