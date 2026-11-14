/* /evalplan/ 포트 빌드 설정. build.mjs가 워크스페이스 루트에 vite.port.config.ts로 복사한다. */
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url))

export default defineConfig({
  base: '/evalplan/',
  publicDir: false,
  plugins: [vue(), tailwindcss()],
  resolve: {
    // alias는 '@' 일반 규칙보다 먼저 와야 한다. firebase를 끌어오는 모듈을 포트 파일로 바꾼다.
    alias: [
      { find: /^@\/lib\/serverLlm$/, replacement: src('daeryun-port/evalplan/serverLlm.ts') },
      { find: /^@\/lib\/llmDefaults$/, replacement: src('daeryun-port/evalplan/llmDefaults.ts') },
      { find: /^@\/components\/ServerLlmNotice\.vue$/, replacement: src('daeryun-port/evalplan/ServerLlmNotice.vue') },
      // 대륜고에는 문서작성 AI(/docai)가 없다. 넘기기 모듈을 내려받기 안내만 하는 포트 파일로 바꾼다.
      { find: /^@\/lib\/export\/handoff$/, replacement: src('daeryun-port/evalplan/exportHandoff.ts') },
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
  },
  build: {
    outDir: 'dist-port',
    emptyOutDir: true,
    rollupOptions: { input: { evalplan: fileURLToPath(new URL('./evalplan.html', import.meta.url)) } },
  },
})
