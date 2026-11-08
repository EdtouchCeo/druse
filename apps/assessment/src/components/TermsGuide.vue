<script setup lang="ts">
// 앱 서비스 개발 용어 화면(/assessment/terms/). 읽기 전용이며 원고 저장과 관계가 없다.
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowRight, ArrowUp, Check, Copy } from 'lucide-vue-next'
import { EXAMPLE_PROMPT, PRACTICE_LINK_ENABLED, PROMPT_TERM_CATEGORIES, PROMPT_TERM_SOURCE, practiceLink, termById, termsInCategory } from '../data/promptTerms'
import TermDemo from './TermDemo.vue'

const CHARACTER = '/img/daeryuni/'
const copied = ref('')
const copyFailed = ref('')
let copyTimer: ReturnType<typeof setTimeout> | undefined

const badge = (category?: string) => category === '①' ? '1' : category === '②' ? '2' : '3'
const categoryClass = (category?: string) => category === '①' ? 'cat-1' : category === '②' ? 'cat-2' : category === '③' ? 'cat-3' : ''

function reducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches }
function goTo(id: string, updateHash = true) {
  const card = document.getElementById(id)
  if (!card) return false
  if (updateHash) history.replaceState(history.state, '', `${location.pathname}${location.search}#${encodeURIComponent(id)}`)
  card.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
  card.querySelector<HTMLElement>('.term-title')?.focus({ preventScroll: true })
  return true
}
function goTop() { history.replaceState(history.state, '', `${location.pathname}${location.search}`); window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); document.getElementById('terms-heading')?.focus({ preventScroll: true }) }
function fromHash() { const id = decodeURIComponent(location.hash.slice(1)); if (id && termById(id)) void nextTick(() => goTo(id, false)) }

async function copyPrompt(id: string, text: string) {
  clearTimeout(copyTimer); copyFailed.value = ''
  let ok = false
  try { await navigator.clipboard.writeText(text); ok = true } catch {
    const area = document.createElement('textarea'); area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0'
    document.body.appendChild(area); area.select()
    try { ok = document.execCommand('copy') } catch { ok = false }
    area.remove()
  }
  if (ok) { copied.value = id; copyTimer = setTimeout(() => { copied.value = '' }, 2000) }
  else copyFailed.value = id
}

onMounted(() => { fromHash(); window.addEventListener('hashchange', fromHash) })
onBeforeUnmount(() => { clearTimeout(copyTimer); window.removeEventListener('hashchange', fromHash) })
</script>

