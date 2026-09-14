import type {Student,Strategy} from './types'
export type SourceRef={source_id:string;json_pointer:string;field_pointers?:Record<string,unknown>}
export type SchoolAssessment={id:string;subject:string;school_stage:'high'|'middle';grade:number;academic_year:number;semester:number;title:string;learning_topics:string[];steps:string[];outputs:string[];conditions:string[];timing:string|null;ai_status?:string;rubric_excerpts?:string[];issues?:string[];source_label:string;source_ref:SourceRef;revision:unknown;verified_current:false;summary_note?:string}
export type SchoolActivity={id:string;name?:string;title?:string;description:string;school_stage?:'high'|'middle'|null;school_year?:number|null;semester?:number|null;grade_range?:number[]|null;steps?:string[];outputs?:string[];source_label:string;source_ref:SourceRef;revision:unknown;verified_current:false;summary_note?:string}
export type SchoolContext={schema_version:string;reviewed_on:string;sources:unknown[];applicability_rules:unknown;assessments:SchoolAssessment[];clubs:SchoolActivity[];activities:SchoolActivity[]}
const subjectKey=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,'').toLowerCase()
export function schoolAiLabel(status?:string):string{return ({prohibited:'AI 사용 금지',limited_to_specified_stages:'지정 단계에서만 허용',limited:'제한적 허용 · 원문 조건 확인',permitted_all_stages_as_written:'전 단계 허용 · 원문 조건 확인',allowed_all_as_stated:'허용 · 원문 조건 확인',unresolved:'허용 여부 확인 필요',not_specified:'허용 여부 미명시'} as Record<string,string>)[status||'']||status||'허용 여부 확인 필요'}
export function taskMatchesStudent(task:SchoolAssessment,student:Student,subjects:string[]):boolean{return task.school_stage===student.school_stage&&task.grade===student.grade&&task.academic_year===student.academic_year&&subjects.some(subject=>subjectKey(subject)===subjectKey(task.subject))}
export function schoolMatches(data:SchoolContext,student:Student,subjects:string[],query='',semester:number|null=null){
 const selected=data.assessments.filter(task=>taskMatchesStudent(task,student,subjects)&&(semester===null||task.semester===semester))
 const term=query.trim().toLowerCase()
 const reference=data.assessments.filter(task=>!selected.some(row=>row.id===task.id)&&(term?[task.title,task.subject,...task.learning_topics].join(' ').toLowerCase().includes(term):subjects.some(subject=>subjectKey(subject)===subjectKey(task.subject))&&!taskMatchesStudent(task,student,subjects)))
 const activities=[...data.clubs,...data.activities].filter(row=>!term||[row.name,row.title,row.description].join(' ').toLowerCase().includes(term))
 const activityGroups={matched:[] as SchoolActivity[],reference:[] as SchoolActivity[],unverified:[] as SchoolActivity[]}
 for(const activity of activities)activityGroups[activityApplicability(activity,student,semester).status].push(activity)
 return {selected,reference,activities,activityGroups}
}
export type ActivityApplicability={status:'matched'|'reference'|'unverified';reasons:string[]}
export function activityApplicability(activity:SchoolActivity,student:Student,semester:number|null=null):ActivityApplicability{
 const differences:string[]=[],unknown:string[]=[]
 if(!activity.school_stage)unknown.push('학교급');else if(activity.school_stage!==student.school_stage)differences.push('학교급이 다름')
 if(!activity.school_year)unknown.push('학년도');else if(activity.school_year!==student.academic_year)differences.push('학년도가 다름')
 if(!activity.grade_range?.length)unknown.push('대상 학년');else if(!activity.grade_range.includes(student.grade))differences.push('대상 학년이 다름')
 if(!activity.semester)unknown.push('학기');else if(semester!==null&&activity.semester!==semester)differences.push('학기가 다름')
 return differences.length?{status:'reference',reasons:[...differences,...(unknown.length?[`${unknown.join('·')} 확인 필요`]:[])]}:unknown.length?{status:'unverified',reasons:[`${unknown.join('·')} 확인 필요`]}:{status:'matched',reasons:['대상 조건 일치 · 현재 운영·참여 가능 여부 확인 필요']}
}
/** Append only curated public material. Never trim away source conditions to fit. */
function appendPublicPlan(current:string,addition:string):string{return current.includes(addition)?current:[current.trimEnd(),addition].filter(Boolean).join('\n\n')}
function checkedStrategy(strategy:Strategy):Strategy{
 for(const [field,value] of Object.entries(strategy))if(value.length>12000)throw new Error(`${field==='subject_plan'?'교과 계획':field==='inquiry_plan'?'탐구 계획':field==='activity_plan'?'활동 계획':'전략 항목'}이 12,000자를 넘습니다. 기존 내용을 정리한 뒤 자료를 다시 담아 주세요. 조건·출처는 생략하지 않았습니다.`)
 return strategy
}
/** Match whole curated topic/name expressions only; prose tokens are not evidence of fit. */
function selectionReason(strategy:Strategy,sourcePhrases:string[]):string{
 const normalize=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ')
 const phrases=sourcePhrases.map(normalize).filter(phrase=>phrase.length>=4&&phrase.length<=40)
 const candidates=[['관심·진로',strategy.target_path],['관심 전공·계열',strategy.target_major]] as const
 for(const [label,value] of candidates){
  const publicText=normalize(value)
  const common=phrases.find(phrase=>publicText.includes(phrase))
  if(common)return `선택 이유(상담 확인 필요): 연결 후보 “${common}”는 ${label} 항목에도 있는 원문 주제입니다.`
 }
 return '선택 이유(확인 필요): 관심·강점과 이 자료를 연결할 근거를 상담에서 확인합니다.'
}
function sourceLine(row:SchoolAssessment|SchoolActivity,details:boolean):string{
 return `출처: ${row.source_label}${details?' · 자료 '+row.source_ref.source_id+' · '+row.source_ref.json_pointer:''} · 개정 ${row.revision===null||row.revision===undefined?'확인 필요':String(row.revision)}`
}
function taskSourceLines(task:SchoolAssessment,details:boolean):string[]{return [
 `학교 계획 참고: ${task.academic_year}학년도 ${task.semester}학기 ${task.grade}학년 ${task.subject} · ${task.title}`,
 task.learning_topics.length?'관련 주제(원문): '+task.learning_topics.join(' / '):'',
 task.steps.length?'원문 절차: '+task.steps.join(' / '):'절차: 원문에서 확인 필요',
 task.outputs.length?'원문 산출물: '+task.outputs.join(' / '):'산출물: 원문에 별도 정리되지 않음 · 과제명·절차와 함께 확인',
 `원문 시기: ${task.timing||'명시된 시기 없음'}`,
 `조건: ${task.conditions.length?task.conditions.join(' / '):'원문 조건을 교사에게 확인'}`,
 `AI 사용 조건: ${schoolAiLabel(task.ai_status)} · 위 원문 조건의 단계·금지 범위를 함께 확인`,
 task.rubric_excerpts?.length?'채점표 발췌(필수 조건과 구분): '+task.rubric_excerpts.join(' / '):'',
 task.issues?.length?'원문 확인 사항: '+task.issues.join(' / '):'',sourceLine(task,details),
 '현행 적용·수강 여부·마감·허용 범위는 담당 교사에게 확인합니다.',
].filter(Boolean)}
/** Detailed teacher evidence; the student plan keeps the readable source and exact conditions. */
export function taskReference(task:SchoolAssessment):string{return taskSourceLines(task,true).join('\n')}
export function adoptSchoolTask(task:SchoolAssessment,strategy:Strategy):Strategy{
 const copy={...strategy}
 const [heading,...sourceDetails]=taskSourceLines(task,false)
 const plan=[heading,
  selectionReason(strategy,[...task.learning_topics,task.title]),
  `할 일(제안): 합의한 원문 절차를 진행하고 ${task.outputs.length?'아래 원문 산출물에 수행 과정과 근거를 남깁니다.':'수행 과정과 근거를 남깁니다.'}`,
  '점검 기준(제안): 결과의 근거·원문 조건 준수 여부를 교사 피드백과 대조합니다.',
  ...sourceDetails,
 ].join('\n')
 copy.subject_plan=appendPublicPlan(copy.subject_plan,plan)
 if(!copy.inquiry_plan.trim())copy.inquiry_plan=`탐색 참고: ${task.title}\n실행 제안: 위 교과 계획의 주제와 연결되는 수업 자료에 근거를 표시합니다.\n현행 과제나 필수 참여로 확정하지 않고 교사와 적용 범위를 확인합니다.`
 return checkedStrategy(copy)
}

