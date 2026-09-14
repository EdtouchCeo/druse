import test from 'node:test'
import assert from 'node:assert/strict'
import {CloudTransport} from '../src/lib/cloudTransport'
import {syntheticCase} from './fixtures/intuitive'

for(const provider of ['gemini','ollama'] as const)test(`${provider} sends current grade metadata separately from historical grades without structured student identifiers`,async()=>{
 const original=globalThis.fetch,calls:{url:string;body:any;options:RequestInit}[]=[]
 globalThis.fetch=(async(input,options={})=>{calls.push({url:String(input),body:JSON.parse(String(options.body)),options});return new Response(JSON.stringify(provider==='gemini'?{candidates:[{content:{parts:[{text:'합성 제안'}]}}]}:{message:{content:'합성 제안'}}))}) as typeof fetch
 try{
  const value=syntheticCase();value.privacy='standard';value.student.grade=3
  value.sessions[0]!.profile!.grades=[{id:'4c51fd43-45b4-434e-bf4e-59f7845fc44e',subject:'합성 과목',academic_year:2024,semester:1,grade_scale:'9',rank_grade:4,score:80,achievement:'B'}]
  const before=JSON.stringify(value)
  assert.equal(await new CloudTransport().generalAi(value,value.current_session_id,{provider,model:'synthetic-local',apiKey:'synthetic-key',ollamaUrl:'http://127.0.0.1:11434'}),'합성 제안')
  assert.equal(calls.length,1)
  const prompt:string=provider==='gemini'?calls[0]!.body.contents[0].parts[0].text:calls[0]!.body.messages[0].content
  const payload=JSON.parse(prompt.slice(prompt.indexOf('\n')+1))
  assert.deepEqual(payload.student,{academic_year:2026,school_stage:'high',grade:3})
  assert.equal(payload.profile.grades[0].academic_year,2024)
  for(const identifier of [value.student.name!,value.student.student_number,value.student.student_id])assert.equal(prompt.includes(identifier),false)
  assert.match(prompt,/역산하지/);assert.match(prompt,/미정 전공을 확정하지/);assert.equal(JSON.stringify(value),before)
 }finally{globalThis.fetch=original}
})