<template>
  <div class="terms-page">
    <section class="terms-hero" aria-labelledby="terms-heading">
      <div class="terms-hero-copy">
        <span class="eyebrow">웹 서비스 개발 기본 용어 · 16개</span>
        <h1 id="terms-heading" tabindex="-1">앱 서비스 개발 용어</h1>
        <p>프롬프트에 용어를 쓰면 AI가 만들 화면과 기능이 정해집니다. 용어를 눌러 뜻과 화면, 쓰는 문장을 확인하세요.</p>
      </div>
      <img :src="`${CHARACTER}pose_raise.webp`" alt="" class="terms-hero-char" />
    </section>

    <nav class="category-jump" aria-label="용어 범주">
      <a v-for="c in PROMPT_TERM_CATEGORIES" :key="c.id" :href="`#category-${categoryClass(c.id)}`" :class="categoryClass(c.id)" @click.prevent="goTo(`category-${categoryClass(c.id)}`, false)"><span class="cat-badge" aria-hidden="true">{{ badge(c.id) }}</span>{{ c.label }}</a>
    </nav>

    <section class="example-prompt" aria-labelledby="example-prompt-title">
      <h2 id="example-prompt-title">프롬프트 세 문장에 담긴 용어</h2>
      <p class="example-lead">수업 자료의 예시 프롬프트입니다. 색은 용어의 범주를 나타냅니다. 용어를 누르면 그 카드로 이동합니다.</p>
      <ol class="example-sentences">
        <li v-for="s in EXAMPLE_PROMPT" :key="s.role">
          <span class="sentence-role">{{ s.role }}</span>
          <p><template v-for="(part, index) in s.parts" :key="index"><button v-if="part.termId" type="button" class="term-chip" :class="categoryClass(termById(part.termId)?.category)" @click="goTo(part.termId!)">{{ part.text }}</button><template v-else>{{ part.text }}</template></template></p>
        </li>
      </ol>
      <ul class="legend" aria-label="범주 색">
        <li v-for="c in PROMPT_TERM_CATEGORIES" :key="c.id" :class="categoryClass(c.id)"><span class="cat-badge" aria-hidden="true">{{ badge(c.id) }}</span>{{ c.label }}</li>
      </ul>
    </section>

    <section v-for="c in PROMPT_TERM_CATEGORIES" :id="`category-${categoryClass(c.id)}`" :key="c.id" class="term-category" :class="categoryClass(c.id)" :aria-labelledby="`category-${categoryClass(c.id)}-title`">
      <header class="category-head">
        <img :src="`${CHARACTER}${c.character}`" alt="" class="category-char" />
        <div>
          <span class="eyebrow">범주 {{ c.id }} · {{ c.groups }}</span>
          <h2 :id="`category-${categoryClass(c.id)}-title`" class="term-title" tabindex="-1">{{ c.label }}</h2>
          <p>{{ c.lead }}</p>
          <div class="category-terms"><button v-for="t in termsInCategory(c.id)" :key="t.id" type="button" class="term-chip" :class="categoryClass(c.id)" @click="goTo(t.id)">{{ t.name }}</button></div>
        </div>
      </header>

      <article v-for="t in termsInCategory(c.id)" :id="t.id" :key="t.id" class="term-card" :aria-labelledby="`${t.id}-title`">
        <header class="term-card-head">
          <span class="cat-badge" :aria-label="`범주 ${t.category}`">{{ badge(t.category) }}</span>
          <div><h3 :id="`${t.id}-title`" class="term-title" tabindex="-1">{{ t.name }}</h3><span class="term-en">{{ t.en }}</span></div>
        </header>
        <dl class="term-body">
          <div class="term-row"><dt><span>1</span>뜻</dt><dd class="meaning">{{ t.meaning }}</dd></div>
          <div class="term-row"><dt><span>2</span>비유와 예</dt><dd>{{ t.analogy }}</dd></div>
          <div class="term-row demo-row"><dt><span>3</span>화면에서 보이는 모습</dt><dd><TermDemo :term="t" /></dd></div>
          <div class="term-row prompt-row"><dt><span>4</span>프롬프트에 이렇게 쓴다</dt><dd><blockquote>{{ t.promptExample }}</blockquote><div class="copy-line"><button type="button" class="secondary" @click="copyPrompt(t.id, t.promptExample)"><Check v-if="copied === t.id" :size="17" /><Copy v-else :size="17" />{{ copied === t.id ? '복사했습니다' : '문장 복사' }}</button><span v-if="copyFailed === t.id" class="copy-failed" role="alert">자동 복사를 쓸 수 없습니다. 문장을 길게 눌러 직접 복사하세요.</span><span v-else class="sr-status" role="status">{{ copied === t.id ? '문장을 복사했습니다.' : '' }}</span></div></dd></div>
          <div class="term-row"><dt><span>5</span>결과에서 이렇게 확인한다</dt><dd>{{ t.checkHow }}</dd></div>
        </dl>
        <footer class="term-card-foot">
          <a v-if="PRACTICE_LINK_ENABLED" class="primary" :href="practiceLink(t.id)">이 용어로 프롬프트 연습하기<ArrowRight :size="17" /></a>
          <button type="button" class="text-button" @click="goTop"><ArrowUp :size="16" />맨 위로</button>
        </footer>
      </article>
    </section>

    <p class="terms-source">자료: {{ PROMPT_TERM_SOURCE }}. 생성형 AI를 쓰지 않으며 이 화면의 내용은 서버로 전송하지 않습니다.</p>
    <a class="terms-back" href="/#student/assessment-help/subject">평가과제 도움 자료로 돌아가기</a>
  </div>
</template>

