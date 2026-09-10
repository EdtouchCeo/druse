<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Copy, Download, FileText, FolderOpen, GraduationCap, LayoutGrid, Lightbulb, Menu, MoreHorizontal, Plus, Printer, RefreshCw, Save, ShieldCheck, Trash2, Upload, X } from 'lucide-vue-next'
import type { CanvasKey, Guide, Mode, Practice, Project, SocialKey, Technique } from './lib/types'
import { createProject, cloneProject, getField, getIdeaText, isUntouchedProject, linkPlan, reviewField, setReviewChecked, setField, suggestedCanvas, touchSocial } from './lib/model'
import { listProjects, loadProject, saveProject, deleteProject } from './lib/storage'
import { readViewState, writeViewState } from './lib/viewState'
import { documentSections, documentText, downloadBackup, importBackup, printProject, readSketch } from './lib/exportProject'
import { TECHNIQUES } from './data/questionBank'
import { EXAMPLES } from './data/examples'
import { PRACTICES } from './data/practiceProblems'
import { SOCIAL_GUIDES, CANVAS_GUIDES } from './data/writingGuides'
import WritingHelp from './components/WritingHelp.vue'
import ReviewPanel from './components/ReviewPanel.vue'

type Kind = 'social' | 'business'
type DialogKind = '' | 'projects' | 'start' | 'preview' | 'transfer' | 'variation' | 'delete' | 'copy'
const project = ref<Project>(createProject())
const projects = ref<Project[]>([])
const kind = ref<Kind>(location.pathname.includes('business-model') ? 'business' : 'social')
const landing = ref(!/social-plan|business-model/.test(location.pathname))
const step = ref(0)
const loading = ref(true)
const saveStatus = ref('불러오는 중')
const error = ref('')
const toast = ref('')
const helpOpen = ref(true)
const checksOpen = ref(false)
const mobileSteps = ref(false)
const dialog = ref<DialogKind>('')
const dialogElement = ref<HTMLElement>()
const importInput = ref<HTMLInputElement>()
const sketchInput = ref<HTMLInputElement>()
const exampleTechnique = ref<Technique>('path')
const exampleMode = ref(false)
const activeQuestion = ref(0)
const pendingPractice = ref<Practice | null>(null)
const deleteId = ref('')
const deleteBackedUp = ref(false)
const transferKeys = ref<CanvasKey[]>([])
const variationText = ref('')
const copyText = ref('')
const isSaving = ref(false)
let initialized = false
let suppressSave = false
let dirty = false
let saveTimer: ReturnType<typeof setTimeout> | undefined
let toastTimer: ReturnType<typeof setTimeout> | undefined
let savePromise: Promise<void> | null = null
let lastFocus: HTMLElement | null = null
let lastSaveOk = true
let restoringPosition = false

const techniques = Object.values(TECHNIQUES)
const activeTechnique = computed(() => exampleMode.value ? exampleTechnique.value : project.value.technique)
const technique = computed(() => TECHNIQUES[activeTechnique.value])
const example = computed(() => EXAMPLES[activeTechnique.value])
const guides = computed<Guide[]>(() => kind.value === 'social' ? SOCIAL_GUIDES : CANVAS_GUIDES)
const guide = computed(() => guides.value[step.value] || guides.value[0]!)
const situationStep = computed(() => kind.value === 'social' && guide.value.key === 'situation')
const writingGuides = computed(() => guides.value.filter(g => kind.value !== 'social' || g.key !== 'situation'))
const positionText = computed(() => situationStep.value ? '사전 읽기' : `${kind.value === 'social' ? step.value : step.value + 1} / ${writingGuides.value.length}`)
const ideaStep = computed(() => kind.value === 'social' && guide.value.key === 'ideas')
const question = computed(() => technique.value.questions[activeQuestion.value] || technique.value.questions[0]!)
const field = computed(() => ideaStep.value ? `answer:${project.value.technique}:${question.value.id}` : `${kind.value === 'social' ? 'social' : 'canvas'}:${guide.value.key}`)
const currentText = computed(() => getField(project.value, field.value))
const checks = computed(() => ideaStep.value ? question.value.checks : guide.value.checks)
const currentReview = computed(() => project.value.reviews[field.value])
const selectedPractice = computed(() => PRACTICES.find(p => p.id === project.value.practiceId))
const completion = computed(() => writingGuides.value.filter(g => g.key === 'ideas' && kind.value === 'social' ? getIdeaText(project.value).trim() : getField(project.value, `${kind.value === 'social' ? 'social' : 'canvas'}:${g.key}`).trim()).length)
const title = computed(() => kind.value === 'social' ? '사회 문제 해결 계획서' : '비즈니스 모델 수립하기')
const sections = computed(() => documentSections(project.value, kind.value))
const planChanged = computed(() => !!project.value.linkedPlan && project.value.linkedPlan.revision !== project.value.socialRevision)
const suggestions = computed(() => suggestedCanvas(project.value))
const transferEntries = computed(() => Object.entries(suggestions.value).map(([key, value]) => ({ key: key as CanvasKey, value: value || '', label: CANVAS_GUIDES.find(g => g.key === key)?.label || key })))
const deletionTarget = computed(() => deleteId.value === project.value.id ? project.value : projects.value.find(p => p.id === deleteId.value))
const answeredQuestions = computed(() => TECHNIQUES[project.value.technique].questions.filter(q => project.value.answers[project.value.technique][q.id]?.trim()).length)
const firstUnanswered = computed(() => TECHNIQUES[project.value.technique].questions.findIndex(q => !project.value.answers[project.value.technique][q.id]?.trim()))
const previousWriting = computed(() => SOCIAL_GUIDES.filter((g, index) => g.key !== 'situation' && (kind.value === 'business' || index < step.value)).map(g => ({ label: g.label, text: g.key === 'ideas' ? getIdeaText(project.value) : project.value.social[g.key as SocialKey] })).filter(item => item.text.trim()))
const hasPlanContent = computed(() => !!project.value.social.situation.trim() || SOCIAL_GUIDES.some(g => g.key === 'ideas' ? !!getIdeaText(project.value).trim() : !!project.value.social[g.key as SocialKey].trim()))

