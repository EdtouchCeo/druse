import test from 'node:test'
import assert from 'node:assert/strict'
import {emptyConsultation,normalizeConsultation,preparationIssues,finalizationIssues} from '../src/lib/workflow'
import {emptyStrategy,normalizeCase,studentView,parseBackup,draftBackup} from '../src/lib/model'
import {LocalTransport} from '../src/lib/localTransport'
import {CloudTransport} from '../src/lib/cloudTransport'
import type {CounselingCase,Session} from '../src/lib/types'
const session=():Session=>({id:'synthetic-session',date:'2026-09-12',topic:'자료 비교 계획',student_question:'',context:'',evidence_notes:'',teacher_opinion:'',strategy:emptyStrategy(),actions:[],next_date:'',record:null,analysis:null,review:null,confirmed:null})
const example=():CounselingCase=>({id:'synthetic-case',schema_version:1,revision:3,privacy:'standard',created_at:'2026-09-12',updated_at:'2026-09-12',origin:'synthetic',student:{student_id:'synthetic-student',student_number:'10101',academic_year:2026,school_stage:'high',grade:1},teacher:{display_name:'합성교사'},current_session_id:'synthetic-session',sessions:[session()]})
test('legacy remains legacy; a new workflow needs a real plan, preparation and completed consultation',()=>{
 const legacy=normalizeCase(example()).sessions[0]!
 assert.equal(legacy.workflow_version,undefined);assert.deepEqual(finalizationIssues(legacy),[])
 legacy.workflow_version=2;legacy.strategy!.target_major='관심 분야'
 assert.ok(preparationIssues(legacy).some(issue=>issue.includes('계획')))
 legacy.strategy!.subject_plan='교사 준비 계획';assert.deepEqual(preparationIssues(legacy),[])
 assert.match(finalizationIssues(legacy)[0]!,/준비/)
 legacy.preparation={prepared_at:'2026-09-12T00:00:00Z',prepared_by:'demo',topic:legacy.topic,strategy:{...legacy.strategy!},actions:[]}
 assert.match(finalizationIssues(legacy)[0]!,/상담/)
 legacy.consultation={...emptyConsultation(),status:'completed',date:'2026-09-12',student_response:'부담 범위에 대한 실제 반응',agreed_direction:'수업 중 자료 두 개를 비교'}
 assert.deepEqual(finalizationIssues(legacy),[])
 legacy.strategy!.subject_plan='상담 후 수정한 계획';assert.equal(legacy.preparation.strategy.subject_plan,'교사 준비 계획')
})
test('consultation completion validates actual date, response and agreement without inventing missing values',()=>{
 assert.deepEqual(normalizeConsultation(undefined),emptyConsultation())
 for(const value of [null,{status:'completed'},{date:'2026-02-30'},{student_response:'x'.repeat(6001)},{summary:'x\0y'}])assert.throws(()=>normalizeConsultation(value))
 const result=normalizeConsultation({status:'completed',date:'2026-09-12',student_response:'반응',agreed_direction:'합의'})
 assert.equal(result.summary,'');assert.equal(result.adjustments,'')
})
test('backups preserve preparation and consultation while student projection strips even malformed private workflow fields',()=>{
 const value=example(),current=value.sessions[0]!
 current.workflow_version=2;current.preparation={prepared_at:'2026-09-12',prepared_by:'demo',topic:current.topic,strategy:{...emptyStrategy(),subject_plan:'상담 전 원안'},actions:[]};current.consultation={...emptyConsultation(),status:'in_progress',student_response:'교사용 반응 기록'}
 const backup=parseBackup(JSON.stringify({format:'daeryun-counseling',version:1,case:value}),'online')
 assert.equal(backup.case.sessions[0]!.preparation!.strategy.subject_plan,'상담 전 원안')
 assert.equal(backup.case.sessions[0]!.consultation!.student_response,'교사용 반응 기록')
 current.guidance={published_at:'2026-09-12',published_by:'teacher'}
 current.preparation='malformed private field' as never;current.consultation='private invalid field' as never;current.workflow_version=99 as never;current.imported_history={preparation_imported:true}
 const projected=studentView(value)!.sessions[0]!
 for(const key of ['profile','preparation','consultation','workflow_version','imported_history'])assert.equal(key in projected,false)
})
test('prepare sends the saved revision and selected session; local CSRF and cloud isolation remain enforced',async()=>{
 const original=globalThis.fetch,storage=globalThis.localStorage,calls:{url:string;options:RequestInit}[]=[]
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>JSON.stringify({token:'synthetic-token'})}})
 globalThis.fetch=(async(input,options={})=>{calls.push({url:String(input),options});return new Response(JSON.stringify(String(input).endsWith('/health')?{csrf_token:'local-csrf'}:{case:example()}))}) as typeof fetch
 try{
  const local=new LocalTransport();await local.health();await local.prepare(example(),'synthetic-session')
  assert.equal(calls[1]!.url,'/api/cases/synthetic-case/prepare')
  assert.equal((calls[1]!.options.headers as Record<string,string>)['X-Counseling-Token'],'local-csrf')
  const cloud=new CloudTransport();await cloud.prepare(example(),'synthetic-session')
  assert.ok(calls[2]!.url.includes('action=prepare'))
  for(const call of calls.slice(1))assert.deepEqual(JSON.parse(String(call.options.body)),{revision:3,session_id:'synthetic-session'})
  const privateCase=example();privateCase.privacy='local_only';await assert.rejects(cloud.prepare(privateCase,'synthetic-session'),/온라인/)
  assert.equal(calls.length,3)
 }finally{globalThis.fetch=original;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage})}
})

test('editing a completed response produces a recoverable in-progress backup without altering the original draft',()=>{
 const value=example(),current=value.sessions[0]!
 current.workflow_version=2;current.preparation={prepared_at:'2026-09-12',prepared_by:'demo',topic:current.topic,strategy:{...emptyStrategy(),subject_plan:'원안'},actions:[]};current.consultation={...emptyConsultation(),status:'completed',date:'2026-09-12',student_response:'',agreed_direction:'수업 안에서 수행',adjustments:'한 자료로 축소'}
 const backup=draftBackup(value,current.id),restored=parseBackup(JSON.stringify(backup),'online')
 assert.equal(restored.case.sessions[0]!.consultation!.status,'in_progress')
 assert.equal(restored.case.sessions[0]!.consultation!.adjustments,'한 자료로 축소')
 assert.equal(restored.case.sessions[0]!.preparation!.strategy.subject_plan,'원안')
 assert.equal(current.consultation.status,'completed')
})