export type ActivityAdoptionOptions={student:Student;semester:number|null;weekly_minutes:number|null}
export function schoolActivityAction(activity:SchoolActivity,options?:Pick<ActivityAdoptionOptions,'weekly_minutes'>):string{
 return `${options?.weekly_minutes===0?'기존 수업·활동 안에서: ':''}제안 · “${activity.name||activity.title||'활동명 확인 필요'}”의 대상·운영 확인 후 ${activity.outputs?.length?'활동 계획의 원문 산출물에 수행 과정·근거와 피드백으로 고친 부분 표시하기':'남길 결과(확인 필요)와 맡을 범위를 정해 수행 과정·근거·피드백 남기기'}`
}
function activitySourceLines(activity:SchoolActivity,details:boolean):string[]{
 return [`학교 활동 참고: ${activity.name||activity.title||'활동명 확인 필요'}`,`원문 대상: ${activity.school_stage==='high'?'고등학교':activity.school_stage==='middle'?'중학교':'학교급 확인 필요'} · ${activity.school_year?activity.school_year+'학년도':'학년도 확인 필요'} · ${activity.semester?activity.semester+'학기':'학기 확인 필요'} · ${activity.grade_range?.length?activity.grade_range.join('·')+'학년':'대상 학년 확인 필요'}`,sourceLine(activity,details),activity.summary_note||'현재 운영·참여 가능 여부와 일정은 확인이 필요합니다.']
}
export function activityReference(activity:SchoolActivity):string{return activitySourceLines(activity,true).join('\n')}
export function adoptSchoolActivity(activity:SchoolActivity,strategy:Strategy,options:ActivityAdoptionOptions):Strategy{
 const applicability=activityApplicability(activity,options.student,options.semester)
 const scope=applicability.status==='matched'?'대상 조건 일치 · 운영·참여 확인 후 검토':applicability.status==='reference'?'다른 대상의 탐색 참고 · 현재 참여 계획으로 확정하지 않음':'적용 범위 미확정 · 대상 확인 후 검토'
 const plan=[`활동 실행 초안: ${activity.name||activity.title||'활동명 확인 필요'}`,
  selectionReason(strategy,[activity.name,activity.title].filter((value):value is string=>Boolean(value))),
  `할 일(제안): 합의한 원문 절차를 진행하고 ${activity.outputs?.length?'아래 원문 산출물에 ':'자료에 '}맡은 부분·근거·피드백을 표시합니다.`,
  '점검 기준(제안): 맡은 부분과 피드백으로 고친 이유를 자료로 설명합니다.',
  `적용 상태: ${scope}${applicability.status==='matched'?'':' ('+applicability.reasons.join(' / ')+')'}`,
  ...(options.weekly_minutes===0?['기존 수업·활동 안에서만 참고하며 새 프로그램 참여를 요구하지 않습니다.']:['일정·소요 시간은 확인 필요합니다.']),
  `활동 자료 설명: ${activity.description}`,
  activity.steps?.length?'원문 절차: '+activity.steps.join(' → '):'절차: 원문에서 확인 필요',
  activity.outputs?.length?'원문 산출물: '+activity.outputs.join(' / '):'산출물: 원문에서 확인 필요',
  '참여하거나 완성한 실적으로 기록하지 않습니다.',...activitySourceLines(activity,false).slice(1)].join('\n')
 return checkedStrategy({...strategy,activity_plan:appendPublicPlan(strategy.activity_plan,plan)})
}
