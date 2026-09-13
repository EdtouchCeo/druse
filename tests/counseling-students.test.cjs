'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {handler}=require('../netlify/functions/_lib/handlers/counseling-students');
const authId='40000000-0000-4000-8000-000000000001',teacherId='40000000-0000-4000-8000-000000000002',studentId='40000000-0000-4000-8000-000000000003';
const originalFetch=global.fetch;
const input=()=>({name:'직접 추가 학생',student_number:'10102',academic_year:2026,school_stage:'high',grade:1});
const event=(data=input(),method='POST')=>({httpMethod:method,headers:{authorization:'Bearer synthetic-teacher'},body:JSON.stringify(data)});
function fixture({role='교사',approved=true,grants=[],rpcStatus=200,rpcValue}={}){
 const calls=[];
 global.fetch=async(raw,options={})=>{
  const url=new URL(raw);calls.push({url,options});let value,status=200;
  if(url.pathname==='/auth/v1/user')value={id:authId};
  else if(url.pathname==='/rest/v1/users')value=[{id:teacherId,google_id:authId,name:'합성 교사',role,approved}];
  else if(url.pathname==='/rest/v1/counseling_roles')value=grants.map(role=>({role}));
  else if(url.pathname==='/rest/v1/rpc/counseling_create_student'){value=rpcValue||{student_id:studentId,...input(),account_linked:false};status=rpcStatus;}
  else assert.fail('Unexpected request '+url.pathname);
  return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
 };
 return {calls,rpcs:()=>calls.filter(c=>c.url.pathname.includes('/rpc/'))};
}
test.beforeEach(()=>{process.env.COUNSELING_STORAGE='supabase';process.env.SUPABASE_URL='https://synthetic.invalid';process.env.SUPABASE_SERVICE_KEY='synthetic-only';});
test.afterEach(()=>{global.fetch=originalFetch;});

test('POST returns a minimal student and uses the authenticated teacher for the atomic RPC',async()=>{
 const f=fixture(),response=await handler(event({...input(),name:' 직접 추가 학생 ',student_number:' 10102 '}));
 assert.equal(response.statusCode,200);assert.deepEqual(JSON.parse(response.body),{student:{student_id:studentId,...input(),account_linked:false}});assert.equal(response.headers['Cache-Control'],'no-store');
 assert.equal(f.rpcs().length,1);assert.deepEqual(JSON.parse(f.rpcs()[0].options.body),{p_actor:teacherId,p_input:input()});
 assert.ok(f.calls.every(c=>c.options.method!=='POST'||c.url.pathname==='/rest/v1/rpc/counseling_create_student'));
});

test('missing auth and non-POST requests never reach the database',async()=>{
 const f=fixture(),e=event();e.headers={};assert.equal((await handler(e)).statusCode,401);assert.equal(f.calls.length,0);
 for(const method of ['GET','PUT','PATCH','DELETE'])assert.equal((await handler(event(input(),method))).statusCode,405);
 assert.equal(f.calls.length,0);
});

test('only currently school-approved teachers may register, not students or manager-only accounts',async()=>{
 for(const options of [{role:'학생',grants:['student']},{role:'학생',grants:['teacher']},{role:'학부모',grants:['manager']},{approved:false},{approved:null}]){
  const f=fixture(options);assert.equal((await handler(event())).statusCode,403);assert.equal(f.rpcs().length,0);
 }
});

test('invalid form and injected identity or permission fields never reach registration RPC',async()=>{
 for(const data of [{...input(),name:' '},{...input(),student_number:'abc'},{...input(),academic_year:2019},...['actor','p_actor','student_id','user_id','teacher_user_id','created_by','approved','role','active','record'].map(key=>({...input(),[key]:teacherId}))]){
  const f=fixture();assert.equal((await handler(event(data))).statusCode,400);assert.equal(f.rpcs().length,0);
 }
 const f=fixture();assert.equal((await handler(event({...input(),name:'x'.repeat(7000)}))).statusCode,413);assert.equal(f.rpcs().length,0);
});

