<script setup lang="ts">
// 구현 프롬프트 연습의 기능 카드. 네 칸을 이어 읽으면 기능 한 줄이 된다.
import { computed } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import { featureSentence, type PromptFeature } from '../lib/promptCore'

const props = defineProps<{ feature: PromptFeature; index: number; solo: boolean; removable: boolean }>()
const emit = defineEmits<{ remove: []; focusField: [field: string] }>()
const f = computed(() => props.feature)
const preview = computed(() => featureSentence(props.feature, true))
const FIELDS = [
  { key: 'input', label: '입력: 무엇을 입력하거나 고르면', placeholder: "예: 오늘 메뉴마다 남긴 정도(0, 25, 50, 75, 100%)를 고르고 '분석하기'를 누르면," },
  { key: 'process', label: '처리: 어떤 규칙과 기준으로', placeholder: '예: 배식량 × 남긴 정도로 메뉴별 잔반량(g)을 계산해' },
  { key: 'result', label: '결과: 무엇을 보여 줄지', placeholder: '예: 표로 보여 주고 표 아래에 계산식을 보여 줘.' },
  { key: 'exception', label: '예외: 입력이 없거나 기록이 부족할 때', placeholder: "예: 기록이 3회 미만이면 '기록이 더 필요해요'라고 안내해 줘." },
] as const
const id = (key: string) => `feature-${props.feature.id}-${key}`
</script>

<template>
  <article class="feature-card" :aria-labelledby="id('title')">
    <header>
      <h3 :id="id('title')">기능 {{ index + 1 }}</h3>
      <button v-if="removable" type="button" class="text-button danger" @click="emit('remove')"><Trash2 :size="16" />이 기능 지우기</button>
    </header>
    <label class="field-label">기능 이름<input v-model="f.name" maxlength="200" :placeholder="solo ? '' : '예: 잔반 인식'" :data-field="`feature:${feature.id}:name`" @focus="emit('focusField', `feature:${feature.id}:name`)" /></label>
    <div class="feature-fields">
      <div v-for="field in FIELDS" :key="field.key">
        <label class="field-label">{{ field.label }}<textarea v-model="f[field.key]" rows="2" maxlength="4000" :placeholder="solo ? '' : field.placeholder" :data-field="`feature:${feature.id}:${field.key}`" @focus="emit('focusField', `feature:${feature.id}:${field.key}`)" /></label>
      </div>
    </div>
    <div class="improve-row">
      <label class="check-label"><input v-model="f.improved" type="checkbox" />개선 방안을 반영한 기능입니다</label>
      <template v-if="f.improved">
        <label class="field-label">(개선: ) 안에 쓸 기능 이름<input v-model="f.improveLabel" maxlength="200" :placeholder="f.name || '예: 잔반 인식'" /></label>
      </template>
    </div>
    <p class="feature-preview"><span>이어 읽으면</span>{{ preview || '네 칸을 채우면 여기에 기능 한 줄이 만들어집니다.' }}</p>
  </article>
</template>

<style scoped>
.feature-card{border:1px solid var(--border);border-radius:14px;background:var(--card);padding:18px 20px;display:flex;flex-direction:column;gap:6px}
.feature-card header{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.feature-card h3{font-size:18px;color:#1e3a6b}
.feature-card .field-label{margin:6px 0}
.feature-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 14px}
.feature-fields textarea{min-height:88px;font-size:16px}
.improve-row{margin-top:8px;display:flex;flex-direction:column;gap:6px}
.check-label{display:flex;align-items:center;gap:10px;min-height:44px;font-size:15px;font-weight:600}
.feature-preview{margin:8px 0 0;padding:12px 14px;border-radius:10px;background:var(--subtle);font-size:15px;line-height:1.8}
.feature-preview span{display:block;font-size:14px;font-weight:700;color:var(--muted)}
@media(max-width:800px){.feature-fields{grid-template-columns:1fr}}
@media(max-width:480px){.feature-card{padding:16px 14px}}
</style>
