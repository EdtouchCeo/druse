import test from 'node:test'
import assert from 'node:assert/strict'
import {displayText,inlineParts,reportBlocks} from '../src/lib/reportContent'

test('detailed strategy keeps its headings, preparation list and three-year table in reading order',()=>{
 const blocks=reportBlocks('# 학생이 준비할 사항\n- 보고서와 원자료 모으기\n- 관심 질문 정리하기\n[교과 학습]\n주제: 자료의 조건에 따른 설명 비교\n| 학년 | 준비 방향 |\n| --- | --- |\n| 1학년 | 기초 개념과 근거 정리 |\n| 2학년 | 비교 방법 확장 |\n| 3학년 | 한계 설명과 진로 선택 |')
 assert.deepEqual(blocks.map(block=>block.kind),['heading','list','heading','heading','table'])
 assert.deepEqual(blocks[1],{kind:'list',items:['보고서와 원자료 모으기','관심 질문 정리하기']})
 const table=blocks[4];assert.equal(table?.kind,'table')
 if(table?.kind==='table')assert.deepEqual(table.rows,[['1학년','기초 개념과 근거 정리'],['2학년','비교 방법 확장'],['3학년','한계 설명과 진로 선택']])
})

test('source lines and repeated school conditions remain complete and in their original positions',()=>{
 const condition='조건: 수업 시간에만 작성하고 원자료의 수치 1 2를 그대로 표시한다.'
 const lines=['출처: 학교 자료 /assessment/0',condition,'',condition,'설명 '+ '원자료를 대조하며 한계를 설명한다. '.repeat(100)]
 const blocks=reportBlocks(lines.join('\n'))
 assert.deepEqual(blocks,lines.map((text,index)=>({kind:'paragraph',text,source:index===0})))
 assert.deepEqual(inlineParts('**개념과 근거**를 잇는다. 수치 1 * 2, a_b, <script>원문</script>'),[
  {strong:true,text:'개념과 근거'},{strong:false,text:'를 잇는다. 수치 1 * 2, a_b, <script>원문</script>'}])
})

test('table cells preserve literal pipes and do not consume following prose with another column count',()=>{
 const blocks=reportBlocks('| 구분 | 원문 |\n| --- | --- |\n| 수식 | x \\| y |\n본문 | 중간 | 끝')
 assert.deepEqual(blocks,[{kind:'table',headers:['구분','원문'],rows:[['수식','x | y']]},{kind:'paragraph',text:'본문 | 중간 | 끝',source:false}])
})

test('malformed and empty table candidates remain readable text without losing any line',()=>{
 for(const lines of [
  ['| 구분 | 원문 |','| --- | --- |'],
  ['| 구분 | 원문 |','| --- | --- | --- |','| 원자료 | 유지 |']
 ])assert.deepEqual(reportBlocks(lines.join('\n')),lines.map(text=>({kind:'paragraph',text,source:false})))
})

test('area preparation labels are readable and retain evidence, support and subject connections',()=>{
 const labels=['현재 근거','준비 방향','준비할 자료·결과물','필요한 도움','연결할 교과·탐구']
 const content='자료에서 확인한 내용과 <script>문자열</script>, **강조**를 그대로 유지한다.'
 assert.deepEqual(reportBlocks(labels.map(label=>label+': '+content).join('\n')),labels.map(label=>({kind:'detail',label,text:content.replace('<script>문자열</script>','')})))
 assert.deepEqual(reportBlocks('준비 방향:\n- 기존 자료 비교\n- 교사에게 피드백 요청'),[{kind:'detail',label:'준비 방향',text:''},{kind:'list',items:['기존 자료 비교','교사에게 피드백 요청']}])
})

test('consumer formatting repairs arrows and entities while retaining amounts and stored text',()=>{
 const input='환경 $\\rightarrow$ 사회 \\(\\rightarrow\\) 건강<br>자료 비용 $5, 비교 자료 $10. &#x20; <strong>준비</strong>'
 assert.equal(displayText(input),'환경 → 사회 → 건강\n자료 비용 $5, 비교 자료 $10.   **준비**')
 assert.ok(input.includes('$\\rightarrow$'))
 const text='현재 근거: 개념을 연결해 설명한 경험이 있다.\n원문 근거: 과거 기록 인용\n확인 위치: 3쪽\n학습 방법: 다음 과목에서 비교 조건을 정한다.\n자료: 교과서의 관련 단원'
 const shown=reportBlocks(text,{hideEvidence:true})
 assert.equal(shown.length,3)
 assert.ok(JSON.stringify(shown).includes('다음 과목'))
 assert.ok(!JSON.stringify(shown).includes('3쪽'))
 assert.ok(text.includes('과거 기록 인용'))
 assert.equal(displayText('원인 $\rightarrow$ 결과, 자료 $5 → $10'),'원인 → 결과, 자료 $5 → $10')
 const source='출처: 2026학년도 2학기 과학 수업 · 자료 SOURCE-77 · /assessment/0 · 개정 2'
 assert.deepEqual(reportBlocks(source,{hideEvidence:true}),[{kind:'paragraph',text:'출처: 2026학년도 2학기 과학 수업',source:true}])
 assert.deepEqual(reportBlocks('출처: 자료 OECD · 2026 개정 교육 보고서 · https://example.org/report',{hideEvidence:true}),[{kind:'paragraph',text:'출처: 자료 OECD · 2026 개정 교육 보고서 · https://example.org/report',source:true}])
})
