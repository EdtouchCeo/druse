"""원본 PDF의 표 셀 좌표로 초·중 공유표 내용요소를 학교급별로 분리한다.

원본 문장 부분문자열 검증을 통과한 셀만 사용한다. school/grade/subject 헤더가
지정한 열에 완전히 포함된 셀 또는 해당 열을 완전히 덮는 공통 셀만 채택한다.
"""
import json
import re
from pathlib import Path
import fitz


def norm(text):
    return re.sub(r'\s+', '', text or '')


def apply_pdf_tables(data, result, pdf_root, parser):
    root = Path(pdf_root)
    pdfs = {parser_name(p.stem): p for p in root.glob('*.pdf')}
    report = {"subjects": [], "rejected": []}
    opened = {}
    for subj in result['subjects']:
        if subj['school'] not in ('초등학교', '중학교'):
            continue
        label = data['docs'][subj['doc']]
        path = pdfs.get(parser_name(label))
        if not path:
            raise ValueError(f'원본 PDF 없음: {label}')
        doc = opened.setdefault(str(path), fitz.open(path))
        source = '\n'.join(c[2] for c in data['chunks'] if c[0] == subj['doc'])
        source_ns = norm(parser.strip_footers(source))
        area_by_name = {norm(a['name']): a for a in subj['areas']}
        elements = {}
        cores = {}
        proofs = []
        current_area = None
        current_cat = None
        bounds = None
        content_started = False
        mixed = False
        subject_columns = subj['subject'] in ('바른 생활', '슬기로운 생활', '즐거운 생활')
        for pi in range(max(0, subj['pageStart'] - 2), min(len(doc), subj['pageEnd'])):
            page = doc[pi]
            text = page.get_text()
            if not content_started:
                if not re.search(r'가\.\s*내용\s*체계', text):
                    continue
                content_started = True
            # 표제/영역은 실제 y좌표로 정렬한다. PDF 내부 텍스트 저장순서는 사용하지 않는다.
            lines = []
            for block in page.get_text('dict')['blocks']:
                for line in block.get('lines', []):
                    value = ''.join(span['text'] for span in line['spans']).strip()
                    lines.append((line['bbox'][1], value))
            headings = [(y, re.sub(r'^\(\d+\)\s*', '', t)) for y, t in lines
                        if re.match(r'^\(\d+\)', t)]
            stop_y = min([y for y, t in lines if re.fullmatch(r'나\.\s*성취기준', t)] or [float('inf')])
            for table in page.find_tables().tables:
                if table.bbox[1] >= stop_y:
                    continue
                above = [(y, name) for y, name in headings if y < table.bbox[1]]
                if above:
                    name = max(above)[1]
                    current_area = norm(name)
                    current_cat = None
                    bounds = None
                if not current_area:
                    current_area = norm(subj['subject'])
                flat = []
                for row in table.rows:
                    for rect in row.cells:
                        if rect is None:
                            continue
                        value = page.get_text('text', clip=rect, sort=False).strip()
                        flat.append((rect, value, norm(value)))
                selected = []
                for rect, value, compact in flat:
                    if compact == norm(subj['school']):
                        selected.append((rect[0], rect[2]))
                    elif subj['school'] == '초등학교' and re.fullmatch(r'[135][-~∼][246]학년군?', compact):
                        selected.append((rect[0], rect[2]))
                    elif subject_columns and compact == norm(subj['subject']):
                        selected.append((rect[0], rect[2]))
                if selected:
                    bounds = (min(v[0] for v in selected), max(v[1] for v in selected))
                    mixed = True
                elif bounds and not subject_columns:
                    # 이어지는 표의 열 폭은 다음 쪽에서 달라질 수 있다. 이전 x값을
                    # 그대로 쓰지 않고 그 쪽의 실제 오른쪽 학교급 셀 경계를 사용한다.
                    value_rects = [r for r, value, _ in flat if re.search(r'[⋅•]', value)]
                    right_cells = [r for r in value_rects if abs(r[2] - table.bbox[2]) < 1]
                    if value_rects and right_cells:
                        split_x = max(r[0] for r in right_cells)
                        left_x = min(r[0] for r in value_rects)
                        if split_x > left_x + 5:
                            bounds = ((split_x, table.bbox[2]) if subj['school'] == '중학교'
                                      else (left_x, split_x))
                # 내용요소 범주 행의 y구간을 읽는다. 세로 병합 셀은 해당 구간 전체에 적용된다.
                categories = []
                for rect, value, compact in flat:
                    canonical = re.sub(r'[⋅·ㆍ\[\]]', '', compact)
                    if canonical in ('지식이해', '과정기능', '가치태도'):
                        cat = {'지식이해': '지식·이해', '과정기능': '과정·기능', '가치태도': '가치·태도'}[canonical]
                        categories.append((rect, cat))
                domain_cells = [(r, v) for r, _, v in flat if v in area_by_name]
                core_columns = [r for r, _, v in flat if v == '핵심아이디어'] if subject_columns else []
                values = []
                for rect, value, compact in flat:
                    cuts = {rect[1], rect[3]}
                    if re.search(r'[⋅•]', value) and not subject_columns:
                        # 점선 행이 합쳐진 경우 왼쪽 하위범주(상호작용/점검조정 등)의
                        # 행 경계로 나눈다. 공유행의 문장 끝만 옆 열로 잘리는 것을 막는다.
                        for other, _, _ in flat:
                            if other[2] <= rect[0] + 1:
                                cuts.update(y for y in (other[1], other[3]) if rect[1] < y < rect[3])
                    ys = sorted(cuts)
                    for y0, y1 in zip(ys, ys[1:]):
                        piece = (rect[0], y0, rect[2], y1)
                        text_piece = page.get_text('text', clip=piece, sort=False).strip()
                        values.append((piece, text_piece, norm(text_piece)))
                for rect, value, compact in values:
                    if not value or not re.search(r'[⋅•]', value):
                        continue
                    cat_matches = [(r, cat) for r, cat in categories
                                   if rect[0] >= r[2] - 1 and rect[1] >= r[1] - 1 and rect[1] < r[3] - 1]
                    cat = cat_matches[-1][1] if cat_matches else None
                    if not cat and current_cat and not any(r[1] <= rect[1] for r, _ in categories):
                        cat = current_cat
                    area_key = current_area
                    if subject_columns:
                        domains = [(r, v) for r, v in domain_cells if r[1] <= rect[1] + 1 < r[3]]
                        if domains:
                            area_key = domains[-1][1]
                    # 같은 쪽의 핵심아이디어 병합 셀은 초·중 전체에 공통이다.
                    core_row = any('핵심아이디어' == v and rect[0] >= r[2] - 1
                                   and rect[1] >= r[1] - 1 and rect[1] < r[3] - 1
                                   for r, _, v in flat)
                    if subject_columns and any(abs(rect[0] - r[0]) < 1 and abs(rect[2] - r[2]) < 1
                                               and rect[1] >= r[3] - 1 for r in core_columns):
                        core_row = True
                    if not core_row and not cat:
                        # 다음 쪽으로 이어진 가치·태도 등은 그 쪽에 라벨이 있을 때만 채택.
                        continue
                    if cat and not core_row:
                        if bounds is None:
                            continue
                        # selected 학교급 칼럼 안의 셀 또는 그 학교급 열을 덮는 공통 셀.
                        overlap = min(rect[2], bounds[1]) - max(rect[0], bounds[0])
                        if overlap <= 1:
                            continue
                        # 점선 경계가 검출되지 않아 셀이 합쳐졌으면 불릿의 시작 x를
                        # 확인한다. 양쪽 학교급 열에 각각 불릿이 있으면 실제 열로 자른다.
                        bullet_x = [w[0] for w in page.get_text('words', clip=rect)
                                    if w[4].startswith(('⋅', '•'))]
                        inside = any(bounds[0] - 1 <= x < bounds[1] for x in bullet_x)
                        outside = any(x < bounds[0] - 1 or x >= bounds[1] for x in bullet_x)
                        if inside and outside:
                            rect = (max(rect[0], bounds[0]), rect[1], min(rect[2], bounds[1]), rect[3])
                            value = page.get_text('text', clip=rect, sort=False).strip()
                    bullets = parser.collect_bullets(value)
                    valid = []
                    for bullet in bullets:
                        if norm(bullet) in source_ns:
                            valid.append(bullet)
                        else:
                            report['rejected'].append({'subject': subj['subject'], 'school': subj['school'],
                                                       'page': pi + 1, 'text': bullet})
                    if not valid:
                        continue
                    target = cores.setdefault(area_key, []) if core_row else elements.setdefault(area_key, {}).setdefault(cat, [])
                    target.extend(valid)
                    proofs.append({'page': pi + 1, 'area': area_key, 'category': 'coreIdeas' if core_row else cat,
                                   'bbox': [round(x, 2) for x in rect], 'count': len(valid)})
                if categories:
                    current_cat = max(categories, key=lambda x: x[0][1])[1]
            if stop_y != float('inf'):
                break
        if not mixed:
            continue
        # 학교급 열을 확인한 표에서는 기존 선형 추출의 혼합 요소를 남기지 않는다.
        for a in subj['areas']:
            a['elements'] = {'지식·이해': [], '과정·기능': [], '가치·태도': []}
        for key in set(elements) | set(cores):
            area = area_by_name.get(key)
            if area is None:
                # 영역명 대응이 확인되지 않으면 새 영역을 추론하지 않는다.
                report['rejected'].append({'subject': subj['subject'], 'school': subj['school'],
                                           'area': key, 'reason': '원문 영역과 struct 영역 대응 없음'})
                continue
            for cat, values in elements.get(key, {}).items():
                area['elements'][cat] = list(dict.fromkeys(values))
            if cores.get(key):
                area['coreIdeas'] = list(dict.fromkeys(cores[key]))
        subj['contentElementsSource'] = 'pdf-school-column'
        subj['contentElementsVerified'] = True
        report['subjects'].append({'school': subj['school'], 'subject': subj['subject'], 'doc': subj['doc'],
                                   'elements': sum(len(v) for a in subj['areas'] for v in a['elements'].values()),
                                   'cells': proofs})
    for doc in opened.values():
        doc.close()
    return report


def parser_name(label):
    return re.sub(r'_국가교육위원회.*$', '', label).strip()
