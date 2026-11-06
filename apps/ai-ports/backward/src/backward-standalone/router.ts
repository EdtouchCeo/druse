import { createRouter, createWebHashHistory } from 'vue-router'

/* 샛별 AI 카드가 /backward/#/backward/unit·lesson으로 들어오므로 원본과 같은 경로를 쓴다. */
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/backward' },
    {
      path: '/backward',
      name: 'backward-home',
      component: () => import('../views/BackwardHomeView.vue'),
      meta: {
        title: '백워드 수업 설계 · 대륜고 사용설명서',
        section: '백워드 수업 설계',
        subtitle: '도달점에서 거꾸로 설계하는 개념기반탐구학습',
      },
    },
    {
      path: '/backward/unit',
      name: 'backward-unit',
      component: () => import('../views/UnitDesignView.vue'),
      meta: {
        title: '단원 설계 · 백워드 · 대륜고 사용설명서',
        section: '개념기반 단원 설계',
        subtitle: '핵심 아이디어부터 단원 흐름까지 5단계',
      },
    },
    {
      path: '/backward/lesson',
      name: 'backward-lesson',
      component: () => import('../views/LessonPlanView.vue'),
      meta: {
        title: '차시 설계 · 백워드 · 대륜고 사용설명서',
        section: '개념기반 차시 설계',
        subtitle: '활동·발문·활동지·수업 시나리오까지 6단계',
      },
    },
    { path: '/:pathMatch(.*)*', redirect: '/backward' },
  ],
})

router.afterEach((to) => {
  document.title = (to.meta.title as string) ?? '백워드 수업 설계 · 대륜고 사용설명서'
})

// 보안 장비가 첫 방문을 가로채며 #조각을 떨어뜨리는 망을 위한 백업 딥링크(?dest=backward/unit).
const dest = new URLSearchParams(window.location.search).get('dest')
if (dest && /^[a-z/-]+$/.test(dest)) {
  const target = '/' + dest.replace(/^\/+/, '')
  window.history.replaceState(null, '', window.location.pathname + window.location.hash)
  void router.isReady().then(() => {
    if (router.currentRoute.value.path === '/backward' && target !== '/') void router.replace(target)
  })
}

export default router