function rememberPosition() { if (initialized && !exampleMode.value && !restoringPosition) writeViewState(project.value, kind.value, step.value, activeQuestion.value) }
function restorePosition() { restoringPosition = true; const position = readViewState(project.value, kind.value); step.value = position.step; activeQuestion.value = position.question; restoringPosition = false }
watch([step, activeQuestion], () => { rememberPosition(); checksOpen.value = false }, { flush: 'sync' })

function announce(message: string) { toast.value = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.value = '' }, 4500) }
function serialize(p: Project): Project { return JSON.parse(JSON.stringify(p)) as Project }
function write(value: string) { try { setField(project.value, field.value, value) } catch(e) { error.value = e instanceof Error ? e.message : '입력 내용을 확인해 주세요.' } }
function openPracticePicker() { pendingPractice.value = null; dialog.value = 'start' }
function startNew() { if (kind.value === 'social') openPracticePicker(); else void newProject() }
function changeTechnique(value: Technique) { if (exampleMode.value) { exampleTechnique.value = value; activeQuestion.value = 0 } else { rememberPosition(); project.value.technique = value; touchSocial(project.value); restorePosition() } }
function setStep(index: number) { step.value = index; mobileSteps.value = false; nextTick(() => document.querySelector<HTMLElement>('#editor-heading')?.focus()) }
function selectQuestion(index: number) { activeQuestion.value = index; nextTick(() => { const heading = document.querySelector<HTMLElement>('#question-heading'); heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }) }
function isWritten(g: Guide) { return g.key === 'ideas' && kind.value === 'social' ? !!getIdeaText(project.value).trim() : !!getField(project.value, `${kind.value === 'social' ? 'social' : 'canvas'}:${g.key}`).trim() }

watch(project, () => {
  if (!initialized || suppressSave) return
  dirty = true; saveStatus.value = '저장 대기'; clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { void persist() }, 650)
}, { deep: true, flush: 'sync' })

async function persist(): Promise<boolean> {
  clearTimeout(saveTimer)
  if (savePromise) { await savePromise; if (!lastSaveOk) return false; if (dirty) return persist(); return true }
  if (!dirty) return true
  dirty = false; isSaving.value = true; saveStatus.value = '저장 중'
  const snapshot = serialize(project.value)
  savePromise = (async () => {
    try {
      const result = await saveProject(snapshot)
      if (project.value.id === snapshot.id) {
        suppressSave = true
        project.value.id = result.project.id; project.value.revision = result.project.revision; project.value.updatedAt = result.project.updatedAt
        suppressSave = false
        if (result.conflict) { updateUrl(true); announce('다른 창의 변경과 겹쳐 별도 사본으로 보관했습니다.') }
      }
      saveStatus.value = dirty ? '저장 대기' : '이 기기에 저장됨'
      projects.value = await listProjects()
      lastSaveOk = true
    } catch (e) { lastSaveOk = false; dirty = true; saveStatus.value = '저장하지 못함'; error.value = `${e instanceof Error ? e.message : '기기 저장소를 사용할 수 없습니다.'} 원고를 백업 파일로 내려받아 보관하세요. 현재 원고를 보존하기 위해 다른 원고로 전환하지 않습니다.` }
    finally { isSaving.value = false }
  })()
  await savePromise; savePromise = null
  return lastSaveOk
}

