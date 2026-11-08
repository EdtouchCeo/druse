<script setup lang="ts">
// 구현 프롬프트 연습의 편집 영역. App.vue의 틀(단계 목록, 모드, 내 글 점검, 인쇄)은 그대로 쓰고
// 이 컴포넌트는 단계마다 입력 칸·용어 버튼·조립 결과·점검표만 그린다. 생성형 AI와 서버 전송은 없다.
import { computed, nextTick, ref } from 'vue'
import { ArrowRight, Check, CircleAlert, Copy, ExternalLink, Plus, Printer, Trash2 } from 'lucide-vue-next'
import type { Project } from '../lib/types'
import { emptyFeature, findTerms, TERM_CATEGORY_LABELS, type CheckResult, type TermCategory } from '../lib/promptCore'
import { assembleImplementation, checkImplementation, LIMITS, PROMPT_DICTIONARY, requiredPassed } from '../lib/promptState'
import { BAD_GOOD_EXAMPLES, COMMON_TEMPLATES, DAMEOK_BASELINE, DAMEOK_PROMPT_TEXT, EXAMPLE_NOTICE, PRACTICE_NOTICE, PROMPT_GUIDES, READING, STEP_TERM_IDS, type PromptStepKey } from '../data/promptPractice'
import { termById, termLink } from '../data/promptTerms'
import WritingHelp from './WritingHelp.vue'
import PromptFeatureCard from './PromptFeatureCard.vue'

const props = defineProps<{ project: Project; stepKey: PromptStepKey; mode: 'example' | 'guided' | 'solo'; focusTerm: string }>()
const emit = defineEmits<{ goStep: [index: number]; print: []; preview: [] }>()

const s = computed(() => props.project.implementation)
const guide = computed(() => PROMPT_GUIDES.find(g => g.key === props.stepKey)!)
const solo = computed(() => props.mode === 'solo')
const example = computed(() => props.mode === 'example')
const assembled = computed(() => assembleImplementation(s.value))
const results = computed(() => checkImplementation(s.value))
const required = computed(() => results.value.filter(r => r.level === 'required'))
const failedRequired = computed(() => required.value.filter(r => !r.ok))
const advice = computed(() => results.value.filter(r => r.level === 'advice' && !r.ok))
const infos = computed(() => results.value.filter(r => r.level === 'info'))
const blanks = computed(() => (assembled.value.text.match(/\[\s*\]/g) ?? []).length)
const requiredOk = computed(() => requiredPassed(results.value) && !!assembled.value.body)
// 빈칸 [  ]이 남아 있으면 필수 조건을 통과해도 제출 조건을 갖췄다고 하지 않는다.
const ready = computed(() => requiredOk.value && blanks.value === 0)
const catClass = (c: TermCategory | null | undefined) => c === '①' ? 'cat-1' : c === '②' ? 'cat-2' : c === '③' ? 'cat-3' : 'cat-x'

/* ── 예시 '다먹 AI' 원문을 단계별로 자른다 ── */
function dameokSection(key: PromptStepKey): string {
  const lines = DAMEOK_PROMPT_TEXT.split('\n')
  const pick = (prefix: string) => lines.filter(l => l.startsWith(prefix))
  if (key === 'role') return [...pick('[역할]'), ...pick('[만들 형태]')].join('\n')
  if (key === 'screen') return pick('[화면 구성]').join('\n')
  if (key === 'common') return pick('[공통 조건]').join('\n')
  if (key === 'features') { const start = lines.indexOf('[기능별 동작 조건]'); return lines.slice(start, lines.findIndex(l => l.startsWith('[공통 조건]'))).join('\n') }
  if (key === 'done') return DAMEOK_PROMPT_TEXT
  return ''
}
const exampleText = computed(() => dameokSection(props.stepKey))
const exampleHits = computed(() => findTerms(exampleText.value, PROMPT_DICTIONARY))

