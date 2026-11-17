"""각종 양식 원본(.hwpx) → 문서작성 AI 기본 양식 틀

원본: input/teacher/각종 양식/*.hwpx
실행: python scripts/forms/prep_forms.py "<원본 폴더>" output/web/forms/templates
하는 일: 예시로 적혀 있던 값(이름, 날짜, 수업 내용)을 비우고 줄 배치 캐시를 지운다. 항목 이름과 안내문은 그대로 둔다.
양식이 바뀌면 아래 문구 일치(assert)가 실패한다. 실패한 위치를 새 양식에 맞게 고친다.
틀을 다시 만들면 output/web/forms/forms.js의 작성 기준(칸 위치)도 함께 확인한다.
"""
import io, os, re, sys, zipfile

SRC, DST = sys.argv[1], sys.argv[2]
TC = re.compile(r'<hp:tc\b.*?</hp:tc>', re.S)
TBL = re.compile(r'<hp:tbl\b.*?</hp:tbl>', re.S)
PARA = re.compile(r'<hp:p\b[^>]*>.*?</hp:p>', re.S)
PLAIN_P = re.compile(r'<hp:p\b[^>]*>(?:(?!<hp:p\b|<hp:tbl\b).)*?</hp:p>', re.S)


class Form:
    def __init__(self, name):
        self.z = zipfile.ZipFile(os.path.join(SRC, name))
        self.sec = self.z.read('Contents/section0.xml').decode('utf-8')
        assert self.sec.count('<hp:tbl') == len(TBL.findall(self.sec)), '표 안의 표가 있다: ' + name
        self.sec = re.sub(r'<hp:linesegarray>.*?</hp:linesegarray>', '', self.sec, flags=re.S)

    def _cell(self, t, r, c, fn):
        tables = list(TBL.finditer(self.sec))
        m = tables[t - 1]
        tbl = m.group(0)
        key = '<hp:cellAddr colAddr="%d" rowAddr="%d"/>' % (c, r)
        hits = [x for x in TC.finditer(tbl) if key in x.group(0)]
        assert len(hits) == 1, (t, r, c, len(hits))
        tc = hits[0].group(0)
        sub = re.search(r'(<hp:subList\b[^>]*>)(.*?)(</hp:subList>)', tc, re.S)
        paras = PARA.findall(sub.group(2))
        assert paras, (t, r, c)
        new_tc = tc[:sub.start(2)] + fn(paras) + tc[sub.end(2):]
        tbl = tbl[:hits[0].start()] + new_tc + tbl[hits[0].end():]
        self.sec = self.sec[:m.start()] + tbl + self.sec[m.end():]

    @staticmethod
    def _para(p, text):
        head = re.match(r'<hp:p\b[^>]*>', p).group(0)
        cp = re.search(r'<hp:run charPrIDRef="(\d+)"', p).group(1)
        text = text.replace('&', '&amp;').replace('<', '&lt;')
        return '%s<hp:run charPrIDRef="%s"><hp:t>%s</hp:t></hp:run></hp:p>' % (head, cp, text)

    def clear(self, t, cells):
        for r, c in cells:
            self._cell(t, r, c, lambda ps: self._para(ps[0], ''))

    def put(self, t, r, c, text):
        """칸의 글을 text로 바꾼다. 줄 수는 원래 문단 수 안에서만."""
        lines = text.split('\n')
        def fn(ps):
            assert len(lines) <= len(ps), (t, r, c)
            return ''.join(self._para(ps[i], lines[i]) for i in range(len(lines)))
        self._cell(t, r, c, fn)

    def sub(self, old, new, count=1):
        assert self.sec.count(old) == count, (old, self.sec.count(old))
        self.sec = self.sec.replace(old, new)

    def para_text(self, starts, text):
        """본문 문단(표 밖) 가운데 글이 starts로 시작하는 것 하나의 글을 바꾼다."""
        self._plain(starts, lambda p: self._para(p, text))

    def drop(self, starts):
        self._plain(starts, lambda p: '')

    def _plain(self, starts, fn):
        hits = [m for m in PLAIN_P.finditer(self.sec)
                if ''.join(re.findall(r'<hp:t>([^<]*)</hp:t>', m.group(0))).replace('&amp;', '&').strip().startswith(starts)
                and '<hp:secPr' not in m.group(0)]
        assert len(hits) == 1, (starts, len(hits))
        m = hits[0]
        self.sec = self.sec[:m.start()] + fn(m.group(0)) + self.sec[m.end():]

    def save(self, name):
        buf = io.BytesIO()
        out = zipfile.ZipFile(buf, 'w')
        for info in self.z.infolist():
            data = self.sec.encode('utf-8') if info.filename == 'Contents/section0.xml' else self.z.read(info.filename)
            # mimetype은 압축하지 않은 첫 항목이어야 한다(HWPX 규칙).
            kind = zipfile.ZIP_STORED if info.filename == 'mimetype' else zipfile.ZIP_DEFLATED
            out.writestr(zipfile.ZipInfo(info.filename, date_time=(2026, 11, 17, 0, 0, 0)), data, kind)
        out.close()
        open(os.path.join(DST, name), 'wb').write(buf.getvalue())
        print('OK', name, len(buf.getvalue()))


