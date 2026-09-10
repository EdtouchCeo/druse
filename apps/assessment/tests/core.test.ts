import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { createProject, copy, linkPlan, setField, reviewField, suggestedCanvas, validateProject, isUntouchedProject, SOCIAL_KEYS, CANVAS_KEYS } from '../src/lib/model'
import { saveProject, loadProject, listProjects, deleteProject } from '../src/lib/storage'
import { importBackup, documentSections, documentText, printHtml, escapeHtml } from '../src/lib/exportProject'
import { TECHNIQUES } from '../src/data/questionBank'
import { EXAMPLES } from '../src/data/examples'
import { PRACTICES } from '../src/data/practiceProblems'

const backup = (project: unknown) => JSON.stringify({ format:'daeryun-assessment', version:1, project })
test('only an untouched automatic draft can be reused for the first selected practice',()=>{
  assert.equal(isUntouchedProject(createProject()),true)
  for(const mutate of [(p:any)=>p.title='내가 정한 제목',(p:any)=>p.canvas.problem='가',(p:any)=>p.social.empathy='가',(p:any)=>p.answers.path['path-1']='가',(p:any)=>p.author='가',(p:any)=>p.practiceId='path-new',(p:any)=>reviewField(p,'social:empathy',[]),(p:any)=>linkPlan(p)]){const p=createProject();mutate(p);assert.equal(isUntouchedProject(p),false)}
})
function filledProject() {
  const p=createProject('expert')
  p.title='과목 선택 연습';p.author='내가 정한 별칭';p.sketch='data:image/png;base64,aGVsbG8='
  for (const key of SOCIAL_KEYS) setField(p,`social:${key}`,`사회-${key}`)
  for (const key of CANVAS_KEYS) setField(p,`canvas:${key}`,`모델-${key}`)
  for (const [key,t] of Object.entries(TECHNIQUES)) for(const q of t.questions) setField(p,`answer:${key}:${q.id}`,`답변-${q.id}`)
  p.sources='학교 안내서, 기준일 2026-09-10';p.same='구조는 같다';p.different='입력 조건은 다르다';p.choiceReason='공식 규칙으로 추론하기 때문';p.variation='시간표 변경';
  reviewField(p,'social:definition',['입력 조건이 구체적인가?']);p.reviews['social:definition'].reason='조건을 더 적었다'
  linkPlan(p)
  return p
}

test('38 questions have unique IDs, original examples and staged writing help',()=>{
  assert.deepEqual(Object.values(TECHNIQUES).map(t=>t.questions.length),[8,10,10,10])
  const all=Object.values(TECHNIQUES).flatMap(t=>t.questions)
  assert.equal(all.length,38);assert.equal(new Set(all.map(q=>q.id)).size,38)
  for(const q of all) for(const text of [q.question,q.example,q.clue,q.starter,...q.checks]) assert.ok(text.trim(),q.id)
})

test('four techniques provide eight complete example documents and four attributed practice situations',()=>{
  assert.equal(Object.keys(EXAMPLES).length,4);assert.equal(PRACTICES.length,4)
  assert.equal(new Set(PRACTICES.map(p=>p.technique)).size,4)
  for(const [key,example] of Object.entries(EXAMPLES)){
    assert.equal(example.technique,key);assert.deepEqual(Object.keys(example.social),SOCIAL_KEYS);assert.deepEqual(Object.keys(example.canvas),CANVAS_KEYS)
    for(const text of [...Object.values(example.social),...Object.values(example.canvas),example.source])assert.ok(text.trim(),key)
  }
  for(const practice of PRACTICES){assert.ok(practice.situation.length>100);assert.ok(practice.source.trim());assert.ok(practice.change.trim())}
  assert.match(PRACTICES.find(p=>p.technique==='path')!.source,/새로 만든/)
  assert.doesNotMatch(JSON.stringify([EXAMPLES,PRACTICES,TECHNIQUES]),/스캐폴딩|피드백/)
})

test('provided practice situations contain readable paragraphs and survive backup and social output intact',()=>{
  for(const practice of PRACTICES){
    const paragraphs=practice.situation.split(/\n\s*\n/).filter(t=>t.trim())
    assert.ok(paragraphs.length>=3,`${practice.technique}: paragraphs=${paragraphs.length}`)
    const p=createProject(practice.technique);p.practiceId=practice.id;p.source=practice.source;p.social.situation=practice.situation
    const restored=importBackup(backup(p))
    assert.equal(restored.social.situation,practice.situation)
    assert.ok(documentText(restored,'social').includes(practice.situation))
    assert.equal(documentSections(restored,'social').length,6)
  }
})

