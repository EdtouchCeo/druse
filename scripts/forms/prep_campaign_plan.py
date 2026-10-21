"""1학급 1캠페인 활동계획서 원본(.hwpx) → 자리표시자 템플릿

원본: 창의인성부/1학급 1캠페인 활동/2025학년도 1학급 1캠페인 활동계획서(0-0).hwp
순서:
  1. python scripts/forms/hwp_to_hwpx.py <원본.hwp> plan.hwpx        (한글 설치 PC 필요)
  2. python scripts/forms/prep_campaign_plan.py plan.hwpx output/web/forms/templates/campaign-plan.hwpx
  3. python scripts/forms/build_template_js.py campaign-plan
원본 양식이 바뀌면 이 스크립트의 문구 일치(assert)가 실패하므로, 실패한 위치를 새 양식에 맞게 고친다.
"""
import io, re, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(src)
sec = z.read('Contents/section0.xml').decode('utf-8')

# 1) drop memo field (fieldBegin ctrl incl. memo body, and fieldEnd ctrl)
sec, n1 = re.subn(r'<hp:ctrl><hp:fieldBegin [^>]*type="MEMO".*?</hp:fieldBegin></hp:ctrl>', '', sec, flags=re.S)
sec, n2 = re.subn(r'<hp:ctrl><hp:fieldEnd [^>]*/></hp:ctrl>', '', sec)
assert n1 == 1 and n2 == 1, (n1, n2)
# 2) example style (gray italic, charPr 17) -> normal black (charPr 11)
sec = sec.replace('charPrIDRef="17"', 'charPrIDRef="11"')
# 3) cached line layout is stale once text changes; Hangul recomputes it
sec = re.sub(r'<hp:linesegarray>.*?</hp:linesegarray>', '', sec, flags=re.S)

def sub_once(old, new):
    global sec
    assert sec.count(old) == 1, (old, sec.count(old))
    sec = sec.replace(old, new)

sub_once('<hp:t>1학급 1캠페인 활동 계획서(0학년 0반)</hp:t>', '<hp:t>1학급 1캠페인 활동 계획서({{학년}}학년 {{반}}반)</hp:t>')
sub_once('<hp:t>0학년 0반 00번</hp:t>', '<hp:t>{{대표_학번}}</hp:t>')
# representative name: the only '000' inside a colSpan=3 cell at colAddr 7,row 1
sec = re.sub(r'<hp:t>000</hp:t>(</hp:run></hp:p></hp:subList><hp:cellAddr colAddr="7" rowAddr="1"/>)', r'<hp:t>{{대표_성명}}</hp:t>\1', sec, count=1)
assert '{{대표_성명}}' in sec

# participant grid rows 3..6, pairs at (1,2) (4,5) (7,9)
pairs = [(1, 2), (4, 5), (7, 9)]
k = 0
for row in range(3, 7):
    for c_no, c_name in pairs:
        k += 1
        for col, key in ((c_no, f'p{k}_no'), (c_name, f'p{k}_name')):
            pat = re.compile(r'(<hp:tc [^>]*>(?:(?!</hp:tc>).)*?)<hp:run charPrIDRef="11"(?:/>|><hp:t>[^<]*</hp:t></hp:run>)((?:(?!</hp:tc>).)*?<hp:cellAddr colAddr="%d" rowAddr="%d"/>)' % (col, row), re.S)
            sec, n = pat.subn(lambda m: m.group(1) + '<hp:run charPrIDRef="11"><hp:t>{{%s}}</hp:t></hp:run>' % key + m.group(2), sec, count=1)
            assert n == 1, (row, col)

# activity date cell: first paragraph had '... 6월 ' + memo + '13일' + empty t
sec, n = re.subn(r'<hp:t>2025년 6월 10일 ~ 2025년 6월 </hp:t><hp:t>13일</hp:t><hp:t/>', '<hp:t>{{기간}}</hp:t>', sec)
assert n == 1, 'period'
sub_once('<hp:t>(등교시간 실시: 매일 07:50~08:15 실시, 총 4일간 2시간)</hp:t>', '<hp:t>{{시간설명}}</hp:t>')
sub_once('<hp:t>구 테니스장 앞 건널목</hp:t>', '<hp:t>{{장소}}</hp:t>')
sec, n = re.subn(r'<hp:t>평소 일과 중 축구나[^<]*</hp:t>', '<hp:t>{{목적}}</hp:t>', sec); assert n == 1
sec, n = re.subn(r'<hp:t>많은 학생들과 대면하여[^<]*</hp:t>', '<hp:t>{{내용}}</hp:t>', sec); assert n == 1
# area marks row 12
for col, key in ((1, '영역_캠페인'), (3, '영역_이웃돕기'), (6, '영역_환경보호'), (8, '영역_기타')):
    pat = re.compile(r'(<hp:tc [^>]*>(?:(?!</hp:tc>).)*?)<hp:run charPrIDRef="12"(?:/>|><hp:t>[^<]*</hp:t></hp:run>)((?:(?!</hp:tc>).)*?<hp:cellAddr colAddr="%d" rowAddr="12"/>)' % col, re.S)
    sec, n = pat.subn(lambda m: m.group(1) + '<hp:run charPrIDRef="12"><hp:t>{{%s}}</hp:t></hp:run>' % key + m.group(2), sec, count=1)
    assert n == 1, key
sub_once('<hp:t>2025년  0월  0일</hp:t>', '<hp:t>{{작성일}}</hp:t>')

out = zipfile.ZipFile(dst, 'w')
for info in z.infolist():
    data = z.read(info.filename)
    if info.filename == 'Contents/section0.xml':
        data = sec.encode('utf-8')
    elif info.filename == 'Preview/PrvText.txt':
        data = '1학급 1캠페인 활동 계획서'.encode('utf-16-le') if False else data
    comp = zipfile.ZIP_STORED if info.filename == 'mimetype' else zipfile.ZIP_DEFLATED
    out.writestr(info.filename, data, compress_type=comp)
out.close()
print('placeholders:', sorted(set(re.findall(r'\{\{([^}]+)\}\}', sec))))
