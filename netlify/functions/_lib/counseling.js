'use strict';
const crypto = require('crypto');
const storage = require('./counseling-storage');
const P = require('./counseling-profile');
const {displayText,consumerLine}=require('./counseling-report-content');
const W = require('./counseling-workflow');
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
 // School-approved teachers can use strategy without a second service approval.
 // Manager and student access still require their explicit counseling grants.
 if(profile.role==='교사'&&!granted.includes('teacher'))granted.push('teacher');
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
 return rows.map(r=>({student_id:r.id,name:r.name||'',...(histories.find(h=>h.student_id===r.id)||{}),account_linked:uuid(r.user_id)}));
}
async function requireStudent(actor,id) { if(!uuid(id))fail(404,'NOT_FOUND','상담 자료를 찾을 수 없습니다.');const students=await studentsFor(actor);const s=students.find(s=>s.student_id===id);if(!s)fail(404,'NOT_FOUND','상담 자료를 찾을 수 없습니다.');return s; }
async function readCase(actor,id) { if(!uuid(id))fail(404,'NOT_FOUND','상담 자료를 찾을 수 없습니다.');const rows=await db(`counseling_cases?id=eq.${id}&select=data,student_id&limit=1`,{actor_id:actor.id});if(!rows?.length)fail(404,'NOT_FOUND','상담 자료를 찾을 수 없습니다.');await requireStudent(actor,rows[0].student_id);const result=caseForActor(rows[0].data,actor);if(!result)fail(404,'NOT_FOUND','안내된 전략을 찾을 수 없습니다.');return result; }
const localStrategyKeys=['preparation_reports','evidence_map','school_connections','external_context_token'];
function rejectPrivate(value) {
 if(value===null||value===undefined)return;
 if(Array.isArray(value)){value.forEach(rejectPrivate);return;}
 if(typeof value!=='object')return;
 for(const [k,v]of Object.entries(value)){
  if(localStrategyKeys.includes(k))fail(400,'LOCAL_ONLY','학생부 분석과 연결된 전략 자료는 교사 PC의 로컬 앱에서만 보관합니다.');
  if((k==='privacy'&&v!=='standard')||(k==='local_only'&&v)||(k==='premium'&&v)||(['record','analysis','pdf_base64','dataBase64','extracted_text','source_pdf'].includes(k)&&v!==null&&v!==undefined&&v!==''))fail(400,'LOCAL_ONLY','학생부와 프리미엄 자료는 교사 PC의 로컬 앱에서만 처리합니다.');
  rejectPrivate(v);
 }
}
const textFields=['topic','student_question','context','evidence_notes','teacher_opinion','next_date'];
const strategyFields=['target_major','target_path','strengths','gaps','subject_plan','inquiry_plan','activity_plan','semester_plan','student_message'];
function strategyOf(s) {return Object.fromEntries(strategyFields.map(k=>[k,typeof s.strategy?.[k]==='string'?s.strategy[k]:'']));}
function normalizeCase(c) {const copy=structuredClone(c);copy.sessions=copy.sessions.map(s=>({...s,strategy:strategyOf(s),profile:P.profileOf(s),guidance:s.guidance??null,preparation:s.preparation??null,consultation:W.consultationOf(s)}));return copy;}
function sessionContent(s) {const strategy=strategyOf(s),profile=P.profileForHash(s),consultation=W.consultationOf(s);return {id:s.id,date:s.date,...Object.fromEntries(textFields.map(k=>[k,s[k]||''])),actions:s.actions||[],...(Object.values(strategy).some(Boolean)?{strategy}:{}),...(P.hasData(profile)?{profile}:{}),...(s.workflow_version===2?{workflow_version:2}:{}),...(s.preparation?{preparation:s.preparation}:{}),...(W.hasConsultation(consultation)?{consultation}:{})}; }
function hashSession(s) { return crypto.createHash('sha256').update(JSON.stringify(sessionContent(s))).digest('hex'); }
function publicAdmissionProfile(s) {
 const targets=P.profileOf(s).admission_targets.filter(P.hasAdmissionTarget);
 return targets.length?{profile:{admission_targets:targets}}:{};
}
function studentCase(c,{includeDrafts=false}={}) {
 const sessions=c.sessions.filter(s=>includeDrafts||(W.ready(s)&&s.guidance&&typeof s.guidance.published_at==='string'&&uuid(s.guidance.published_by)&&s.confirmed?.content_hash===hashSession(s))).map(s=>({id:s.id,date:s.date,topic:s.topic,strategy:strategyOf(s),...publicAdmissionProfile(s),student_question:'',context:'',evidence_notes:'',teacher_opinion:'',actions:(s.actions||[]).map(a=>({id:a.id,text:a.text,due_date:a.due_date,status:a.status})),next_date:s.next_date||'',record:null,analysis:null,review:null,confirmed:null,guidance:s.guidance?{published_at:s.guidance.published_at,published_by:s.guidance.published_by}:null}));
 if(!sessions.length)return null;
 const student=Object.fromEntries(['student_id','name','student_number','academic_year','school_stage','grade'].filter(k=>c.student[k]!==undefined).map(k=>[k,c.student[k]]));
 return {schema_version:1,id:c.id,revision:c.revision,privacy:'standard',created_at:c.created_at,updated_at:c.updated_at,origin:'teacher',student,teacher:{display_name:c.teacher.display_name||''},current_session_id:sessions.at(-1).id,sessions};
}
function caseForActor(c,actor) {rejectPrivate(c);return actor.role==='student'?studentCase(c):normalizeCase(c);}
function guidanceReady(s) {const strategy=strategyOf(s);return strategy.student_message.trim().length>0&&W.planFields.some(k=>strategy[k].trim());}
function validateStrategy(value){onlyKeys(value,strategyFields);for(const k of strategyFields)if(typeof value[k]!=='string'||value[k].length>12000)fail(400,'INVALID_STRATEGY','전략 항목을 문자열 12,000자 이내로 작성해 주세요.');}
function validateActions(actions){
 if(!Array.isArray(actions)||actions.length>30)fail(400,'INVALID_ACTION','다음 할 일을 30개 이내로 작성해 주세요.');
 const ids=new Set();for(const a of actions){onlyKeys(a,['id','text','due_date','status']);if(!uuid(a.id)||ids.has(a.id)||typeof a.text!=='string'||a.text.length>2000||!['planned','in_progress','done','deferred'].includes(a.status)||typeof a.due_date!=='string')fail(400,'INVALID_ACTION','다음 할 일의 형식을 확인해 주세요.');ids.add(a.id);}
}
function validateSession(s) {
 onlyKeys(s,['id','date',...textFields,'strategy','profile','guidance','actions','record','analysis','review','confirmed','imported_history','workflow_version','preparation','consultation']);
 if(!uuid(s.id)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s.date||''))fail(400,'INVALID_SESSION','상담 회차와 날짜를 확인해 주세요.');
 for(const k of textFields)if(typeof s[k]!=='string'||s[k].length>12000)fail(400,'INVALID_SESSION','상담 항목을 12,000자 이내로 작성해 주세요.');
 if(s.strategy!==undefined)validateStrategy(s.strategy);
 P.validateProfile(s.profile,{onlyKeys,fail,uuid});
 if(s.guidance!==undefined&&s.guidance!==null){onlyKeys(s.guidance,['published_at','published_by']);if(typeof s.guidance.published_at!=='string'||!Number.isFinite(Date.parse(s.guidance.published_at))||!uuid(s.guidance.published_by))fail(400,'INVALID_GUIDANCE','학생 안내 정보를 확인해 주세요.');}
 validateActions(s.actions);
 W.validate(s,{onlyKeys,fail,uuid,validateStrategy,validateActions});
 rejectPrivate(s);
}
function validateCase(c) {
 onlyKeys(c,['schema_version','id','revision','privacy','created_at','updated_at','origin','student','teacher','current_session_id','sessions','imported_from']);
 rejectPrivate(c);
 if(c.schema_version!==1||c.privacy!=='standard'||!uuid(c.id)||!Number.isInteger(c.revision)||c.revision<1||!Array.isArray(c.sessions)||!c.sessions.length||c.sessions.length>80)fail(400,'INVALID_CASE','상담 파일 형식 또는 버전을 확인해 주세요.');
 const ids=new Set();for(const s of c.sessions){validateSession(s);if(ids.has(s.id))fail(400,'INVALID_SESSION','회차 ID가 중복되었습니다.');ids.add(s.id);}if(!ids.has(c.current_session_id))fail(400,'INVALID_SESSION','현재 회차를 확인해 주세요.');
}
function freshSession() { return {id:newId(),date:now().slice(0,10),topic:'',student_question:'',context:'',evidence_notes:'',teacher_opinion:'',strategy:strategyOf({}),profile:P.profileOf({}),workflow_version:2,preparation:null,consultation:W.consultationOf({}),guidance:null,actions:[],next_date:'',record:null,analysis:null,review:null,confirmed:null}; }
function newCase(student,actor) { const s=freshSession(),t=now();const identity=Object.fromEntries(['student_id','name','student_number','academic_year','school_stage','grade'].filter(k=>student[k]!==undefined).map(k=>[k,student[k]]));return {schema_version:1,id:newId(),revision:1,privacy:'standard',created_at:t,updated_at:t,origin:'teacher',student:identity,teacher:{id:actor.id,display_name:actor.display_name},current_session_id:s.id,sessions:[s]}; }
function revision(c,b) { if(b.revision!==c.revision)fail(409,'REVISION_CONFLICT','다른 창에서 변경되었습니다. 다시 불러와 주세요.'); }
function getSession(c,id) {const s=c.sessions.find(s=>s.id===id);if(!s)fail(404,'NOT_FOUND','상담 회차를 찾을 수 없습니다.');return s;}
function updateCase(stored,incoming) {
 validateCase(incoming);revision(stored,incoming);
 for(const k of ['id','privacy','origin','created_at','student','teacher','imported_from'])if(JSON.stringify(stored[k])!==JSON.stringify(incoming[k]))fail(400,'IMMUTABLE_FIELD','학생·교사·원본 연결 정보는 변경할 수 없습니다.');
 if(stored.current_session_id!==incoming.current_session_id||stored.sessions.length!==incoming.sessions.length)fail(400,'IMMUTABLE_HISTORY','회차 추가는 다음 상담 버튼으로 진행해 주세요.');
 const out=structuredClone(stored);
 incoming.sessions.forEach((s,i)=>{const old=stored.sessions[i];if(!old||old.id!==s.id)fail(400,'IMMUTABLE_HISTORY','기존 회차를 보존해 주세요.');for(const k of ['review','confirmed','imported_history','guidance','preparation','workflow_version'])if(JSON.stringify(['guidance','preparation'].includes(k)?(s[k]??null):s[k])!==JSON.stringify(['guidance','preparation'].includes(k)?(old[k]??null):old[k]))fail(400,'PROTECTED_REVIEW','검토·확정·학생 안내·사전 전략 정보는 해당 절차에서만 변경할 수 있습니다.');if(hashSession(old)!==hashSession(s)){if(old.confirmed)fail(409,'CONFIRMED_SESSION','확정 전략은 보존하고 다음 회차를 만들어 주세요.');out.sessions[i]={...structuredClone(s),strategy:strategyOf(s),profile:P.profileOf(s),consultation:W.consultationOf(s),review:null,confirmed:null,guidance:null};}});
 return out;
}
function reviewProse(s,strategy){
 const lines=[s.topic,...Object.values(strategy)];
 if(!Object.values(strategy).some(value=>value.trim()))lines.push(s.teacher_opinion);
 if(s.analysis&&typeof s.analysis==='object'){
  lines.push(s.analysis.summary);
  for(const key of ['strengths','improvements','actions'])for(const row of s.analysis[key]||[]){if(!row||typeof row!=='object')continue;for(const field of key==='actions'?['text','reason','expected_output','review_criteria','teacher_support']:['text','guidance'])lines.push(row[field]);}
  for(const key of ['questions','limitations'])lines.push(...s.analysis[key]||[]);
 }
 return lines.filter(value=>typeof value==='string'&&value.trim()).join('\n');
}
function reviewSession(s) {
 const notes=[],strategy=strategyOf(s),hasStrategy=Object.values(strategy).some(v=>v.trim());
 if(!s.topic.trim())notes.push('전략 주제를 작성해 주세요.');
 if(hasStrategy?!strategy.student_message.trim():!s.teacher_opinion.trim())notes.push(hasStrategy?'학생에게 전할 안내 문장을 작성해 주세요.':'교사의 상담 의견을 작성해 주세요.');
 if(hasStrategy&&!W.planFields.some(k=>strategy[k].trim()))notes.push('교과·탐구·활동·학년별 전략 중 하나 이상을 구체적으로 작성해 주세요.');
 if(!W.ready(s))notes.push('상담 완료로 표시하려면 상담 날짜·학생 반응·합의한 방향을 기록해 주세요.');
 const incomplete=notes.length>0;
 const prose=reviewProse(s,strategy);
 if(/(?:매우 중요|다양한|효과적으로|시사하는 바가 크|혁명적)/.test(prose))notes.push('추상적이거나 과장된 표현은 확인한 행동이나 조건으로 다듬을 수 있는지 검토해 주세요. 직접 인용과 사실은 보존해 주세요.');
 if(/합격.{0,24}(?:가능성|확률|유리|확실|보장)|(?:무조건|반드시|틀림없이).{0,12}합격/.test(prose))notes.push('합격 가능성·확률·보장을 말하는 문장이 있습니다. 제공 자료만으로 예측한 판단인지 확인하고, 확인한 사실과 진로 탐색 방향을 구분해 주세요. 직접 인용이라면 원문을 바꾸지 말고 맥락을 확인합니다.');
 if(/교사 (?:제안|준비안)|(?:질문|방법|산출물|점검일|범위|기준)(?:을|를).{0,12}(?:정합니다|선택합니다|확인합니다)/.test(prose))notes.push('준비 단계의 문장이 남아 있는지 확인해 주세요. 최종 안내에는 학생이 준비할 내용·방법·산출물을 구체적으로 적고, 학교 과제의 조건과 제한은 보존합니다.');
 const lines=prose.split('\n').map(line=>line.trim()).filter(line=>line.length>=25);
 if(new Set(lines).size!==lines.length)notes.push('같은 설명이 반복됩니다. 학생이 읽을 최종 문장에서 반복을 줄일 수 있는지 검토하되, 과제별 조건·직접 인용·수치는 임의로 삭제하지 마세요.');
 if(strategy.student_message.split('\n').some(line=>Array.from(line.trim()).length>450))notes.push('학생 안내에 긴 문단이 있습니다. 내용을 줄이기보다 소제목·줄바꿈·목록으로 준비할 자료와 방법을 구분해 읽을 수 있게 정리해 주세요. 조건·직접 인용은 보존합니다.');
 if(/학교 계획 참고:|학교 활동 참고:|활동 실행 초안:/.test(prose))notes.push('학교 자료를 연결했다는 이유만으로 현재 과제나 활동 참여가 확정된 것은 아닙니다. 대상·시기·참여 가능 여부와 원문 조건을 확인한 뒤 학생과 합의한 실행 범위를 안내해 주세요.');
 notes.push('규칙에 따른 점검 의견입니다. AI 모델의 문체 평가나 교사의 내용 확인을 대신하지 않습니다.','전략의 근거와 직접 인용을 보존하고, 계획을 이미 수행한 성과로 표현하지 않았는지 확인해 주세요. 학생 안내 문장의 핵심·구체성·반복 여부는 교사가 최종 확인합니다.');
 return {state:incomplete?'needs_revision':'pending',method:'manual',content_hash:hashSession(s),notes,created_at:now()};
}
async function writeCase(actor,c,expected,action) {c.updated_at=now();c.revision=expected+1;validateCase(c);return db('rpc/counseling_write_case',{method:'POST',data:{p_actor:actor.id,p_case:c,p_expected:expected,p_action:action}});}
function escapeHtml(s) {return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function report(c,s,{audience='teacher',confirmedPreview=false}={}) {
 const e=escapeHtml,strategy=strategyOf(s),student=audience==='student';
 const name=c.student.name?.trim()||c.student.student_number||'학생';
 const title=`${name} ${student?'학습·진로 전략 보고서':'학생부 분석 자료'}`;
 // Render authored strategy structure without interpreting HTML or losing lines.
 const inline=value=>e(value).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'$1');
 const line=value=>{
  const field=value.match(/^(\s*(?:현재 근거|준비 방향|준비할 자료·결과물|필요한 도움|연결할 교과·탐구):)(.*)$/);
  if(field)return `<strong>${inline(field[1])}</strong>${inline(field[2])}`;
  return /^\s*(?:출처:|자료 ID:|원문 위치:)/.test(value)?`<span class="source-line">${inline(value)}</span>`:/^\s*(?:학교 계획 참고:|학교 활동 참고:)/.test(value)?`<strong class="school-reference">${inline(value)}</strong>`:/^\s*(?:조건:|AI 관련 원문:|원문 대상:|원문 시기:|적용 상태:)/.test(value)?`<span class="school-condition">${inline(value)}</span>`:inline(value);
 };
 const cells=value=>value.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(v=>v.trim());
 const divider=value=>value.includes('|')&&cells(value).every(v=>/^:?-{3,}:?$/.test(v));
 const structured=value=>{
  const lines=displayText(String(value??'')).split('\n').map(consumerLine).filter(line=>line!==null);let html='',plain=[];
  const flush=()=>{if(plain.length){html+='<p class="prose-lines">'+plain.map(v=>`<span class="prose-line">${line(v)||'<br>'}</span>`).join('\n')+'</p>';plain=[];}};
  for(let i=0;i<lines.length;i++){
   if(lines[i].includes('|')&&i+1<lines.length&&divider(lines[i+1])){
    flush();const headers=cells(lines[i]);i+=2;const rows=[];
    while(i<lines.length&&lines[i].includes('|')&&lines[i].trim()){rows.push(cells(lines[i]));i++;}i--;
    const width=Math.max(headers.length,...rows.map(row=>row.length));
    html+='<table><thead><tr>'+Array.from({length:width},(_,j)=>`<th scope="col">${inline(headers[j]||'')}</th>`).join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+Array.from({length:width},(_,j)=>`<td>${line(row[j]||'')}</td>`).join('')+'</tr>').join('')+'</tbody></table>';
   }else if(/^\s*영역:\s*(?:자율·자치활동|동아리활동|진로활동|봉사활동|독서활동|행동특성 및 종합의견)\s*$/.test(lines[i])){flush();html+='<h4>'+inline(lines[i])+'</h4>';}
   else if(/^\s*#{1,6}\s+/.test(lines[i])){flush();html+='<h4>'+inline(lines[i].replace(/^\s*#{1,6}\s+/,''))+'</h4>';}
   else if(/^\s*[-*]\s+/.test(lines[i])){flush();html+='<p class="bullet">• '+line(lines[i].replace(/^\s*[-*]\s+/,''))+'</p>';}
   else plain.push(lines[i]);
  }
  flush();return html;
 };
 const present=([,value])=>String(value??'').trim().length>0;
 const section=([label,value],level=3)=>`<section><h${level}>${e(label)}</h${level}>${structured(value)}</section>`;
 let content='';
 const targets=P.profileOf(s).admission_targets.filter(P.hasAdmissionTarget);
 if(targets.length)content+='<section class="admission-targets"><h2>검토할 희망 대학·전공</h2><table><thead><tr><th scope="col">대학</th><th scope="col">전공</th><th scope="col">전형</th><th scope="col">대입학년도</th></tr></thead><tbody>'+targets.map(target=>'<tr>'+[target.university,target.major,[target.admission_type,target.admission_name].filter(Boolean).join(' · '),target.admission_year?target.admission_year+'학년도':''].map(value=>`<td>${e(value)}</td>`).join('')+'</tr>').join('')+'</tbody></table></section>';
 if(strategy.student_message.trim())content+=section(['학생에게 전하는 안내',strategy.student_message],2);
 const groups=[['학생부 분석과 진로 방향', [['목표 전공·관심 분야',strategy.target_major],['희망 진로·진학 방향',strategy.target_path],['강점과 이어갈 방향',strategy.strengths],['보완할 점과 필요한 도움',strategy.gaps]]],['학습·탐구 전략', [['교과 학습 계획',strategy.subject_plan],['탐구 계획',strategy.inquiry_plan],['창체·봉사·독서·행동특성 전략',strategy.activity_plan],['학년·학기별 성장 전략',strategy.semester_plan]]]];
 for(const [heading,fields] of groups){const available=fields.filter(present);if(available.length)content+=`<h2>${heading}</h2>`+available.map(field=>section(field)).join('');}
 const actions=!student&&!Object.values(strategy).some(value=>value.trim())?(s.actions||[]).filter(action=>action.text.trim()):[];
 if(actions.length)content+='<section class="preparation-items"><h2>학생이 준비할 내용</h2><table><thead><tr><th scope="col">순서</th><th scope="col">준비할 내용</th></tr></thead><tbody>'+actions.map((action,index)=>`<tr><td>${index+1}</td><td>${structured(action.text)}</td></tr>`).join('')+'</tbody></table></section>';
 if(!student){
  const profile=P.profileOf(s),scales={'5':'5등급','9':'9등급',achievement:'성취도',unknown:'미확인'};
  if(profile.grades.length)content+='<section><h2>교과 성적 자료</h2><table><thead><tr><th>학년도·학기</th><th>과목</th><th>척도</th><th>등급</th><th>점수</th><th>성취도</th></tr></thead><tbody>'+profile.grades.map(grade=>`<tr><td>${e(grade.academic_year)} · ${e(grade.semester)}</td><td>${e(grade.subject||'과목 미입력')}</td><td>${e(scales[grade.grade_scale])}</td><td>${e(grade.rank_grade??'')}</td><td>${e(grade.score??'')}</td><td>${e(grade.achievement||'')}</td></tr>`).join('')+'</tbody></table></section>';
 }
 const status=s.confirmed||confirmedPreview?'': ' · 검토용 초안';
 const meta=[`${c.student.academic_year}학년도`,c.student.student_number&&`학번 ${c.student.student_number}`,`작성일 ${s.date}`,c.teacher.display_name&&`담당 교사 ${c.teacher.display_name}`].filter(Boolean).join(' · ');
 return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${e(title)}</title><style>body{font-family:"Malgun Gothic",sans-serif;max-width:880px;margin:32px auto;line-height:1.75;color:#212b38}p{overflow-wrap:anywhere;widows:2;orphans:2}h1{font-size:25px;line-height:1.4}h2{font-size:20px;border-bottom:2px solid #315478;padding-bottom:8px;margin-top:30px}h3{font-size:17px;margin-top:22px}h4{font-size:15px;margin:16px 0 6px}h2,h3,h4{break-after:avoid-page}section{break-inside:auto}.source-line{font-size:0.88em;color:#475569}.school-reference,.school-condition{font-weight:600}.document-meta{font-size:13px;color:#475569;margin:4px 0}.document-topic{font-size:20px;font-weight:600;margin:18px 0}.prose-lines{display:block;white-space:normal}.prose-line{display:block;white-space:pre-wrap;break-inside:avoid-page;overflow-wrap:anywhere}.bullet{padding-left:12px}.preparation-items th:first-child{width:40px}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:14px 0;font-size:.91em;line-height:1.55}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #c5d1dd;padding:9px;overflow-wrap:anywhere;vertical-align:top}th{text-align:left;background:#eff3f8}td p{margin:0}button{padding:10px 16px;margin:24px 0}@page{size:A4;margin:18mm}@media print{button{display:none}body{margin:0;font-size:10.5pt;line-height:1.65}h1{font-size:22px}h2{font-size:18px}h3{font-size:15px}h4{font-size:13px}.document-meta{font-size:9pt}}</style><h1>${e(title)}</h1><p class="document-meta">${e(meta+status)}</p>${s.topic?`<p class="document-topic">${e(s.topic)}</p>`:''}${content}<button onclick="window.print()">인쇄 / PDF 저장</button></html>`;
}
module.exports={HttpError,fail,uuid,newId,now,json,wrap,body,onlyKeys,config,db,identity,profileFor,auth,studentsFor,requireStudent,readCase,rejectPrivate,strategyFields,strategyOf,profileOf:P.profileOf,consultationOf:W.consultationOf,planFields:W.planFields,requireWorkflowReady:s=>W.requireReady(s,fail),normalizeCase,studentCase,caseForActor,guidanceReady,hashSession,validateCase,freshSession,newCase,revision,getSession,updateCase,reviewSession,writeCase,report};
