import test from 'node:test'
import assert from 'node:assert/strict'
import {CloudTransport} from '../src/lib/cloudTransport'
import {syntheticCase} from './fixtures/intuitive'

for(const provider of ['server','gemini','ollama'] as const)test(`legacy ${provider} generation rejects private free text before any fetch`,async()=>{
 const original=globalThis.fetch,calls:unknown[]=[]
 globalThis.fetch=(async(...args)=>{calls.push(args);throw new Error('The legacy generation path must never request a network resource.')}) as typeof fetch
 try{
  const value=syntheticCase(),session=value.sessions[0]!
  value.privacy='standard'
  const sentinel='합성개인정보표식 학생홍길동 학교대륜고 학번19999 synthetic-private@example.test C:\\private\\record.pdf'
  session.topic=sentinel;session.context=sentinel;session.evidence_notes=sentinel;session.teacher_opinion=sentinel
  session.profile!.teacher_observations=sentinel;session.profile!.interests=sentinel;session.strategy!.inquiry_plan=sentinel
  session.consultation!.student_response=sentinel
  const before=JSON.stringify(value)
  await assert.rejects(()=>new CloudTransport().generalAi(value,value.current_session_id,{provider,model:'synthetic-model',apiKey:'synthetic-unused-key',ollamaUrl:'http://127.0.0.1:11434'}),/로컬 전략실의 비식별 학종 전략 생성/)
  assert.deepEqual(calls,[])
  assert.equal(JSON.stringify(value),before)
 }finally{globalThis.fetch=original}
})