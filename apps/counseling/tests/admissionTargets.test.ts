import test from 'node:test'
import assert from 'node:assert/strict'
import {adoptProfile,admissionTargetSummary,emptyProfile,hasAdmissionTarget,newAdmissionTarget,normalizeProfile,profileIssues,profileQuestions} from '../src/lib/profile'
import {emptyStrategy} from '../src/lib/model'

test('optional admission choices and partial rows survive backup normalization without inferred values',()=>{
 const id=crypto.randomUUID(),value=normalizeProfile({target_major:'기존 관심 분야',admission_targets:[{id,major:'탐색 중인 전공'}]})
 assert.equal(value.target_major,'기존 관심 분야')
 assert.deepEqual(value.admission_targets,[{id,major:'탐색 중인 전공',university:'',admission_type:'',admission_name:'',admission_year:null}])
 assert.deepEqual(normalizeProfile(JSON.parse(JSON.stringify(value))),value)
 assert.deepEqual(normalizeProfile({target_major:'이전 저장값'}).admission_targets,[])
 assert.equal(profileIssues(emptyProfile()).length,0)
 const blank=newAdmissionTarget()
 assert.equal(hasAdmissionTarget(blank),false)
 assert.equal(blank.admission_year,null)
 assert.equal(profileQuestions({...emptyProfile(),admission_targets:[blank]}).length,0)
})

test('university-specific wishes become labeled preparation input without replacing authored strategy',()=>{
 const rows=[{...newAdmissionTarget(),university:'합성 대학 A',major:'생명과학과',admission_type:'학생부종합',admission_name:'합성전형',admission_year:2029},{...newAdmissionTarget(),major:'다른 관심 전공'}]
 const profile={...emptyProfile(),target_major:'기존 관심 분야',admission_targets:rows}
 assert.equal(admissionTargetSummary(rows[1]!), '다른 관심 전공')
 const draft=adoptProfile(profile,emptyStrategy())
 assert.match(draft.target_major,/기존 관심 분야/)
 assert.match(draft.target_major,/희망\(입력\): 합성 대학 A · 생명과학과 · 학생부종합 · 합성전형 · 2029학년도 대입/)
 assert.doesNotMatch(draft.target_major,/합격|최저|지원 가능/)
 assert.equal(adoptProfile(profile,{...emptyStrategy(),target_major:'교사가 정한 방향'}).target_major,'교사가 정한 방향')
 assert.match(profileQuestions(profile).find(row=>row.id==='admission')!.evidence,/합성 대학 A/)
 assert.deepEqual(profile.admission_targets,rows)
})

test('admission field validation rejects malformed rows while allowing independently missing fields',()=>{
 const row=newAdmissionTarget()
 for(const patch of [{university:'대학만 입력'},{major:'전공만 입력'},{admission_type:'유형만 입력'},{admission_name:'전형명만 입력'},{admission_year:2030}])assert.equal(profileIssues({...emptyProfile(),admission_targets:[{...row,...patch}]}).length,0)
 for(const targets of [null,{},[null],[row,row],[row,{...row,id:row.id.toUpperCase()}],Array.from({length:13},newAdmissionTarget),...[{id:'bad'},{admission_year:true},{admission_year:'2029'},{admission_year:2029.5},{admission_year:2101},{university:null},{major:'x'.repeat(201)},{admission_type:'x'.repeat(101)},{admission_name:'x\0y'},{raw_pdf:'forbidden'}].map(patch=>[{...row,...patch}])])assert.throws(()=>normalizeProfile({admission_targets:targets}))
})
