'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../netlify/functions/_lib/counseling-storage');
const C=require('../netlify/functions/_lib/counseling');
const ids={manager:'30000000-0000-4000-8000-000000000001',auth:'30000000-0000-4000-8000-000000000002',teacher:'30000000-0000-4000-8000-000000000003',student:'30000000-0000-4000-8000-000000000004',studentUser:'30000000-0000-4000-8000-000000000005',other:'30000000-0000-4000-8000-000000000006'};
class MemoryStore{
 constructor(){this.entries=new Map();this.counter=0;this.calls=[];this.beforeSet=null;}
 seed(key,value){this.entries.set(key,{data:structuredClone(value),etag:'"'+(++this.counter)+'"'});}
 async getWithMetadata(key,options){this.calls.push({method:'get',key,options});const value=this.entries.get(key);return value?structuredClone(value):null;}
 async set(key,payload,conditions){this.calls.push({method:'set',key,conditions});if(this.beforeSet){const answer=await this.beforeSet(key,payload,conditions);if(answer)return answer;}
  const previous=this.entries.get(key);
  if((conditions.onlyIfNew&&previous)||(conditions.onlyIfMatch&&conditions.onlyIfMatch!==previous?.etag))return {modified:false};
  this.seed(key,JSON.parse(payload));return {modified:true,etag:this.entries.get(key).etag};
 }
 async *list({prefix}){const keys=[...this.entries.keys()].filter(key=>key.startsWith(prefix)).sort();for(let i=0;i<keys.length;i+=2)yield {blobs:keys.slice(i,i+2).map(key=>({key})),directories:[]};}
 async delete(key){this.calls.push({method:'delete',key});this.entries.delete(key);}
}
function fixture({seed=true}={}){
 const store=new MemoryStore();
 const profiles=new Map([[ids.manager,{id:ids.manager,google_id:ids.auth,role:'교사',approved:true}],
  [ids.teacher,{id:ids.teacher,role:'교사',approved:true}],[ids.studentUser,{id:ids.studentUser,role:'학생',approved:true}],
  [ids.other,{id:ids.other,role:'학생',approved:true}]]);
 const config={schema_version:1,revision:1,bootstrap:{user_id:ids.manager},roles:[{user_id:ids.manager,role:'manager',approved:true},{user_id:ids.teacher,role:'teacher',approved:true},{user_id:ids.studentUser,role:'student',approved:true}],
  students:[{id:ids.student,user_id:ids.studentUser,name:'합성 학생',active:true}],
  numbers:[{student_id:ids.student,academic_year:2026,student_number:'10101',school_stage:'high',grade:1}],
  assignments:[{student_id:ids.student,teacher_user_id:ids.teacher,active:true}],audit:[]};
 if(seed)store.seed('configuration/v1',config);
 const db=async path=>{const url=new URL(path,'https://synthetic.invalid/');assert.equal(url.pathname,'/users');const id=url.searchParams.get('id')?.slice(3);return profiles.has(id)?[structuredClone(profiles.get(id))]:[];};
 return {store,profiles,adapter:S.createAdapter(store,db),config};
}
function sample(){const c=C.newCase({student_id:ids.student,name:'합성 학생',student_number:'10101',academic_year:2026,school_stage:'high',grade:1},{id:ids.teacher,display_name:'합성 교사'});c.sessions[0].topic='합성 상담';return c;}
const write=(f,c,expected=0)=>f.adapter.query('rpc/counseling_write_case',{method:'POST',data:{p_actor:ids.teacher,p_case:c,p_expected:expected,p_action:expected?'update':'create'}});
const admin=(f,input)=>f.adapter.query('rpc/counseling_administer',{method:'POST',data:{p_actor:ids.manager,p_input:input}});
const get=(f,id,actor_id)=>f.adapter.query(`counseling_cases?id=eq.${id}&select=data,student_id&limit=1`,{actor_id});
const list=(f,actor_id)=>f.adapter.query(`counseling_cases?student_id=in.(${ids.student})&select=data&order=updated_at.desc&limit=200`,{actor_id});
const code=expected=>error=>error instanceof S.StorageError&&error.code===expected;
const remove=(f,c,expected=c.revision,actor=ids.teacher)=>f.adapter.query('rpc/counseling_delete_case',{method:'POST',data:{p_actor:actor,p_id:c.id,p_expected:expected}});

