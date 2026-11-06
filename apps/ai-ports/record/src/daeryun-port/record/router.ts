import { createRouter, createWebHashHistory } from 'vue-router'

/* 해시 라우터. 화면 진입은 막지 않고, 서버 AI 자격은 생성 요청에서 서버가 판정한다. */
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/sebak' },
    { path: '/sebak', name: 'sebak', component: () => import('@/views/record/SebakRecordView.vue'), meta: { title: '과세특 AI — 샛별 AI' } },
    { path: '/club', name: 'club', component: () => import('@/views/record/ClubRecordView.vue'), meta: { title: '동아리 특기사항 AI — 샛별 AI' } },
    { path: '/jayul', name: 'jayul', component: () => import('@/views/record/JayulRecordView.vue'), meta: { title: '자율·자치활동 AI — 샛별 AI' } },
    { path: '/jinro', name: 'jinro', component: () => import('@/views/record/JinroRecordView.vue'), meta: { title: '진로활동 AI — 샛별 AI' } },
    { path: '/haengtuk', name: 'haengtuk', component: () => import('@/views/record/HaengtukRecordView.vue'), meta: { title: '행동특성·종합의견 AI — 샛별 AI' } },
    { path: '/:pathMatch(.*)*', redirect: '/sebak' },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

router.afterEach((to) => {
  document.title = (to.meta?.title as string | undefined) || '학생부 특기사항 AI — 샛별 AI'
})

export default router