# 1. 1학급 1캠페인 활동 결과보고서
f = Form('1학급 1캠페인 활동 결과보고서.hwpx')
f.clear(1, [(r, c) for r in range(2, 8) for c in (1, 2, 3, 5, 6, 7)])
f.clear(1, [(8, 1), (9, 1), (11, 1), (11, 4), (11, 6)])
f.save('campaign-result.hwpx')

# 2. 결석신고서: 손으로 쓰는 빈 양식이라 그대로 둔다.
f = Form('결석신고서.hwpx')
f.save('absence-report.hwpx')

# 3. 교수-학습 지도안(약안)
f = Form('교수-학습 지도안(약안) 양식.hwpx')
f.put(1, 0, 0, '본 시 수 업 안 (    /    )')
f.clear(1, [(1, 1), (1, 4), (1, 6), (1, 9), (1, 12), (2, 2)] + [(r, c) for r in (4, 5, 6) for c in (2, 7, 10)])
f.save('lesson-plan-brief.hwpx')

# 4. 봉사활동 운영 계획서
f = Form('봉사활동 운영 계획서(양식).hwpx')
f.clear(1, [(1, 0), (1, 1), (1, 3)])
f.clear(2, [(r, c) for r in range(1, 9) for c in (0, 1, 2, 3)] + [(r, 4) for r in (1, 3, 5, 7)])
f.save('service-plan.hwpx')

# 5. 봉사활동 확인서
f = Form('봉사활동 확인서(양식).hwpx')
f.clear(1, [(r, c) for r in range(1, 9) for c in (0, 1, 2, 3, 4)] + [(r, 5) for r in (1, 3, 5, 7)])
f.save('service-cert.hwpx')

# 6. 수업 참관록
f = Form('수업 참관록 양식.hwpx')
f.put(1, 0, 1, '20   년    월    일(   요일)      교시')
f.save('class-observation.hwpx')

# 7. 월중 행사표: 날짜 숫자는 두고 요일·행사·비고를 비운다.
f = Form('월중 행사표.hwpx')
f.clear(1, [(r, c) for r in range(1, 32) for c in (1, 2, 3)])
f.para_text('2026년 11월 행 사 표', '20   년    월 행 사 표')
f.save('monthly-events.hwpx')

# 8. 학교운영위원회 제안서
f = Form('학교운영위원회 제안서.hwpx')
f.sub('제출연월일 : 2026년 10월 14일', '제출연월일 : 20   년    월    일')
f.para_text('가. 2027학년도 일반계고', '  가. ')
f.drop('나. 2027학년도 1학기 교육감')
f.drop('다. 2027학년도 입학생 및 3개 학년 교육과정 편제(대륜')
f.para_text('가. 2027학년도 입학생 및 3개 학년 교육과정 편제 제출', '  가. ')
for s in ('나. 이수 학점 증배', '1) 사유', '2) 내용', '다. 교과서 없는'):
    f.drop(s)
f.para_text('붙임  2027학년도', '붙임  ')
f.drop('2027학년도 3개 학년 교육과정 편제 1부.  끝.')
f.save('sc-proposal.hwpx')

# 9. 학급 특색 활동 제안서
f = Form('학급 특색 활동 제안서(0학년0반).hwpx')
f.clear(2, [(0, 2), (0, 4), (2, 1), (5, 1)])
f.save('class-activity-proposal.hwpx')

# 10. 확대간부회의: 빈 양식이라 그대로 둔다.
f = Form('확대간부회의.hwpx')
f.save('staff-meeting.hwpx')