test('duplicate and storage errors fail without leaking remote details',async()=>{
 for(const [status,value,expected]of [[409,{code:'23505',message:'private existing student identity'},409],[503,{message:'private service credentials'},503]]){
  fixture({rpcStatus:status,rpcValue:value});const response=await handler(event());assert.equal(response.statusCode,expected);assert.ok(!response.body.includes('private'));
 }
});

test('native endpoint keeps the HTTP registration contract',async()=>{
 fixture();const native=(await import('../netlify/functions/counseling-students.mjs')).default;
 const response=await native(new Request('https://synthetic.invalid/.netlify/functions/counseling-students',{method:'POST',headers:{authorization:'Bearer synthetic-teacher','Content-Type':'application/json'},body:JSON.stringify(input())}));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{student:{student_id:studentId,...input(),account_linked:false}});
});

test('native Blobs journey registers, reloads the assigned roster, and starts a persistent strategy',async()=>{
 process.env.COUNSELING_STORAGE='blobs';process.env.NODE_ENV='test';
 const {setEnvironmentContext}=require('../netlify/functions/_lib/vendor/netlify-blobs.cjs');
 const runtime={siteID:'synthetic-site',token:'synthetic-only',edgeURL:'https://cache.synthetic.invalid',uncachedEdgeURL:'https://origin.synthetic.invalid'};
 setEnvironmentContext(runtime);const entries=new Map(),writes=[];let revision=0;
 global.fetch=async(raw,options={})=>{
  const url=new URL(raw),method=String(options.method||'GET').toUpperCase();
  if(url.origin===runtime.uncachedEdgeURL){
   const key=url.pathname,previous=entries.get(key),headers=new Headers(options.headers);
   if(method==='GET')return previous?new Response(previous.body,{status:200,headers:{etag:previous.etag}}):new Response('',{status:404});
   assert.equal(method,'PUT');
   if((headers.get('if-none-match')==='*'&&previous)||(headers.has('if-match')&&headers.get('if-match')!==previous?.etag))return new Response('',{status:412});
   const body=typeof options.body==='string'?options.body:await new Response(options.body).text(),etag='"'+(++revision)+'"';
   entries.set(key,{body,etag});writes.push({key,body:JSON.parse(body)});return new Response('',{status:200,headers:{etag}});
  }
  assert.equal(url.origin,'https://synthetic.invalid');assert.equal(method,'GET');
  if(url.pathname==='/auth/v1/user')return Response.json({id:authId});
  assert.equal(url.pathname,'/rest/v1/users');return Response.json([{id:teacherId,google_id:authId,name:'합성 교사',role:'교사',approved:true}]);
 };
 const request=(name,data)=>new Request('https://site.synthetic.invalid/.netlify/functions/'+name,{method:data?'POST':'GET',headers:{authorization:'Bearer synthetic-teacher','Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 const register=(await import('../netlify/functions/counseling-students.mjs')).default;
 const session=(await import('../netlify/functions/counseling-session.mjs')).default;
 const cases=(await import('../netlify/functions/counseling-cases.mjs')).default;
 try{
  const registered=await register(request('counseling-students',input()));assert.equal(registered.status,200);const {student}=await registered.json();assert.equal(student.account_linked,false);
  const roster=await session(request('counseling-session'));assert.equal(roster.status,200);assert.deepEqual((await roster.json()).students,[student]);
  const created=await cases(request('counseling-cases',{student:{student_id:student.student_id}}));assert.equal(created.status,201);const stored=(await created.json()).case;
  assert.equal(stored.student.student_id,student.student_id);assert.equal(stored.teacher.id,teacherId);assert.equal(stored.revision,1);assert.equal(Object.hasOwn(stored.student,'account_linked'),false);
  const read=await cases(request('counseling-cases?id='+stored.id));assert.equal(read.status,200);assert.deepEqual((await read.json()).case,stored);
  assert.equal(writes.filter(w=>w.body.schema_version===1&&Array.isArray(w.body.students)).length,1);assert.ok(writes.some(w=>w.body.version_key&&w.body.student_id===student.student_id));
 }finally{delete process.env.NETLIFY_BLOBS_CONTEXT;}
});
