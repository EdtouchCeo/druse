import test from 'node:test'
import assert from 'node:assert/strict'
import {assertStandard,clone,draftBackup,hasPrivateMaterial,normalizeCase,parseBackup,studentView} from '../src/lib/model'
import {CloudTransport} from '../src/lib/cloudTransport'
import {syntheticCase} from './fixtures/intuitive'
import type {Backup,CounselingCase,Session} from '../src/lib/types'

const privateReports={version:1,reports:[{id:'local-report',kind:'admissions',target_id:'local-target',title:'합성 전략',summary:'합성 요약',sections:[],source_hash:'local-source-hash',created_at:'2026-09-17',model:'synthetic',context_token:'v1.synthetic-context.synthetic-signature',evidence_map:{'strength:compare':{label:'비공개근거표식',details:['로컬에서만 보존할 학생부 근거 문장']}},school_connections:[{subject:'합성 과목',task:'학교고유과제표식',reason:'로컬 과제 연결',conditions:['실제 과제 조건']}]}]}
function privateCase():CounselingCase{const value=syntheticCase();value.privacy='standard';value.sessions[0]!.record=null;value.sessions[0]!.analysis=null;value.sessions[0]!.preparation_reports=clone(privateReports) as Session['preparation_reports'];return value}
function backup(value:CounselingCase):Backup{return {format:'daeryun-counseling',version:1,case:value}}

test('any preparation report field makes a relabeled case local-only before online backup parsing',()=>{
 for(const material of [privateReports,{version:1,reports:[]},{context_token:'synthetic-private-token'},null,false,'synthetic-private-string']){
  const value=privateCase();value.sessions[0]!.preparation_reports=material as Session['preparation_reports']
  assert.equal(hasPrivateMaterial(value),true)
  assert.throws(()=>assertStandard(value),/온라인으로 전송할 수 없습니다/)
  assert.throws(()=>parseBackup(JSON.stringify(backup(value)),'online'),/온라인으로 전송할 수 없습니다/)
 }
 const standard=syntheticCase();standard.privacy='standard'
 assert.equal(hasPrivateMaterial(standard),false)
 assert.doesNotThrow(()=>parseBackup(JSON.stringify(backup(standard)),'online'))
})

test('private reports in an older unselected session still prevent online import',()=>{
 const value=privateCase(),next=clone(value.sessions[0]!)
 next.id='new-selected-session';delete next.preparation_reports
 value.sessions.push(next);value.current_session_id=next.id
 assert.equal(hasPrivateMaterial(value),true)
 assert.throws(()=>parseBackup(JSON.stringify(backup(value)),'online'),/온라인으로 전송/)
})

test('every cloud case mutation rejects report-only private material before authentication or fetch',async()=>{
 const original=globalThis.fetch,calls:unknown[]=[]
 globalThis.fetch=(async(...args)=>{calls.push(args);throw new Error('No authentication or cloud call is allowed for local reports.')}) as typeof fetch
 try{
  const value=privateCase(),api=new CloudTransport(),id=value.current_session_id,before=JSON.stringify(value)
  const operations=[()=>api.save(value),()=>api.importBackup(backup(value)),()=>api.next(value),()=>api.review(value,id),()=>api.prepare(value,id),()=>api.confirm(value,id),()=>api.publish(value,id),()=>api.deleteCase(value)]
  for(const operation of operations)await assert.rejects(operation,/온라인으로 전송할 수 없습니다/)
  assert.deepEqual(calls,[])
  assert.equal(JSON.stringify(value),before)
 }finally{globalThis.fetch=original}
})

test('local normalization and draft backups preserve evidence and opaque context without sharing mutable references',()=>{
 const value=privateCase(),before=JSON.stringify(value)
 const normalized=normalizeCase(value),restored=parseBackup(JSON.stringify(backup(value)),'local').case,draft=draftBackup(value,value.current_session_id).case
 for(const copy of [normalized,restored,draft]){
  assert.deepEqual(copy.sessions[0]!.preparation_reports,privateReports)
  const report=copy.sessions[0]!.preparation_reports!.reports[0]!
  assert.equal((report as unknown as {context_token:string}).context_token,'v1.synthetic-context.synthetic-signature')
  report.evidence_map!['strength:compare']!.details.push('사본에서만 변경')
 }
 assert.equal(JSON.stringify(value),before)
})

test('student response projection removes private report evidence, school connections and context tokens',()=>{
 const value=privateCase();value.sessions[0]!.guidance={published_at:'2026-09-17',published_by:'synthetic-teacher'}
 const before=JSON.stringify(value),student=studentView(value)!
 assert.ok(student)
 assert.equal(Object.prototype.hasOwnProperty.call(student.sessions[0],'preparation_reports'),false)
 for(const sentinel of ['비공개근거표식','학교고유과제표식','synthetic-context','local-source-hash'])assert.equal(JSON.stringify(student).includes(sentinel),false)
 assert.equal(JSON.stringify(value),before)
})
