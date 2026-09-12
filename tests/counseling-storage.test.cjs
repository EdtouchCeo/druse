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
const get=(f,id)=>f.adapter.query(`counseling_cases?id=eq.${id}&select=data,student_id&limit=1`);
const list=f=>f.adapter.query(`counseling_cases?student_id=in.(${ids.student})&select=data&order=updated_at.desc&limit=200`);
const code=expected=>error=>error instanceof S.StorageError&&error.code===expected;
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
test('school role change, unassigned student, and local-only payload cannot be saved',async()=>{
 const f=fixture(),c=sample();f.profiles.get(ids.teacher).approved=false;await assert.rejects(write(f,c),code('ACCESS_DENIED'));f.profiles.get(ids.teacher).approved=true;
 const other=structuredClone(c);other.student.student_id=ids.other;await assert.rejects(write(f,other),code('ACCESS_DENIED'));
 c.privacy='local_only';await assert.rejects(write(f,c),code('INVALID_CASE'));assert.equal(f.store.entries.size,1);
});
test('missing or corrupt version never degrades into an empty successful response',async()=>{
 const f=fixture(),c=sample();await write(f,c);const key=f.store.entries.get(`cases/${c.id}/head`).data.version_key;f.store.entries.delete(key);await assert.rejects(get(f,c.id),code('STORAGE_UNAVAILABLE'));
});
test('corrupt configuration never gets silently replaced or bootstrapped',async()=>{const f=fixture();f.store.seed('configuration/v1',{schema_version:1,revision:1});await assert.rejects(f.adapter.readConfig(),code('STORAGE_UNAVAILABLE'));});
