<script setup lang="ts">
/*
 * /record/ 포트 전용 — `@/components/ServerEndedHint.vue` 대체(vite alias).
 * 생성 버튼 아래 한 줄. 서버 AI를 고른 상태에서 로그인 여부와 전송 범위를 알린다.
 */
import { Info, ShieldCheck, ExternalLink } from 'lucide-vue-next'
import { isSignedIn, TEACHER_LOGIN_URL } from '../common/drSession'

defineProps<{ provider: string | undefined; bridgeOnly?: boolean }>()
const emit = defineEmits<{ (e: 'open'): void }>()
</script>

<template>
  <template v-if="provider === 'server'">
    <div
      v-if="!isSignedIn"
      role="status"
      class="flex w-full flex-wrap items-center gap-x-2 gap-y-2 break-keep rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <Info class="size-4 shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1 basis-60">
        교사 로그인 후 이용할 수 있습니다. 로그인하지 않으려면 AI 설정에서 Gemini 무료 키, 구독 연결, Ollama 가운데 하나를 고르세요.
      </span>
      <a
        :href="TEACHER_LOGIN_URL"
        target="_blank"
        rel="noopener"
        class="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-semibold text-brand-foreground hover:brightness-110"
      >
        교사 로그인 <ExternalLink class="size-3.5" />
      </a>
      <button
        type="button"
        class="min-h-11 shrink-0 rounded-lg border border-amber-400/60 bg-card px-3 text-sm font-semibold text-foreground hover:bg-accent"
        @click="emit('open')"
      >
        AI 설정 열기
      </button>
    </div>
    <p v-else class="flex w-full items-start gap-1.5 break-keep text-xs leading-relaxed text-muted-foreground">
      <ShieldCheck class="mt-0.5 size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
      <span>서버 AI(Claude)로 생성합니다. 가림 처리를 거친 입력 내용이 답변을 만들기 위해 Anthropic으로 전송되며, 서버에는 저장하지 않습니다.</span>
    </p>
  </template>
</template>
