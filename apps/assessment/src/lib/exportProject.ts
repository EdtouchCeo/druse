import type { Project } from './types'
import { cloneProject, getIdeaText, validateProject } from './model'
import { SOCIAL_GUIDES, CANVAS_GUIDES } from '../data/writingGuides'
import { TECHNIQUES } from '../data/questionBank'
export type DocumentKind='social'|'business'
export const escapeHtml=(text:string):string=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const safeName=(name:string)=>name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,80)||'나의 계획'
export function downloadBackup(project:Project):void {
  const blob=new Blob([JSON.stringify({format:'daeryun-assessment',version:1,project},null,2)],{type:'application/json;charset=utf-8'})
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${safeName(project.title)}_백업.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)
}
export function importBackup(text:string):Project {
  if(text.length>12_000_000)throw new Error('백업 파일이 너무 큽니다. 12MB 이내의 파일을 선택해 주세요.')
  let raw:unknown
  try {raw=JSON.parse(text)}catch{throw new Error('JSON 백업 파일을 읽지 못했습니다. 이 도구에서 내려받은 파일인지 확인해 주세요.')}
  if(!raw||typeof raw!=='object'||!('format' in raw)||raw.format!=='daeryun-assessment'||!('version' in raw)||raw.version!==1||!('project' in raw))throw new Error('이 도구의 백업 파일이 아닙니다.')
  const p=validateProject(raw.project), imported=cloneProject(p,`${p.title} — 불러온 계획`)
  imported.linkedPlan=p.linkedPlan;imported.reviews=p.reviews
  return imported
}
export function documentSections(project:Project,kind:DocumentKind):{title:string;text:string}[] {
  const sections=(kind==='social'?SOCIAL_GUIDES:CANVAS_GUIDES).map(g=>({title:kind==='social'&&g.key==='situation'?'문제 상황':g.label,text:kind==='social'?(g.key==='ideas'?getIdeaText(project):project.social[g.key as keyof Project['social']]):project.canvas[g.key as keyof Project['canvas']]}))
  if(kind==='social'&&project.variation.trim())sections[0]!.text += `\n\n이번 연습에서 바뀐 조건\n${project.variation}`
  if(kind==='social'&&(project.choiceReason.trim()||getIdeaText(project).trim()))sections.find(s=>s.title===SOCIAL_GUIDES.find(g=>g.key==='ideas')?.label)!.text=[`활용 기법: ${TECHNIQUES[project.technique].label}`,project.choiceReason.trim()?`선택한 이유\n${project.choiceReason}`:'',getIdeaText(project)].filter(Boolean).join('\n\n')
  if(project.sources.trim())sections.push({title:'참고한 자료',text:project.sources})
  return sections
}
export function documentText(project:Project,kind:DocumentKind):string {
  const title=kind==='social'?'AI 기반 사회 문제 해결 계획서':'비즈니스 모델 수립하기'
  return [title,project.title,project.author,...documentSections(project,kind).map(s=>`${s.title}\n${s.text||'(작성 전)'}`)].filter(Boolean).join('\n\n')
}
export function printHtml(project:Project,kind:DocumentKind):string {
  const title=kind==='social'?'AI 기반 사회 문제 해결 계획서':'비즈니스 모델 수립하기'
  const image=kind==='social'&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(project.sketch)?`<section><h2>프로토타입 스케치</h2><img src="${project.sketch}" alt="학생이 작성한 프로토타입 스케치"></section>`:''
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title+' — '+project.title)}</title><style>
  *{box-sizing:border-box}body{font-family:"Malgun Gothic",sans-serif;color:#17233d;margin:0 auto;padding:28px;max-width:900px;line-height:1.8;font-size:12pt}h1{font-size:23pt;line-height:1.4}h2{font-size:15pt;border-bottom:1px solid #ccd2dd;padding-bottom:6px;break-after:avoid}section{margin:24px 0}p{white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3}img{display:block;max-width:100%;max-height:220mm;object-fit:contain;break-inside:avoid}button{padding:12px 20px;font:inherit;margin:8px 0}.muted{color:#526078}@page{size:A4;margin:18mm}@media print{body{padding:0;max-width:none}.tools{display:none}}</style></head><body><div class="tools"><button onclick="window.print()">인쇄 / PDF 저장</button><p>인쇄 대상에서 PDF로 저장을 선택하세요.</p></div><h1>${title}</h1><p>${escapeHtml(project.title)}</p>${project.author?`<p class="muted">${escapeHtml(project.author)}</p>`:''}${documentSections(project,kind).map(s=>`<section><h2>${escapeHtml(s.title)}</h2><p>${escapeHtml(s.text||'(작성 전)')}</p></section>`).join('')}${image}</body></html>`
}
export function printProject(project:Project,kind:DocumentKind):void {
  const win=window.open('','_blank')
  if(!win)throw new Error('인쇄 창을 열지 못했습니다. 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.')
  win.opener=null;win.document.open();win.document.write(printHtml(project,kind));win.document.close()
}
export async function readSketch(file:File):Promise<string> {
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('PNG, JPG, WebP 이미지를 선택해 주세요.')
  if(file.size>5_000_000)throw new Error('스케치는 5MB 이하로 선택해 주세요.')
  const url=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(new Error('이미지를 읽지 못했습니다.'));r.readAsDataURL(file)})
  await new Promise<void>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve();image.onerror=()=>reject(new Error('이미지 내용이 손상되었습니다. 다른 파일을 선택해 주세요.'));image.src=url})
  return url
}
