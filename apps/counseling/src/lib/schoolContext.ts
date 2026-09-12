import type {Student,Strategy} from './types'
export type SourceRef={source_id:string;json_pointer:string;field_pointers?:Record<string,unknown>}
export type SchoolAssessment={id:string;subject:string;school_stage:'high'|'middle';grade:number;academic_year:number;semester:number;title:string;learning_topics:string[];steps:string[];outputs:string[];conditions:string[];timing:string|null;ai_status?:string;rubric_excerpts?:string[];issues?:string[];source_label:string;source_ref:SourceRef;revision:unknown;verified_current:false;summary_note?:string}
export type SchoolActivity={id:string;name?:string;title?:string;description:string;school_stage?:'high'|'middle'|null;school_year?:number|null;semester?:number|null;grade_range?:number[]|null;steps?:string[];outputs?:string[];source_label:string;source_ref:SourceRef;revision:unknown;verified_current:false;summary_note?:string}
export type SchoolContext={schema_version:string;reviewed_on:string;sources:unknown[];applicability_rules:unknown;assessments:SchoolAssessment[];clubs:SchoolActivity[];activities:SchoolActivity[]}
const subjectKey=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,'').toLowerCase()
export function taskMatchesStudent(task:SchoolAssessment,student:Student,subjects:string[]):boolean{return task.school_stage===student.school_stage&&task.grade===student.grade&&task.academic_year===student.academic_year&&subjects.some(subject=>subjectKey(subject)===subjectKey(task.subject))}
export function schoolMatches(data:SchoolContext,student:Student,subjects:string[],query='',semester:number|null=null){
 const selected=data.assessments.filter(task=>taskMatchesStudent(task,student,subjects)&&(semester===null||task.semester===semester))
 const term=query.trim().toLowerCase()
 const reference=data.assessments.filter(task=>!selected.some(row=>row.id===task.id)&&(term?[task.title,task.subject,...task.learning_topics].join(' ').toLowerCase().includes(term):subjects.some(subject=>subjectKey(subject)===subjectKey(task.subject))&&!taskMatchesStudent(task,student,subjects)))
 const activities=[...data.clubs,...data.activities].filter(row=>!term||[row.name,row.title,row.description].join(' ').toLowerCase().includes(term))
 return {selected,reference,activities}
}
export function taskReference(task:SchoolAssessment):string{return [`학교 계획 참고: ${task.academic_year}학년도 ${task.semester}학기 ${task.grade}학년 ${task.subject} · ${task.title}`,`원문 시기: ${task.timing||'명시된 시기 없음'}`,`조건: ${task.conditions.length?task.conditions.join(' / '):'원문 조건을 교사에게 확인'}`,`AI 관련 원문: ${task.ai_status||'별도 확인 필요'}`,task.rubric_excerpts?.length?'채점표 발췌(필수 조건과 구분): '+task.rubric_excerpts.join(' / '):'',task.issues?.length?'원문 확인 사항: '+task.issues.join(' / '):'',`출처: ${task.source_label} · 자료 ${task.source_ref.source_id} · ${task.source_ref.json_pointer} · 개정 ${String(task.revision)}`,'현행 적용·수강 여부·마감·허용 범위는 담당 교사에게 확인합니다.'].filter(Boolean).join('\n')}
export function adoptSchoolTask(task:SchoolAssessment,strategy:Strategy):Strategy{
 const copy={...strategy}
 if(!copy.subject_plan.trim())copy.subject_plan=`학교 계획 자료 “${task.subject} · ${task.title}”를 참고합니다. 실제 수강과 현행 과제 여부를 확인한 뒤 수업 개념과 수행 범위를 정합니다.\n${taskReference(task)}`
 if(!copy.inquiry_plan.trim())copy.inquiry_plan=`탐색 참고: ${task.title}\n${task.learning_topics.length?'관련 주제: '+task.learning_topics.join(', ')+'\n':''}자료의 절차와 산출물을 참고해 질문 → 방법 → 산출물 → 피드백 순서로 계획합니다.\n${task.steps.length?'원문 절차: '+task.steps.join(' / ')+'\n':''}${task.outputs.length?'원문 산출물: '+task.outputs.join(' / ')+'\n':''}현행 과제나 필수 참여로 확정하지 않고 교사와 적용 범위를 확인합니다.`
 return copy
}
