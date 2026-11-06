import { createRouter, createWebHashHistory } from 'vue-router'

/* 해시 라우터 — 화면 1개, 가드 없음. */
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'evalplan', component: () => import('@/views/EvalPlanView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
