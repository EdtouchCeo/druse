'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const crypto=require('node:crypto');
const context=new AsyncLocalStorage();
const STORE_NAME='daeryun-counseling-v1';
const ADMIN_EMAIL='drhong81@gmail.com';
const CONFIG_KEY='configuration/v1';
const MAX_CONFIG_BYTES=10*1024*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class StorageError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const fail=(status,code,message)=>{throw new StorageError(status,code,message);};
const conflict=()=>fail(409,'REVISION_CONFLICT','다른 요청에서 변경되었습니다. 최신 기록을 다시 불러와 주세요.');
const unavailable=(diagnostic='INVALID_RESPONSE')=>{const error=new StorageError(503,'STORAGE_UNAVAILABLE','상담 저장소를 확인하지 못했습니다. 저장 완료로 처리하지 않았습니다.');error.storageDiagnostic=diagnostic;throw error;};
const uuid=value=>typeof value==='string'&&UUID.test(value);
const now=()=>new Date().toISOString();
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const emptyConfig=()=>({schema_version:1,revision:0,bootstrap:null,roles:[],students:[],numbers:[],assignments:[],audit:[]});

function mode(){const value=process.env.COUNSELING_STORAGE||'blobs';if(!['blobs','supabase'].includes(value))fail(503,'STORAGE_CONFIG','상담 저장소 설정을 확인해 주세요.');return value;}
function handles(path){return /^(?:counseling_|rpc\/counseling_)/.test(path);}
function withEvent(event,callback){return context.run({event},callback);}

function diagnostic(error){
 // Only fixed categories may reach the public health response. Never expose
 // error.message, stack, URL, headers, SDK context, identifiers or credentials.
 const names=[error?.name,error?.constructor?.name];
 if(names.includes('MissingBlobsEnvironmentError'))return 'PLATFORM_CONTEXT_MISSING';
 if(names.includes('BlobsConsistencyError'))return 'STRONG_CONTEXT_MISSING';
 if(['MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND'].includes(error?.code))return 'SDK_MODULE_MISSING';
 if(['AbortError','TimeoutError'].some(name=>names.includes(name)))return 'TRANSPORT_TIMEOUT';
 if(['ENOTFOUND','ECONNRESET','ECONNREFUSED','ETIMEDOUT'].includes(error?.cause?.code))return 'TRANSPORT_NETWORK';
 if(error instanceof StorageError&&['HTTP_400','HTTP_401','HTTP_403','HTTP_404','HTTP_429','HTTP_500','HTTP_502','HTTP_503','HTTP_504','INVALID_RESPONSE'].includes(error.storageDiagnostic))return error.storageDiagnostic;
 if(error?.code==='STORAGE_CONFIG')return 'STORAGE_MODE_INVALID';
 return 'STORAGE_UNCLASSIFIED';
}

function strictFetch(fetcher=globalThis.fetch){return async(input,options={})=>{
 const response=await fetcher(input,options);
 const method=String(options.method||input?.method||'GET').toUpperCase();
 const allowed=method==='GET'||method==='HEAD'?[200,304,404]:method==='PUT'?[200,201,204,412]:method==='DELETE'?[200,204,404]:[200,201,204];
 // SDK conditional writes currently misreport non-412 failures as successful.
 // Reject those responses before the SDK can turn them into modified:true.
 if(!allowed.includes(response.status))unavailable(`HTTP_${response.status}`);
 return response;
};}

function platformStore(){
 // Native Netlify Functions supply the complete request-scoped Blobs context.
 // Do not call connectLambda: SDK 11.0.3 drops uncachedEdgeURL and breaks strong reads.
 const {getStore}=require('./vendor/netlify-blobs.cjs');
 return getStore({name:STORE_NAME,consistency:'strong',fetch:strictFetch()});
}
function currentAdapter(supabase){
 const scope=context.getStore();if(!scope)fail(503,'STORAGE_CONTEXT','상담 실행 환경을 확인하지 못했습니다.');
 if(!scope.adapter)scope.adapter=createAdapter(platformStore(scope.event),supabase);
 return scope.adapter;
}
function query(path,options,supabase){return currentAdapter(supabase).query(path,options);}
async function bootstrap(me,profile,supabase){if(mode()==='blobs')await currentAdapter(supabase).bootstrap(me,profile);}

