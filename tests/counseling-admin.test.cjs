'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const admin=require('../netlify/functions/_lib/handlers/counseling-admin').handler;
const session=require('../netlify/functions/_lib/handlers/counseling-session').handler;
const cases=require('../netlify/functions/_lib/handlers/counseling-cases').handler;
const authId='20000000-0000-4000-8000-000000000001';
const profileId='20000000-0000-4000-8000-000000000002';
const targetId='20000000-0000-4000-8000-000000000003';
const initialFetch=global.fetch;
function event(method='GET',body){return {httpMethod:method,headers:{authorization:'Bearer synthetic-manager-token'},queryStringParameters:{},body:body===undefined?null:JSON.stringify(body)};}
const parse=response=>JSON.parse(response.body);
function fixture({grants=['manager'],approved=true,role='교사',userCount=2}={}){
 const calls=[];
 const profile={id:profileId,google_id:authId,name:'합성 관리자',role,approved,email:'synthetic@example.invalid'};
 const users=Array.from({length:userCount},(_,index)=>({id:`synthetic-user-${index}`,name:'합성 사용자',role:'학생',approved:true,email:'hidden@example.invalid',google_id:'must-not-be-returned',private_note:'must-not-be-returned'}));
 const tables={users,counseling_roles:[{user_id:profileId,role:'manager',approved:true,private_note:'not-returned'}],
  counseling_students:[{id:targetId,user_id:targetId,name:'합성 학생',active:true,private_note:'not-returned'}],
  counseling_student_numbers:[{student_id:targetId,academic_year:2026,student_number:'10101',school_stage:'high',grade:1,private_note:'not-returned'}],
  counseling_assignments:[{student_id:targetId,teacher_user_id:profileId,active:true,private_note:'not-returned'}]};
 global.fetch=async(raw,options={})=>{
  const url=new URL(raw);calls.push({url,options});let value;
  if(url.pathname==='/auth/v1/user')value={id:authId,email:'synthetic@example.invalid'};
  else if(url.pathname==='/rest/v1/users'&&url.searchParams.has('google_id'))value=[profile];
  else if(url.pathname==='/rest/v1/counseling_roles'&&url.searchParams.has('user_id'))value=grants.map(role=>({role}));
  else if(url.pathname==='/rest/v1/counseling_assignments'&&url.searchParams.has('teacher_user_id'))value=[];
  else if(url.pathname==='/rest/v1/counseling_students'&&url.searchParams.has('user_id'))value=[];
  else if(url.pathname==='/rest/v1/rpc/counseling_administer')value={ok:true};
  else {
   const table=url.pathname.split('/').at(-1);
   assert.ok(Object.hasOwn(tables,table),'Unexpected request '+url.pathname);
   const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||500);
   value=tables[table].slice(offset,offset+limit);
  }
  return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
 };
 return {calls};
}
test.beforeEach(()=>{process.env.COUNSELING_STORAGE='supabase';process.env.SUPABASE_URL='https://synthetic.invalid';process.env.SUPABASE_SERVICE_KEY='synthetic-service-key';process.env.COUNSELING_SERVER_AI_ENABLED='true';process.env.LLM_MODEL='synthetic-model';process.env.GEMINI_API_KEY='synthetic-only';});
test.afterEach(()=>{global.fetch=initialFetch;});
test('admin snapshot needs a Bearer token before any fetch',async()=>{const f=fixture(),e=event();e.headers={};assert.equal((await admin(e)).statusCode,401);assert.equal(f.calls.length,0);});
test('school approval and separate manager role are both mandatory',async()=>{
 for(const options of [{grants:['teacher']},{grants:[]},{grants:['manager'],approved:false}]){
  const f=fixture(options);assert.equal((await admin(event())).statusCode,403);assert.ok(!f.calls.some(c=>c.url.searchParams.has('offset')));
 }
});
test('admin snapshot projects minimal metadata without email, auth ID, logs or case data',async()=>{
 const f=fixture(),response=await admin(event());assert.equal(response.statusCode,200);
 const data=parse(response);assert.deepEqual(Object.keys(data),['users','roles','students','numbers','assignments']);
 assert.deepEqual(Object.keys(data.users[0]),['id','name','role','approved']);
 assert.deepEqual(Object.keys(data.students[0]),['id','user_id','name','active']);
 assert.ok(!response.body.includes('email')&&!response.body.includes('google_id')&&!response.body.includes('private_note'));
 assert.ok(!f.calls.some(c=>/counseling_cases|case_versions|\/logs/.test(c.url.pathname)));
 assert.equal(response.headers['Cache-Control'],'no-store');
});
test('admin snapshot continues after the first 500 accounts',async()=>{
 const f=fixture({userCount:510}),response=await admin(event());assert.equal(response.statusCode,200);assert.equal(parse(response).users.length,510);
 assert.ok(f.calls.some(c=>c.url.pathname==='/rest/v1/users'&&c.url.searchParams.get('offset')==='500'));
});
test('oversized management lists fail instead of returning an incomplete snapshot',async()=>{
 fixture({userCount:10001});const response=await admin(event());assert.equal(response.statusCode,503);assert.equal(parse(response).error.code,'ADMIN_LIST_LIMIT');
});
test('manager-only session exposes management access without students or server AI',async()=>{
 const f=fixture(),response=await session(event());assert.equal(response.statusCode,200);const data=parse(response);
 assert.equal(data.user.role,'manager');assert.equal(data.user.can_manage,true);assert.deepEqual(data.students,[]);assert.equal(data.ai.server,false);
 assert.ok(!f.calls.some(c=>c.url.pathname.includes('counseling_assignments')));
 assert.equal((await cases(event())).statusCode,403);
});
test('teacher-manager retains teacher behavior while ordinary teacher cannot manage',async()=>{
 fixture({grants:['teacher','manager']});let data=parse(await session(event()));assert.equal(data.user.role,'teacher');assert.equal(data.user.can_manage,true);assert.equal(data.ai.server,true);
 fixture({grants:['teacher']});data=parse(await session(event()));assert.equal(data.user.role,'teacher');assert.equal(data.user.can_manage,false);
});
test('manager mutations use the authenticated profile ID and retain existing contract',async()=>{
 const f=fixture();const response=await admin(event('POST',{action:'role',user_id:targetId,role:'teacher',approved:true}));assert.equal(response.statusCode,200);
 const request=f.calls.find(c=>c.url.pathname.includes('/rpc/'));const body=JSON.parse(request.options.body);
 assert.equal(body.p_actor,profileId);assert.deepEqual(body.p_input,{action:'role',user_id:targetId,role:'teacher',approved:true});
});
test('client cannot inject an actor or bootstrap manager through the API',async()=>{
 fixture();assert.equal((await admin(event('POST',{action:'role',user_id:targetId,role:'teacher',approved:true,p_actor:targetId}))).statusCode,400);
 fixture({grants:['teacher']});assert.equal((await admin(event('POST',{action:'role',user_id:profileId,role:'manager',approved:true}))).statusCode,403);
});