function updateUrl(replace = false) {
  const pathname = landing.value ? '/assessment/' : `/assessment/${kind.value === 'social' ? 'social-plan' : 'business-model'}/`
  const url = `${pathname}?project=${encodeURIComponent(project.value.id)}`
  if (replace) history.replaceState({}, '', url); else history.pushState({}, '', url)
  document.title = `${landing.value ? '수행평가 준비' : title.value} | 대륜고등학교`
}
async function navigate(next: Kind) { await persist(); rememberPosition(); kind.value = next; landing.value = false; if (!exampleMode.value) restorePosition(); else { step.value = 0; activeQuestion.value = 0 }; updateUrl(); nextTick(() => document.querySelector<HTMLElement>('#editor-heading')?.focus()) }
async function chooseProject(id: string, remember = true, openEditor = true) {
  if (!await persist()) return
  if (remember) rememberPosition()
  try {
    const loaded = await loadProject(id)
    if (!loaded) { error.value = '이 원고를 찾을 수 없습니다. 백업 파일이 있다면 불러오세요.'; return }
    suppressSave = true; project.value = loaded; suppressSave = false; dirty = false
    exampleMode.value = false; if (openEditor) landing.value = false; restorePosition(); dialog.value = ''; saveStatus.value = '이 기기에 저장됨'; updateUrl(true)
  } catch { error.value = '원고를 열지 못했습니다. 원고 목록을 다시 열거나 백업 파일을 불러오세요.' }
}
async function newProject(practice?: Practice) {
  if (!await persist()) return
  rememberPosition()
  const fresh = createProject(practice?.technique || project.value.technique)
  if (practice && isUntouchedProject(project.value)) { fresh.id = project.value.id; fresh.revision = project.value.revision; fresh.createdAt = project.value.createdAt }
  if (practice) { fresh.title = practice.title; fresh.practiceId = practice.id; fresh.source = practice.source; fresh.social.situation = practice.situation; writeViewState(fresh, 'social', 0, 0); writeViewState(fresh, 'business', 0, 0) }
  suppressSave = true; project.value = fresh; suppressSave = false
  dirty = true; await persist(); exampleMode.value = false; landing.value = false; restorePosition(); dialog.value = ''; pendingPractice.value = null; updateUrl()
}
async function duplicate() { if (!await persist()) return; rememberPosition(); const position = readViewState(project.value, kind.value); const copied = cloneProject(project.value); writeViewState(copied, kind.value, position.step, position.question); suppressSave = true; project.value = copied; suppressSave = false; exampleMode.value = false; restorePosition(); dirty = true; await persist(); updateUrl(true); dialog.value = ''; announce('현재 원고를 복제했습니다.') }
async function removeProject() {
  const id = deleteId.value
  if (!deleteBackedUp.value) return
  try { if (!await persist()) return; await deleteProject(id); projects.value = await listProjects(); dialog.value = ''; if (project.value.id === id) { if (projects.value[0]) await chooseProject(projects.value[0].id); else await newProject() }; announce('원고를 삭제했습니다.') }
  catch { error.value = '원고를 삭제하지 못했습니다. 잠시 뒤 다시 시도하세요.' }
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return
  try { if (file.size > 12_000_000) throw new Error('백업 파일은 12MB 이하여야 합니다.'); const restored = importBackup(await file.text()); if (!await persist()) return; rememberPosition(); suppressSave = true; project.value = restored; suppressSave = false; dirty = true; await persist(); exampleMode.value = false; dialog.value = ''; landing.value = false; restorePosition(); updateUrl(); announce('백업을 새 원고로 불러왔습니다.') }
  catch (e) { error.value = e instanceof Error ? e.message : '백업 파일을 확인해 주세요.' }
  finally { input.value = '' }
}
async function uploadSketch(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return
  try { project.value.sketch = await readSketch(file); touchSocial(project.value); announce('스케치를 원고에 넣었습니다.') }
  catch (e) { error.value = e instanceof Error ? e.message : '이미지를 열지 못했습니다.' }
  finally { input.value = '' }
}
function checkDraft() { reviewField(project.value, field.value, checks.value) }
function saveReason(value: string) { const review = project.value.reviews[field.value]; if (review) review.reason = value }
function saveCheck(index: number, checked: boolean) { setReviewChecked(project.value, field.value, index, checked) }
function openTransfer() { transferKeys.value = transferEntries.value.filter(e => e.value.trim() && !project.value.canvas[e.key].trim()).map(e => e.key); dialog.value = 'transfer' }
function applyTransfer() {
  let count = 0
  for (const key of transferKeys.value) { if (!project.value.canvas[key].trim() && suggestions.value[key]) { project.value.canvas[key] = suggestions.value[key]!; count++ } }
  linkPlan(project.value); dialog.value = ''; announce(count ? `${count}개 빈 항목에 계획 내용을 옮겼습니다.` : '현재 계획서를 참고 자료로 연결했습니다.')
}
async function createVariation() {
  if (!variationText.value.trim()) return
  if (!await persist()) return; rememberPosition(); const position = readViewState(project.value, kind.value); const copied = cloneProject(project.value, `${project.value.title} · 조건 바꾸기`); copied.variation = variationText.value.trim(); copied.mode = 'guided'; writeViewState(copied, kind.value, position.step, position.question)
  suppressSave = true; project.value = copied; suppressSave = false; dirty = true; await persist(); exampleMode.value = false; restorePosition(); dialog.value = ''; updateUrl(); announce('원래 원고를 보존하고 조건 변화 연습용 사본을 만들었습니다.')
}
function openVariation() { if (!project.value.social.situation.trim()) { openPracticePicker(); return }; variationText.value = selectedPractice.value?.change || PRACTICES.find(p => p.technique === project.value.technique)?.change || ''; dialog.value = 'variation' }
function setMode(mode: Mode) { rememberPosition(); const wasExample = exampleMode.value; exampleMode.value = mode === 'example'; if (exampleMode.value) exampleTechnique.value = project.value.technique; else { project.value.mode = mode; if (wasExample) restorePosition() }; checksOpen.value = false }
async function copyDocument() { const text = documentText(project.value, kind.value); try { await navigator.clipboard.writeText(text); announce('문서 전체를 복사했습니다.') } catch { copyText.value = text; dialog.value = 'copy' } }
function printDocument() { try { printProject(project.value, kind.value) } catch (e) { error.value = e instanceof Error ? e.message : '인쇄 창을 열지 못했습니다. 브라우저의 팝업 허용을 확인하세요.' } }
async function popstate() {
  if (!await persist()) { updateUrl(true); return }; rememberPosition(); kind.value = location.pathname.includes('business-model') ? 'business' : 'social'; landing.value = !/social-plan|business-model/.test(location.pathname)
  const id = new URLSearchParams(location.search).get('project'); if (id && id !== project.value.id) await chooseProject(id, false, !landing.value); else if (!exampleMode.value) restorePosition(); else { step.value = 0; activeQuestion.value = 0 }
}
function beforeUnload(event: BeforeUnloadEvent) { if (dirty || isSaving.value) { event.preventDefault(); event.returnValue = '' } }
function trapDialog(event: KeyboardEvent) {
  if (event.key === 'Escape') { dialog.value = ''; return }
  if (event.key !== 'Tab') return
  const elements = dialogElement.value?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea, select, [tabindex="0"]')
  if (!elements?.length) return
  const first = elements[0]; const last = elements[elements.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
watch(dialog, async (value, previous) => {
  if (value && !previous) lastFocus = document.activeElement as HTMLElement
  document.body.style.overflow = value ? 'hidden' : ''
  if (value) { await nextTick(); dialogElement.value?.querySelector<HTMLElement>('button, input, textarea')?.focus(); if (value === 'projects') { try { projects.value = await listProjects() } catch { error.value = '원고 목록을 불러오지 못했습니다.' } } }
  else lastFocus?.focus()
})
onMounted(async () => {
  try { projects.value = await listProjects(); const id = new URLSearchParams(location.search).get('project'); const existing = id ? await loadProject(id) : projects.value[0]; if (existing) project.value = existing; else { if (id) error.value = '이 주소의 원고는 현재 기기에 없습니다. 백업 파일을 불러오거나 새 원고를 작성하세요.'; dirty = true }; restorePosition(); initialized = true; await persist(); saveStatus.value = dirty ? '저장하지 못함' : '이 기기에 저장됨'; updateUrl(true) }
  catch { initialized = true; dirty = true; saveStatus.value = '저장소 사용 불가'; error.value = '이 브라우저에서 기기 저장소를 열지 못했습니다. 작성은 가능하며 백업 파일을 내려받아 보관해야 합니다.' }
  finally { loading.value = false }
  window.addEventListener('popstate', popstate); window.addEventListener('beforeunload', beforeUnload)
})
onBeforeUnmount(() => { clearTimeout(saveTimer); clearTimeout(toastTimer); window.removeEventListener('popstate', popstate); window.removeEventListener('beforeunload', beforeUnload); document.body.style.overflow = '' })
</script>

<template>
  <a class="skip-link" href="#workspace-main">본문으로 건너뛰기</a>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="/#student/assessment-help/subject"><span class="brand-mark"><GraduationCap :size="23" /></span><span><strong>대륜고등학교</strong><small>수행평가 준비</small></span></a>
      <nav class="tool-switch" aria-label="작성 도구"><button :class="{ active: kind === 'social' && !landing }" @click="navigate('social')"><FileText :size="17" /><span>사회 문제 해결</span></button><button :class="{ active: kind === 'business' && !landing }" @click="navigate('business')"><LayoutGrid :size="17" /><span>비즈니스 모델</span></button></nav>
      <button class="secondary projects-trigger" @click="dialog = 'projects'"><FolderOpen :size="18" /><span>내 원고</span></button>
    </header>
    <div v-if="error" class="error-banner" role="alert"><span>{{ error }}</span><button class="text-button" @click="downloadBackup(project)">원고 백업</button><button class="icon-button" aria-label="오류 안내 닫기" @click="error = ''"><X :size="18" /></button></div>
    <div v-if="loading" class="loading-state" role="status"><span class="loading-dot"></span>이 기기에 저장한 원고를 불러오고 있습니다.</div>

    <main v-else-if="landing" id="workspace-main" class="landing">
      <div class="landing-intro"><span class="eyebrow">AI 문제 해결 · 수행평가 준비</span><h1>예제에서 방법을 찾고,<br />내 문제의 해결책을 씁니다.</h1><p>비슷한 새 상황에서도 스스로 계획할 수 있도록 준비하세요.<br class="desktop-only" /> 질문을 따라 쓴 계획을 비즈니스 모델로 이어갈 수 있습니다.</p></div>
      <div class="landing-cards"><button class="landing-card social-card" @click="navigate('social')"><span class="card-icon"><FileText :size="28" /></span><span class="eyebrow">01 · 문제에서 해결 계획으로</span><h2>사회 문제 해결 계획서</h2><p>문제를 이해하고, 네 가지 알고리즘의 질문으로 해결 절차를 구체화합니다.</p><span class="card-link">계획서 작성하기 <ArrowRight :size="18" /></span></button><button class="landing-card business-card" @click="navigate('business')"><span class="card-icon"><LayoutGrid :size="28" /></span><span class="eyebrow">02 · 해결 계획에서 서비스로</span><h2>비즈니스 모델 수립하기</h2><p>누구의 문제를 해결하는지, 어떤 가치를 어떻게 전달할지 아홉 칸에 정리합니다.</p><span class="card-link">비즈니스 모델 작성하기 <ArrowRight :size="18" /></span></button></div>
      <div class="learning-path"><div><span>1</span><p><strong>예제로 익히기</strong>완성된 글에서 해결 원리를 찾습니다.</p></div><ChevronRight :size="18" /><div><span>2</span><p><strong>도움받아 써 보기</strong>질문과 단서로 내 글을 씁니다.</p></div><ChevronRight :size="18" /><div><span>3</span><p><strong>혼자 써 보기</strong>달라진 상황에 방법을 적용합니다.</p></div></div>
      <p class="privacy-note"><ShieldCheck :size="18" /> 로그인 없이 사용할 수 있습니다. 원고와 이미지는 이 기기에 저장됩니다.</p>
    </main>

    <template v-else-if="!loading">
      <div class="document-bar"><div class="document-title"><span class="eyebrow">{{ kind === 'social' ? 'SOCIAL PROBLEM SOLVING' : 'LEAN CANVAS' }}</span><h1>{{ title }}</h1></div><div class="document-actions"><span class="save-status" role="status"><span :class="['status-dot', { pending: dirty || isSaving }]" />{{ saveStatus }}</span><button class="secondary" @click="dialog = 'preview'"><BookOpen :size="17" /><span>전체 보기</span></button><button class="primary" @click="printDocument"><Printer :size="17" /><span>인쇄 / PDF 저장</span></button></div></div>
      <div class="workspace-layout" :class="{ 'without-help': !helpOpen }">
        <aside class="steps-sidebar" :class="{ 'mobile-expanded': mobileSteps }">
          <button class="mobile-step-toggle" :aria-expanded="mobileSteps" @click="mobileSteps = !mobileSteps"><Menu :size="18" /> {{ guide.label }}<span>{{ positionText }}</span></button>
          <div class="sidebar-content"><div class="sidebar-heading"><span>글이 있는 항목</span><span>{{ completion }} / {{ writingGuides.length }}</span></div><div class="progress-track"><span :style="{ width: `${completion / writingGuides.length * 100}%` }" /></div><p class="progress-caption">{{ kind === 'social' ? '내용을 적은 항목 수이며 완성도를 뜻하지 않습니다.' : '내용을 적은 항목 수이며 완성도를 뜻하지 않습니다.' }}</p>
          <nav aria-label="작성 단계"><button v-for="(g, index) in guides" :key="g.key" class="step-item" :class="{ active: index === step }" :aria-current="index === step ? 'step' : undefined" @click="setStep(index)"><span class="step-number"><BookOpen v-if="kind === 'social' && g.key === 'situation'" :size="16" /><Check v-else-if="isWritten(g) && index !== step" :size="15" /><template v-else>{{ String(kind === 'social' ? index : index + 1).padStart(2, '0') }}</template></span><span>{{ g.label }}</span><ChevronRight v-if="index === step" :size="15" /></button></nav>
          <div class="sidebar-bottom"><p>생각을 이어 가세요.</p><button class="text-button" @click="navigate(kind === 'social' ? 'business' : 'social')">{{ kind === 'social' ? '비즈니스 모델로 이어쓰기' : '사회 문제 해결 계획서로' }}<ArrowRight :size="16" /></button><a href="/#student/assessment-help/subject"><ArrowLeft :size="14" /> 평가과제 도움 자료로</a></div></div>
        </aside>
        <main id="workspace-main" class="editor-main">
          <div class="project-heading"><label for="project-title">원고 제목</label><input id="project-title" v-model="project.title" maxlength="180" placeholder="내 프로젝트에 이름을 붙여 주세요" /><button class="icon-button" aria-label="원고 관리" @click="dialog = 'projects'"><MoreHorizontal :size="20" /></button></div>
          <div class="mode-tabs" role="group" aria-label="연습 방식"><button :class="{ active: exampleMode }" @click="setMode('example')">예제로 익히기</button><button :class="{ active: !exampleMode && project.mode !== 'solo' }" @click="setMode('guided')">도움받아 써 보기</button><button :class="{ active: !exampleMode && project.mode === 'solo' }" @click="setMode('solo')">혼자 써 보기</button></div>
          <div v-if="exampleMode" class="example-banner"><BookOpen :size="19" /><p>완성 예제를 읽고 있습니다. 내 원고는 따로 보관됩니다. 전체 보기와 인쇄에는 내 원고가 표시됩니다.</p><button class="text-button" @click="setMode('guided')">내 글로 돌아가기</button></div>
          <div v-else-if="project.variation" class="variation-banner"><span class="eyebrow">조건 바꾸기 연습</span><p>{{ project.variation }}</p><small>제공된 변화가 해결 계획에 어떤 영향을 주는지 확인하세요. 공감하기 이후의 글을 다듬고 수정 이유를 남길 수 있습니다.</small></div>
          <div v-if="kind === 'business' && !exampleMode && hasPlanContent" class="plan-link-banner"><div><strong>{{ !project.linkedPlan ? '계획서의 생각을 이어 오세요' : planChanged ? '연결한 계획서가 수정되었습니다' : '사회 문제 해결 계획서가 연결되어 있습니다' }}</strong><p>{{ !project.linkedPlan ? '문제, 대상, 해결 절차를 참고하며 모델을 구체화합니다.' : '이미 작성한 캔버스는 유지됩니다. 필요한 항목을 선택해 가져오세요.' }}</p></div><button class="secondary" @click="openTransfer">{{ project.linkedPlan ? '연결 내용 확인' : '계획 가져오기' }}<ArrowRight :size="16" /></button></div>
          <div v-if="kind === 'business' && !exampleMode && !hasPlanContent" class="business-start-note"><h3>어떤 문제를 해결할지 먼저 살펴보세요.</h3><p>완성 예제를 읽거나, 제공된 문제로 사회 문제 해결 계획서를 준비할 수 있습니다. 바로 아래 항목에 생각을 써도 됩니다.</p><div class="button-row"><button class="secondary" @click="setMode('example')"><BookOpen :size="17" />예제로 익히기</button><button class="primary" @click="navigate('social')">계획서부터 준비하기<ArrowRight :size="17" /></button></div></div>
          <details v-if="!exampleMode && !situationStep && (project.social.situation.trim() || previousWriting.length)" :key="project.id" class="context-reference"><summary><BookOpen :size="17" /><span>문제 상황과 앞에서 쓴 글 보기</span></summary><div class="reference-body"><section v-if="project.social.situation.trim()"><h3>제공된 문제 상황</h3><div class="situation-passages"><p v-for="(paragraph, index) in project.social.situation.split(/\n\s*\n/)" :key="index">{{ paragraph }}</p></div><small v-if="project.source">자료 출처: {{ project.source }}</small></section><section v-if="project.variation"><h3>제공된 조건 변화</h3><p>{{ project.variation }}</p></section><section v-for="item in previousWriting" :key="item.label"><h3>내가 쓴 {{ item.label }}</h3><p>{{ item.text }}</p></section></div></details>
          <div class="editor-section-heading"><div><span class="eyebrow">{{ situationStep ? '먼저 읽기' : `STEP ${String(kind === 'social' ? step : step + 1).padStart(2, '0')}` }}</span><h2 id="editor-heading" tabindex="-1">{{ guide.label }}</h2></div><button class="help-toggle secondary" :aria-expanded="checksOpen" aria-controls="nearby-checks" @click="checksOpen = !checksOpen"><Lightbulb :size="16" />{{ checksOpen ? '확인할 점 접기' : '확인할 점' }}</button></div>
          <section v-if="checksOpen" id="nearby-checks" class="nearby-checks"><h3>{{ situationStep ? '읽으며 확인할 것' : '이 글에서 확인할 것' }}</h3><ul><li v-for="item in checks" :key="item">{{ item }}</li></ul></section>

          <template v-if="exampleMode">
            <label class="field-label">읽을 예제<select :value="exampleTechnique" @change="changeTechnique(($event.target as HTMLSelectElement).value as Technique)"><option v-for="t in techniques" :key="t.key" :value="t.key">{{ t.label }} · {{ EXAMPLES[t.key].title }}</option></select></label>
            <article class="example-document" :class="{ 'provided-situation': situationStep }"><span class="eyebrow">{{ example.title }}</span><h3>{{ guide.label }}</h3><p>{{ kind === 'social' ? example.social[guide.key as SocialKey] : example.canvas[guide.key as CanvasKey] }}</p><footer>자료 출처: {{ example.source }}</footer></article>
            <section v-if="ideaStep" class="question-list"><h3>아이디어를 구체화하는 {{ technique.questions.length }}가지 질문</h3><details v-for="(q,index) in technique.questions" :key="q.id"><summary>{{ index + 1 }}. {{ q.question }}</summary><p>{{ q.example }}</p></details></section>
            <div class="example-next"><p>예제의 해결 방법을 다른 연습 문제에 적용해 보세요.</p><button class="primary" @click="setMode('guided')">{{ situationStep ? '연습 문제로 준비하기' : '내 계획 이어 쓰기' }}<ArrowRight :size="16" /></button></div>
          </template>

          <template v-else>
            <template v-if="situationStep">
              <div class="start-toolbar"><p>제공된 상황을 읽고 대상과 조건을 확인하세요. 해결 계획은 다음 다섯 단계에서 작성합니다.</p><button v-if="project.social.situation.trim()" class="secondary" @click="openPracticePicker">{{ project.social.situation.trim() ? '다른 연습 문제 고르기' : '연습 문제 고르기' }}<ChevronRight :size="16" /></button></div>
              <article v-if="project.social.situation.trim()" class="provided-situation" aria-label="제공된 문제 상황"><header><span class="eyebrow">{{ selectedPractice ? '제공된 연습 문제' : '이 원고에 보관된 문제 상황' }}</span><h3>{{ selectedPractice?.title || project.title }}</h3></header><div class="situation-passages"><p v-for="(paragraph, index) in project.social.situation.split(/\n\s*\n/)" :key="index">{{ paragraph }}</p></div><footer v-if="project.source && project.source !== '직접 작성'">자료 출처: {{ project.source }}</footer></article>
              <section v-else class="situation-empty"><BookOpen :size="30" /><h3>읽을 연습 문제를 먼저 골라 주세요.</h3><p>문제 상황은 미리 제공됩니다. 한 가지를 선택하면 새 원고에서 공감하기부터 준비할 수 있습니다.</p><button class="primary" @click="openPracticePicker">연습 문제 고르기<ArrowRight :size="17" /></button></section>
              <div v-if="project.social.situation.trim()" class="reading-next"><span class="eyebrow">읽은 뒤에는</span><p>등장인물이 겪는 불편과 요구를 생각하며 ‘공감하기’로 이어 가세요.</p></div>
            </template>
            <template v-else>
            <template v-if="ideaStep">
              <p class="section-description">내 문제에 맞는 방법을 고르고, 질문에 답하며 실행 순서를 만들어 보세요.</p>
              <div class="technique-grid"><button v-for="t in techniques" :key="t.key" :class="{ selected: project.technique === t.key }" @click="changeTechnique(t.key)"><span>{{ t.label }}</span><small>{{ t.summary }}</small></button></div>
              <label class="field-label">고려한 방법과 이 방법을 고른 이유<textarea v-model="project.choiceReason" rows="3" placeholder="다른 해결 방법과 비교했을 때, 이 방법이 내 문제의 어떤 조건에 맞나요?" @input="touchSocial(project)" /></label>
              <details class="concept-note"><summary>{{ technique.label }}의 흐름과 확인할 점</summary><p>{{ technique.flow }}</p><p>{{ technique.caution }}</p></details>
              <div class="question-navigation" role="group" aria-label="아이디어 질문"><button v-for="(q, index) in technique.questions" :key="q.id" :class="{ active: index === activeQuestion, answered: project.answers[project.technique]?.[q.id]?.trim() }" :aria-label="`질문 ${index + 1}: ${q.question}`" :aria-pressed="index === activeQuestion" @click="selectQuestion(index)">{{ index + 1 }}</button></div>
              <div class="question-progress"><span>답한 질문 {{ answeredQuestions }} / {{ technique.questions.length }}</span><button v-if="firstUnanswered !== -1" class="text-button" @click="selectQuestion(firstUnanswered)">다음 빈 질문으로<ArrowRight :size="16" /></button><span v-else>모든 질문에 글을 적었습니다.</span></div>
              <div class="question-heading"><span>질문 {{ activeQuestion + 1 }} / {{ technique.questions.length }}</span><h3 id="question-heading" tabindex="-1">{{ question.question }}</h3></div>
              <WritingHelp :key="question.id" :question="question.question" :clue="question.clue" :starter="question.starter" :example="question.example" :solo="project.mode === 'solo'" />
            </template>
            <WritingHelp v-else :key="`${kind}-${guide.key}`" :question="guide.question" :clue="guide.clue" :starter="guide.starter" :example="kind === 'social' ? example.social[guide.key as SocialKey] : example.canvas[guide.key as CanvasKey]" :solo="project.mode === 'solo'" />
            <div class="draft-field"><div class="draft-label"><label for="draft-text">{{ ideaStep ? '내 상황에 맞는 답변' : '내 글' }}</label><span>{{ currentText.length.toLocaleString() }}자</span></div><textarea id="draft-text" :key="field" :value="currentText" maxlength="40000" :rows="ideaStep ? 7 : 10" :placeholder="project.mode === 'solo' ? '내가 이해한 내용을 내 문장으로 작성하세요.' : ideaStep ? question.starter : guide.starter" @input="write(($event.target as HTMLTextAreaElement).value)" /><p class="field-footnote">내가 쓴 문장 그대로 최종 문서에 담깁니다.</p></div>
            <div v-if="ideaStep" class="question-footer"><button class="secondary" :disabled="activeQuestion === 0" @click="selectQuestion(activeQuestion - 1)"><ArrowLeft :size="16" />이전 질문</button><button class="secondary" :disabled="activeQuestion === technique.questions.length - 1" @click="selectQuestion(activeQuestion + 1)">다음 질문<ArrowRight :size="16" /></button></div>
            <template v-if="kind === 'social' && guide.key === 'empathy'"><details class="connection-exercise"><summary>예제와 내 상황 비교하기</summary><p>예제의 방법은 가져오되, 대상과 조건은 내 문제에 맞게 바꾸어 보세요.</p><label class="field-label">같은 해결 구조<textarea v-model="project.same" rows="3" placeholder="예제와 내 문제에서 같은 역할을 하는 것은 무엇인가요?" /></label><label class="field-label">달라진 대상과 조건<textarea v-model="project.different" rows="3" placeholder="누가, 어디에서, 어떤 제한을 겪는지가 어떻게 달라졌나요?" /></label></details></template>
            <template v-if="kind === 'social' && guide.key === 'prototype'"><section class="sketch-panel"><div><h3>스케치 첨부</h3><p>종이에 그린 화면이나 모형을 이미지로 넣을 수 있습니다.</p></div><button class="secondary" @click="sketchInput?.click()"><Upload :size="17" />{{ project.sketch ? '이미지 바꾸기' : '이미지 고르기' }}</button><small>PNG, JPEG, WebP 이미지만 사용할 수 있습니다. 첨부한 이미지는 원고 백업과 인쇄에 포함됩니다.</small><template v-if="project.sketch"><img :src="project.sketch" alt="내가 첨부한 프로토타입 스케치" /><button class="text-button danger" @click="project.sketch = ''; touchSocial(project)">스케치 삭제</button></template></section></template>
            <ReviewPanel :key="field" :review="currentReview" :current="currentText" :checks="checks" @review="checkDraft" @reason="saveReason" @check="saveCheck" />
            </template>
          </template>

          <footer class="editor-navigation"><button class="secondary" :disabled="step === 0" @click="setStep(step - 1)"><ArrowLeft :size="17" />이전 항목</button><span>{{ positionText }}</span><button v-if="step < guides.length - 1" class="primary" @click="setStep(step + 1)">{{ situationStep ? '공감하기로' : '다음 항목' }}<ArrowRight :size="17" /></button><button v-else class="primary" @click="dialog = 'preview'">전체 글 확인<ArrowRight :size="17" /></button></footer>
        </main>

        <aside v-if="helpOpen" class="context-sidebar"><div class="context-heading"><span class="eyebrow">{{ situationStep ? '제시문 읽기 도움' : '생각을 이어 가는 도움' }}</span><BookOpen :size="19" /></div><h3>{{ kind === 'social' ? '해결책보다 먼저,\n문제의 조건을 보세요.' : '누구에게 어떤\n변화를 줄 수 있나요?' }}</h3><p>{{ guide.question }}</p><div class="context-divider" /><span class="eyebrow">{{ situationStep ? '읽으며 확인할 것' : '이 항목에서 확인하기' }}</span><ul class="context-checks"><li v-for="item in guide.checks" :key="item">{{ item }}</li></ul><div v-if="kind === 'business'" class="context-note"><strong>2026 예제의 린 캔버스</strong><p>아홉 항목이 서로 연결되는지 확인하세요. 인터뷰를 마치지 않아도 바로 작성할 수 있습니다.</p></div><div v-else-if="situationStep" class="context-note"><strong>다음은 공감하기</strong><p>문제 상황은 제공된 자료입니다. 등장인물의 행동과 불편을 확인한 뒤, 다음 단계에서 자신의 생각을 씁니다.</p></div><div v-else class="context-note"><strong>상황이 바뀐다면</strong><p>같은 방법을 쓰더라도 입력, 조건, 판단 기준이 달라질 수 있습니다.</p><button class="text-button" @click="openVariation">조건 바꾸어 연습<ArrowRight :size="15" /></button></div><details class="context-sources"><summary>예제 자료의 출처</summary><p>{{ example.source }}</p><p>{{ project.source && project.source !== '직접 작성' ? project.source : '연습 문제를 선택하면 자료 출처를 확인할 수 있습니다.' }}</p></details><div class="storage-card"><ShieldCheck :size="19" /><p>이 기기에 저장됩니다.<small>다른 기기에서 이어 쓰려면 백업 파일을 내려받으세요.</small></p><button class="text-button" @click="downloadBackup(project)"><Download :size="15" />원고 백업</button></div></aside>
      </div>
      <footer class="app-footer"><span>대륜고등학교 · 수행평가 준비</span><span>원고와 이미지는 서버로 전송하지 않습니다.</span></footer>
    </template>
  </div>

  <input ref="importInput" type="file" accept=".json,application/json" hidden @change="importFile" />
  <input ref="sketchInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="uploadSketch" />
  <div v-if="toast" class="toast" role="status"><Check :size="18" />{{ toast }}</div>

  <div v-if="dialog" class="modal-backdrop" @click.self="dialog = ''"><section ref="dialogElement" role="dialog" aria-modal="true" aria-labelledby="dialog-title" class="modal" :class="{ wide: dialog === 'preview' || dialog === 'transfer' }" @keydown="trapDialog">
    <header class="modal-heading"><h2 id="dialog-title">{{ ({ projects: '내 원고', start: '연습 문제 고르기', preview: '전체 글 확인', transfer: '계획 가져오기', variation: '조건 바꾸어 연습', delete: '원고 삭제', copy: '문서 전체 복사' })[dialog] }}</h2><button class="icon-button" aria-label="닫기" @click="dialog = ''"><X :size="22" /></button></header>
    <div class="modal-body">
      <template v-if="dialog === 'projects'"><p>원고는 이 브라우저에 보관됩니다. 다른 기기로 옮길 때는 백업 파일을 사용하세요.</p><div class="button-row"><button class="primary" @click="startNew"><Plus :size="17" />{{ kind === 'social' ? '연습 문제로 새 원고' : '빈 원고 만들기' }}</button><button class="secondary" @click="duplicate"><Copy :size="17" />현재 원고 복제</button><button class="secondary" @click="importInput?.click()"><Upload :size="17" />백업 불러오기</button></div><div class="project-list"><article v-for="p in projects" :key="p.id" :class="{ current: p.id === project.id }"><button class="project-open" @click="chooseProject(p.id)"><FileText :size="20" /><span><strong>{{ p.title || '제목 없는 원고' }}</strong><small>{{ TECHNIQUES[p.technique].label }} · {{ new Date(p.updatedAt).toLocaleString('ko-KR') }}</small><small v-if="p.id === project.id">현재 열려 있는 원고</small></span></button><button class="icon-button" :aria-label="`${p.title} 백업`" @click="downloadBackup(p)"><Download :size="18" /></button><button class="icon-button danger" :aria-label="`${p.title} 삭제`" @click="deleteId = p.id; deleteBackedUp = false; dialog = 'delete'"><Trash2 :size="18" /></button></article></div><p v-if="!projects.length" class="empty-state">아직 저장한 원고가 없습니다. 새 원고를 시작하거나 백업을 불러오세요.</p><label class="field-label">학번과 이름 (선택)<input v-model="project.author" maxlength="100" placeholder="인쇄물에 필요한 경우에만 입력하세요" /></label><small>학번과 이름은 이 기기에만 보관되며 인쇄물과 백업 파일에 포함됩니다.</small></template>
      <template v-if="dialog === 'start'"><p>읽을 연습 문제를 고르세요. 선택한 문제로 새 원고를 만들며, 기존 원고와 답변은 그대로 보관됩니다.</p><div class="practice-grid"><button v-for="p in PRACTICES" :key="p.id" :class="{ selected: pendingPractice?.id === p.id }" @click="pendingPractice = p"><span class="eyebrow">{{ TECHNIQUES[p.technique].label }}</span><strong>{{ p.title }}</strong><small>{{ p.source }}</small></button></div><article v-if="pendingPractice" class="practice-detail"><h3>{{ pendingPractice.title }}</h3><div class="situation-passages"><p v-for="(paragraph, index) in pendingPractice.situation.split(/\n\s*\n/)" :key="index">{{ paragraph }}</p></div><div class="button-row"><button class="primary" @click="newProject(pendingPractice)">이 문제로 새 원고 만들기<ArrowRight :size="16" /></button></div><small>상황을 읽은 뒤 공감하기, 문제 정의, 아이디어 창출, 프로토타입, 평가를 작성합니다.</small></article></template>
      <template v-if="dialog === 'preview'"><div class="preview-toolbar"><p>{{ title }} · 내 원고</p><div class="button-row"><button class="secondary" @click="copyDocument"><Copy :size="17" />전체 복사</button><button class="secondary" @click="downloadBackup(project)"><Download :size="17" />원고 백업</button><button class="primary" @click="printDocument"><Printer :size="17" />인쇄 / PDF 저장</button></div></div><label class="field-label">학번과 이름 (선택)<input v-model="project.author" maxlength="100" placeholder="출력물에 필요한 경우에만 입력하세요" /></label><article class="document-preview"><h2>{{ project.title || title }}</h2><p v-if="project.author" class="print-author">{{ project.author }}</p><section v-for="section in sections" :key="section.title"><h3>{{ section.title }}</h3><p>{{ section.text || '아직 작성하지 않았습니다.' }}</p></section><figure v-if="kind === 'social' && project.sketch"><img :src="project.sketch" alt="내 프로토타입 스케치" /><figcaption>프로토타입 스케치</figcaption></figure></article><p class="notice">예제 답안과 작성 도움은 출력물에 포함되지 않습니다. 인쇄 창에서 대상을 ‘PDF로 저장’으로 고르세요.</p></template>
      <template v-if="dialog === 'transfer'"><p>현재 계획을 참고 자료로 연결합니다. 선택한 내용은 비어 있는 캔버스 항목에만 옮깁니다.</p><div v-if="project.linkedPlan" class="linked-compare"><h3>계획서 변경 확인</h3><p>{{ planChanged ? '연결 이후 계획서가 바뀌었습니다. 아래 내용을 비교하세요.' : '연결한 시점과 현재 계획의 버전이 같습니다.' }}</p><details v-for="g in SOCIAL_GUIDES" :key="g.key"><summary>{{ g.label }}</summary><div class="comparison"><section><h4>연결했을 때</h4><p>{{ (g.key === 'ideas' ? getIdeaText(project.linkedPlan) : project.linkedPlan.social[g.key as SocialKey]) || '작성 전' }}</p></section><section><h4>현재 계획</h4><p>{{ g.key === 'ideas' ? getIdeaText(project) : project.social[g.key as SocialKey] || '작성 전' }}</p></section></div></details></div><div class="transfer-list"><article v-for="entry in transferEntries" :key="entry.key"><label><input v-model="transferKeys" type="checkbox" :value="entry.key" :disabled="!!project.canvas[entry.key].trim() || !entry.value.trim()" /><strong>{{ entry.label }}</strong></label><p>{{ entry.value || '계획서에 가져올 내용이 없습니다.' }}</p><p v-if="entry.key === 'customerSegments' && entry.value.trim()" class="transfer-draft-note">공감하기에서 가져온 참고 초안입니다. 서비스를 쓰는 사람, 도움을 받는 사람, 도입을 결정하는 주체를 구분해 다시 써 보세요.</p><small v-if="project.canvas[entry.key].trim()">이 항목에 이미 쓴 글이 있어 자동으로 옮기지 않습니다. 아래 내용을 참고해 직접 다듬으세요.</small></article></div><button class="primary" @click="applyTransfer">선택 항목 가져오고 현재 계획 연결<ArrowRight :size="16" /></button></template>
      <template v-if="dialog === 'variation'"><p>아래와 같이 조건이 달라졌습니다. 문제 상황은 그대로 읽고, 내가 쓴 해결 계획에서 달라져야 할 부분을 찾아보세요.</p><article class="provided-change"><span class="eyebrow">제공된 조건 변화</span><p>{{ variationText }}</p></article><p>새 사본에서 연습하므로 원래 원고와 답변은 보존됩니다.</p><button class="primary" :disabled="!variationText.trim()" @click="createVariation">사본에서 연습 시작<ArrowRight :size="16" /></button></template>
      <template v-if="dialog === 'delete'"><p>‘{{ projects.find(p => p.id === deleteId)?.title || '선택한 원고' }}’를 이 기기에서 삭제합니다. 삭제 전 백업을 내려받으면 다시 불러올 수 있습니다.</p><div class="button-row"><button class="secondary" @click="downloadBackup(deletionTarget || project); deleteBackedUp = true"><Download :size="17" />삭제 전 백업</button><button class="secondary" @click="dialog = 'projects'">취소</button><button class="danger-button" :disabled="!deleteBackedUp" @click="removeProject">원고 삭제</button></div></template>
      <template v-if="dialog === 'copy'"><p>자동 복사를 사용할 수 없습니다. 아래 글을 선택하여 복사하세요.</p><textarea :value="copyText" readonly rows="15" aria-label="복사할 문서 전체" @focus="($event.target as HTMLTextAreaElement).select()" /></template>
    </div>
  </section></div>
</template>