test('existing custom situation is retained as source material while subsequent writing changes',()=>{
  const p=createProject();p.social.situation='이전에 직접 저장한 고유한 문제 상황.\n\n기존 제한 조건을 보존한다.'
  const original=p.social.situation
  for(const key of SOCIAL_KEYS.filter(k=>k!=='situation'))setField(p,`social:${key}`,`다음 작성 단계 ${key}`)
  const restored=validateProject(JSON.parse(JSON.stringify(p)))
  assert.equal(restored.social.situation,original);assert.ok(documentText(restored,'social').includes(original))
})

test('social output includes the provided changed condition without altering the source situation',()=>{
  const p=createProject();p.social.situation=PRACTICES[0].situation;p.variation=PRACTICES[0].change
  const before=copy(p)
  const sections=documentSections(p,'social'),text=documentText(p,'social')
  assert.equal(sections.length,6);assert.ok(sections[0].text.includes(p.social.situation));assert.ok(sections[0].text.includes(p.variation));assert.ok(text.includes('이번 연습에서 바뀐 조건'))
  assert.deepEqual(p,before);assert.ok(!documentText(p,'business').includes(p.variation))
})

test('backup roundtrip retains every student artifact while importing as a separate project',()=>{
  const original=filledProject(), imported=importBackup(backup(original))
  assert.notEqual(imported.id,original.id)
  for(const key of ['social','canvas','answers','sources','author','sketch','linkedPlan','reviews','same','different','choiceReason','variation','technique','mode','socialRevision'] as const) assert.deepEqual(imported[key],original[key],key)
  imported.social.definition='다시 작성';assert.notEqual(imported.social.definition,original.social.definition)
})

test('invalid JSON, unsupported wrapper/version, incomplete fields and excessive text are rejected',()=>{
  for(const value of ['{','null','[]','{}',JSON.stringify({format:'other',version:1,project:filledProject()}),JSON.stringify({format:'daeryun-assessment',version:2,project:filledProject()})]) assert.throws(()=>importBackup(value))
  const mutations=[(p:any)=>p.schemaVersion=2,(p:any)=>p.mode='unknown',(p:any)=>p.technique='unknown',(p:any)=>p.revision=-1,(p:any)=>p.social.empathy=3,(p:any)=>p.social.test='a'.repeat(40001),(p:any)=>p.answers.path['unrecognized']='x',(p:any)=>p.sketch='data:image/svg+xml;base64,PHN2Zz4=', (p:any)=>p.reviews['social:test']={prompts:[]}]
  for(const mutate of mutations){const p=filledProject();mutate(p);assert.throws(()=>importBackup(backup(p)))}
})

test('prototype-shaped input cannot pollute application data',()=>{
  const raw=JSON.parse(backup(filledProject()));raw.project.social.__proto__={polluted:'yes'}
  Object.defineProperty(raw.project,'__proto__',{value:{polluted:'yes'},enumerable:true})
  const result=importBackup(JSON.stringify(raw))
  assert.equal((result as any).polluted,undefined);assert.equal(({} as any).polluted,undefined)
  assert.deepEqual(Object.keys(result.social),SOCIAL_KEYS)
})

test('linked plan is a frozen copy and suggestion preview does not overwrite the canvas',()=>{
  const p=filledProject(),snapshot=copy(p.linkedPlan),canvas=copy(p.canvas)
  setField(p,'social:definition','바뀐 문제');setField(p,'answer:expert:expert-1','바뀐 입력')
  assert.deepEqual(p.linkedPlan,snapshot);assert.ok(p.socialRevision>p.linkedPlan!.revision)
  assert.equal(suggestedCanvas(p).problem,'바뀐 문제');assert.deepEqual(p.canvas,canvas)
  linkPlan(p);assert.equal(p.linkedPlan!.social.definition,'바뀐 문제')
})

test('editing and restoring after review preserve the recorded original and student reason',()=>{
  const p=filledProject(),review=copy(p.reviews['social:definition'])
  setField(p,'social:definition','수정한 문장');assert.deepEqual(p.reviews['social:definition'],review)
  setField(p,'social:definition',review.original);assert.equal(p.social.definition,review.original)
  assert.equal(p.reviews['social:definition'].reason,review.reason)
  const empty=createProject();assert.match(reviewField(empty,'social:test',['질문']).prompts[0],/아직 작성/)
})

