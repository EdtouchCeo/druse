import type { CanvasKey, Project, Review, SocialKey, Technique } from './types'
import { TECHNIQUES } from '../data/questionBank'

export const SOCIAL_KEYS: SocialKey[] = ['situation','empathy','definition','ideas','prototype','test']
export const CANVAS_KEYS: CanvasKey[] = ['problem','customerSegments','uvp','solution','channels','revenue','costs','keyMetrics','unfairAdvantage']
export const TECHNIQUE_KEYS: Technique[] = ['path','local','game','expert']
const record = <K extends string>(keys: K[]): Record<K,string> => Object.fromEntries(keys.map(k=>[k,''])) as Record<K,string>
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export function createProject(technique: Technique = 'path'): Project {
  const now = new Date().toISOString()
  return { schemaVersion:1, id:crypto.randomUUID(), revision:0, socialRevision:0, title:'나의 문제 해결 계획', createdAt:now, updatedAt:now,
    technique, mode:'guided', source:'직접 작성', practiceId:'', same:'', different:'', choiceReason:'', social:record(SOCIAL_KEYS),
    answers:{path:{},local:{},game:{},expert:{}}, canvas:record(CANVAS_KEYS), sources:'', author:'', reviews:{}, linkedPlan:null, sketch:'', variation:'' }
}
export function cloneProject(project: Project, title = `${project.title} — 새 연습`): Project {
  const clone=copy(project), now=new Date().toISOString()
  return {...clone,id:crypto.randomUUID(),title,revision:0,createdAt:now,updatedAt:now,reviews:{},linkedPlan:null}
}
export function snapshotPlan(project: Project) {
  return {revision:project.socialRevision,at:new Date().toISOString(),title:project.title,technique:project.technique,social:copy(project.social),answers:copy(project.answers)}
}
export function touchSocial(project: Project): void { project.socialRevision++ }
export function linkPlan(project: Project): void { project.linkedPlan=snapshotPlan(project) }
export function getIdeaText(project: Pick<Project,'technique'|'answers'|'social'>): string {
  return [project.social.ideas, ...TECHNIQUES[project.technique].questions.map((q,i)=>{
    const answer=project.answers[project.technique][q.id]?.trim()
    return answer ? `${i+1}. ${answer}` : ''
  })].filter(Boolean).join('\n\n')
}
export function getField(project: Project, field: string): string {
  const [group,key,id]=field.split(':')
  if(group==='social' && SOCIAL_KEYS.includes(key as SocialKey)) return project.social[key as SocialKey]
  if(group==='canvas' && CANVAS_KEYS.includes(key as CanvasKey)) return project.canvas[key as CanvasKey]
  if(group==='answer' && TECHNIQUE_KEYS.includes(key as Technique)) return project.answers[key as Technique][id!]??''
  return ''
}
export function setField(project: Project,field: string,value:string): void {
  if(value.length>40000) throw new Error('한 항목은 40,000자 이내로 작성해 주세요.')
  const [group,key,id]=field.split(':')
  if(group==='social' && SOCIAL_KEYS.includes(key as SocialKey)) {project.social[key as SocialKey]=value;touchSocial(project)}
  else if(group==='canvas' && CANVAS_KEYS.includes(key as CanvasKey)) project.canvas[key as CanvasKey]=value
  else if(group==='answer' && TECHNIQUE_KEYS.includes(key as Technique) && TECHNIQUES[key as Technique].questions.some(q=>q.id===id)) {
    project.answers[key as Technique][id!]=value;touchSocial(project)
  }
}
export function reviewField(project: Project,field:string,checks:string[]): Review {
  const original=getField(project,field)
  const prompts=original.trim()
    ? ['아래 질문과 내가 쓴 내용을 비교해 보세요. 문장의 뜻과 타당성은 직접 확인합니다.',...checks]
    : ['아직 작성한 내용이 없습니다. 작성 도움에서 질문을 읽고 내 상황에 맞는 생각을 먼저 적어 보세요.']
  const review={field,original,revision:project.revision,createdAt:new Date().toISOString(),prompts,reason:''}
  project.reviews[field]=review
  return review
}
export function suggestedCanvas(project: Project): Partial<Record<CanvasKey,string>> {
  return {problem:project.social.definition,customerSegments:project.social.empathy,solution:getIdeaText(project),keyMetrics:project.social.test}
}

