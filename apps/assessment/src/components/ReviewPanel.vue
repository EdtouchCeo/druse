<script setup lang="ts">
import { computed } from 'vue'
import { ClipboardCheck } from 'lucide-vue-next'
import type { Review } from '../lib/types'
const props = defineProps<{ review?: Review; current: string; checks: string[] }>()
const emit = defineEmits<{ review: []; reason: [value: string] }>()
const changed = computed(() => props.review && props.review.original !== props.current)
</script>

<template>
  <section class="review-panel">
    <div class="review-top"><div><h3>내 글 점검</h3><p>작성한 문장을 읽고, 아래 질문으로 확인하세요.</p></div><button class="secondary" @click="emit('review')"><ClipboardCheck :size="17" /> {{ review ? '현재 글로 다시 점검' : '지금 쓴 글 점검' }}</button></div>
    <div v-if="review" class="review-content">
      <p class="notice">{{ review.original.trim() ? '글을 기록했습니다. 내용의 타당성과 근거는 아래 질문을 따라 직접 확인하세요.' : '아직 작성한 내용이 없습니다. 작성 도움의 첫 질문부터 한 문장으로 답해 보세요.' }}</p>
      <blockquote v-if="review.original.trim()" class="quoted-draft">{{ review.original }}</blockquote>
      <p v-if="changed" class="change-notice">점검 이후 글이 바뀌었습니다. 아래에서 수정 전후를 비교할 수 있습니다.</p>
      <ul class="review-checks"><li v-for="(question, index) in review.prompts" :key="question"><label><input type="checkbox" :key="`${review.createdAt}-${index}`" /><span>{{ question }}</span></label></li></ul>
      <details v-if="changed" class="revision-details"><summary>다시 다듬기 · 수정 전후 비교</summary><div class="comparison"><section><h4>점검할 때 쓴 글</h4><p>{{ review.original || '작성 전' }}</p></section><section><h4>현재 글</h4><p>{{ current || '작성 전' }}</p></section></div></details>
      <label class="field-label">수정한 이유 또는 다음에 보완할 점<textarea :value="review.reason" rows="3" placeholder="어떤 조건을 추가했고, 왜 바꾸었는지 적어 보세요." @input="emit('reason', ($event.target as HTMLTextAreaElement).value)" /></label>
      <small>이 점검은 글의 정답이나 점수를 판정하지 않습니다. 점검 시점의 글과 수정 이유는 원고에 함께 저장됩니다.</small>
    </div>
    <p v-else class="muted review-empty">현재 글을 남긴 뒤 보완할 점을 찾고, 고쳐 쓴 글과 비교할 수 있습니다.</p>
  </section>
</template>