test('social output includes six actual fields and active-technique answers only',()=>{
  const p=filledProject(),sections=documentSections(p,'social'),text=documentText(p,'social')
  assert.equal(sections.length,6)
  for(const key of SOCIAL_KEYS)assert.ok(text.includes(`사회-${key}`),key)
  for(const q of TECHNIQUES.expert.questions)assert.ok(text.includes(`답변-${q.id}`))
  assert.ok(!text.includes('답변-path-1'));assert.ok(text.includes(p.choiceReason));assert.ok(!text.includes(p.sources))
  assert.ok(printHtml(p,'social').includes('<img src="data:image/png;'))
})

test('written ideas export the technique, choice reason and answers while untouched ideas remain empty',()=>{
  const p=createProject('expert'),empty=documentSections(p,'social')[3]!
  assert.equal(empty.text,'')
  p.choiceReason='조건을 명시한 공식 규칙으로 판단하기 때문이다.';setField(p,'answer:expert:expert-1','이수 과목과 관심 분야를 입력한다.')
  const sections=documentSections(p,'social'),ideas=sections[3]!.text
  assert.equal(sections.length,6);assert.ok(ideas.includes('활용 기법: 전문가 시스템'));assert.ok(ideas.includes(p.choiceReason));assert.ok(ideas.includes('이수 과목과 관심 분야를 입력한다.'))
})

test('business output maps all nine actual canvas fields and does not mix social drafts',()=>{
  const p=filledProject(),sections=documentSections(p,'business'),text=documentText(p,'business')
  assert.equal(sections.length,9)
  for(const key of CANVAS_KEYS)assert.ok(text.includes(`모델-${key}`),key)
  assert.ok(!text.includes(p.sources));assert.ok(!text.includes('사회-definition'));assert.ok(!printHtml(p,'business').includes('<img'))
})

test('print output escapes user text in title, body and author; unsafe sketch is omitted',()=>{
  const p=filledProject(),attack='<script>alert("owned")</script><img src=x onerror=alert(1)>'
  p.title=attack;p.author=attack;p.sources=attack;p.social.definition=attack;p.canvas.problem=attack;p.sketch='x" onerror="alert(1)'
  for(const kind of ['social','business'] as const){const html=printHtml(p,kind);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes(escapeHtml(attack)))}
  assert.equal(escapeHtml('&<>"\''),'&amp;&lt;&gt;&quot;&#39;')
})

test('saving snapshots input before async work and returns a new revision',async()=>{
  const p=filledProject(),pending=saveProject(p);p.social.definition='호출 이후 편집'
  const saved=await pending;assert.equal(saved.project.social.definition,'사회-definition');assert.equal(saved.conflict,false);assert.equal(saved.project.revision,1)
  assert.deepEqual(await loadProject(saved.project.id),saved.project)
  await deleteProject(saved.project.id);assert.equal(await loadProject(saved.project.id),null)
})

test('competing tabs preserve both drafts including linkage and review history',async()=>{
  const initial=(await saveProject(filledProject())).project
  const first=copy(initial),second=copy(initial)
  first.social.definition='첫째 창';second.social.definition='둘째 창'
  const results=await Promise.all([saveProject(first),saveProject(second)])
  assert.equal(results.filter(r=>r.conflict).length,1)
  const conflict=results.find(r=>r.conflict)!,regular=results.find(r=>!r.conflict)!
  assert.notEqual(conflict.project.id,initial.id);assert.equal(regular.project.id,initial.id)
  assert.deepEqual(conflict.project.reviews,initial.reviews);assert.deepEqual(conflict.project.linkedPlan,initial.linkedPlan)
  const stored=await listProjects();assert.ok(stored.some(p=>p.id===conflict.project.id));assert.ok(stored.some(p=>p.id===regular.project.id))
  assert.deepEqual(new Set(results.map(r=>r.project.social.definition)),new Set(['첫째 창','둘째 창']))
  for(const r of results)await deleteProject(r.project.id)
})

test('missing IndexedDB produces actionable Korean backup guidance',async()=>{
  const db=globalThis.indexedDB
  try{Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true,writable:true});await assert.rejects(()=>saveProject(createProject()),/백업 파일/)}
  finally{Object.defineProperty(globalThis,'indexedDB',{value:db,configurable:true,writable:true})}
})