// Backups are untrusted inputs: rebuild known keys instead of merging arbitrary objects.
export function validateProject(value: unknown): Project {
  function obj(v:unknown):Record<string,unknown> { if(!v||typeof v!=='object'||Array.isArray(v)) throw new Error('계획 파일의 항목 형식을 확인해 주세요.');return v as Record<string,unknown> }
  function text(v:unknown,max=40000):string { if(typeof v!=='string'||v.length>max) throw new Error('계획 파일의 글자 수나 형식이 올바르지 않습니다.');return v }
  function num(v:unknown):number { if(!Number.isSafeInteger(v)||Number(v)<0) throw new Error('계획 파일의 버전 정보가 올바르지 않습니다.');return Number(v) }
  function strings<K extends string>(v:unknown,keys:K[]):Record<K,string> {const o=obj(v);return Object.fromEntries(keys.map(k=>[k,text(o[k])])) as Record<K,string>}
  function answers(v:unknown):Project['answers'] {const o=obj(v); return Object.fromEntries(TECHNIQUE_KEYS.map(k=>{
    const values=obj(o[k]);const known=TECHNIQUES[k].questions.map(q=>q.id)
    return [k,Object.fromEntries(Object.entries(values).map(([id,t])=>{if(!known.includes(id)) throw new Error('지원하지 않는 질문이 들어 있습니다.');return [id,text(t)]}))]
  })) as Project['answers']}
  function technique(v:unknown):Technique {if(!TECHNIQUE_KEYS.includes(v as Technique)) throw new Error('지원하지 않는 기법입니다.');return v as Technique}
  const o=obj(value)
  if(o.schemaVersion!==1) throw new Error('지원하지 않는 계획 파일 버전입니다. 원래 사용한 도구에서 다시 내보내 주세요.')
  const p=createProject(technique(o.technique))
  if(!['example','guided','solo'].includes(o.mode as string)) throw new Error('연습 방식이 올바르지 않습니다.')
  p.mode=o.mode as Project['mode']; p.id=text(o.id,150);p.revision=num(o.revision);p.socialRevision=num(o.socialRevision)
  for(const key of ['title','createdAt','updatedAt','source','practiceId','same','different','choiceReason','sources','author','variation'] as const) p[key]=text(o[key])
  p.social=strings(o.social,SOCIAL_KEYS);p.canvas=strings(o.canvas,CANVAS_KEYS);p.answers=answers(o.answers)
  p.sketch=text(o.sketch,7_000_000)
  if(p.sketch&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p.sketch)) throw new Error('스케치는 PNG, JPG, WebP 이미지여야 합니다.')
  if(o.linkedPlan!==null) {const l=obj(o.linkedPlan);p.linkedPlan={revision:num(l.revision),at:text(l.at,100),title:text(l.title),technique:technique(l.technique),social:strings(l.social,SOCIAL_KEYS),answers:answers(l.answers)}}
  const reviews=obj(o.reviews)
  if(Object.keys(reviews).length>100) throw new Error('점검 기록이 너무 많습니다.')
  const validFields=[...SOCIAL_KEYS.map(k=>`social:${k}`),...CANVAS_KEYS.map(k=>`canvas:${k}`),...TECHNIQUE_KEYS.flatMap(k=>TECHNIQUES[k].questions.map(q=>`answer:${k}:${q.id}`))]
  for(const [key,value] of Object.entries(reviews)) {
    if(!validFields.includes(key)) throw new Error('지원하지 않는 점검 기록입니다.')
    const r=obj(value)
    if(!Array.isArray(r.prompts)||r.prompts.length>20) throw new Error('점검 질문 형식이 올바르지 않습니다.')
    p.reviews[key]={field:key,original:text(r.original),revision:num(r.revision),createdAt:text(r.createdAt,100),prompts:r.prompts.map(v=>text(v,3000)),reason:text(r.reason)}
  }
  return p
}
