import {evidenceLocation,findingArea} from './analysisPresentation'
import {analysisReportIssue} from './reports'
import {displayText} from './reportContent'
import type {AdmissionTarget,Session,Student} from './types'

export type PreparationStage='analysis'|'admissions'|'inquiry'
export type ReportItem={title:string;detail:string;reason:string;steps:string[];evidence_refs:string[]}
export type ReportSection={id:string;title:string;overview:string;items:ReportItem[]}
export type ReportSource={id:string;title:string;url:string;year?:number|null}
export type SchoolConnection={subject:string;task:string;reason:string;conditions:string[];source?:string;academic_year?:number;grade?:number;semester?:number;status?:string;steps?:string[];learning_topics?:string[]}
export interface Report {
 id:string;kind:'admissions'|'inquiry';target_id:string;title:string;summary:string;sections:ReportSection[]
 created_at:string;source_hash:string;model:string;sources?:ReportSource[];school_connections?:SchoolConnection[]
 evidence_map?:Record<string,{label:string;details:string[]}>
 imported_unverified?:boolean;status?:string
}
export interface PreparationReports {version:1;reports:Report[]}
export type DashboardSection=ReportSection&{empty:string}
export type DashboardSource={label:string;text:string;available:boolean;url?:string}

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
const string=(value:unknown):value is string=>typeof value==='string'&&!value.includes('\0')
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(string)
export function safeSourceUrl(value:string):string {try{const url=new URL(value);return url.protocol==='https:'||url.protocol==='http:'?url.href:''}catch{return ''}}

