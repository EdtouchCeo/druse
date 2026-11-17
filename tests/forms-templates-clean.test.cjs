// 기본 양식 틀에 원본 문서의 흔적(미리보기 글·그림, 만든 사람)이 남지 않았는지 확인한다.
// 편집기는 이 항목을 새로 만들지 않아, 틀에 남으면 교사가 내려받는 문서에 그대로 따라간다.
// 실행: node --test tests/forms-templates-clean.test.cjs
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const JSZip = require('../output/web/lib/jszip.min.js')
const dir = path.join(__dirname, '../output/web/forms/templates')
const blank = fs.readFileSync(path.join(__dirname, '../output/web/forms/blank.hwpx'))
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.hwpx'))) {
  test('틀에 원본 흔적 없음: ' + f, async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(dir, f)))
    const blankImg = await (await JSZip.loadAsync(blank)).file('Preview/PrvImage.png').async('nodebuffer')
    assert.equal(Object.keys(zip.files)[0], 'mimetype')
    assert.equal((await zip.file('Preview/PrvText.txt').async('string')).trim(), '')
    assert.ok((await zip.file('Preview/PrvImage.png').async('nodebuffer')).equals(blankImg), '미리보기 그림이 빈 문서의 것과 다르다')
    const hpf = await zip.file('Contents/content.hpf').async('string')
    for (const m of hpf.matchAll(/<opf:(title|meta name="(?:creator|lastsaveby|CreatedDate|ModifiedDate|date)"[^>]*)>([^<]*)</g)) assert.equal(m[2], '', m[1])
  })
}
