import type {Consultation,Preparation,Session} from './types'

export const planKeys=['subject_plan','inquiry_plan','activity_plan','semester_plan'] as const
export const consultationFields=[
 {key:'student_response',label:'학생 반응',hint:'교사의 사전 전략에 대한 학생의 실제 반응과 설명을 기록합니다.'},
 {key:'agreed_direction',label:'합의한 방향',hint:'학생과 함께 정한 방향, 범위와 우선 실행할 일을 기록합니다.'},
 {key:'adjustments',label:'수정할 점',hint:'사전 전략에서 유지할 내용과 변경할 내용, 그 이유를 구분합니다.'},
 {key:'summary',label:'상담 요약',hint:'상담의 핵심과 이후 확인할 자료를 간결하게 정리합니다.'},
] as const
export function emptyConsultation():Consultation{return {status:'not_started',date:'',student_response:'',agreed_direction:'',adjustments:'',summary:''}}
function validDate(value:string):boolean{return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value}
export function consultationIssues(value:Consultation):string[]{
 const issues:string[]=[]
 if(!['not_started','in_progress','completed'].includes(value.status))issues.push('상담 진행 상태를 확인해 주세요.')
 for(const {key,label} of consultationFields)if(typeof value[key]!=='string'||value[key].length>6000||value[key].includes('\0'))issues.push(label+'은 6,000자 이내의 글로 입력해 주세요.')
 if(typeof value.date!=='string'||(value.date!==''&&!validDate(value.date)))issues.push('상담일을 올바른 날짜로 입력해 주세요.')
 if(value.status==='completed'){
  if(!value.date)issues.push('상담일을 입력해 주세요.')
  if(typeof value.student_response==='string'&&!value.student_response.trim())issues.push('학생의 실제 반응을 입력해 주세요.')
  if(typeof value.agreed_direction==='string'&&!value.agreed_direction.trim())issues.push('학생과 합의한 방향을 입력해 주세요.')
 }
 return issues
}
export function normalizeConsultation(value:unknown):Consultation{
 if(value===undefined)return emptyConsultation()
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!(k in emptyConsultation())))throw new Error('상담 반영 기록의 형식을 확인해 주세요.')
 const result={...emptyConsultation(),...value} as Consultation
 const issues=consultationIssues(result);if(issues.length)throw new Error(issues[0])
 return {...result}
}
export function normalizePreparation(value:unknown):Preparation|null{
 if(value===undefined||value===null)return null
 if(typeof value!=='object'||Array.isArray(value))throw new Error('사전 전략 기록의 형식을 확인해 주세요.')
 const record=value as Preparation
 if(typeof record.prepared_at!=='string'||!record.prepared_at||typeof record.prepared_by!=='string'||!record.prepared_by||typeof record.topic!=='string'||record.topic.length>200||record.topic.includes('\0')||!record.strategy||typeof record.strategy!=='object'||Array.isArray(record.strategy)||!Array.isArray(record.actions))throw new Error('사전 전략 기록의 필수 항목을 확인해 주세요.')
 const keys=['target_major','target_path','strengths','gaps',...planKeys,'student_message'] as const
 if(keys.some(key=>typeof record.strategy[key]!=='string'||record.strategy[key].length>12000||record.strategy[key].includes('\0')))throw new Error('사전 전략 항목의 형식을 확인해 주세요.')
 if(record.actions.some(a=>!a||typeof a.id!=='string'||typeof a.text!=='string'||typeof a.due_date!=='string'||!['planned','in_progress','done','deferred'].includes(a.status)))throw new Error('사전 전략의 실행과제를 확인해 주세요.')
 return JSON.parse(JSON.stringify(record)) as Preparation
}
export function normalizeWorkflow(session:Session):void{
 if(session.workflow_version!==undefined&&session.workflow_version!==2)throw new Error('지원하지 않는 전략 진행 버전입니다.')
 session.preparation=normalizePreparation(session.preparation)
 session.consultation=normalizeConsultation(session.consultation)
}
export function preparationIssues(session:Session):string[]{
 const issues:string[]=[]
 if(session.confirmed||session.guidance)issues.push('확정한 전략은 새 회차에서 준비해 주세요.')
 if(session.preparation)issues.push('상담 전 전략이 이미 보존되어 있습니다. 최종 전략에서 변경 내용을 반영해 주세요.')
 if(!session.topic.trim())issues.push('전략 제목을 입력해 주세요.')
 if(!planKeys.some(key=>session.strategy?.[key]?.trim()))issues.push('교과·탐구·활동·학기별 계획 중 하나 이상을 작성해 주세요.')
 return issues
}
export function finalizationIssues(session:Session):string[]{
 if(session.workflow_version!==2)return []
 if(!session.preparation)return ['교사 전략을 먼저 준비 완료한 뒤 학생 상담을 진행해 주세요.']
 if(session.consultation?.status!=='completed')return ['학생 상담과 반영 기록을 완료한 뒤 최종 결과물을 검토해 주세요.']
 return consultationIssues(session.consultation)
}