/** Read saved reports without executing markup or spreading unrecognized metadata. */
export function normalizeReport(value:unknown):Report|null {
 if(!object(value)||!['admissions','inquiry'].includes(String(value.kind)))return null
 for(const key of ['id','target_id','title','summary','created_at','source_hash','model'])if(!string(value[key]))return null
 if(!Array.isArray(value.sections)||value.sections.length>20)return null
 const sections:ReportSection[]=[]
 for(const section of value.sections){
  if(!object(section)||!string(section.id)||!string(section.title)||!string(section.overview)||!Array.isArray(section.items)||section.items.length>80)return null
  const items:ReportItem[]=[]
  for(const item of section.items){if(!object(item)||!string(item.title)||!string(item.detail)||!string(item.reason)||!strings(item.steps)||!strings(item.evidence_refs))return null;items.push({title:item.title,detail:item.detail,reason:item.reason,steps:[...item.steps],evidence_refs:[...item.evidence_refs]})}
  sections.push({id:section.id,title:section.title,overview:section.overview,items})
 }
 const sources:ReportSource[]=Array.isArray(value.sources)?value.sources.filter(source=>object(source)&&string(source.id)&&string(source.title)&&string(source.url)).map(source=>({id:source.id,title:source.title,url:safeSourceUrl(source.url),...(Number.isInteger(source.year)?{year:source.year}:{})})):[]
 const school_connections:SchoolConnection[]=Array.isArray(value.school_connections)?value.school_connections.filter(row=>object(row)&&string(row.subject)&&string(row.task)&&string(row.reason)&&strings(row.conditions)).map(row=>({subject:row.subject,task:row.task,reason:row.reason,conditions:[...row.conditions],...(string(row.source)?{source:row.source}:{}),...(Number.isInteger(row.academic_year)?{academic_year:row.academic_year as number}:{}),...(Number.isInteger(row.grade)?{grade:row.grade as number}:{}),...(Number.isInteger(row.semester)?{semester:row.semester as number}:{}),...(string(row.status)?{status:row.status}:{}),...(strings(row.steps)?{steps:[...row.steps]}:{}),...(strings(row.learning_topics)?{learning_topics:[...row.learning_topics]}:{})})):[]
 const evidence_map:NonNullable<Report['evidence_map']>={}
 if(object(value.evidence_map))for(const [key,entry] of Object.entries(value.evidence_map))if(object(entry)&&string(entry.label)&&strings(entry.details))evidence_map[key]={label:entry.label,details:[...entry.details]}
 return {id:value.id as string,kind:value.kind as Report['kind'],target_id:value.target_id as string,title:value.title as string,summary:value.summary as string,sections,created_at:value.created_at as string,source_hash:value.source_hash as string,model:value.model as string,sources,school_connections,evidence_map,...(value.imported_unverified===true?{imported_unverified:true}:{}),...(string(value.status)?{status:value.status}:{})}
}
export function readReports(value:unknown):Report[]{return object(value)&&value.version===1&&Array.isArray(value.reports)?value.reports.map(normalizeReport).filter((report):report is Report=>report!==null):[]}
export function latestReport(reports:Report[],kind:Report['kind'],targetId:string):Report|undefined{return reports.filter(report=>report.kind===kind&&report.target_id===targetId).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0]}
export function isStale(report:Report,currentSourceHash:string|undefined):boolean{return !currentSourceHash||!report.source_hash||report.source_hash!==currentSourceHash}
export function schoolConnectionContext(connection:SchoolConnection,student:Pick<Student,'grade'|'academic_year'>):{scope:string;notice:string}{
 const scope=[connection.academic_year?connection.academic_year+'학년도':'학년도 미확인',connection.grade?connection.grade+'학년':'대상 학년 미확인',connection.semester?connection.semester+'학기':'학기 미확인'].join(' · ')
 let notice='계획 참고 · 현재 이수·과제 공지와 참여 조건을 확인합니다.'
 if(connection.grade&&student.grade&&connection.grade!==student.grade)notice=connection.grade>student.grade?'이후 학년의 선택 후보 · 현재 과제나 향후 이수를 확정하지 않습니다.':'이전 학년의 참고 자료 · 현재 과제로 적용하지 않습니다.'
 else if(connection.academic_year&&student.academic_year&&connection.academic_year!==student.academic_year)notice='다른 학년도의 계획 · 현재 운영과 과제 공지를 다시 확인합니다.'
 return {scope,notice}
}
export function reportQualityIssue(report:Report|undefined):string {
 if(!report)return '아직 생성한 결과가 없습니다.'
 if(report.imported_unverified)return '가져온 결과의 근거를 현재 자료로 다시 확인해 주세요.'
 if(report.sections.length!==5)return '다섯 가지 상세 영역을 모두 작성해야 합니다.'
 const details=new Set<string>()
 for(const section of report.sections){
  if(!section.title.trim()||!section.overview.trim()||section.items.length<3)return '영역별 설명과 구체적인 준비 항목을 보완해 주세요.'
  for(const item of section.items){
   const detail=item.detail.replace(/\s/g,'')
   if(!item.title.trim()||item.detail.trim().length<120||item.reason.trim().length<40||item.steps.filter(step=>step.trim()).length<2)return '항목별 설명·선정 이유·실행 방법을 보완해 주세요.'
   if(details.has(detail))return '같은 설명이 반복된 항목을 구체적인 내용으로 보완해 주세요.'
   details.add(detail)
  }
  const content=[section.overview,...section.items.flatMap(item=>[item.title,item.detail,item.reason,...item.steps])].join('').replace(/\s/g,'')
  if(content.length<650)return '영역별 상세 내용이 부족합니다. 근거와 학습 방법을 더 구체화해 주세요.'
 }
 return ''
}
export function stageIssue(session:Session,stage:PreparationStage,target:AdmissionTarget|undefined,admissions?:Report,currentSourceHash?:string):string {
 if(stage==='analysis')return analysisReportIssue(session)
 if(session.confirmed||session.guidance)return '확정하거나 안내한 결과의 수정은 새 회차에서 진행해 주세요.'
 if(session.imported_unverified)return '가져온 학생부와 분석을 현재 회차에서 다시 확인해 주세요.'
 const issue=analysisReportIssue(session);if(issue)return issue
 if(!target?.university.trim()||!target.major.trim())return '학생 기본자료에 희망 대학과 학과를 입력해 주세요.'
 if(stage==='inquiry'){
  if(!admissions)return '이 대학·학과의 학종 준비 전략을 먼저 생성해 주세요.'
  const quality=reportQualityIssue(admissions);if(quality)return quality
  if(isStale(admissions,currentSourceHash))return currentSourceHash?'입력 내용이 달라졌습니다. 학종 준비 전략을 먼저 다시 생성해 주세요.':'학종 준비 전략의 최신 입력을 확인해 주세요.'
 }
 return ''
}