test('case deletion removes all history and publication while keeping the student and other strategies',async()=>{
 const f=fixture(),c=sample(),other=sample();await write(f,c);await write(f,other);
 for(let revision=2;revision<=4;revision++){c.revision=revision;c.sessions[0].guidance={published_at:C.now(),published_by:ids.teacher};await write(f,c,revision-1);}
 assert.deepEqual(await remove(f,c),{deleted:true,id:c.id});assert.deepEqual(await get(f,c.id),[]);
 assert.deepEqual((await list(f)).map(row=>row.data.id),[other.id]);assert.deepEqual((await f.adapter.readConfig()).data,f.config);
 assert.ok(![...f.store.entries.keys()].some(key=>key.startsWith(`cases/${c.id}/versions/`)));
 assert.ok(!f.store.entries.has(`student-cases/${ids.student}/${c.id}`));
 const tombstone=f.store.entries.get(`cases/${c.id}/head`).data;
 assert.equal(tombstone.deleted,true);assert.equal(tombstone.revision,5);assert.equal(tombstone.data,undefined);assert.equal(tombstone.version_key,undefined);
 const attempted=structuredClone(c);attempted.revision=6;await assert.rejects(write(f,attempted,5),code('REVISION_CONFLICT'));
 attempted.revision=1;await assert.rejects(write(f,attempted,0),code('REVISION_CONFLICT'));
});

test('case deletion requires current teacher approval, assignment and authorship',async()=>{
 for(const mutate of [f=>{f.profiles.get(ids.teacher).approved=false},f=>{f.profiles.get(ids.teacher).role='학생'},f=>{f.config.assignments[0].active=false},f=>{f.config.students[0].active=false},f=>{f.config.assignments=[]}]){
  const f=fixture(),c=sample();await write(f,c);mutate(f);f.store.seed('configuration/v1',f.config);
  await assert.rejects(remove(f,c),code('ACCESS_DENIED'));assert.equal((await get(f,c.id))[0].data.id,c.id);assert.ok(!f.store.calls.some(call=>call.method==='delete'));
 }
 const f=fixture(),c=sample();await write(f,c);
 f.config.assignments.push({student_id:ids.student,teacher_user_id:ids.manager,active:true});f.store.seed('configuration/v1',f.config);
 for(const actor of [ids.manager,ids.studentUser])await assert.rejects(remove(f,c,1,actor),code('ACCESS_DENIED'));
 assert.deepEqual((await get(f,c.id))[0].data,c);
});

test('stale deletion leaves the current version and history intact',async()=>{
 const f=fixture(),c=sample();await write(f,c);c.revision=2;await write(f,c,1);
 await assert.rejects(remove(f,c,1),code('REVISION_CONFLICT'));assert.deepEqual((await get(f,c.id))[0].data,c);assert.ok(!f.store.calls.some(call=>call.method==='delete'));
});

test('an edit winning the head race prevents deletion and history cleanup',async()=>{
 const f=fixture(),c=sample();await write(f,c);const edited=structuredClone(c);edited.revision=2;edited.sessions[0].topic='새 버전';
 f.store.beforeSet=async(key,payload)=>{if(key.endsWith('/head')&&JSON.parse(payload).deleted){f.store.beforeSet=null;await write(f,edited,1);}return null;};
 await assert.rejects(remove(f,c),code('REVISION_CONFLICT'));assert.deepEqual((await get(f,c.id))[0].data,edited);assert.ok(!f.store.calls.some(call=>call.method==='delete'));
});

test('a late in-flight edit cannot resurrect a deleted case or leave its contents behind',async()=>{
 const f=fixture(),c=sample();await write(f,c);const edited=structuredClone(c);edited.revision=2;
 f.store.beforeSet=async key=>{if(key.includes('/versions/')){f.store.beforeSet=null;await remove(f,c);}return null;};
 await assert.rejects(write(f,edited,1),code('REVISION_CONFLICT'));assert.deepEqual(await get(f,c.id),[]);assert.deepEqual(await list(f),[]);
 assert.ok(![...f.store.entries.keys()].some(key=>key.startsWith(`cases/${c.id}/versions/`)));
});

test('deletion rechecks school approval immediately before publishing its tombstone',async()=>{
 const f=fixture(),c=sample();await write(f,c);const read=f.store.getWithMetadata.bind(f.store);
 f.store.getWithMetadata=async(key,options)=>{const result=await read(key,options);if(key.includes('/versions/'))f.profiles.get(ids.teacher).approved=false;return result;};
 await assert.rejects(remove(f,c),code('ACCESS_DENIED'));assert.equal(f.store.entries.get(`cases/${c.id}/head`).data.deleted,undefined);assert.ok(!f.store.calls.some(call=>call.method==='delete'));
});

