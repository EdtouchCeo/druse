import test from 'node:test'
import assert from 'node:assert/strict'
import {activityStrategyAreas,activityStrategySections} from '../src/lib/activityStrategy'
import {strategyExamples} from '../src/lib/inputExamples'

test('the six activity domains remain distinct and retain their complete preparation details',()=>{
 const input=strategyExamples.activity_plan!,result=activityStrategySections(input)
 assert.equal(result.introduction,'')
 assert.deepEqual(result.sections.map(section=>section.title),[...activityStrategyAreas])
 for(const section of result.sections){
  for(const label of ['현재 근거:','준비 방향:','준비할 자료·결과물:','필요한 도움:','연결할 교과·탐구:'])assert.ok(section.text.includes(label),section.title+label)
  assert.ok(input.includes(section.heading+'\n'+section.text))
 }
 assert.equal(result.sections.map(section=>section.heading+'\n'+section.text).join('\n'),input)
})

test('legacy prose and a partial activity plan are preserved without inventing missing domains',()=>{
 const legacy='학교 자료에서 확인할 조건\n원문 수식: a_b + 1\n\n활동과 진로를 연결한 기존 교사 설명'
 assert.deepEqual(activityStrategySections(legacy),{introduction:legacy,sections:[]})
 const partial=legacy+'\n\n영역: 독서활동\n현재 근거: 자료가 없어 아직 확인하지 못했다.\n준비 방향: 읽은 글을 학생과 확인한다.\n기존 학교 조건: 자료 반입 범위는 교사 안내를 따른다.'
 const result=activityStrategySections(partial)
 assert.equal(result.introduction,legacy+'\n')
 assert.deepEqual(result.sections,[{title:'독서활동',heading:'영역: 독서활동',text:'현재 근거: 자료가 없어 아직 확인하지 못했다.\n준비 방향: 읽은 글을 학생과 확인한다.\n기존 학교 조건: 자료 반입 범위는 교사 안내를 따른다.'}])
})

test('formatted and extra area headings preserve order and do not merge unrelated material',()=>{
 const result=activityStrategySections('## 영역: 동아리활동\n동아리 원문\n\n[독서활동]\n독서 원문\n**영역: 학교별 추가 영역**\n추가 원문\n영역: 동아리활동\n추가 동아리 원문')
 assert.deepEqual(result.sections.map(section=>section.title),['동아리활동','독서활동','학교별 추가 영역','동아리활동'])
 assert.deepEqual(result.sections.map(section=>section.text),['동아리 원문\n','독서 원문','추가 원문','추가 동아리 원문'])
})
