/* daeryun.life 포트 진입점 — edtouch v2의 main.ts에서 카톡 인앱 전환·PWA·Share Target SW·firebase를 모두 뺐다. */
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { postFormsReady } from './formsEmbed'
import '../../style.css'

createApp(App).use(router).mount('#app')
// 문서작성 AI 안에서 열린 경우에만 부모에 준비 신호를 한 번 보낸다(단독 화면에서는 아무 일도 없다).
router.isReady().then(postFormsReady, () => {})
