import {displayText} from './reportContent'
import type {Session} from './types'
import type {DashboardSection,PreparationStage} from './preparationReports'

export interface DashboardHighlight {label:string;title:string;text:string;sectionId:string}
// These are previews of saved content. Full wording and conditions remain in the detail section.
export function previewText(value:string,limit=170):string {
 const text=displayText(value).replace(/\s+/g,' ').trim()
 return text.length>limit?text.slice(0,limit).trimEnd()+'…':text
}
export function dashboardHighlights(stage:PreparationStage,session:Session,sections:DashboardSection[]):DashboardHighlight[]{
 if(stage==='analysis'){
  const analysis=session.analysis
  if(!analysis)return []
  const sectionFor=(text:string)=>sections.find(section=>section.items.some(item=>item.detail===text))?.id||'synthesis'
  return [
   {label:'확인된 강점',items:analysis.strengths,empty:'저장된 강점 판단이 없습니다. 원문과 분석 범위를 확인하세요.'},
   {label:'보완·확인',items:analysis.improvements,empty:'저장된 보완 판단이 없습니다. 확인되지 않은 어려움을 추정하지 않습니다.'},
   {label:'다음 준비',items:analysis.actions,empty:'제안된 준비 과제가 없습니다. 추가 확인 질문에서 시작할 수 있습니다.'},
  ].map(({label,items,empty})=>({label,title:items.length?`${items.length}개 항목`: '추가 확인',text:items[0]?previewText(items[0].text):empty,sectionId:items[0]?sectionFor(items[0].text):'synthesis'}))
 }
 const preferred=stage==='admissions'?['priorities','academic_preparation']:['questions','inquiry_question']
 const section=preferred.map(id=>sections.find(item=>item.id===id)).find(Boolean)||sections[stage==='admissions'?3:0]
 return (section?.items||[]).slice(0,3).map((item,index)=>({label:`제안 ${String(index+1).padStart(2,'0')}`,title:item.title,text:previewText(item.steps[0]||item.detail),sectionId:section!.id}))
}
