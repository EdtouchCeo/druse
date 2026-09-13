import test from 'node:test'
import assert from 'node:assert/strict'
import {validateNewStudent} from '../src/lib/students'
import {CloudTransport} from '../src/lib/cloudTransport'
import type {NewStudentInput} from '../src/lib/types'

const input:NewStudentInput={name:'합성학생',student_number:'10101',academic_year:2026,school_stage:'high',grade:1}

test('manual student input requires a usable name and existing school number/year rules',()=>{
 assert.deepEqual(validateNewStudent({...input,name:'  합성학생  ',student_number:' 10101 '}),input)
 for(const patch of [{name:''},{name:'   '},{name:'가'.repeat(81)},{name:'합성\n학생'},{student_number:'101'},{student_number:'a0101'},{student_number:'１２３４５'},{academic_year:2019},{academic_year:2101},{academic_year:2026.5},{grade:0},{grade:4},{grade:1.5},{school_stage:'college'}]){
  assert.throws(()=>validateNewStudent({...input,...patch} as NewStudentInput))
 }
 assert.doesNotThrow(()=>validateNewStudent({...input,academic_year:2020,grade:3,school_stage:'middle'}))
})

test('manual registration reuses the school bearer and sends only student fields before case creation',async t=>{
 const oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),oldFetch=globalThis.fetch
 Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>JSON.stringify({token:'school-session'})},configurable:true})
 t.after(()=>{globalThis.fetch=oldFetch;if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else Reflect.deleteProperty(globalThis,'localStorage')})
 const student={...input,student_id:'server-student-id',account_linked:false},calls:{path:string;body:unknown;options:RequestInit}[]=[]
 globalThis.fetch=async(url,options)=>{
  calls.push({path:String(url),body:JSON.parse(String(options?.body)),options:options!})
  return new Response(JSON.stringify(String(url).endsWith('counseling-students')?{student}:{case:{id:'new-case'}}),{status:200})
 }
 const api=new CloudTransport()
 const added=await api.addStudent({...input,name:' 합성학생 ',student_id:'client-id',teacher_user_id:'other-teacher'} as NewStudentInput)
 assert.equal(added.student_id,'server-student-id');assert.equal(added.account_linked,false)
 await api.create(added,'합성교사')
 assert.equal(calls[0]!.path,'/.netlify/functions/counseling-students')
 assert.deepEqual(calls[0]!.body,input)
 assert.deepEqual(calls[1]!.body,{student:{student_id:'server-student-id'},teacher:{display_name:'합성교사'}})
 for(const call of calls){assert.equal(call.options.method,'POST');assert.equal(new Headers(call.options.headers).get('Authorization'),'Bearer school-session');assert.equal(call.options.cache,'no-store')}
})

test('manual registration rejects invalid input without sending a request and retains API duplicate errors',async t=>{
 const oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),oldFetch=globalThis.fetch
 Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>JSON.stringify({token:'school-session'})},configurable:true})
 t.after(()=>{globalThis.fetch=oldFetch;if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else Reflect.deleteProperty(globalThis,'localStorage')})
 let calls=0;globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{code:'DUPLICATE',message:'이미 등록된 학번입니다.'}}),{status:409})}
 const api=new CloudTransport()
 await assert.rejects(api.addStudent({...input,academic_year:2019}),/학년도/);assert.equal(calls,0)
 await assert.rejects(api.addStudent(input),{status:409,code:'DUPLICATE'});assert.equal(calls,1)
})
