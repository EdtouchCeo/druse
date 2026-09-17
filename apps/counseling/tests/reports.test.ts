import test from 'node:test'
import assert from 'node:assert/strict'
import {analysisReportIssue} from '../src/lib/reports'
import {reportFilename} from '../src/lib/model'
import {LocalTransport} from '../src/lib/localTransport'
import {CloudTransport} from '../src/lib/cloudTransport'
import type {Session} from '../src/lib/types'

function session():Session{return {id:'selected-session',date:'2026-09-14',topic:'',student_question:'',context:'',evidence_notes:'',teacher_opinion:'',workflow_version:2,preparation:null,consultation:{status:'not_started',date:'',student_response:'',agreed_direction:'',adjustments:'',summary:''},actions:[],next_date:'',record:{id:'record',filename:'synthetic.pdf',sha256:'source',page_count:1,school_stage:'high',sections:[],warnings:[],readable_pages:[1],unreadable_pages:[]},analysis:{summary:'합성 분석',strengths:[],improvements:[],actions:[],questions:[],limitations:[],model:'synthetic',created_at:'2026-09-14',record_sha256:'source'},review:null,confirmed:null}}

test('analysis report readiness uses saved record provenance independently of strategy workflow',()=>{
 const value=session(),before=structuredClone(value)
 assert.equal(analysisReportIssue(value),'')
 assert.deepEqual(value,before)
 value.analysis!.record_sha256='previous-source';assert.match(analysisReportIssue(value),/다시 분석/)
 delete value.analysis!.record_sha256;assert.match(analysisReportIssue(value),/연결 정보/)
 value.analysis=null;assert.match(analysisReportIssue(value),/분석을 완료/)
 value.record=null;assert.match(analysisReportIssue(value),/PDF를 불러와/)
})

test('analysis PDF routes to the selected local session and cannot request the cloud',async()=>{
 const original=globalThis.fetch,calls:string[]=[]
 globalThis.fetch=(async input=>{calls.push(String(input));return new Response('%PDF-synthetic')}) as typeof fetch
 try{
  assert.equal(await(await new LocalTransport().report('case/id','session id','analysis')).text(),'%PDF-synthetic')
  assert.equal(calls[0],'/api/cases/case%2Fid/report.pdf?session_id=session%20id&audience=analysis')
  await assert.rejects(new CloudTransport().report('case/id','session id','analysis'),/로컬/)
  assert.equal(calls.length,1)
  assert.equal(reportFilename('10101','2026-09-14','analysis'),'학생부_분석_자료_10101_2026-09-14.pdf')
 }finally{globalThis.fetch=original}
})
