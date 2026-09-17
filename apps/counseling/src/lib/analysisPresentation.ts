import type {Analysis,Finding,SchoolRecord} from './types'

export const analysisAreas=['학업','탐구','진로','공동체','자기관리','기타'] as const
export function findingArea(item:{area?:string;evidence_ids:string[];text?:string;quote?:string;guidance?:string},record?:SchoolRecord|null):string {
 const sources=item.evidence_ids.map(id=>record?.sections.find(section=>section.id===id))
 const careerWords=/관심|진로|전공|과목.{0,12}선택/
 if(['학업','탐구','기타'].includes(item.area||'')&&item.quote&&'guidance' in item&&sources.length
   &&sources.every(source=>source&&(['career','진로활동'].includes(source.category)||source.label.includes('진로활동')))
   &&careerWords.test(item.text||'')&&sources.every(source=>careerWords.test(source?.text||'')))return '진로'
 if(item.area&&analysisAreas.includes(item.area as typeof analysisAreas[number]))return item.area
 const categories=item.evidence_ids.map(id=>record?.sections.find(section=>section.id===id)?.category)
 if(categories.some(value=>['academic','subject','subject_detail'].includes(value||'')))return '학업'
 if(categories.includes('career'))return '진로'
 if(categories.includes('club'))return '탐구'
 if(categories.some(value=>['volunteer','autonomous','autonomy','behavior'].includes(value||'')))return '공동체'
 if(categories.includes('attendance'))return '자기관리'
 return '기타'
}
export function groupedFindings(analysis:Analysis,record?:SchoolRecord|null) {
 return analysisAreas.map(area=>({area,strengths:analysis.strengths.filter(item=>findingArea(item,record)===area),improvements:analysis.improvements.filter(item=>findingArea(item,record)===area)})).filter(group=>group.strengths.length||group.improvements.length)
}
export function evidenceLocation(id:string,record?:SchoolRecord|null):string {
 const source=record?.sections.find(section=>section.id===id)
 if(!source)return '원문 위치 확인 필요'
 return [source.label,source.academic_year?source.academic_year+'학년도':'',source.grade?source.grade+'학년':'',source.semester?source.semester+'학기':'',source.pages.length?source.pages.join(', ')+'쪽':''].filter(Boolean).join(' · ')
}
export function findingDirections(items:Finding[]):string {
 return items.map(item=>[item.area?'['+item.area+']':'',item.text,item.guidance].filter(Boolean).join('\n')).join('\n\n')
}
