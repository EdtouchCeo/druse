<script setup lang="ts">
/* AI 연결 상태 한 줄. 단원·차시 어느 단계에서든 로그인과 개인 키를 고를 수 있게 셸에 둔다. */
import { computed, ref } from 'vue'
import { CheckCircle2, AlertTriangle, ExternalLink, KeyRound } from 'lucide-vue-next'
import UserKeySettings from '../components/UserKeySettings.vue'
import { useLlmMode } from '../composables/useLlmMode'
import { isSignedIn, TEACHER_LOGIN_URL } from '../daeryun-port/common/drSession'

const { hasKey } = useLlmMode()
const settingsOpen = ref(false)
const ready = computed(() => hasKey.value || isSignedIn.value)
</script>

<template>
  <div
    class="relative mb-5 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between"
    :class="ready ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/10'"
  >
    <div class="flex items-start gap-2.5">
      <CheckCircle2 v-if="ready" class="mt-0.5 size-4.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <AlertTriangle v-else class="mt-0.5 size-4.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div class="break-keep text-sm">
        <template v-if="hasKey">
          <p class="font-bold text-foreground">개인 Gemini 키로 생성합니다.</p>
          <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">입력한 내용은 답변을 만들기 위해 Google로 전송됩니다. 키는 이 브라우저에만 저장합니다.</p>
        </template>
        <template v-else-if="isSignedIn">
          <p class="font-bold text-foreground">서버 AI(Claude)로 생성합니다.</p>
          <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">승인 교사만 쓸 수 있습니다. 입력한 내용은 답변을 만들기 위해 Anthropic으로 전송되며, 서버에는 저장하지 않습니다.</p>
        </template>
        <template v-else>
          <p class="font-bold text-foreground">교사 로그인 후 이용할 수 있습니다.</p>
          <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">서버 AI(Claude)는 승인 교사만 쓸 수 있습니다. 로그인하지 않으려면 개인 Gemini 키를 등록하세요.</p>
        </template>
      </div>
    </div>
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      <a
        v-if="!ready"
        :href="TEACHER_LOGIN_URL"
        target="_blank"
        rel="noopener"
        class="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground hover:brightness-110"
      >
        교사 로그인 <ExternalLink class="size-3.5" />
      </a>
      <button
        type="button"
        class="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
        @click="settingsOpen = true"
      >
        <KeyRound class="size-4" /> {{ hasKey ? '개인 키 관리' : '개인 키 등록' }}
      </button>
    </div>
    <UserKeySettings v-model:open="settingsOpen" />
  </div>
</template>
