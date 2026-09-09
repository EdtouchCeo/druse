<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Lightbulb, ChevronDown } from 'lucide-vue-next'
const props = defineProps<{ question: string; clue: string; starter: string; example?: string; solo?: boolean }>()
const level = ref(0)
const opened = ref(!props.solo)
watch(() => props.question, () => { level.value = 0; opened.value = !props.solo })
watch(() => props.solo, value => { opened.value = !value })
const nextLabel = computed(() => ['생각할 단서 보기', '문장 틀 보기', '예시 보기'][level.value])
</script>

<template>
  <section class="writing-help">
    <button class="help-heading" :aria-expanded="opened" @click="opened = !opened"><span><Lightbulb :size="18" /> 작성 도움</span><ChevronDown :size="17" :class="{ rotated: opened }" /></button>
    <div v-if="opened" class="help-body">
      <p class="help-question">{{ question }}</p>
      <div v-if="level >= 1" class="help-layer"><span class="eyebrow">생각할 단서</span><p>{{ clue }}</p></div>
      <div v-if="level >= 2" class="help-layer"><span class="eyebrow">내 상황으로 바꿔 쓸 문장 틀</span><p>{{ starter }}</p></div>
      <div v-if="level >= 3 && example" class="help-layer example-layer"><span class="eyebrow">예제 속 답변</span><p>{{ example }}</p><small>예제의 대상과 조건을 내 문제에 맞게 바꾸어 생각해 보세요.</small></div>
      <button v-if="level < (example ? 3 : 2)" class="text-button" @click="level++">{{ nextLabel }} <ChevronDown :size="15" /></button>
    </div>
  </section>
</template>
