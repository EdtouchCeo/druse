<script setup lang="ts">
/* 대륜고판 셸. 2026-07-20 배포본 구성이고, 2026-11-06 서버 AI 연결에 맞춰 푸터 문구를 고쳤다. */
import { House } from 'lucide-vue-next'
import logo from './daeryun-logo.jpg'

const tabs = [
  { to: '/sebak', label: '과세특' },
  { to: '/club', label: '동아리' },
  { to: '/jayul', label: '자율·자치' },
  { to: '/jinro', label: '진로' },
  { to: '/haengtuk', label: '행특' },
]
</script>

<template>
  <div class="flex min-h-screen flex-col bg-background text-foreground">
    <header class="sticky top-0 z-50 border-b border-border bg-card/90 backdrop-blur">
      <div class="container mx-auto max-w-5xl px-4 md:px-6">
        <div class="flex h-14 items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <img :src="logo" alt="대륜고등학교" class="h-6 w-auto shrink-0 object-contain" />
            <span class="truncate text-sm font-bold sm:text-base">
              학생부 특기사항 AI <span class="text-muted-foreground">— 샛별 AI</span>
            </span>
          </div>
          <a
            href="https://daeryun.life/"
            class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-brand/50 hover:text-brand"
          >
            <House class="size-3.5" />
            <span class="hidden sm:inline">대륜고 사용설명서</span>
            <span class="sm:hidden">홈</span>
          </a>
        </div>
        <nav class="-mb-px flex gap-1 overflow-x-auto">
          <RouterLink
            v-for="t in tabs"
            :key="t.to"
            :to="t.to"
            class="shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors"
            :class="$route.path === t.to ? 'border-brand text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'"
          >
            {{ t.label }}
          </RouterLink>
        </nav>
      </div>
    </header>
    <main class="flex-1">
      <RouterView v-slot="{ Component, route }">
        <component :is="Component" :key="route.fullPath" />
      </RouterView>
    </main>
    <footer class="border-t border-border py-6 text-center text-xs text-muted-foreground">
      <p>개발 및 운영 : 교사 홍대화</p>
      <p class="mx-auto mt-1.5 max-w-3xl break-keep px-4">
        승인 교사는 로그인하면 서버 AI(Claude)를 쓸 수 있습니다. 이때 입력한 내용은 답변을 만들기 위해 Anthropic으로 전송되며, 서버에는 저장하지 않습니다.
        작성한 표와 기록은 이 브라우저에만 남습니다.
      </p>
    </footer>
  </div>
</template>