export const stageSections:Record<PreparationStage,readonly {id:string;title:string;empty:string}[]>={
 analysis:[
  {id:'history',title:'학습 이력과 학생부 영역 지도',empty:'학생부에서 제공된 학년·학기, 판독 범위와 각 영역의 기록을 확인합니다.'},
  {id:'academic',title:'학업역량',empty:'교과의 개념 이해, 질문·탐구 방법과 수정 과정을 확인합니다. 기록이 없는 부분은 판단을 보류합니다.'},
  {id:'career',title:'진로역량',empty:'관심이 생긴 계기와 변화, 관련 과목·경험 및 선택 이유를 근거에서 확인합니다.'},
  {id:'community',title:'공동체역량',empty:'협업·소통·책임의 구체적인 행동과 개인의 기여를 확인합니다.'},
  {id:'synthesis',title:'종합 진단과 다음 준비',empty:'강점과 보완점의 연결, 추가 확인 질문과 다음 단계에서 사용할 판단을 정리합니다.'},
 ],
 admissions:[
  {id:'target',title:'목표와 공식 자료',empty:'대학·학과와 대입 학년도에 맞는 공식 자료의 적용 범위를 확인합니다.'},
  {id:'criteria',title:'대학의 평가와 전공의 학습 기반',empty:'공개된 학종 평가기준과 학과 교육내용을 구분하고 필요한 고교 학습 기반을 살핍니다.'},
  {id:'comparison',title:'학생과 목표의 대조',empty:'학생부 분석의 강점·보완점과 대학·학과 준비 관점을 연결합니다.'},
  {id:'priorities',title:'준비 우선순위',empty:'유지할 공부, 보완할 개념·기능, 과목 선택과 추가 확인 조건을 정리합니다.'},
  {id:'school',title:'학교에서 가능한 준비',empty:'실제 수업·과제·활동의 조건과 연결하고 선택 가능한 대안을 확인합니다.'},
 ],
 inquiry:[
  {id:'questions',title:'탐구 질문과 선정 이유',empty:'학생부 분석과 학종 준비 전략에서 출발한 중심 질문과 하위 질문을 세웁니다.'},
  {id:'concepts',title:'개념과 학습 방법',empty:'필요한 개념·기능과 자기 설명, 자료 읽기, 문제 풀이·오류 수정 방법을 정합니다.'},
  {id:'design',title:'탐구 설계',empty:'자료의 선택 기준과 비교·실험·분석 방법, 예상 한계와 판단 기준을 설계합니다.'},
  {id:'school',title:'학교 과제·활동 연결',empty:'실제 과제의 필수 절차·산출물·평가기준과 허용 조건에 맞춰 역할과 도움을 정합니다.'},
  {id:'reflection',title:'성찰과 다음 학습',empty:'학습 후 설명할 내용과 결과물 점검·수정 방법, 후속 질문과 선택의 대안을 정합니다.'},
 ],
}

