<script setup lang="ts">
/* 대륜고판 셸. 2026-11-05 서버 AI(Claude) 연결에 맞춰 푸터 문구를 고쳤다. */
import { House } from 'lucide-vue-next'
import logo from './daeryun-logo.png'
</script>

<template>
  <div class="flex min-h-screen flex-col bg-background text-foreground">
    <header class="sticky top-0 z-50 border-b border-border bg-card/90 backdrop-blur">
      <div class="container mx-auto max-w-5xl px-4 md:px-6">
        <div class="flex h-14 items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <img :src="logo" alt="대륜고등학교" class="h-6 w-auto shrink-0 object-contain" />
            <span class="truncate text-sm font-bold sm:text-base">
              교수학습 및 평가 운영 계획 AI <span class="text-muted-foreground">— 샛별 AI</span>
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
      </div>
    </header>
    <main class="flex-1">
      <RouterView />
    </main>
    <footer class="border-t border-border py-6 text-center text-xs text-muted-foreground">
      <p>개발 및 운영 : 교사 홍대화</p>
      <p class="mx-auto mt-1.5 max-w-3xl break-keep px-4">
        승인 교사는 로그인하면 서버 AI(Claude)를 쓸 수 있습니다. 이때 입력한 내용은 답변을 만들기 위해 Anthropic으로 전송되며, 서버에는 저장하지 않습니다.
        작성 중인 계획은 이 브라우저에만 남습니다.
      </p>
    </footer>
  </div>
</template>