function createAdapter(store,supabase){
 async function read(key){
  const entry=await store.getWithMetadata(key,{type:'json',consistency:'strong'});
  if(entry===null)return null;
  if(!entry||!entry.data||typeof entry.data!=='object'||Array.isArray(entry.data)||typeof entry.etag!=='string'||!entry.etag)unavailable();
  return entry;
 }
 async function write(key,value,etag){
  const result=await store.set(key,JSON.stringify(value),etag?{onlyIfMatch:etag}:{onlyIfNew:true});
  if(result?.modified===false)return false;
  if(result?.modified!==true||typeof result.etag!=='string'||!result.etag)unavailable();
  return true;
 }
 async function config(){
  const entry=await read(CONFIG_KEY);
  if(entry&&(entry.data.schema_version!==1||!Number.isInteger(entry.data.revision)||['roles','students','numbers','assignments','audit'].some(key=>!Array.isArray(entry.data[key]))))unavailable();
  return entry||{data:emptyConfig(),etag:null};
 }
 async function changeConfig(change){
  for(let attempt=0;attempt<4;attempt++){
   const previous=await config(),next=structuredClone(previous.data);
   const result=await change(next);
   if(result?.unchanged)return result.value;
   next.revision=previous.data.revision+1;
   if(Buffer.byteLength(JSON.stringify(next))>MAX_CONFIG_BYTES)fail(503,'CONFIGURATION_LIMIT','상담 관리 이력의 저장 범위를 확인해 주세요. 기존 자료는 보존했습니다.');
   if(await write(CONFIG_KEY,next,previous.etag))return result;
  }
  conflict();
 }
 async function profile(id,requiredRole){
  if(!uuid(id))fail(403,'ACCESS_DENIED','상담 계정을 확인해 주세요.');
  const rows=await supabase(`users?id=eq.${id}&select=id,google_id,role,approved&limit=2`);
  if(!Array.isArray(rows)||rows.length!==1||rows[0].approved!==true||(requiredRole&&rows[0].role!==requiredRole))fail(403,'ACCESS_DENIED','학교 승인과 회원 구분을 확인해 주세요.');
  return rows[0];
 }
 function granted(data,id,role){return data.roles.some(row=>row.user_id===id&&row.role===role&&row.approved===true);}
 function accessible(data,id,studentId){return data.students.some(s=>s.id===studentId&&s.active===true)&&granted(data,id,'teacher')&&data.assignments.some(a=>a.student_id===studentId&&a.teacher_user_id===id&&a.active===true);}
 async function authorize(data,id,role){await profile(id,role==='teacher'?'교사':role==='student'?'학생':undefined);if(!granted(data,id,role))fail(403,'ACCESS_DENIED','상담 역할 승인이 필요합니다.');}
 function put(rows,match,value){const index=rows.findIndex(match);if(index<0)rows.push(value);else rows[index]=value;}
 async function bootstrapManager(me,schoolProfile){
  if(String(me?.email||'').toLowerCase()!==ADMIN_EMAIL||!me.email_confirmed_at||!uuid(me.id)||schoolProfile?.approved!==true||String(schoolProfile.google_id)!==me.id||!uuid(schoolProfile.id))return;
  await changeConfig(async data=>{
   if(data.bootstrap)return {unchanged:true};
   const fresh=await profile(schoolProfile.id);
   if(String(fresh.google_id)!==me.id)fail(403,'ACCESS_DENIED','관리자 계정 연결을 확인해 주세요.');
   const timestamp=now(),roles=['manager',...(fresh.role==='교사'?['teacher']:[])];
   for(const role of roles)put(data.roles,r=>r.user_id===fresh.id&&r.role===role,{user_id:fresh.id,role,approved:true,updated_at:timestamp});
   data.bootstrap={user_id:fresh.id,at:timestamp};
   data.audit.push({id:crypto.randomUUID(),actor_id:fresh.id,target_user_id:fresh.id,action:'bootstrap',previous:null,current_value:{roles},created_at:timestamp});
   return {ok:true};
  });
 }
 async function administer({p_actor,p_input}){
  const input=p_input;if(!input||typeof input!=='object')fail(400,'BAD_REQUEST','관리 요청을 확인해 주세요.');
  const auditId=crypto.randomUUID();
  return changeConfig(async data=>{
   await authorize(data,p_actor,'manager');
   const timestamp=now();let previous=null,target;
   if(input.action==='role'){
    target=input.user_id;
    if(!uuid(target)||!['manager','teacher','student'].includes(input.role)||typeof input.approved!=='boolean')fail(400,'BAD_REQUEST','역할 입력을 확인해 주세요.');
    if(input.approved)await profile(target,input.role==='teacher'?'교사':input.role==='student'?'학생':undefined);
    previous=data.roles.find(r=>r.user_id===target&&r.role===input.role)||null;
    put(data.roles,r=>r.user_id===target&&r.role===input.role,{user_id:target,role:input.role,approved:input.approved,updated_at:timestamp});
   }else if(input.action==='student'){
    target=input.user_id;await profile(target,'학생');
    if(!/^\d{4,8}$/.test(input.student_number||'')||!Number.isInteger(input.academic_year)||input.academic_year<2020||input.academic_year>2100||!['middle','high'].includes(input.school_stage)||![1,2,3].includes(input.grade)||typeof input.name!=='string'||input.name.length>80)fail(400,'BAD_REQUEST','학생 등록 정보를 확인해 주세요.');
    previous=data.students.find(s=>s.user_id===target)||null;
    const id=previous?.id||input.student_id||crypto.randomUUID();
    if(!uuid(id)||(previous&&input.student_id&&input.student_id!==id)||data.students.some(s=>s.id===id&&s.user_id!==target))fail(409,'STUDENT_ID_CONFLICT','등록된 학생 ID와 계정이 다릅니다.');
    if(data.numbers.some(n=>n.academic_year===input.academic_year&&n.student_number===input.student_number&&n.student_id!==id))fail(409,'DUPLICATE','같은 학년도에 이미 등록된 학번입니다.');
    put(data.students,s=>s.user_id===target,{id,user_id:target,name:input.name,active:previous?.active??true,created_at:previous?.created_at||timestamp});
    put(data.numbers,n=>n.student_id===id&&n.academic_year===input.academic_year,{student_id:id,academic_year:input.academic_year,student_number:input.student_number,school_stage:input.school_stage,grade:input.grade});
   }else if(input.action==='assign'){
    target=input.teacher_user_id;
    if(!uuid(target)||typeof input.active!=='boolean'||!data.students.some(s=>s.id===input.student_id))fail(400,'BAD_REQUEST','등록된 학생과 상담 교사를 확인해 주세요.');
    if(input.active)await authorize(data,target,'teacher');
    previous=data.assignments.find(a=>a.student_id===input.student_id&&a.teacher_user_id===target)||null;
    put(data.assignments,a=>a.student_id===input.student_id&&a.teacher_user_id===target,{student_id:input.student_id,teacher_user_id:target,active:input.active,updated_at:timestamp});
   }else fail(400,'UNKNOWN_ACTION','지원하지 않는 관리 요청입니다.');
   data.audit.push({id:auditId,actor_id:p_actor,target_user_id:target,action:input.action,previous,current_value:input,created_at:timestamp});
   return input.action==='student'?{student_id:data.students.find(s=>s.user_id===target).id}:{ok:true};
  });
 }
 async function head(id){
  if(!uuid(id))fail(400,'BAD_REQUEST','상담 ID를 확인해 주세요.');
  const entry=await read(`cases/${id}/head`);
  if(entry&&(entry.data.id!==id||!uuid(entry.data.student_id)||!Number.isInteger(entry.data.revision)||!String(entry.data.version_key).startsWith(`cases/${id}/versions/`)))unavailable();
  return entry;
 }
 async function fromHead(entry){
  const version=await read(entry.data.version_key);
  if(!version||version.data.case_id!==entry.data.id||version.data.revision!==entry.data.revision||hash(version.data)!==entry.data.version_hash)unavailable();
  return version.data;
 }
 async function writeCase({p_actor,p_case,p_expected,p_action}){
  const c=p_case,id=c?.id,studentId=c?.student?.student_id;
  if(!uuid(id)||!uuid(studentId)||!Number.isInteger(p_expected)||p_expected<0||c.revision!==p_expected+1||c.schema_version!==1||c.privacy!=='standard'||!Array.isArray(c.sessions)||!c.sessions.length||c.sessions.some(s=>!s||s.record!=null||s.analysis!=null))fail(400,'INVALID_CASE','일반 상담 저장 형식을 확인해 주세요.');
  const previous=await head(id);
  if((previous?previous.data.revision:0)!==p_expected)conflict();
  const settings=(await config()).data;
  await authorize(settings,p_actor,'teacher');
  if(!accessible(settings,p_actor,studentId))fail(403,'ACCESS_DENIED','현재 담당 학생의 상담만 저장할 수 있습니다.');
  if(previous){
   const old=(await fromHead(previous)).data;
   if(JSON.stringify(old.student)!==JSON.stringify(c.student)||JSON.stringify(old.teacher)!==JSON.stringify(c.teacher))fail(403,'IDENTITY_IMMUTABLE','상담의 학생·교사 연결은 변경할 수 없습니다.');
  }else if(c.teacher?.id!==p_actor)fail(403,'IDENTITY_MISMATCH','인증된 상담 교사만 기록할 수 있습니다.');
  const versionKey=`cases/${id}/versions/${c.revision}-${crypto.randomUUID()}`;
  const version={case_id:id,revision:c.revision,data:c,actor_id:p_actor,action:p_action,created_at:now(),previous_key:previous?.data.version_key||null};
  if(!await write(versionKey,version,null))conflict();
  if(!previous){
   // Derived discovery entries are written before publishing the head. If this
   // request fails, an entry with no head is ignored. No successful case is lost.
   await write(`student-cases/${studentId}/${id}`,{case_id:id,student_id:studentId},null);
  }
  // Check a fresh authorization snapshot immediately before publishing.
  const latest=(await config()).data;
  await authorize(latest,p_actor,'teacher');
  if(!accessible(latest,p_actor,studentId))fail(403,'ACCESS_DENIED','담당 배정이 변경되어 저장하지 않았습니다.');
  const next={schema_version:1,id,student_id:studentId,revision:c.revision,version_key:versionKey,version_hash:hash(version),updated_at:c.updated_at};
  if(!await write(`cases/${id}/head`,next,previous?.etag))conflict();
  return c;
 }
 const tables={
  counseling_roles:{key:'roles',fields:['user_id','role','approved'],filter:['user_id','role','approved']},
  counseling_students:{key:'students',fields:['id','user_id','name','active'],filter:['id','user_id','active']},
  counseling_student_numbers:{key:'numbers',fields:['student_id','academic_year','student_number','school_stage','grade'],filter:['student_id','academic_year']},
  counseling_assignments:{key:'assignments',fields:['student_id','teacher_user_id','active'],filter:['student_id','teacher_user_id','active']},
  counseling_cases:{fields:['data','student_id'],filter:['id','student_id']}
 };
 function parse(path){
  const [table,search='']=path.split('?');const spec=tables[table];if(!spec||path.split('?').length>2)fail(400,'UNSUPPORTED_STORAGE_QUERY','지원하지 않는 상담 저장소 요청입니다.');
  const params=new URLSearchParams(search),seen=new Set();
  for(const key of params.keys()){if(seen.has(key)||!['select','order','limit','offset',...spec.filter].includes(key))fail(400,'UNSUPPORTED_STORAGE_QUERY','지원하지 않는 조회 조건입니다.');seen.add(key);}
  const fields=String(params.get('select')||'').split(',');if(!fields.length||fields.some(f=>!spec.fields.includes(f)))fail(400,'UNSUPPORTED_STORAGE_QUERY','지원하지 않는 조회 항목입니다.');
  const filters=[];
  for(const field of spec.filter){
   if(!params.has(field))continue;const input=params.get(field);let values;
   if(input.startsWith('eq.'))values=[input.slice(3)];else if(input.startsWith('in.(')&&input.endsWith(')'))values=input.slice(4,-1).split(',');else fail(400,'UNSUPPORTED_STORAGE_QUERY','지원하지 않는 조회 조건입니다.');
   if(!values.length||values.length>10000)fail(400,'UNSUPPORTED_STORAGE_QUERY','조회 범위를 확인해 주세요.');
   if(field==='id'||field.endsWith('_id')){if(values.some(v=>!uuid(v)))fail(400,'UNSUPPORTED_STORAGE_QUERY','식별자 조회 조건을 확인해 주세요.');}
   else if(field==='active'||field==='approved'){if(values.some(v=>!['true','false'].includes(v)))fail(400,'UNSUPPORTED_STORAGE_QUERY','승인 조회 조건을 확인해 주세요.');}
   else if(field==='academic_year'){if(values.some(v=>!/^\d{4}$/.test(v)))fail(400,'UNSUPPORTED_STORAGE_QUERY','학년도 조회 조건을 확인해 주세요.');}
   else if(values.some(v=>!['teacher','student','manager'].includes(v)))fail(400,'UNSUPPORTED_STORAGE_QUERY','역할 조회 조건을 확인해 주세요.');
   filters.push({field,values});
  }
  const orders=params.has('order')?params.get('order').split(',').map(value=>{const [field,direction,...extra]=value.split('.');if(extra.length||![...spec.fields,'updated_at'].includes(field)||!['asc','desc'].includes(direction))fail(400,'UNSUPPORTED_STORAGE_QUERY','정렬 조건을 확인해 주세요.');return {field,direction};}):[];
  const number=(key,fallback)=>{if(!params.has(key))return fallback;const raw=params.get(key);if(!/^\d+$/.test(raw)||Number(raw)>10000)fail(400,'UNSUPPORTED_STORAGE_QUERY','조회 범위를 확인해 주세요.');return Number(raw);};
  return {table,spec,fields,filters,orders,limit:number('limit',10000),offset:number('offset',0)};
 }
 async function caseRows(filters){
  const byId=filters.find(f=>f.field==='id'),byStudent=filters.find(f=>f.field==='student_id');
  if(!byId&&!byStudent)fail(400,'UNSUPPORTED_STORAGE_QUERY','학생 또는 상담 ID가 필요합니다.');
  const ids=new Set(byId?.values||[]);
  if(!byId){
   for(const studentId of byStudent.values){
    for await(const page of store.list({prefix:`student-cases/${studentId}/`,paginate:true})){
     for(const blob of page.blobs){const id=blob.key.slice(`student-cases/${studentId}/`.length);if(uuid(id))ids.add(id);if(ids.size>10000)fail(503,'CASE_LIST_LIMIT','상담 목록 범위를 확인해 주세요.');}
    }
   }
  }
  const result=[],pending=[...ids];
  for(let start=0;start<pending.length;start+=12){
   const batch=await Promise.all(pending.slice(start,start+12).map(async id=>{
    const entry=await head(id);if(!entry||(byStudent&&!byStudent.values.includes(entry.data.student_id)))return null;
    const version=await fromHead(entry);return {id,student_id:entry.data.student_id,data:version.data,updated_at:entry.data.updated_at};
   }));
   result.push(...batch.filter(Boolean));
  }
  return result;
 }
 async function query(path,{method='GET',data}={}){
  if(path==='rpc/counseling_administer'&&method==='POST')return administer(data);
  if(path==='rpc/counseling_write_case'&&method==='POST')return writeCase(data);
  if(method!=='GET')fail(400,'UNSUPPORTED_STORAGE_QUERY','상담 변경은 지정된 API로 처리해 주세요.');
  const request=parse(path);
  let rows=request.table==='counseling_cases'?await caseRows(request.filters):(await config()).data[request.spec.key];
  rows=rows.filter(row=>request.filters.every(f=>f.values.includes(String(row[f.field]))));
  rows=[...rows].sort((a,b)=>{for(const {field,direction}of request.orders){const left=a[field],right=b[field];if(left===right)continue;return(left<right?-1:1)*(direction==='desc'?-1:1);}return 0;});
  return rows.slice(request.offset,request.offset+request.limit).map(row=>Object.fromEntries(request.fields.map(field=>[field,row[field]])));
 }
 return {query,bootstrap:bootstrapManager,readConfig:config};
}
module.exports={StorageError,STORE_NAME,mode,handles,withEvent,query,bootstrap,strictFetch,createAdapter,diagnostic};