/** Presentation only: partial analyses remain readable and downloadable. */
export function analysisDetailIssue(session:Session):string {
 const {record,analysis}=session;if(!record||!analysis)return ''
 const length=(value:string)=>displayText(value).replace(/<\/?[A-Za-z][^>]*>/g,'').replace(/\*\*|__|~~|`/g,'').replace(/\s/g,'').length
 const findings=[...analysis.strengths,...analysis.improvements]
 const groups=[findings.filter(item=>['학업','탐구'].includes(findingArea(item,record))),findings.filter(item=>findingArea(item,record)==='진로'),findings.filter(item=>['공동체','자기관리'].includes(findingArea(item,record)))]
 const lengths=[length(analysis.summary),...groups.map(items=>items.reduce((total,item)=>total+length(item.text)+length(item.guidance),0)),analysis.actions.reduce((total,item)=>total+[item.text,item.reason,item.expected_output||'',item.review_criteria||'',item.teacher_support||''].reduce((sum,text)=>sum+length(text),0),0)]
 const counts=[new Set(record.sections.map(source=>source.id)).size,...groups.map(items=>items.length),analysis.actions.length]
 const missing=stageSections.analysis.filter((_,index)=>lengths[index]!<650||counts[index]!<3).map(section=>section.title)
 return missing.length?'상세 근거 추가 필요: '+missing.join(' · ')+'. 제공된 기록과 저장된 판단을 그대로 확인할 수 있습니다. 자료가 적다는 이유로 학생의 역량이 부족하다고 판단하지 않습니다.':''
}

export function analysisDashboardSections(session:Session):DashboardSection[]{
 const sections:DashboardSection[]=stageSections.analysis.map(section=>({...section,overview:'',items:[]}))
 const record=session.record,analysis=session.analysis
 if(record){
  sections[0]!.overview=[record.readable_pages.length+'쪽 판독',record.unreadable_pages.length?record.unreadable_pages.length+'쪽 추가 확인 필요':'',...record.warnings].filter(Boolean).join(' · ')
  sections[0]!.items=record.sections.map(source=>({title:source.label,detail:evidenceLocation(source.id,record),reason:source.status==='present'?'학생부에 기록된 사실을 근거에서 펼쳐 확인할 수 있습니다.':source.status==='empty'?'제공된 자료에 내용이 없습니다. 역량 부족으로 해석하지 않습니다.':source.status==='not_applicable'?'이 자료에서 적용하지 않는 영역입니다.':'원문과 판독 상태를 추가로 확인해 주세요.',steps:[],evidence_refs:[source.id]}))
 }
 if(!analysis)return sections
 const destination=(area:string)=>area==='진로'?2:['공동체','자기관리'].includes(area)?3:['학업','탐구'].includes(area)?1:4
 for(const [kind,items] of [['강점',analysis.strengths],['보완·확인',analysis.improvements]] as const)for(const finding of items){sections[destination(findingArea(finding,record))]!.items.push({title:kind+' · '+findingArea(finding,record),detail:finding.text,reason:finding.guidance,steps:[],evidence_refs:[...finding.evidence_ids]})}
 sections[4]!.overview=analysis.summary
 for(const action of analysis.actions)sections[4]!.items.push({title:'다음 학습 · '+findingArea(action,record),detail:action.text,reason:action.reason,steps:[action.expected_output?'준비할 결과물: '+action.expected_output:'',action.review_criteria?'확인할 관점: '+action.review_criteria:'',action.teacher_support?'필요한 도움: '+action.teacher_support:''].filter(Boolean),evidence_refs:[...action.evidence_ids]})
 for(const question of analysis.questions)sections[4]!.items.push({title:'추가 확인 질문',detail:question,reason:'학생의 설명과 실제 자료를 함께 확인합니다.',steps:[],evidence_refs:[]})
 for(const limitation of analysis.limitations)sections[4]!.items.push({title:'분석 범위와 한계',detail:limitation,reason:'현재 자료에서 확인할 수 있는 범위를 구분합니다.',steps:[],evidence_refs:[]})
 return sections
}
export function resultDashboardSections(stage:'admissions'|'inquiry',report:Report|undefined):DashboardSection[]{
 if(!report)return stageSections[stage].map(section=>({...section,overview:'',items:[]}))
 return report.sections.map((section,index)=>({...section,empty:stageSections[stage][index]?.empty||'이 영역의 내용을 보완해 주세요.'}))
}
export function dashboardSource(ref:string,session:Session,report?:Report,admissions?:Report):DashboardSource {
 const mapped=report?.evidence_map?.[ref]
 if(mapped)return {label:mapped.label,text:mapped.details.join('\n\n'),available:true}
 const source=session.record?.sections.find(section=>section.id===ref)
 if(source)return {label:evidenceLocation(ref,session.record),text:source.text,available:true}
 const publicSource=report?.sources?.find(source=>source.id===ref||'public:'+source.id===ref)
 if(publicSource)return {label:publicSource.title+(publicSource.year?' · '+publicSource.year+'학년도':''),text:'공식 공개 자료',url:safeSourceUrl(publicSource.url),available:true}
 if(ref==='analysis:summary')return {label:'앞 단계 · 학생부 종합 분석',text:session.analysis?.summary||'',available:!!session.analysis}
 if(ref.startsWith('strength:')||ref.startsWith('need:'))return {label:ref.startsWith('strength:')?'앞 단계 · 확인된 강점':'앞 단계 · 보완할 학습',text:'학생부 분석의 관련 근거와 연결하여 해석을 확인해 주세요.',available:false}
 if(admissions&&(ref===admissions.id||ref==='admissions:summary'))return {label:'앞 단계 · '+admissions.title,text:admissions.summary,available:true}
 return {label:'근거 위치 확인 필요',text:'저장된 결과의 근거를 현재 학생부 분석과 공식 자료에서 확인해 주세요.',available:false}
}