test('history cleanup failures never claim successful deletion and can be retried without resurrection',async()=>{
 const f=fixture(),c=sample();await write(f,c);const purge=f.store.delete.bind(f.store);f.store.delete=async()=>{throw Error('synthetic storage failure');};
 await assert.rejects(remove(f,c),/synthetic storage failure/);assert.deepEqual(await get(f,c.id),[]);assert.deepEqual(await list(f),[]);
 f.store.delete=purge;assert.deepEqual(await remove(f,c),{deleted:true,id:c.id});assert.ok(![...f.store.entries.keys()].some(key=>key.startsWith(`cases/${c.id}/versions/`)));
});

test('HTTP deletion retries a failed Blobs purge with the original revision and renewed authorization',async t=>{
 const f=fixture(),c=sample(),other=sample();await write(f,c);await write(f,other);
 const handler=require('../netlify/functions/_lib/handlers/counseling-cases').handler;
 const original={query:S.query,fetch:global.fetch,env:Object.fromEntries(['COUNSELING_STORAGE','SUPABASE_URL','SUPABASE_SERVICE_KEY'].map(key=>[key,process.env[key]]))};
 t.after(()=>{S.query=original.query;global.fetch=original.fetch;for(const [key,value]of Object.entries(original.env))if(value===undefined)delete process.env[key];else process.env[key]=value;});
 process.env.COUNSELING_STORAGE='blobs';process.env.SUPABASE_URL='https://synthetic.invalid';process.env.SUPABASE_SERVICE_KEY='synthetic-only';
 S.query=(path,options)=>f.adapter.query(path,options);
 let actor=ids.teacher;
 global.fetch=async raw=>{const url=new URL(raw);assert.equal(url.origin,'https://synthetic.invalid');if(url.pathname==='/auth/v1/user')return Response.json({id:ids.auth});assert.equal(url.pathname,'/rest/v1/users');return Response.json([{...f.profiles.get(actor),google_id:ids.auth,name:'합성 교사'}]);};
 const request=(method='DELETE',revision=c.revision)=>({httpMethod:method==='LIST'?'GET':method,headers:{authorization:'Bearer synthetic-only'},queryStringParameters:method==='LIST'?{}:{id:c.id},body:JSON.stringify({revision})});
 const purge=f.store.delete.bind(f.store);f.store.delete=async()=>{throw Error('synthetic purge failure');};
 assert.equal((await handler(request())).statusCode,503);assert.equal((await handler(request('GET'))).statusCode,404);
 const duringFailure=await handler(request('LIST'));assert.equal(duringFailure.statusCode,200);assert.deepEqual(JSON.parse(duringFailure.body).cases.map(row=>row.id),[other.id]);
 assert.equal((await handler(request('DELETE',c.revision+1))).statusCode,409);
 actor=ids.manager;assert.equal((await handler(request())).statusCode,403);actor=ids.teacher;
 f.config.assignments[0].active=false;f.store.seed('configuration/v1',f.config);assert.equal((await handler(request())).statusCode,403);
 f.config.assignments[0].active=true;f.store.seed('configuration/v1',f.config);f.profiles.get(ids.teacher).approved=false;assert.equal((await handler(request())).statusCode,403);
 f.profiles.get(ids.teacher).approved=true;f.store.delete=purge;
 // Reloading the ordinary list recovers cleanup without a selected card,
 // deletion dialog or client-held original revision.
 const reloaded=await handler(request('LIST'));assert.equal(reloaded.statusCode,200);assert.deepEqual(JSON.parse(reloaded.body).cases.map(row=>row.id),[other.id]);
 assert.ok(![...f.store.entries.keys()].some(key=>key.startsWith(`cases/${c.id}/versions/`)));assert.ok(!f.store.entries.has(`student-cases/${ids.student}/${c.id}`));
 const response=await handler(request());assert.equal(response.statusCode,200);assert.deepEqual(JSON.parse(response.body),{deleted:true,id:c.id});
 assert.ok(![...f.store.entries.keys()].some(key=>key.startsWith(`cases/${c.id}/versions/`)));
 assert.equal((await handler(request())).statusCode,200);
});

