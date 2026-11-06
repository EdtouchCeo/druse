/* daeryun.life 포트 진입점 — edtouch v2의 main.ts에서 카톡 인앱 전환·PWA·Share Target SW·firebase를 모두 뺐다. */
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import '../../style.css'

createApp(App).use(router).mount('#app')
