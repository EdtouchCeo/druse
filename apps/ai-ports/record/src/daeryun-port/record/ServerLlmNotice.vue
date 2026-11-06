<script setup lang="ts">
/* /record/ 포트 전용 — `@/components/ServerLlmNotice.vue` 대체(vite alias). AI 설정 창의 서버 AI 안내. */
import { CircleCheck, Info } from 'lucide-vue-next'
import { isSignedIn, TEACHER_LOGIN_URL } from '../common/drSession'
</script>

<template>
  <div
    v-if="!isSignedIn"
    role="status"
    class="flex gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10"
  >
    <Info class="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
    <div class="space-y-1 break-keep text-amber-800 dark:text-amber-200/90">
      <p class="font-semibold">서버 AI는 교사 로그인 후 쓸 수 있습니다.</p>
      <p>로그인하지 않으려면 위에서 Gemini 무료 키, 구독 연결, Ollama 가운데 하나를 고르세요.</p>
      <a
        :href="TEACHER_LOGIN_URL"
        target="_blank"
        rel="noopener"
        class="inline-flex min-h-11 items-center font-medium text-brand hover:underline"
      >
        새 탭에서 교사 로그인
      </a>
    </div>
  </div>
  <div
    v-else
    class="flex gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-500/40 dark:bg-emerald-500/10"
  >
    <CircleCheck class="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
    <p class="break-keep text-emerald-800 dark:text-emerald-200/90">
      로그인을 확인했습니다. 승인 교사 계정이면 API 키 없이 쓸 수 있습니다. 승인 여부는 생성할 때 서버가 확인합니다.
    </p>
  </div>
</template>