test('automatic deletion recovery requires the original teacher and current school approval and assignment',async()=>{
 const f=fixture(),c=sample();await write(f,c);const purge=f.store.delete.bind(f.store);f.store.delete=async()=>{throw Error('synthetic purge failure');};await assert.rejects(remove(f,c));f.store.delete=purge;
 f.config.assignments.push({student_id:ids.student,teacher_user_id:ids.manager,active:true});f.store.seed('configuration/v1',f.config);
 for(const actor of [undefined,ids.studentUser,ids.manager]){assert.deepEqual(await list(f,actor),[]);assert.deepEqual(await get(f,c.id,actor),[]);}
 f.config.assignments[0].active=false;f.store.seed('configuration/v1',f.config);assert.deepEqual(await get(f,c.id,ids.teacher),[]);
 f.config.assignments[0].active=true;f.store.seed('configuration/v1',f.config);f.profiles.get(ids.teacher).approved=false;assert.deepEqual(await list(f,ids.teacher),[]);
 f.profiles.get(ids.teacher).approved=true;f.profiles.get(ids.teacher).role='학생';assert.deepEqual(await list(f,ids.teacher),[]);
 assert.ok(!f.store.calls.some(call=>call.method==='delete'));assert.ok(f.store.entries.has(`student-cases/${ids.student}/${c.id}`));
 f.profiles.get(ids.teacher).role='교사';assert.deepEqual(await get(f,c.id,ids.teacher),[]);
 assert.ok(!f.store.entries.has(`student-cases/${ids.student}/${c.id}`));assert.ok(![...f.store.entries.keys()].some(key=>key.startsWith(`cases/${c.id}/versions/`)));
});

test('automatic purge caps histories per request and continues on the next ordinary list',async()=>{
 const f=fixture(),cases=Array.from({length:6},sample);for(const c of cases)await write(f,c);
 const purge=f.store.delete.bind(f.store);f.store.delete=async()=>{throw Error('synthetic purge failure');};for(const c of cases)await assert.rejects(remove(f,c));f.store.delete=purge;
 assert.deepEqual(await list(f,ids.teacher),[]);
 assert.equal([...f.store.entries.keys()].filter(key=>key.startsWith(`student-cases/${ids.student}/`)).length,1);
 assert.equal(f.store.calls.filter(call=>call.method==='delete'&&call.key.includes('/versions/')).length,5);
 assert.deepEqual(await list(f,ids.teacher),[]);assert.ok(![...f.store.entries.keys()].some(key=>key.includes('/versions/')||key.startsWith('student-cases/')));
});