<style scoped>
.terms-page{max-width:1040px;margin:0 auto;padding:32px 24px 48px;display:flex;flex-direction:column;gap:22px}
.terms-hero{position:relative;overflow:hidden;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:34px 34px 0 38px;border-radius:18px;background:linear-gradient(135deg,#1e3a6b 0%,var(--brand) 60%,#4a7bc4 100%);color:#fff}
.terms-hero-copy{padding-bottom:32px;min-width:0}
.terms-hero .eyebrow{display:inline-block;margin-bottom:10px;padding:2px 11px;border:1px solid rgba(232,160,32,.6);border-radius:999px;background:rgba(255,255,255,.12);color:#f6d48e;letter-spacing:0}
.terms-hero h1{font-size:32px;color:#fff;outline:none}
.terms-hero p{margin:10px 0 0;color:#dbe6ff;font-size:17px;max-width:40em}
.terms-hero-char{height:170px;width:auto;flex:none}
.category-jump{display:flex;flex-wrap:wrap;gap:8px}
.category-jump a{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:8px 14px;border:1px solid var(--border);border-radius:999px;background:var(--card);color:#1e3a6b;font-size:15px;font-weight:600}
.category-jump a:hover{border-color:#4a7bc4;text-decoration:none}
.cat-badge{display:inline-grid;place-items:center;min-width:28px;height:28px;border-radius:50%;font-size:15px;font-weight:700;flex:none}
.cat-1{--cat:#1e3a6b;--cat-soft:#e8eef9}
.cat-2{--cat:#8a5a00;--cat-soft:#fff3dc}
.cat-3{--cat:#17656f;--cat-soft:#e3f4f4}
.cat-1 .cat-badge,.cat-1.cat-badge,.term-category.cat-1 .cat-badge{background:#1e3a6b;color:#fff}
.cat-2 .cat-badge,.term-category.cat-2 .cat-badge{background:#e8a020;color:#1e2a44}
.cat-3 .cat-badge,.term-category.cat-3 .cat-badge{background:#17656f;color:#fff}
.example-prompt{padding:26px 28px;border:1px solid var(--border);border-radius:16px;background:var(--card)}
.example-prompt h2{font-size:22px;color:#1e3a6b}
.example-lead{margin:8px 0 16px;font-size:16px;color:var(--muted)}
.example-sentences{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.example-sentences li{padding:14px 16px;border-radius:12px;background:var(--subtle)}
.sentence-role{display:block;font-size:14px;font-weight:700;color:var(--muted);margin-bottom:4px}
.example-sentences p{margin:0;font-size:17px;line-height:2.85}
.term-chip{display:inline-flex;align-items:center;min-height:44px;margin:1px 1px;padding:2px 5px;border-radius:8px;border:1px solid transparent;background:var(--cat-soft);color:var(--cat);font-weight:700;font-size:inherit;line-height:1.5;vertical-align:baseline;text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--cat) 35%,transparent);text-underline-offset:4px}
.term-chip:hover{border-color:var(--cat)}
.legend{list-style:none;margin:16px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:8px 18px}
.legend li{display:flex;align-items:center;gap:8px;font-size:15px;color:var(--foreground)}
.legend .cat-badge{min-width:24px;height:24px;font-size:13px}
.term-category{display:flex;flex-direction:column;gap:16px;scroll-margin-top:16px}
.category-head{display:flex;gap:18px;align-items:flex-end;padding:22px 24px 0;border-radius:16px;background:var(--cat-soft);border-top:4px solid var(--cat);overflow:hidden}
.category-head>div{padding-bottom:22px;min-width:0}
.category-char{height:132px;width:auto;flex:none;order:2;margin-left:auto}
.category-head .eyebrow{color:var(--cat);letter-spacing:0}
.category-head h2{font-size:24px;color:#1e3a6b;outline:none}
.category-head p{margin:6px 0 12px;font-size:16px}
.category-terms{display:flex;flex-wrap:wrap;gap:6px}
.category-terms .term-chip{background:#fff;font-size:15px;min-height:44px;text-decoration:none}
.term-card{border:1px solid var(--border);border-radius:16px;background:var(--card);padding:24px 26px;box-shadow:var(--shadow);scroll-margin-top:16px}
.term-card:target,.term-card:focus-within{border-color:#4a7bc4}
.term-card-head{display:flex;gap:12px;align-items:center;margin-bottom:14px}
.term-card-head h3{font-size:23px;color:#1e3a6b;outline:none}
.term-title:focus-visible{outline:3px solid var(--gold);outline-offset:4px;border-radius:4px}
.term-en{font-size:14px;color:var(--muted)}
.term-body{margin:0;display:flex;flex-direction:column}
.term-row{display:grid;grid-template-columns:11.5em minmax(0,1fr);gap:16px;padding:14px 0;border-top:1px solid var(--border)}
.term-row dt{display:flex;gap:8px;align-items:flex-start;font-size:15px;font-weight:700;color:#1e3a6b;line-height:1.6}
.term-row dt span{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--cat-soft);color:var(--cat);font-size:13px;flex:none;margin-top:1px}
.term-row dd{margin:0;font-size:16px;line-height:1.8;min-width:0}
.term-row dd.meaning{font-size:17px;font-weight:600}
.prompt-row blockquote{margin:0;padding:12px 16px;border-left:4px solid #e8a020;border-radius:0 10px 10px 0;background:#fffaf0;font-size:16px;line-height:1.8}
.copy-line{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:10px}
.copy-failed{font-size:14px;color:var(--danger)}
.sr-status{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.term-card-foot{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;margin-top:6px;padding-top:12px;border-top:1px solid var(--border)}
.term-card-foot .text-button{margin-left:auto}
.terms-source{font-size:14px;color:var(--muted);margin:0}
.terms-back{align-self:flex-start;display:inline-flex;align-items:center;min-height:44px;font-size:16px;font-weight:600}
@media(max-width:800px){
  .terms-page{padding:20px 16px 40px}
  .terms-hero{padding:24px 12px 0 22px}
  .terms-hero h1{font-size:26px}
  .terms-hero-char{height:120px}
  .term-row{grid-template-columns:1fr;gap:6px}
  .category-char{height:100px}
}
@media(max-width:480px){
  .terms-hero{padding:20px 4px 0 16px}
  .terms-hero-copy{padding-bottom:20px}
  .terms-hero h1{font-size:24px}
  .terms-hero p{font-size:16px}
  .terms-hero-char{height:92px}
  .example-prompt{padding:20px 16px}
  .example-sentences li{padding:12px}
  .example-sentences p{font-size:16px}
  .category-head{padding:18px 14px 0 16px;gap:8px}
  .category-head>div{padding-bottom:18px}
  .category-char{height:78px}
  .category-head h2{font-size:21px}
  .term-card{padding:18px 16px}
  .term-card-head h3{font-size:21px}
}
</style>
