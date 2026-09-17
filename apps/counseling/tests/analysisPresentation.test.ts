import test from 'node:test'
import assert from 'node:assert/strict'
import {groupedFindings,evidenceLocation,findingArea} from '../src/lib/analysisPresentation'
import {applyAnalysis,emptyStrategy} from '../src/lib/model'
import type {Analysis,SchoolRecord} from '../src/lib/types'

test('explicit career reflection retains its career context without reclassifying experiments or collaboration',()=>{
 const record:SchoolRecord={id:'career-record',filename:'synthetic.pdf',sha256:'synthetic',page_count:1,school_stage:'high',warnings:[],readable_pages:[1],unreadable_pages:[],sections:[{id:'career',category:'career',label:'진로활동',school_stage:'high',academic_year:2026,grade:2,semester:1,pages:[1],text:'관심이 변한 이유를 설명하고 관련 과목을 선택할 때 확인할 조건을 구분하였다.',status:'present'}]}
 const finding={area:'탐구',text:'관심의 변화와 관련 과목 선택을 연결하여 설명하였다.',quote:record.sections[0]!.text,guidance:'다른 분야의 질문도 비교한다.',evidence_ids:['career']}
 const before=structuredClone(finding)
 assert.equal(findingArea(finding,record),'진로')
 assert.deepEqual(finding,before)
 assert.equal(findingArea({...finding,area:'공동체',text:'친구의 관심을 듣고 역할을 조정하였다.'},record),'공동체')
 assert.equal(findingArea({...finding,text:'실험 변인을 통제하고 자료의 차이를 설명하였다.'},record),'탐구')
 assert.equal(findingArea({...finding,evidence_ids:['missing']},record),'탐구')
 assert.equal(findingArea({area:'탐구',text:'관심 분야의 새 질문을 탐구한다.',evidence_ids:['career']},record),'탐구')
 record.sections[0]!.category='academic';record.sections[0]!.label='교과 학습'
 assert.equal(findingArea(finding,record),'탐구')
})

test('domain grouping preserves every finding and source location, including old records without area',()=>{
 const record:SchoolRecord={id:'record',filename:'synthetic.pdf',sha256:'synthetic',page_count:2,school_stage:'high',warnings:[],readable_pages:[1,2],unreadable_pages:[],sections:[{id:'source',category:'academic',label:'교과학습발달상황',school_stage:'high',academic_year:2025,grade:1,semester:2,pages:[1,2],text:'서로 다른 자료를 비교함.',status:'present'}]}
 const analysis:Analysis={summary:'합성',strengths:[{area:'탐구',text:'자료 비교',guidance:'변인을 설명해 보기',quote:'서로 다른 자료를 비교함.',evidence_ids:['source']},{text:'교과 학습',guidance:'',evidence_ids:['source']}],improvements:[{area:'공동체',text:'역할 조정 확인',guidance:'피드백 제공',evidence_ids:['unknown']}],questions:[],actions:[],limitations:[],model:'synthetic',created_at:'2026-09-17'}
 const before=structuredClone(analysis),groups=groupedFindings(analysis,record)
 assert.deepEqual(groups.map(group=>group.area),['학업','탐구','공동체'])
 assert.equal(groups.flatMap(group=>[...group.strengths,...group.improvements]).length,3)
 assert.equal(evidenceLocation('source',record),'교과학습발달상황 · 2025학년도 · 1학년 · 2학기 · 1, 2쪽')
 assert.equal(evidenceLocation('unknown',record),'원문 위치 확인 필요')
 assert.deepEqual(analysis,before)
 const strategy=applyAnalysis(emptyStrategy(),analysis)
 assert.match(strategy.strengths,/\[탐구\]/)
 assert.match(strategy.gaps,/\[공동체\]/)
 record.sections[0]!.category='subject_detail'
 assert.equal(groupedFindings({...analysis,strengths:[analysis.strengths[1]!],improvements:[]},record)[0]!.area,'학업')
 record.sections[0]!.category='autonomy'
 assert.equal(groupedFindings({...analysis,strengths:[analysis.strengths[1]!],improvements:[]},record)[0]!.area,'공동체')
})
