<script setup lang="ts">
/* 대륜고판 셸. 2026-08-05 배포 번들에서 복원했고 2026-11-05에 AI 연결 상태를 더했다. */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import AiAccessBar from './AiAccessBar.vue'

const route = useRoute()
const section = computed(() => (route.meta.section as string) ?? '백워드 수업 설계')
const subtitle = computed(() => (route.meta.subtitle as string) ?? '도달점에서 거꾸로 설계하는 개념기반탐구학습')
// 정적 src 속성은 번들러가 import로 바꿔 빌드가 깨진다. 사이트 루트의 로고를 런타임 문자열로 쓴다.
const logo = '/logo.png'
</script>

<template>
  <div class="min-h-screen flex flex-col bg-background text-foreground antialiased">
    <header class="sticky top-0 z-40 text-white shadow-md" style="background: linear-gradient(135deg, #1e3a6b 0%, #2a5298 55%, #4a7bc4 100%)">
      <div class="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:px-6">
        <a href="/" title="대륜고 사용설명서 메인으로" class="shrink-0">
          <img :src="logo" alt="대륜고등학교" class="h-11 w-auto rounded-md bg-white/95 p-1" />
        </a>
        <div class="min-w-0">
          <p class="text-[11px] font-semibold leading-tight text-amber-300">대륜고 사용설명서 · 샛별AI</p>
          <h1 class="truncate text-base font-extrabold leading-tight tracking-tight md:text-lg">{{ section }}</h1>
          <p class="truncate text-[11px] leading-tight text-white/70">{{ subtitle }}</p>
        </div>
        <a
          href="/"
          class="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
        >
          <ArrowLeft class="size-3.5" /> 사용 설명서로
        </a>
      </div>
    </header>
    <main class="relative w-full flex-1">
      <div class="hero-gradient pointer-events-none absolute inset-x-0 top-0 h-64" aria-hidden="true"></div>
      <div class="container relative mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
        <AiAccessBar />
        <RouterView />
      </div>
    </main>
    <footer class="mt-12 shrink-0 text-white" style="background: #2a5298">
      <div class="mx-auto max-w-6xl px-4 py-4 text-center md:px-6">
        <p class="text-xs text-white/80">
          개발 및 운영: 교사 홍대화 <span class="text-white/40">|</span> 문의:
          <a href="mailto:daveceo@edtouch.ai" class="underline hover:text-white">daveceo@edtouch.ai</a>
        </p>
      </div>
    </footer>
  </div>
</template>