/* ── 용어 버튼 ── */
const stepTerms = computed(() => (STEP_TERM_IDS[props.stepKey] ?? []).map(id => termById(id)!).filter(Boolean))
const focused = computed(() => termById(props.focusTerm))
const focusStepIndex = computed(() => {
  if (!focused.value) return -1
  return PROMPT_GUIDES.findIndex(g => (STEP_TERM_IDS[g.key] ?? []).includes(focused.value!.id))
})
const focusHere = computed(() => !!focused.value && stepTerms.value.some(t => t.id === focused.value!.id))
const lastField = ref('')
const insertedTerm = computed(() => termById(inserted.value))
const inserted = ref('')
const insertError = ref('')

function defaultField(termId: string): string {
  if (props.stepKey === 'role') return ['fullstack', 'ai-product'].includes(termId) ? 'role' : 'buildMethod'
  if (props.stepKey === 'screen') return 'screenExtra'
  if (props.stepKey === 'common') return 'commonFree'
  const last = s.value.features[s.value.features.length - 1]
  return last ? `feature:${last.id}:result` : ''
}
function fieldBelongsToStep(field: string): boolean {
  const own: Record<string, string[]> = { role: ['role', 'buildMethod', 'serviceIntro'], screen: ['home', 'screenExtra'], common: ['commonFree'] }
  if (props.stepKey === 'features') return field.startsWith('feature:') && !field.endsWith(':name')
  return (own[props.stepKey] ?? []).includes(field)
}
function readField(field: string): string {
  if (field.startsWith('feature:')) { const [, id, key] = field.split(':'); const f = s.value.features.find(x => x.id === id); return f ? String(f[key as 'input']) : '' }
  return String(s.value[field as 'role'] ?? '')
}
function writeField(field: string, value: string) {
  if (field.startsWith('feature:')) { const [, id, key] = field.split(':'); const f = s.value.features.find(x => x.id === id); if (f) f[key as 'input'] = value; return }
  s.value[field as 'role'] = value
}
async function insertTerm(termId: string) {
  const term = termById(termId); if (!term) return
  const field = lastField.value && fieldBelongsToStep(lastField.value) ? lastField.value : defaultField(termId)
  if (!field) return
  const current = readField(field).trim()
  // 다른 앱의 기능·수치가 원고에 섞이지 않게 빈칸이 있는 문장 틀을 넣는다. 예시 문장은 아래에 보여 주기만 한다.
  // 저장 한도를 넘으면 다시 열 때 잘리므로 칸 한도에서 멈추고 알린다.
  const next = current ? `${current} ${term.template}` : term.template
  if (next.length > LIMITS.text) { insertError.value = `이 칸은 ${LIMITS.text.toLocaleString()}자까지 쓸 수 있어 문장 틀을 넣지 않았습니다. 칸의 글을 줄인 뒤 다시 누르세요.`; return }
  insertError.value = ''
  writeField(field, next)
  inserted.value = term.id
  await nextTick()
  const el = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[data-field="${field}"]`)
  if (el) { el.focus(); const end = el.value.length; el.setSelectionRange?.(end, end) }
}

/* ── 역할·화면·공통 조건 칸 ── */
const screensText = computed({
  get: () => s.value.screens.join(', '),
  set: (value: string) => { s.value.screens = value.split(/[,，、\n]/).map(x => x.trim().slice(0, LIMITS.screen)).filter(Boolean).slice(0, LIMITS.screens) },
})
function addFeature() { s.value.features.push(emptyFeature()); void nextTick(() => document.querySelector<HTMLElement>(`[data-field="feature:${s.value.features[s.value.features.length - 1]!.id}:name"]`)?.focus()) }
function removeFeature(id: string) { if (s.value.features.length > 1) s.value.features = s.value.features.filter(f => f.id !== id) }
const commonItem = (id: string) => s.value.common.find(c => c.templateId === id)
function toggleCommon(id: string, on: boolean) {
  const template = COMMON_TEMPLATES.find(t => t.id === id)!
  if (on && !commonItem(id)) s.value.common.push({ id, templateId: id, fields: {}, text: template.render({}) })
  if (!on) s.value.common = s.value.common.filter(c => c.templateId !== id)
}
function setCommonField(id: string, key: string, value: string) {
  const item = commonItem(id); const template = COMMON_TEMPLATES.find(t => t.id === id)
  if (!item || !template) return
  item.fields = { ...(item.fields ?? {}), [key]: value }
  item.text = template.render(item.fields)
}

/* ── 추가 용어 ── */
const newTermName = ref('')
const newTermCategory = ref<TermCategory>('①')
const extraError = ref('')
function addExtraTerm() {
  const name = newTermName.value.trim()
  extraError.value = ''
  if (!name) { extraError.value = '용어 이름을 적어 주세요.'; return }
  const key = (x: string) => x.replace(/\s/g, '').toLowerCase()
  // 제시 용어의 이름·별칭과 같은 말은 제시 용어의 범주로 센다. 범주를 바꾸어 다시 넣지 못하게 한다.
  const listed = PROMPT_DICTIONARY.find(t => [t.name, ...t.aliases].some(n => key(n) === key(name)))
  if (listed) { extraError.value = `‘${name}’은(는) 제시 용어 ‘${listed.name}’(${listed.category} 범주)으로 이미 셉니다. 추가하지 않아도 됩니다.`; return }
  if (s.value.extraTerms.some(t => key(t.name) === key(name))) { extraError.value = '이미 추가한 용어입니다.'; return }
  if (s.value.extraTerms.length >= LIMITS.extraTerms) { extraError.value = '추가 용어는 30개까지 적을 수 있습니다.'; return }
  s.value.extraTerms.push({ name: name.slice(0, LIMITS.extraName), category: newTermCategory.value })
  newTermName.value = ''
}

/* ── 단계별 참고 의견 ── */
const SECTION_OF: Partial<Record<PromptStepKey, string[]>> = { role: ['role', 'form'], screen: ['screen'], features: ['features'], common: ['common'] }
const stepNotes = computed<CheckResult[]>(() => {
  const own = SECTION_OF[props.stepKey]; if (!own) return []
  return results.value.filter(r => !r.ok && r.level !== 'info' && r.target && own.includes(r.target.section))
})
const sectionPreview = computed(() => {
  const own = SECTION_OF[props.stepKey] ?? []
  return assembled.value.sections.filter(sec => own.includes(sec.id) && sec.body).map(sec => sec.id === 'features' ? `[${sec.title}]\n${sec.body}` : `[${sec.title}] ${sec.body}`).join('\n')
})

/* ── 복사 ── */
const copied = ref(false)
const copyError = ref('')
async function copyPrompt() {
  copyError.value = ''
  try { await navigator.clipboard.writeText(assembled.value.text); copied.value = true; setTimeout(() => { copied.value = false }, 2000) }
  catch { copyError.value = '자동 복사를 쓸 수 없습니다. 아래 글을 선택해 직접 복사하세요.' }
}
</script>

<template>
  <div class="prompt-practice">
    <p class="practice-notice" role="note"><CircleAlert :size="18" />{{ PRACTICE_NOTICE }}</p>

    <section v-if="focused" class="focus-term" :class="catClass(focused.category)" aria-live="polite">
      <p><strong>{{ focused.name }}</strong> 용어를 보고 왔습니다.
        <template v-if="solo">용어 버튼은 ‘도움받아 써 보기’에서 보입니다.</template>
        <template v-else-if="focusHere">이 단계의 용어 버튼에 표시해 두었습니다.</template>
        <template v-else-if="focusStepIndex > -1">이 용어 버튼은 ‘{{ PROMPT_GUIDES[focusStepIndex]!.label }}’ 단계에 있습니다.</template>
      </p>
      <button v-if="!solo && !focusHere && focusStepIndex > -1" type="button" class="secondary" @click="emit('goStep', focusStepIndex)">{{ PROMPT_GUIDES[focusStepIndex]!.label }} 단계로 가기<ArrowRight :size="16" /></button>
    </section>

    <!-- 0 사전 읽기 -->
    <template v-if="stepKey === 'read'">
      <article class="reading">
        <section><h3>쓰는 순서</h3><p class="order-line">{{ READING.order }}</p><p>{{ READING.submitNote }}</p></section>
        <section><h3>작성 방법</h3><ul><li v-for="m in READING.methods" :key="m">{{ m }}</li></ul></section>
        <section><h3>서비스 관련 용어 사용 조건</h3><p>{{ READING.termRule }}</p><p class="muted">{{ READING.termNote }}</p>
          <ul class="category-list"><li v-for="(label, c) in TERM_CATEGORY_LABELS" :key="c" :class="catClass(c as TermCategory)"><span class="cat-dot">{{ c }}</span>{{ label }}</li></ul>
          <a class="secondary terms-link" href="/assessment/terms/">앱 서비스 개발 용어 16개 보기<ExternalLink :size="16" /></a>
        </section>
        <section><h3>나쁜 예와 고친 예</h3>
          <div v-for="e in BAD_GOOD_EXAMPLES" :key="e.bad" class="bad-good"><p><span class="tag bad">나쁜 예</span>{{ e.bad }}</p><p><span class="tag good">고친 예</span>{{ e.good }}</p></div>
        </section>
      </article>
    </template>

    <!-- 예제로 익히기 -->
    <template v-else-if="example">
      <article class="example-document dameok">
        <p class="example-notice">{{ EXAMPLE_NOTICE }}</p>
        <span class="eyebrow">다먹 AI · {{ guide.label }}</span>
        <p>{{ exampleText }}</p>
        <div v-if="exampleHits.length && stepKey !== 'done'" class="hit-list"><span>이 부분에 쓰인 용어</span><span v-for="h in exampleHits" :key="h.termId" class="hit" :class="catClass(h.category)">{{ h.category }} {{ h.surface }}</span></div>
        <footer>자료: 대륜고등학교 정보과 「구현 프롬프트와 개선 보고서 작성 안내」 예시</footer>
      </article>
    </template>

    <!-- 쓰기 단계 -->
    <template v-else>
      <WritingHelp v-if="!solo && stepKey !== 'done'" :key="stepKey" :question="guide.question" :clue="guide.clue" :starter="guide.starter" :example="dameokSection(stepKey)" />

      <div v-if="!solo && stepTerms.length" class="term-buttons" role="group" :aria-label="`${guide.label}에 쓸 용어`">
        <p class="term-buttons-lead">용어 버튼을 누르면 빈칸이 있는 문장 틀이 마지막으로 쓴 칸 끝에 들어갑니다. 빈칸 [  ]을 내 서비스에 맞게 채우세요.</p>
        <div class="term-button-grid">
          <div v-for="t in stepTerms" :key="t.id" class="term-item" :class="[catClass(t.category), { highlight: focusTerm === t.id, inserted: inserted === t.id }]">
            <button type="button" class="term-insert" @click="insertTerm(t.id)"><span class="cat-dot">{{ t.category }}</span>{{ t.name }}<Plus :size="15" /></button>
            <a class="term-meaning" :href="termLink(t.id)">뜻 보기</a>
          </div>
        </div>
        <p v-if="insertError" class="field-error" role="alert">{{ insertError }}</p>
        <p v-if="insertedTerm" class="term-example" aria-live="polite"><strong>{{ insertedTerm.name }}</strong> 문장 틀을 넣었습니다. 수업 자료의 예시 문장: {{ insertedTerm.promptExample }}</p>
      </div>

      <!-- 1 역할과 만들 형태 -->
      <template v-if="stepKey === 'role'">
        <label class="field-label">[역할] AI에게 맡길 역할<textarea v-model="s.role" rows="2" maxlength="4000" data-field="role" :placeholder="solo ? '' : '예: 너는 풀스택 웹 개발 경험이 있는 AI 프로덕트 엔지니어야.'" @focus="lastField = 'role'" /></label>
        <div class="two-col">
          <label class="field-label">서비스 이름<input v-model="s.serviceName" maxlength="200" :placeholder="solo ? '' : '예: 다먹 AI'" /></label>
          <label class="field-label">한 줄 소개(꾸미는 말이나 문장)<input v-model="s.serviceIntro" maxlength="400" data-field="serviceIntro" :placeholder="solo ? '' : '예: 학교 급식 잔반을 줄이는'" @focus="lastField = 'serviceIntro'" /></label>
        </div>
        <label class="field-label">화면(탭) 목록 · 쉼표로 나눕니다<input v-model.lazy="screensText" maxlength="3000" :placeholder="solo ? '' : '예: 홈, 잔반 인식, 배식량 추천, 기록'" /></label>
        <label class="field-label">[만들 형태] 만드는 방식<textarea v-model="s.buildMethod" rows="3" maxlength="4000" data-field="buildMethod" :placeholder="solo ? '' : '예: Tailwind CSS와 Font Awesome을 사용한 단일 HTML 파일로 만들어 줘.'" @focus="lastField = 'buildMethod'" /></label>
      </template>

      <!-- 2 화면 구성 -->
      <template v-else-if="stepKey === 'screen'">
        <p v-if="!solo" class="step-tip">설계안의 프로토타입 연결을 그대로 옮깁니다.</p>
        <label class="field-label">첫 화면에 둘 것<input v-model="s.home" maxlength="400" data-field="home" :placeholder="solo ? '' : '예: 오늘 잔반량 요약 카드'" @focus="lastField = 'home'" /></label>
        <div class="two-col">
          <label class="field-label">CTA 버튼 문구<input v-model="s.ctaLabel" maxlength="100" :placeholder="solo ? '' : '예: 오늘 잔반 기록하기'" /></label>
          <label class="field-label">누르면 이동할 화면<input v-model="s.ctaTarget" maxlength="100" :placeholder="solo ? '' : '예: 잔반 인식 탭'" /></label>
        </div>
        <label class="field-label">더 적을 화면 조건(선택)<textarea v-model="s.screenExtra" rows="2" maxlength="4000" data-field="screenExtra" @focus="lastField = 'screenExtra'" /></label>
        <label class="field-label">개선 표시(선택) · (개선: ) 안에 쓸 기능 이름<input v-model="s.screenImproveLabel" maxlength="200" :placeholder="solo ? '' : '예: 기록 저장과 화면 이동'" /></label>
      </template>

      <!-- 3 기능별 동작 조건 -->
      <template v-else-if="stepKey === 'features'">
        <p v-if="!solo" class="step-tip">설계안의 [입력] → [처리] → [결과] 상자를 그대로 옮깁니다.</p>
        <details v-if="!solo" class="bad-good-box"><summary>나쁜 예와 고친 예</summary><div v-for="e in BAD_GOOD_EXAMPLES" :key="e.bad" class="bad-good"><p><span class="tag bad">나쁜 예</span>{{ e.bad }}</p><p><span class="tag good">고친 예</span>{{ e.good }}</p></div></details>
        <div class="feature-list">
          <PromptFeatureCard v-for="(f, index) in s.features" :key="f.id" :feature="f" :index="index" :solo="solo" :removable="s.features.length > 1" @remove="removeFeature(f.id)" @focus-field="lastField = $event" />
        </div>
        <button type="button" class="secondary add-feature" :disabled="s.features.length >= 20" @click="addFeature"><Plus :size="17" />기능 하나 더하기</button>
      </template>

      <!-- 4 공통 조건 -->
      <template v-else-if="stepKey === 'common'">
        <fieldset class="common-templates">
          <legend>함께 적용할 조건 고르기</legend>
          <div v-for="t in COMMON_TEMPLATES" :key="t.id" class="common-template" :class="{ on: !!commonItem(t.id) }">
            <label class="check-label"><input type="checkbox" :checked="!!commonItem(t.id)" @change="toggleCommon(t.id, ($event.target as HTMLInputElement).checked)" />{{ t.label }}</label>
            <p v-if="!solo" class="muted">{{ t.effect }}</p>
            <template v-if="commonItem(t.id)">
              <div class="common-fields"><label v-for="field in t.fields" :key="field.key" class="field-label">{{ field.label }}<input :value="commonItem(t.id)?.fields?.[field.key] ?? ''" maxlength="300" :placeholder="solo ? '' : field.placeholder" @input="setCommonField(t.id, field.key, ($event.target as HTMLInputElement).value)" /></label></div>
              <p class="common-sentence">{{ commonItem(t.id)?.text }}</p>
            </template>
          </div>
        </fieldset>
        <label class="field-label">더 적을 공통 조건(선택)<textarea v-model="s.commonFree" rows="3" maxlength="4000" data-field="commonFree" @focus="lastField = 'commonFree'" /></label>
        <label class="field-label">개선 표시(선택) · (개선: ) 안에 쓸 기능 이름<input v-model="s.commonImproveLabel" maxlength="200" /></label>
      </template>

      <!-- 5 완성과 점검 -->
      <template v-else-if="stepKey === 'done'">
        <section class="extra-terms">
          <h3>스스로 공부한 용어</h3>
          <p>표에 없는 용어(예: 프론트엔드, 백엔드, 데이터베이스)를 프롬프트에 썼다면 이름과 범주를 적습니다. 프롬프트에 쓰인 경우에만 개수에 들어갑니다.</p>
          <div class="extra-form">
            <label class="field-label">용어 이름<input v-model="newTermName" :maxlength="LIMITS.extraName" @keydown.enter.prevent="addExtraTerm" /></label>
            <label class="field-label">범주<select v-model="newTermCategory"><option v-for="(label, c) in TERM_CATEGORY_LABELS" :key="c" :value="c">{{ c }} {{ label }}</option></select></label>
            <button type="button" class="secondary" @click="addExtraTerm"><Plus :size="16" />추가</button>
          </div>
          <p v-if="extraError" class="field-error" role="alert">{{ extraError }}</p>
          <ul v-if="s.extraTerms.length" class="extra-list"><li v-for="(t, index) in s.extraTerms" :key="t.name" :class="catClass(t.category)"><span class="cat-dot">{{ t.category ?? '–' }}</span>{{ t.name }}<button type="button" class="icon-button" :aria-label="`${t.name} 지우기`" @click="s.extraTerms.splice(index, 1)"><Trash2 :size="16" /></button></li></ul>
        </section>

        <section class="check-board" aria-labelledby="check-board-title">
          <h3 id="check-board-title">수행평가 조건 점검</h3>
          <p v-if="ready" class="ready" role="status"><Check :size="18" />제출 조건을 갖췄습니다.</p>
          <p v-else-if="requiredOk" class="not-ready" role="status">빈칸 [&nbsp;&nbsp;] {{ blanks }}곳을 채우면 제출 조건을 갖춥니다.</p>
          <p v-else class="not-ready" role="status">아직 갖추지 못한 조건이 {{ failedRequired.length || 1 }}가지 있습니다.</p>
          <ul class="required-list">
            <li v-for="r in required" :key="r.id" :class="{ ok: r.ok }"><span class="mark" aria-hidden="true">{{ r.ok ? '✓' : '!' }}</span><div><strong>{{ r.ok ? '갖춤' : '남음' }}</strong> {{ r.message }}<ul v-if="!r.ok && r.items?.length"><li v-for="item in r.items" :key="item">{{ item }}</li></ul></div></li>
          </ul>
          <template v-if="advice.length"><h4>참고 의견</h4><p class="muted">막지 않는 의견입니다. 고칠지는 직접 판단합니다.</p><ul class="advice-list"><li v-for="r in advice" :key="r.id">{{ r.message }}<ul v-if="r.items?.length"><li v-for="item in r.items" :key="item">{{ item }}</li></ul></li></ul></template>
          <ul class="info-list"><li v-for="r in infos" :key="r.id">{{ r.message }}</li></ul>
          <p class="muted">안내자료 예시는 {{ DAMEOK_BASELINE.toLocaleString() }}자입니다. 글자 수는 쪽 수를 판정하지 않습니다.</p>
          <p class="scope-note">개선 보고서(문제·원인·개선 방안)와 1쪽 분량은 이 도구에서 점검하지 않습니다. 제출 문서에서 직접 확인하세요.</p>
        </section>

        <section class="assembled" aria-labelledby="assembled-title">
          <div class="assembled-head"><h3 id="assembled-title">조립한 구현 프롬프트</h3><span>{{ assembled.body.length.toLocaleString() }}자</span></div>
          <pre v-if="assembled.body">{{ assembled.text }}</pre>
          <p v-else class="muted">앞 단계의 칸을 채우면 여기에 다섯 묶음이 순서대로 이어집니다.</p>
          <div class="button-row">
            <button type="button" class="secondary" :disabled="!assembled.body" @click="copyPrompt"><Check v-if="copied" :size="17" /><Copy v-else :size="17" />{{ copied ? '복사했습니다' : '프롬프트 복사' }}</button>
            <button type="button" class="secondary" @click="emit('preview')">전체 보기</button>
            <button type="button" class="primary" @click="emit('print')"><Printer :size="17" />인쇄 / PDF 저장</button>
          </div>
          <p v-if="copyError" class="field-error" role="alert">{{ copyError }}</p>
        </section>
      </template>

      <section v-if="stepKey !== 'done'" class="section-preview" aria-label="이 단계의 조립 결과">
        <h3>이 단계가 프롬프트에 들어가는 모습</h3>
        <pre v-if="sectionPreview">{{ sectionPreview }}</pre>
        <p v-else class="muted">칸을 채우면 여기에 묶음 문장이 만들어집니다.</p>
        <ul v-if="stepNotes.length" class="step-notes"><li v-for="r in stepNotes" :key="r.id" :class="r.level">{{ r.message }}</li></ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.prompt-practice{display:flex;flex-direction:column;gap:16px;margin-top:8px}
.practice-notice{display:flex;align-items:center;gap:8px;margin:0;padding:12px 14px;border-radius:10px;background:#fff5e0;color:#6b4500;font-size:15px;font-weight:700;border:1px solid rgba(232,160,32,.45)}
.cat-1{--cat:#1e3a6b;--cat-soft:#e8eef9}.cat-2{--cat:#8a5a00;--cat-soft:#fff3dc}.cat-3{--cat:#17656f;--cat-soft:#e3f4f4}.cat-x{--cat:#475569;--cat-soft:#f1f5f9}
.cat-dot{display:inline-grid;place-items:center;min-width:24px;height:24px;border-radius:50%;background:var(--cat);color:#fff;font-size:13px;font-weight:700;flex:none}
.cat-2 .cat-dot{color:#1e2a44;background:#e8a020}
.focus-term{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:12px 14px;border-radius:10px;background:var(--cat-soft);border-left:4px solid var(--cat)}
.focus-term p{margin:0;font-size:15px}
.reading{display:flex;flex-direction:column;gap:18px}
.reading section{padding:18px 20px;border:1px solid var(--border);border-radius:12px;background:var(--card)}
.reading h3,.extra-terms h3,.check-board h3,.assembled h3,.section-preview h3{font-size:17px;color:#1e3a6b;margin-bottom:8px}
.reading ul{margin:0;padding-left:20px}.reading li{font-size:16px;line-height:1.85;margin:4px 0}
.order-line{font-weight:700;color:#1e3a6b;font-size:16px}
.category-list{list-style:none;padding:0!important;display:flex;flex-wrap:wrap;gap:6px 16px;margin:6px 0 12px!important}
.category-list li{display:flex;align-items:center;gap:8px}
.terms-link{text-decoration:none}
.bad-good{display:grid;gap:6px;margin:8px 0;padding:12px;border-radius:10px;background:var(--subtle)}
.bad-good p{margin:0;font-size:15px;line-height:1.8}
.tag{display:inline-block;margin-right:8px;padding:0 8px;border-radius:6px;font-size:13px;font-weight:700}
.tag.bad{background:var(--danger-soft);color:var(--danger)}.tag.good{background:#e3f4ec;color:#17654a}
.bad-good-box{padding:4px 14px;border:1px solid var(--border);border-radius:10px;background:var(--card)}
.dameok{margin:0}
.example-notice{display:inline-block;margin:0 0 10px!important;padding:4px 10px;border-radius:6px;background:#fff5e0;color:#6b4500;font-weight:700;font-size:14px!important}
.hit-list{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:12px;font-size:14px}
.hit-list>span:first-child{font-weight:700;color:var(--muted);margin-right:4px}
.hit{padding:2px 8px;border-radius:6px;background:var(--cat-soft);color:var(--cat);font-weight:700}
.term-buttons{padding:14px 16px;border:1px solid var(--border);border-radius:12px;background:var(--card)}
.term-buttons-lead{margin:0 0 10px;font-size:15px;color:var(--muted)}
.term-button-grid{display:flex;flex-wrap:wrap;gap:8px}
.term-item{display:flex;align-items:stretch;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--cat-soft)}
.term-item.highlight{outline:3px solid #e8a020;outline-offset:2px}
.term-item.inserted .term-insert{background:#fff}
.term-insert{display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:6px 12px;background:transparent;color:var(--cat);font-weight:700;font-size:15px}
.term-insert:hover{background:#fff}
.term-example{margin:10px 0 0;padding:10px 12px;border-radius:8px;background:var(--subtle);font-size:15px;line-height:1.75}
.term-meaning{display:inline-flex;align-items:center;min-height:44px;padding:6px 10px;border-left:1px solid var(--border);font-size:14px;font-weight:600;background:var(--card)}
.two-col{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 14px}
.prompt-practice .field-label{margin:4px 0}
.step-tip{margin:0;font-size:15px;color:#1e3a6b;font-weight:600}
.feature-list{display:flex;flex-direction:column;gap:12px}
.add-feature{align-self:flex-start}
.common-templates{border:0;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.common-templates legend{font-size:16px;font-weight:700;color:#1e3a6b;margin-bottom:8px}
.common-template{padding:10px 14px;border:1px solid var(--border);border-radius:12px;background:var(--card)}
.common-template.on{border-color:#4a7bc4;background:#f8fbff}
.common-template .muted{margin:0;font-size:14px}
.check-label{display:flex;align-items:center;gap:10px;min-height:44px;font-size:16px;font-weight:700}
.common-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:0 12px}
.common-sentence{margin:6px 0 0;padding:10px 12px;border-radius:8px;background:var(--subtle);font-size:15px}
.extra-terms,.check-board,.assembled,.section-preview{padding:18px 20px;border:1px solid var(--border);border-radius:12px;background:var(--card)}
.extra-terms>p{font-size:15px;margin-bottom:6px}
.extra-form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:0 10px;align-items:end}
.extra-form .secondary{margin-bottom:4px}
.extra-list{list-style:none;padding:0;margin:8px 0 0;display:flex;flex-wrap:wrap;gap:6px}
.extra-list li{display:flex;align-items:center;gap:6px;padding-left:8px;border-radius:10px;background:var(--cat-soft);font-weight:600}
.scope-note{margin:8px 0 0;padding:10px 12px;border-radius:8px;background:var(--sky-soft);color:#1e3a6b;font-size:15px;font-weight:600}
.field-error{margin:6px 0 0;color:var(--danger);font-size:15px}
.ready,.not-ready{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:10px 14px;border-radius:10px;font-size:16px;font-weight:700}
.ready{background:#e3f4ec;color:#17654a}.not-ready{background:#fff5e0;color:#6b4500}
.required-list,.advice-list,.info-list,.step-notes{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.required-list>li{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:#fff8ec;font-size:15px;line-height:1.75}
.required-list>li.ok{background:#f0f8f4}
.required-list .mark{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#e8a020;color:#1e2a44;font-weight:800;flex:none}
.required-list li.ok .mark{background:#17654a;color:#fff}
.required-list ul,.advice-list ul{margin:4px 0 0;padding-left:18px}
.check-board h4{font-size:16px;margin:16px 0 4px;color:#1e3a6b}
.advice-list>li{padding:8px 12px;border-radius:8px;background:var(--subtle);font-size:15px;line-height:1.75}
.info-list{margin-top:12px}.info-list li{font-size:15px;color:var(--muted)}
.assembled-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.assembled-head span{font-size:14px;color:var(--muted)}
.assembled pre,.section-preview pre{margin:0 0 12px;padding:14px;border-radius:10px;background:var(--subtle);white-space:pre-wrap;overflow-wrap:anywhere;word-break:keep-all;font-family:inherit;font-size:15px;line-height:1.85}
.section-preview pre{margin:0}
.step-notes{margin-top:10px}.step-notes li{font-size:15px;padding:8px 12px;border-radius:8px;background:#fff8ec}
@media(max-width:640px){.two-col,.extra-form{grid-template-columns:1fr}.extra-form .secondary{justify-self:start}}
@media(max-width:480px){.reading section,.extra-terms,.check-board,.assembled,.section-preview{padding:16px 14px}.term-insert{font-size:14px;padding:6px 10px}}
</style>
