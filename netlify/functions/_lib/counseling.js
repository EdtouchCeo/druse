'use strict';
const crypto = require('crypto');
const storage = require('./counseling-storage');
class HttpError extends Error { constructor(status, code, message) { super(message); this.status=status; this.code=code; } }
const fail = (status,code,message) => { throw new HttpError(status,code,message); };
const uuid = v => typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();
function json(statusCode, value) { return {statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify(value)}; }
function wrap(fn) { return async event => { try { return await storage.withEvent(event,()=>fn(event)); } catch(e) { const known=e instanceof HttpError||e instanceof storage.StorageError;return json(known?e.status:503,{error:{code:known?e.code:'SERVICE_UNAVAILABLE',message:known?e.message:'상담 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'}}); } }; }
function body(event,max=350000) { if(typeof event.body!=='string'||Buffer.byteLength(event.body,'utf8')>max) fail(413,'INPUT_LIMIT','입력 크기를 줄여 주세요.'); try { const b=JSON.parse(event.body); if(!b||typeof b!=='object'||Array.isArray(b))throw Error(); return b; } catch { fail(400,'BAD_JSON','JSON 입력을 확인해 주세요.'); } }
function onlyKeys(value,allowed) { if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'BAD_REQUEST','입력 항목의 형식을 확인해 주세요.');for(const k of Object.keys(value))if(!allowed.includes(k))fail(400,'FIELD_NOT_ALLOWED',`허용하지 않는 입력 항목입니다: ${k.slice(0,40)}`); }
function config() { const url=(process.env.SUPABASE_URL||'').replace(/\/$/,''); const key=process.env.SUPABASE_SERVICE_KEY; if(!url||!key)fail(503,'SERVER_CONFIG','상담 계정 서버 설정이 준비되지 않았습니다.'); return {url,key}; }
async function db(path,options={}) {
 if(storage.handles(path)&&storage.mode()==='blobs')return storage.query(path,options,supabaseDB);
 return supabaseDB(path,options);
}
async function supabaseDB(path,{method='GET',data,prefer}={}) {
 const {url,key}=config();
 const r=await fetch(`${url}/rest/v1/${path}`,{method,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(12000)});
 const result=await r.json().catch(()=>null);
 if(!r.ok){if(result?.code==='40001')fail(409,'REVISION_CONFLICT','다른 창에서 변경되었습니다. 다시 불러온 뒤 확인해 주세요.');if(result?.code==='42501')fail(403,'ACCESS_DENIED','상담 접근 권한이 없습니다.');if(result?.code==='23505')fail(409,'DUPLICATE','이미 등록된 정보입니다.');fail(503,'DATABASE_UNAVAILABLE','상담 자료 저장소가 준비되지 않았거나 요청을 처리하지 못했습니다.');}
 return result;
}
function bearer(event) { return String(event.headers?.authorization||event.headers?.Authorization||'').match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||''; }
async function identity(event) {
 const token=bearer(event); if(!token)fail(401,'AUTH_REQUIRED','대륜고 계정으로 로그인해 주세요.');
 const {url,key}=config(); let r;
 try{r=await fetch(`${url}/auth/v1/user`,{headers:{Authorization:`Bearer ${token}`,apikey:key},signal:AbortSignal.timeout(8000)});}catch{fail(503,'AUTH_UNAVAILABLE','로그인 확인 서버에 연결하지 못했습니다.');}
 if(!r.ok)fail(401,'AUTH_REQUIRED','로그인이 만료되었습니다. 다시 로그인해 주세요.');
 const me=await r.json();if(!uuid(me?.id))fail(401,'AUTH_REQUIRED','로그인 정보를 확인하지 못했습니다.');return me;
}
async function profileFor(me) { const rows=await db(`users?google_id=eq.${encodeURIComponent(me.id)}&select=id,google_id,name,email,role,approved,grade,class,admission_year&limit=2`);if(!Array.isArray(rows)||rows.length!==1)fail(403,'PROFILE_REQUIRED','회원 가입과 승인 상태를 확인해 주세요.');return rows[0]; }
async function auth(event,{roles=['teacher','student'],allowBootstrap=false}={}) {
 const me=await identity(event);const profile=await profileFor(me);
 if(profile.approved!==true)fail(403,'NOT_APPROVED','학교의 회원 승인이 필요합니다.');
 if(allowBootstrap)await storage.bootstrap(me,profile,supabaseDB);
 const grants=await db(`counseling_roles?user_id=eq.${profile.id}&approved=eq.true&select=role`);
 const granted=(grants||[]).map(x=>x.role).filter(r=>r==='manager'||(r==='teacher'&&profile.role==='교사')||(r==='student'&&profile.role==='학생'));
 const role=roles.find(r=>granted.includes(r));if(!role)fail(403,'COUNSELING_NOT_APPROVED','상담 참여 권한이 부여되지 않았습니다.');
 return {id:profile.id,authId:me.id,role,roles:granted,display_name:profile.name||'',profile};
}
async function studentsFor(actor) {
 if(!['teacher','student'].includes(actor.role))return [];
 let filter;
 if(actor.role==='student')filter=`user_id=eq.${actor.id}`;
 else {const assigned=await db(`counseling_assignments?teacher_user_id=eq.${actor.id}&active=eq.true&select=student_id`);if(!assigned.length)return [];filter=`id=in.(${assigned.map(a=>a.student_id).join(',')})`;}
 const rows=await db(`counseling_students?${filter}&active=eq.true&select=id,user_id,name`);
 if(!rows.length)return [];
 const histories=await db(`counseling_student_numbers?student_id=in.(${rows.map(r=>r.id).join(',')})&select=student_id,student_number,academic_year,school_stage,grade&order=academic_year.desc`);
 return rows.map(r=>({student_id:r.id,name:r.name||'',...(histories.find(h=>h.student_id===r.id)||{})}));
}
async function requireStudent(actor,id) { if(!uuid(id))fail(404,'NOT_FOUND','상담 자료를 찾을 수 없습니다.');const students=await studentsFor(actor);const s=students.find(s=>s.student_id===id);if(!s)fail(404,'NOT_FOUND','상담 자료를 찾을 수 없습니다.');return s; }
async function readCase(actor,id) { if(!uuid(id))fail(404,'NOT_FOUND','상담 자료를 찾을 수 없습니다.');const rows=await db(`counseling_cases?id=eq.${id}&select=data,student_id&limit=1`);if(!rows?.length)fail(404,'NOT_FOUND','상담 자료를 찾을 수 없습니다.');await requireStudent(actor,rows[0].student_id);const result=caseForActor(rows[0].data,actor);if(!result)fail(404,'NOT_FOUND','안내된 전략을 찾을 수 없습니다.');return result; }
function rejectPrivate(value) {
 if(value===null||value===undefined)return;
 if(Array.isArray(value)){value.forEach(rejectPrivate);return;}
 if(typeof value!=='object')return;
 for(const [k,v]of Object.entries(value)){
  if((k==='privacy'&&v!=='standard')||(k==='local_only'&&v)||(k==='premium'&&v)||(['record','analysis','pdf_base64','dataBase64','extracted_text','source_pdf'].includes(k)&&v!==null&&v!==undefined&&v!==''))fail(400,'LOCAL_ONLY','학생부와 프리미엄 자료는 교사 PC의 로컬 앱에서만 처리합니다.');
  rejectPrivate(v);
 }
}
const textFields=['topic','student_question','context','evidence_notes','teacher_opinion','next_date'];
const strategyFields=['target_major','target_path','strengths','gaps','subject_plan','inquiry_plan','activity_plan','semester_plan','student_message'];
function strategyOf(s) {return Object.fromEntries(strategyFields.map(k=>[k,typeof s.strategy?.[k]==='string'?s.strategy[k]:'']));}
function normalizeCase(c) {const copy=structuredClone(c);copy.sessions=copy.sessions.map(s=>({...s,strategy:strategyOf(s),guidance:s.guidance??null}));return copy;}
function sessionContent(s) {const strategy=strategyOf(s);return {id:s.id,date:s.date,...Object.fromEntries(textFields.map(k=>[k,s[k]||''])),actions:s.actions||[],...(Object.values(strategy).some(Boolean)?{strategy}:{})}; }
function hashSession(s) { return crypto.createHash('sha256').update(JSON.stringify(sessionContent(s))).digest('hex'); }
function studentCase(c,{includeDrafts=false}={}) {
 const sessions=c.sessions.filter(s=>includeDrafts||(s.guidance&&typeof s.guidance.published_at==='string'&&uuid(s.guidance.published_by)&&s.confirmed?.content_hash===hashSession(s))).map(s=>({id:s.id,date:s.date,topic:s.topic,strategy:strategyOf(s),student_question:'',context:'',evidence_notes:'',teacher_opinion:'',actions:(s.actions||[]).map(a=>({id:a.id,text:a.text,due_date:a.due_date,status:a.status})),next_date:s.next_date||'',record:null,analysis:null,review:null,confirmed:null,guidance:s.guidance?{published_at:s.guidance.published_at,published_by:s.guidance.published_by}:null}));
 if(!sessions.length)return null;
 const student=Object.fromEntries(['student_id','name','student_number','academic_year','school_stage','grade'].filter(k=>c.student[k]!==undefined).map(k=>[k,c.student[k]]));
 return {schema_version:1,id:c.id,revision:c.revision,privacy:'standard',created_at:c.created_at,updated_at:c.updated_at,origin:'teacher',student,teacher:{display_name:c.teacher.display_name||''},current_session_id:sessions.at(-1).id,sessions};
}
function caseForActor(c,actor) {rejectPrivate(c);return actor.role==='student'?studentCase(c):normalizeCase(c);}
function guidanceReady(s) {return strategyOf(s).student_message.trim().length>0&&s.actions.some(a=>a.text.trim());}
function validateSession(s) {
 onlyKeys(s,['id','date',...textFields,'strategy','guidance','actions','record','analysis','review','confirmed','imported_history']);
 if(!uuid(s.id)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s.date||''))fail(400,'INVALID_SESSION','상담 회차와 날짜를 확인해 주세요.');
 for(const k of textFields)if(typeof s[k]!=='string'||s[k].length>12000)fail(400,'INVALID_SESSION','상담 항목을 12,000자 이내로 작성해 주세요.');
 if(s.strategy!==undefined){onlyKeys(s.strategy,strategyFields);for(const k of strategyFields)if(typeof s.strategy[k]!=='string'||s.strategy[k].length>12000)fail(400,'INVALID_STRATEGY','전략 항목을 문자열 12,000자 이내로 작성해 주세요.');}
 if(s.guidance!==undefined&&s.guidance!==null){onlyKeys(s.guidance,['published_at','published_by']);if(typeof s.guidance.published_at!=='string'||!Number.isFinite(Date.parse(s.guidance.published_at))||!uuid(s.guidance.published_by))fail(400,'INVALID_GUIDANCE','학생 안내 정보를 확인해 주세요.');}
 if(!Array.isArray(s.actions)||s.actions.length>30)fail(400,'INVALID_ACTION','다음 할 일을 30개 이내로 작성해 주세요.');
 const ids=new Set();for(const a of s.actions){onlyKeys(a,['id','text','due_date','status']);if(!uuid(a.id)||ids.has(a.id)||typeof a.text!=='string'||a.text.length>2000||!['planned','in_progress','done','deferred'].includes(a.status)||typeof a.due_date!=='string')fail(400,'INVALID_ACTION','다음 할 일의 형식을 확인해 주세요.');ids.add(a.id);}
 rejectPrivate(s);
}
function validateCase(c) {
 onlyKeys(c,['schema_version','id','revision','privacy','created_at','updated_at','origin','student','teacher','current_session_id','sessions','imported_from']);
 rejectPrivate(c);
 if(c.schema_version!==1||c.privacy!=='standard'||!uuid(c.id)||!Number.isInteger(c.revision)||c.revision<1||!Array.isArray(c.sessions)||!c.sessions.length||c.sessions.length>80)fail(400,'INVALID_CASE','상담 파일 형식 또는 버전을 확인해 주세요.');
 const ids=new Set();for(const s of c.sessions){validateSession(s);if(ids.has(s.id))fail(400,'INVALID_SESSION','회차 ID가 중복되었습니다.');ids.add(s.id);}if(!ids.has(c.current_session_id))fail(400,'INVALID_SESSION','현재 회차를 확인해 주세요.');
}
function freshSession() { return {id:newId(),date:now().slice(0,10),topic:'',student_question:'',context:'',evidence_notes:'',teacher_opinion:'',strategy:strategyOf({}),guidance:null,actions:[],next_date:'',record:null,analysis:null,review:null,confirmed:null}; }
function newCase(student,actor) { const s=freshSession(),t=now();return {schema_version:1,id:newId(),revision:1,privacy:'standard',created_at:t,updated_at:t,origin:'teacher',student,teacher:{id:actor.id,display_name:actor.display_name},current_session_id:s.id,sessions:[s]}; }
function revision(c,b) { if(b.revision!==c.revision)fail(409,'REVISION_CONFLICT','다른 창에서 변경되었습니다. 다시 불러와 주세요.'); }
function getSession(c,id) {const s=c.sessions.find(s=>s.id===id);if(!s)fail(404,'NOT_FOUND','상담 회차를 찾을 수 없습니다.');return s;}
function updateCase(stored,incoming) {
 validateCase(incoming);revision(stored,incoming);
 for(const k of ['id','privacy','origin','created_at','student','teacher','imported_from'])if(JSON.stringify(stored[k])!==JSON.stringify(incoming[k]))fail(400,'IMMUTABLE_FIELD','학생·교사·원본 연결 정보는 변경할 수 없습니다.');
 if(stored.current_session_id!==incoming.current_session_id||stored.sessions.length!==incoming.sessions.length)fail(400,'IMMUTABLE_HISTORY','회차 추가는 다음 상담 버튼으로 진행해 주세요.');
 const out=structuredClone(stored);
 incoming.sessions.forEach((s,i)=>{const old=stored.sessions[i];if(!old||old.id!==s.id)fail(400,'IMMUTABLE_HISTORY','기존 회차를 보존해 주세요.');for(const k of ['review','confirmed','imported_history','guidance'])if(JSON.stringify(k==='guidance'?(s[k]??null):s[k])!==JSON.stringify(k==='guidance'?(old[k]??null):old[k]))fail(400,'PROTECTED_REVIEW','검토·확정·학생 안내 정보는 해당 절차에서만 변경할 수 있습니다.');if(hashSession(old)!==hashSession(s)){if(old.confirmed)fail(409,'CONFIRMED_SESSION','확정 전략은 보존하고 다음 회차를 만들어 주세요.');out.sessions[i]={...structuredClone(s),strategy:strategyOf(s),review:null,confirmed:null,guidance:null};}});
 return out;
}
function reviewSession(s) {const notes=[],strategy=strategyOf(s),hasStrategy=Object.values(strategy).some(v=>v.trim());if(!s.topic.trim())notes.push('전략 주제를 작성해 주세요.');if(hasStrategy?!strategy.student_message.trim():!s.teacher_opinion.trim())notes.push(hasStrategy?'학생에게 안내할 전략을 작성해 주세요.':'교사의 상담 의견을 작성해 주세요.');if(!s.actions.some(a=>a.text.trim()))notes.push('학생의 실행 과제를 한 가지 이상 작성해 주세요.');const incomplete=notes.length>0;const prose=[...textFields.filter(k=>k!=='next_date').map(k=>s[k]),...Object.values(strategy)].join('\n');if(/(?:매우 중요|다양한|효과적으로|시사하는 바가 크)/.test(prose))notes.push('추상적인 표현은 확인한 행동이나 조건으로 다듬을 수 있는지 검토해 주세요. 직접 인용과 사실은 보존해 주세요.');notes.push('전략의 근거와 직접 인용을 보존하고, 계획을 이미 수행한 성과로 표현하지 않았는지 확인해 주세요. 학생 안내 문장의 핵심·구체성·반복 여부는 교사가 최종 확인합니다.');return {state:incomplete?'needs_revision':'pending',method:'manual',content_hash:hashSession(s),notes,created_at:now()};}
async function writeCase(actor,c,expected,action) {c.updated_at=now();c.revision=expected+1;validateCase(c);return db('rpc/counseling_write_case',{method:'POST',data:{p_actor:actor.id,p_case:c,p_expected:expected,p_action:action}});}
function escapeHtml(s) {return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function report(c,s,{audience='teacher',confirmedPreview=false}={}) {
 const e=escapeHtml,strategy=strategyOf(s),student=audience==='student';
 const statuses={planned:'예정',in_progress:'진행 중',done:'완료',deferred:'보류'};
 const fields=[['전략 주제',s.topic],['희망 전공',strategy.target_major],['진학 방향',strategy.target_path],['강점',strategy.strengths],['보완할 점',strategy.gaps],['교과 학습 계획',strategy.subject_plan],['탐구 계획',strategy.inquiry_plan],['활동 계획',strategy.activity_plan],['학기별 계획',strategy.semester_plan],['학생에게 안내할 내용',strategy.student_message],['학생 실행 과제',s.actions.map(a=>a.text+(a.due_date?` (${a.due_date})`:'')+` · ${statuses[a.status]||a.status}`).join('\n')],['다음 전략 점검',s.next_date]];
 if(!student)fields.push(['교사 내부 참고 · 학생 질문',s.student_question],['교사 내부 참고 · 상황',s.context],['교사 내부 참고 · 근거',s.evidence_notes],['교사 내부 참고 · 의견',s.teacher_opinion]);
 const status=s.guidance?'학생 안내':s.confirmed||confirmedPreview?'확정 · 학생 안내 전':'초안 · 학생 안내 전';
 return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>대륜고 학종 전략 안내</title><style>body{font-family:"Malgun Gothic",sans-serif;max-width:820px;margin:32px auto;line-height:1.7}p{white-space:pre-wrap;overflow-wrap:anywhere}h2{font-size:18px}section{break-inside:avoid}@page{size:A4;margin:18mm}@media print{button{display:none}}</style><button onclick="window.print()">인쇄 / PDF 저장</button><h1>대륜고 학종 전략 안내 · ${status}</h1><p>${e(c.student.academic_year)}학년도 ${e(c.student.student_number)} ${e(c.student.name)} · ${e(s.date)}</p>${fields.map(([k,v])=>`<section><h2>${e(k)}</h2><p>${e(v)}</p></section>`).join('')}<p>전략 버전 ${c.revision} · ${e(c.teacher.display_name)} · ${s.guidance?'학생 안내 '+e(s.guidance.published_at):student?'학생 안내용 미리보기':s.confirmed?'교사 확인 '+e(s.confirmed.at):'교사 최종 확인 전'}</p></html>`;
}
module.exports={HttpError,fail,uuid,newId,now,json,wrap,body,onlyKeys,db,identity,profileFor,auth,studentsFor,requireStudent,readCase,rejectPrivate,strategyFields,strategyOf,normalizeCase,studentCase,caseForActor,guidanceReady,hashSession,validateCase,freshSession,newCase,revision,getSession,updateCase,reviewSession,writeCase,report};