test('automatic purge limits version removals and keeps discovery until all historical bodies are removed',async()=>{
 const f=fixture(),c=sample();await write(f,c);
 for(let index=0;index<105;index++)f.store.seed(`cases/${c.id}/versions/orphan-${index}`,{data:{topic:'synthetic historic body'}});
 const purge=f.store.delete.bind(f.store);f.store.delete=async()=>{throw Error('synthetic purge failure');};await assert.rejects(remove(f,c));f.store.delete=purge;
 assert.deepEqual(await list(f,ids.teacher),[]);assert.equal(f.store.calls.filter(call=>call.method==='delete'&&call.key.includes('/versions/')).length,100);
 assert.ok(f.store.entries.has(`student-cases/${ids.student}/${c.id}`));assert.equal([...f.store.entries.keys()].filter(key=>key.includes('/versions/')).length,6);
 assert.deepEqual(await list(f,ids.teacher),[]);assert.ok(!f.store.entries.has(`student-cases/${ids.student}/${c.id}`));assert.ok(![...f.store.entries.keys()].some(key=>key.includes('/versions/')));
});
test('storage choice is explicit: default blobs, optional SQL, no unknown fallback',()=>{const prior=process.env.COUNSELING_STORAGE;delete process.env.COUNSELING_STORAGE;assert.equal(S.mode(),'blobs');process.env.COUNSELING_STORAGE='supabase';assert.equal(S.mode(),'supabase');process.env.COUNSELING_STORAGE='unknown';assert.throws(()=>S.mode(),code('STORAGE_CONFIG'));if(prior===undefined)delete process.env.COUNSELING_STORAGE;else process.env.COUNSELING_STORAGE=prior;});
test('strict transport rejects conditional-write 503 before SDK false success',async()=>{
 for(const status of [400,401,403,404,429,500,503])await assert.rejects(S.strictFetch(async()=>new Response('',{status}))('https://synthetic.invalid',{method:'PUT'}),code('STORAGE_UNAVAILABLE'));
 for(const status of [200,201,204,412])assert.equal((await S.strictFetch(async()=>new Response(status===204?null:'',{status}))('https://synthetic.invalid',{method:'PUT'})).status,status);
 assert.equal((await S.strictFetch(async()=>new Response('',{status:404}))('https://synthetic.invalid')).status,404);
});
test('SDK-like modified true with missing ETag is never treated as stored',async()=>{const f=fixture();f.store.beforeSet=async()=>({modified:true,etag:''});await assert.rejects(write(f,sample()),code('STORAGE_UNAVAILABLE'));assert.equal(f.store.entries.size,1);});
test('missing configuration is read-only until verified bootstrap',async()=>{const f=fixture({seed:false});assert.deepEqual(await f.adapter.query('counseling_roles?select=role'),[]);assert.equal(f.store.entries.size,0);});
test('bootstrap requires verified fixed administrator identity and existing approved profile',async()=>{
 const school={id:ids.manager,google_id:ids.auth,role:'교사',approved:true};
 const me={id:ids.auth,email:'drhong81@gmail.com',email_confirmed_at:'2026-09-12T00:00:00Z'};
 for(const [identity,profile]of [[{...me,email:'other@example.invalid'},school],[{...me,email_confirmed_at:null},school],[me,{...school,approved:false}],[me,{...school,google_id:ids.other}]]){
  const f=fixture({seed:false});await f.adapter.bootstrap(identity,profile);assert.equal(f.store.entries.size,0);
 }
 const f=fixture({seed:false});await f.adapter.bootstrap(me,school);let data=(await f.adapter.readConfig()).data;
 assert.deepEqual(data.roles.map(r=>r.role),['manager','teacher']);assert.equal(data.audit.length,1);
 data.roles=data.roles.map(r=>({...r,approved:false}));f.store.seed('configuration/v1',data);
 await f.adapter.bootstrap(me,school);data=(await f.adapter.readConfig()).data;assert.ok(data.roles.every(r=>!r.approved));assert.equal(data.audit.length,1);
});
test('configuration CAS preserves concurrent role and assignment updates atomically with audit',async()=>{
 const f=fixture();await Promise.all([admin(f,{action:'role',user_id:ids.other,role:'student',approved:true}),admin(f,{action:'assign',student_id:ids.student,teacher_user_id:ids.teacher,active:false})]);
 const data=(await f.adapter.readConfig()).data;assert.equal(data.audit.length,2);assert.ok(data.roles.some(r=>r.user_id===ids.other&&r.approved));assert.equal(data.assignments[0].active,false);
});
test('configuration conflict exhaustion returns 409 without changing the old data',async()=>{const f=fixture();f.store.beforeSet=async()=>({modified:false});await assert.rejects(admin(f,{action:'role',user_id:ids.other,role:'student',approved:true}),code('REVISION_CONFLICT'));assert.deepEqual((await f.adapter.readConfig()).data,f.config);});
test('manager and target school profiles are freshly rechecked before grants',async()=>{
 const f=fixture();f.profiles.get(ids.manager).approved=false;await assert.rejects(admin(f,{action:'role',user_id:ids.other,role:'student',approved:true}),code('ACCESS_DENIED'));
 f.profiles.get(ids.manager).approved=true;await assert.rejects(admin(f,{action:'role',user_id:ids.other,role:'teacher',approved:true}),code('ACCESS_DENIED'));assert.equal((await f.adapter.readConfig()).data.audit.length,0);
});
test('school-approved teacher can be assigned without a counseling role',async()=>{
 const f=fixture();f.config.roles=f.config.roles.filter(r=>r.user_id!==ids.teacher);f.config.assignments=[];f.store.seed('configuration/v1',f.config);
 await admin(f,{action:'assign',student_id:ids.student,teacher_user_id:ids.teacher,active:true});
 const data=(await f.adapter.readConfig()).data;assert.equal(data.assignments[0].teacher_user_id,ids.teacher);assert.ok(!data.roles.some(r=>r.user_id===ids.teacher));
 const c=sample();await write(f,c);assert.deepEqual((await get(f,c.id))[0].data,c);
});
test('school approval never creates manager access for an ordinary teacher',async()=>{
 const f=fixture();await assert.rejects(f.adapter.query('rpc/counseling_administer',{method:'POST',data:{p_actor:ids.teacher,p_input:{action:'role',user_id:ids.teacher,role:'manager',approved:true}}}),code('ACCESS_DENIED'));
 assert.equal((await f.adapter.readConfig()).data.audit.length,0);
});
test('assignment rejects unapproved teachers, students and parents without modifying configuration',async()=>{
 for(const changed of [{approved:false},{approved:null},{role:'학생'},{role:'학부모'}]){
  const f=fixture();Object.assign(f.profiles.get(ids.teacher),changed);
  await assert.rejects(admin(f,{action:'assign',student_id:ids.student,teacher_user_id:ids.teacher,active:true}),code('ACCESS_DENIED'));
  assert.deepEqual((await f.adapter.readConfig()).data,f.config);
 }
});
test('student account keeps fixed ID across academic years and numbers stay unique',async()=>{
 const f=fixture();const result=await admin(f,{action:'student',user_id:ids.studentUser,student_id:ids.student,student_number:'20101',academic_year:2027,school_stage:'high',grade:2,name:'합성 학생'});assert.equal(result.student_id,ids.student);
 const data=(await f.adapter.readConfig()).data;assert.equal(data.students.length,1);assert.equal(data.numbers.length,2);
 await assert.rejects(admin(f,{action:'student',user_id:ids.other,student_number:'10101',academic_year:2026,school_stage:'high',grade:1,name:'합성 다른 학생'}),code('DUPLICATE'));
});
test('known queries apply exact filters and reject arbitrary table fields or predicates',async()=>{
 const f=fixture();const rows=await f.adapter.query(`counseling_assignments?teacher_user_id=eq.${ids.teacher}&active=eq.true&select=student_id`);assert.deepEqual(rows,[{student_id:ids.student}]);
 for(const path of ['counseling_roles?select=*','counseling_roles?select=role&or=(approved.eq.true)','counseling_unknown?select=role','counseling_roles?select=role&user_id=eq.not-a-uuid','counseling_roles?select=role&select=user_id'])await assert.rejects(f.adapter.query(path),code('UNSUPPORTED_STORAGE_QUERY'));
});
test('case creation publishes a head only after the immutable version and index',async()=>{
 const f=fixture(),c=sample();await write(f,c);assert.deepEqual((await get(f,c.id))[0].data,c);assert.equal((await list(f)).length,1);
 const writes=f.store.calls.filter(c=>c.method==='set').map(c=>c.key);assert.ok(writes[0].includes('/versions/'));assert.ok(writes[1].startsWith('student-cases/'));assert.ok(writes[2].endsWith('/head'));
 assert.ok(f.store.calls.filter(c=>c.method==='get').every(c=>c.options.consistency==='strong'));
 await assert.rejects(write(f,c),code('REVISION_CONFLICT'));
});
test('teacher saves and updates assigned cases without explicit service approval',async()=>{
 for(const approved of [undefined,false]){
  const f=fixture();f.config.roles=f.config.roles.filter(r=>r.user_id!==ids.teacher);
  if(approved!==undefined)f.config.roles.push({user_id:ids.teacher,role:'teacher',approved});
  f.store.seed('configuration/v1',f.config);
  const c=sample();await write(f,c);c.revision=2;c.sessions[0].topic='학교 승인 교사의 전략 수정';await write(f,c,1);
  assert.deepEqual((await get(f,c.id))[0].data,c);assert.equal((await f.adapter.readConfig()).data.roles.filter(r=>r.user_id===ids.teacher).length,approved===undefined?0:1);
 }
});
test('concurrent edits have one winner and one 409 with immutable previous chain',async()=>{
 const f=fixture(),c=sample();await write(f,c);const edits=['first','second'].map(topic=>{const next=structuredClone(c);next.revision=2;next.sessions[0].topic=topic;return next;});
 const results=await Promise.allSettled(edits.map(next=>write(f,next,1)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.ok(results.some(r=>r.status==='rejected'&&r.reason.code==='REVISION_CONFLICT'));
 const entry=f.store.entries.get(`cases/${c.id}/head`).data,version=f.store.entries.get(entry.version_key).data;
 assert.equal(version.revision,2);assert.equal(f.store.entries.get(version.previous_key).data.revision,1);assert.equal((await list(f)).length,1);
});
test('head CAS failure leaves only unlinked data and does not expose the case',async()=>{
 const f=fixture(),c=sample();f.store.beforeSet=async key=>key.endsWith('/head')?{modified:false}:null;
 await assert.rejects(write(f,c),code('REVISION_CONFLICT'));assert.deepEqual(await get(f,c.id),[]);assert.deepEqual(await list(f),[]);assert.ok([...f.store.entries.keys()].some(k=>k.includes('/versions/')));
});
test('revoked assignment between version write and publishing blocks the head',async()=>{
 const f=fixture(),c=sample();f.store.beforeSet=async key=>{if(key.includes('/versions/')){const config=f.store.entries.get('configuration/v1').data;config.assignments[0].active=false;f.store.seed('configuration/v1',config);}return null;};
 await assert.rejects(write(f,c),code('ACCESS_DENIED'));assert.deepEqual(await list(f),[]);
});
test('revoked school approval before publishing blocks implicit teacher saves',async()=>{
 const f=fixture(),c=sample();f.config.roles=f.config.roles.filter(r=>r.user_id!==ids.teacher);f.store.seed('configuration/v1',f.config);
 f.store.beforeSet=async key=>{if(key.includes('/versions/'))f.profiles.get(ids.teacher).approved=false;return null;};
 await assert.rejects(write(f,c),code('ACCESS_DENIED'));assert.deepEqual(await get(f,c.id),[]);assert.deepEqual(await list(f),[]);
});
test('implicit teacher still needs an active student and current assignment to save',async()=>{
 for(const mutation of [data=>{data.assignments=[]},data=>{data.assignments[0].active=false},data=>{data.students[0].active=false}]){
  const f=fixture();f.config.roles=f.config.roles.filter(r=>r.user_id!==ids.teacher);mutation(f.config);f.store.seed('configuration/v1',f.config);
  await assert.rejects(write(f,sample()),code('ACCESS_DENIED'));assert.equal(f.store.entries.size,1);
 }
});
test('null approval and non-teacher membership cannot write despite stale teacher grant',async()=>{
 for(const changed of [{approved:null},{role:'학생'},{role:'학부모'}]){
  const f=fixture();Object.assign(f.profiles.get(ids.teacher),changed);await assert.rejects(write(f,sample()),code('ACCESS_DENIED'));assert.equal(f.store.entries.size,1);
 }
});
test('school role change, unassigned student, and local-only payload cannot be saved',async()=>{
 const f=fixture(),c=sample();f.profiles.get(ids.teacher).approved=false;await assert.rejects(write(f,c),code('ACCESS_DENIED'));f.profiles.get(ids.teacher).approved=true;
 const other=structuredClone(c);other.student.student_id=ids.other;await assert.rejects(write(f,other),code('ACCESS_DENIED'));
 c.privacy='local_only';await assert.rejects(write(f,c),code('INVALID_CASE'));assert.equal(f.store.entries.size,1);
});
test('missing or corrupt version never degrades into an empty successful response',async()=>{
 const f=fixture(),c=sample();await write(f,c);const key=f.store.entries.get(`cases/${c.id}/head`).data.version_key;f.store.entries.delete(key);await assert.rejects(get(f,c.id),code('STORAGE_UNAVAILABLE'));
});
test('corrupt configuration never gets silently replaced or bootstrapped',async()=>{const f=fixture();f.store.seed('configuration/v1',{schema_version:1,revision:1});await assert.rejects(f.adapter.readConfig(),code('STORAGE_UNAVAILABLE'));});

const manualInput=()=>({name:'직접 등록 학생',student_number:'10102',academic_year:2026,school_stage:'high',grade:1});
const createStudent=(f,input=manualInput(),actor=ids.teacher)=>f.adapter.query('rpc/counseling_create_student',{method:'POST',data:{p_actor:actor,p_input:input}});

test('approved teacher creates a student without an account and immediately saves strategy',async()=>{
 const f=fixture({seed:false}),student=await createStudent(f),data=(await f.adapter.readConfig()).data;
 assert.deepEqual(student,{student_id:data.students[0].id,...manualInput(),account_linked:false});
 assert.equal(data.students[0].user_id,null);assert.equal(data.students[0].created_by,ids.teacher);
 assert.deepEqual(data.numbers,[{student_id:student.student_id,academic_year:2026,student_number:'10102',school_stage:'high',grade:1}]);
 assert.equal(data.assignments.length,1);assert.equal(data.assignments[0].teacher_user_id,ids.teacher);assert.equal(data.assignments[0].active,true);
 assert.deepEqual(data.roles,[]);assert.equal(data.audit.length,1);assert.equal(data.audit[0].actor_id,ids.teacher);assert.equal(data.audit[0].action,'create_student');
 assert.equal(f.store.calls.filter(c=>c.method==='set'&&c.key==='configuration/v1').length,1);
 const c=C.newCase(student,{id:ids.teacher,display_name:'합성 교사'});assert.equal(Object.hasOwn(c.student,'account_linked'),false);await write(f,c);assert.deepEqual((await get(f,c.id))[0].data,c);
 assert.deepEqual(await f.adapter.query(`counseling_students?user_id=eq.${ids.studentUser}&active=eq.true&select=id`),[]);
});

test('student creation rejects non-teachers and revoked or missing school approval',async()=>{
 for(const changed of [{approved:false},{approved:null},{role:'학생'},{role:'학부모'}]){
  const f=fixture();Object.assign(f.profiles.get(ids.teacher),changed);
  await assert.rejects(createStudent(f),code('ACCESS_DENIED'));assert.deepEqual((await f.adapter.readConfig()).data,f.config);
 }
 const f=fixture();f.profiles.delete(ids.teacher);await assert.rejects(createStudent(f),code('ACCESS_DENIED'));
});

test('student registration rejects invalid fields and identity or access injection',async()=>{
 const invalid=[{name:''},{name:' '.repeat(3)},{name:'x'.repeat(81)},{name:'a\nb'},{student_number:'123'},{student_number:'123456789'},{student_number:10102},{academic_year:2019},{academic_year:2101},{academic_year:'2026'},{academic_year:2026.1},{school_stage:'university'},{grade:0},{grade:4},{grade:'1'},...['actor','p_actor','user_id','student_id','teacher_user_id','created_by','approved','active','role'].map(key=>({[key]:ids.manager}))];
 for(const fields of invalid){const f=fixture();await assert.rejects(createStudent(f,{...manualInput(),...fields}),error=>error instanceof S.StorageError&&error.status===400);assert.deepEqual((await f.adapter.readConfig()).data,f.config);}
 const f=fixture(),student=await createStudent(f,{...manualInput(),name:' 직접 등록 학생 ',student_number:' 10102 '});assert.equal(student.name,manualInput().name);assert.equal(student.student_number,'10102');
});

test('same teacher retries are idempotent, including concurrent duplicate submissions',async()=>{
 const f=fixture(),results=await Promise.all([createStudent(f),createStudent(f)]);
 assert.deepEqual(results[0],results[1]);assert.deepEqual(await createStudent(f),results[0]);
 const data=(await f.adapter.readConfig()).data;assert.equal(data.students.length,2);assert.equal(data.numbers.length,2);assert.equal(data.assignments.length,2);assert.equal(data.audit.length,1);
 await assert.rejects(createStudent(f,{...manualInput(),name:'다른 이름'}),code('DUPLICATE'));
 await assert.rejects(createStudent(f,{...manualInput(),grade:2}),code('DUPLICATE'));
 await assert.rejects(createStudent(f,{...manualInput(),school_stage:'middle'}),code('DUPLICATE'));
 assert.deepEqual((await f.adapter.readConfig()).data,data);
});

test('existing member student is never adopted, even when already assigned to the creator',async()=>{
 const f=fixture();await assert.rejects(createStudent(f,{...manualInput(),name:'합성 학생',student_number:'10101'}),error=>code('DUPLICATE')(error)&&!error.message.includes('합성 학생')&&!error.message.includes(ids.student));
 assert.deepEqual((await f.adapter.readConfig()).data,f.config);
});

test('teacher cannot acquire another teacher manual student, even with matching input',async()=>{
 const f=fixture(),student=await createStudent(f),previous=(await f.adapter.readConfig()).data;
 await assert.rejects(createStudent(f,manualInput(),ids.manager),code('DUPLICATE'));assert.deepEqual((await f.adapter.readConfig()).data,previous);
 const c=C.newCase(student,{id:ids.manager,display_name:'다른 교사'});
 await assert.rejects(f.adapter.query('rpc/counseling_write_case',{method:'POST',data:{p_actor:ids.manager,p_case:c,p_expected:0,p_action:'create'}}),code('ACCESS_DENIED'));
});

test('retry never reactivates a revoked student or assignment',async()=>{
 for(const revoke of [data=>{data.assignments.at(-1).active=false},data=>{data.assignments.pop()},data=>{data.students.at(-1).active=false}]){
  const f=fixture();await createStudent(f);const data=(await f.adapter.readConfig()).data;revoke(data);f.store.seed('configuration/v1',data);
  await assert.rejects(createStudent(f),code('DUPLICATE'));assert.deepEqual((await f.adapter.readConfig()).data,data);
 }
});

test('concurrent teachers creating the same number produce one owner and one non-disclosing 409',async()=>{
 const f=fixture(),results=await Promise.allSettled([createStudent(f),createStudent(f,manualInput(),ids.manager)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='DUPLICATE').length,1);
 const data=(await f.adapter.readConfig()).data;assert.equal(data.students.length,2);assert.equal(data.assignments.length,2);assert.equal(data.audit.length,1);assert.equal(data.students.at(-1).created_by,data.assignments.at(-1).teacher_user_id);
});

test('concurrent different student registrations both survive configuration CAS',async()=>{
 const f=fixture(),students=await Promise.all([createStudent(f),createStudent(f,{...manualInput(),student_number:'10103'})]);
 const data=(await f.adapter.readConfig()).data;assert.notEqual(students[0].student_id,students[1].student_id);assert.equal(data.students.length,3);assert.equal(data.numbers.length,3);assert.equal(data.assignments.length,3);assert.equal(data.audit.length,2);
});

test('failed registration CAS and storage failures never leave a student or assignment behind',async()=>{
 for(const [result,expected]of [[{modified:false},'REVISION_CONFLICT'],[{modified:true,etag:''},'STORAGE_UNAVAILABLE']]){
  const f=fixture();f.store.beforeSet=async()=>result;await assert.rejects(createStudent(f),code(expected));assert.deepEqual((await f.adapter.readConfig()).data,f.config);
 }
});

test('registration rechecks school approval when a conflicting write forces a retry',async()=>{
 const f=fixture();f.store.beforeSet=async()=>{f.profiles.get(ids.teacher).approved=false;return {modified:false};};
 await assert.rejects(createStudent(f),code('ACCESS_DENIED'));assert.deepEqual((await f.adapter.readConfig()).data,f.config);
});
