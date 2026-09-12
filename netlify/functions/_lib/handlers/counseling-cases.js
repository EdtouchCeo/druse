'use strict';
const C=require('../counseling');
exports.handler=C.wrap(async event=>{
 const actor=await C.auth(event),q=event.queryStringParameters||{},action=q.action||'',id=q.id;
 if(event.httpMethod==='GET'){
  if(!id){if(action)C.fail(400,'BAD_REQUEST','상담 ID를 확인해 주세요.');const students=await C.studentsFor(actor);if(!students.length)return C.json(200,{cases:[]});const rows=await C.db(`counseling_cases?student_id=in.(${students.map(s=>s.student_id).join(',')})&select=data&order=updated_at.desc&limit=200`);return C.json(200,{cases:rows.map(r=>C.caseForActor(r.data,actor)).filter(Boolean)});}
  const c=await C.readCase(actor,id);
  if(action==='export'){const r=C.json(200,{format:'daeryun-counseling',version:1,case:c});r.headers['Content-Disposition']=`attachment; filename="counseling-${c.id}.json"`;return r;}
  if(action==='report'){if(q.audience&&!['teacher','student'].includes(q.audience))C.fail(400,'BAD_REQUEST','출력 대상을 확인해 주세요.');const audience=actor.role==='student'?'student':q.audience||'teacher',source=C.getSession(c,q.session_id||c.current_session_id);const confirmedPreview=actor.role==='teacher'&&source.confirmed?.content_hash===C.hashSession(source);const printable=actor.role==='teacher'&&audience==='student'?C.studentCase(c,{includeDrafts:true}):c;const s=C.getSession(printable,source.id);return {statusCode:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'},body:C.report(printable,s,{audience,confirmedPreview})};}
  if(action)C.fail(400,'UNKNOWN_ACTION','지원하지 않는 요청입니다.');return C.json(200,{case:c});
 }
 if(actor.role!=='teacher')C.fail(403,'TEACHER_REQUIRED','상담 작성은 담당 교사만 할 수 있습니다.');
 if(!['POST','PUT'].includes(event.httpMethod))C.fail(405,'METHOD_NOT_ALLOWED','지원하지 않는 요청 방식입니다.');
 const b=C.body(event);C.rejectPrivate(b);
 if(event.httpMethod==='POST'&&action==='import'){
  C.onlyKeys(b,['bundle','student_id','student_confirmed']);if(b.student_confirmed!==true)C.fail(400,'STUDENT_CONFIRMATION','상담 학생을 먼저 확인해 주세요.');
  C.onlyKeys(b.bundle,['format','version','case']);if(b.bundle?.format!=='daeryun-counseling'||b.bundle.version!==1)C.fail(400,'INVALID_BUNDLE','지원하는 상담 백업 파일이 아닙니다.');C.validateCase(b.bundle.case);
  const student=await C.requireStudent(actor,b.student_id);if(b.bundle.case.student?.student_id!==student.student_id)C.fail(400,'STUDENT_MISMATCH','파일의 학생과 선택한 학생이 다릅니다.');
  const c=C.newCase(student,actor);c.sessions=b.bundle.case.sessions.map(s=>({...structuredClone(s),id:C.newId(),strategy:C.strategyOf(s),guidance:null,record:null,analysis:null,review:null,confirmed:null,imported_history:{source_session_id:s.id,review:s.review,confirmed:s.confirmed}}));c.current_session_id=c.sessions.find(s=>s.imported_history.source_session_id===b.bundle.case.current_session_id).id;c.origin='import';c.imported_from={id:b.bundle.case.id,revision:b.bundle.case.revision,at:C.now()};return C.json(201,{case:await C.writeCase(actor,c,0,'import')});
 }
 if(event.httpMethod==='POST'&&!id&&!action){C.onlyKeys(b,['student','teacher']);C.onlyKeys(b.student,['student_id']);const student=await C.requireStudent(actor,b.student?.student_id);const c=C.newCase(student,actor);return C.json(201,{case:await C.writeCase(actor,c,0,'create')});}
 const stored=await C.readCase(actor,id);let c=structuredClone(stored),review;
 if(event.httpMethod==='PUT'){if(action)C.fail(400,'UNKNOWN_ACTION','지원하지 않는 요청입니다.');C.onlyKeys(b,['case']);c=C.updateCase(stored,b.case);}
 else{
  C.onlyKeys(b,action==='confirm'?['revision','session_id','review_acknowledged']:['review','publish'].includes(action)?['revision','session_id']:['revision']);C.revision(stored,b);
  if(action==='next'){const previous=C.getSession(c,c.current_session_id),s=C.freshSession();s.topic='전략 개정';s.strategy=C.strategyOf(previous);s.context=`이전 전략 주제: ${previous.topic.slice(0,2000)}\n이전 학생 안내: ${s.strategy.student_message.slice(0,2000)}`;s.actions=previous.actions.filter(a=>a.status!=='done').map(a=>({...structuredClone(a),id:C.newId()}));c.sessions.push(s);c.current_session_id=s.id;}
  else if(action==='review'){const s=C.getSession(c,b.session_id);if(s.confirmed)C.fail(409,'CONFIRMED_SESSION','확정 회차는 다음 상담으로 이어서 검토해 주세요.');review=C.reviewSession(s);s.review=review;s.confirmed=null;}
  else if(action==='confirm'){const s=C.getSession(c,b.session_id);if(s.confirmed)C.fail(409,'CONFIRMED_SESSION','이미 확정한 상담입니다.');if(b.review_acknowledged!==true||!s.review||s.review.content_hash!==C.hashSession(s))C.fail(409,'REVIEW_REQUIRED','현재 내용의 문체·근거 점검을 먼저 확인해 주세요.');if(C.reviewSession(s).state==='needs_revision')C.fail(409,'REVISION_REQUIRED','점검에서 확인한 보완 사항을 수정해 주세요.');s.review={...s.review,state:'passed'};s.confirmed={at:C.now(),teacher_id:actor.id,display_name:actor.display_name,content_hash:C.hashSession(s)};}
  else if(action==='publish'){const s=C.getSession(c,b.session_id);if(!s.confirmed||s.confirmed.content_hash!==C.hashSession(s))C.fail(409,'CONFIRM_REQUIRED','현재 전략을 교사가 확정한 뒤 학생에게 안내해 주세요.');if(s.guidance)C.fail(409,'ALREADY_PUBLISHED','이미 학생에게 안내한 전략입니다.');if(!C.guidanceReady(s))C.fail(409,'GUIDANCE_REQUIRED','학생 안내 문장과 실행 과제를 작성해 주세요.');await C.requireStudent(actor,c.student.student_id);s.guidance={published_at:C.now(),published_by:actor.id};}
  else C.fail(400,'UNKNOWN_ACTION','지원하지 않는 요청입니다.');
 }
 const saved=await C.writeCase(actor,c,stored.revision,action||'update');return C.json(200,{case:saved,...(review?{review}:{})});
});
