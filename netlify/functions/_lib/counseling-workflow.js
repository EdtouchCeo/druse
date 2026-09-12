'use strict';
const consultationFields=['date','student_response','agreed_direction','adjustments','summary'];
const planFields=['subject_plan','inquiry_plan','activity_plan','semester_plan'];
function consultationOf(s){return {status:s.consultation?.status||'not_started',...Object.fromEntries(consultationFields.map(k=>[k,typeof s.consultation?.[k]==='string'?s.consultation[k]:'']))};}
function hasConsultation(c){return c.status!=='not_started'||consultationFields.some(k=>c[k]!=='');}
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!value.startsWith('0000-')&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
function ready(s){const c=consultationOf(s);return s.workflow_version!==2||Boolean(s.preparation&&c.status==='completed'&&validDate(c.date)&&c.student_response.trim()&&c.agreed_direction.trim());}
function validate(s,{onlyKeys,fail,uuid,validateStrategy,validateActions}){
 const invalid=()=>fail(400,'INVALID_WORKFLOW','사전 전략과 상담 기록의 형식을 확인해 주세요.');
 if(s.workflow_version!==undefined&&s.workflow_version!==2)invalid();
 if(s.consultation!==undefined){
  onlyKeys(s.consultation,['status',...consultationFields]);
  if(s.consultation.status!==undefined&&!['not_started','in_progress','completed'].includes(s.consultation.status))invalid();
  for(const k of consultationFields)if(s.consultation[k]!==undefined&&(typeof s.consultation[k]!=='string'||s.consultation[k].length>6000||s.consultation[k].includes('\0')))invalid();
 }
 const c=consultationOf(s);
 if(c.date&&!validDate(c.date))invalid();
 if(c.status==='completed'&&(!validDate(c.date)||!c.student_response.trim()||!c.agreed_direction.trim()))invalid();
 if(s.preparation!==undefined&&s.preparation!==null){
  const p=s.preparation;onlyKeys(p,['prepared_at','prepared_by','topic','strategy','actions']);
  if(typeof p.prepared_at!=='string'||p.prepared_at.length>100||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(p.prepared_at)||!validDate(p.prepared_at.slice(0,10))||!Number.isFinite(Date.parse(p.prepared_at))||typeof p.prepared_by!=='string'||!p.prepared_by.trim()||p.prepared_by.length>160||p.prepared_by.includes('\0')||typeof p.topic!=='string'||p.topic.length>200||p.topic.includes('\0'))invalid();
  validateStrategy(p.strategy);validateActions(p.actions);
  if(s.workflow_version!==2||!p.topic.trim()||!planFields.some(k=>p.strategy[k].trim())||Object.values(p.strategy).some(v=>v.includes('\0'))||c.status==='not_started')invalid();
 }
 if(!s.preparation&&hasConsultation(c))fail(400,'PREPARATION_REQUIRED','교사의 사전 전략을 준비한 뒤 학생 상담을 시작해 주세요.');
}
function requireReady(s,fail){
 if(s.workflow_version!==2)return;
 if(!s.preparation)fail(409,'PREPARATION_REQUIRED','교사의 사전 전략을 먼저 준비해 주세요.');
 if(!ready(s))fail(409,'CONSULTATION_REQUIRED','학생 상담 날짜·학생 반응·합의한 방향을 기록하고 상담을 완료해 주세요.');
}
module.exports={consultationFields,planFields,consultationOf,hasConsultation,validDate,ready,validate,requireReady};
