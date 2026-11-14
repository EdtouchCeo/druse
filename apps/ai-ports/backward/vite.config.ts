/* /backward/ 포트 빌드 설정. build.mjs가 워크스페이스 루트에 vite.port.config.ts로 복사한다. */
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/backward/',
  publicDir: false,
  plugins: [vue(), tailwindcss()],
  resolve: {
    // 대륜고에는 문서작성 AI가 없다. edtouch.ai로 창을 여는 넘기기 모듈을 쓰지 않는 포트 파일로 바꾼다.
    alias: [
      {
        find: /^(?:\.\.\/)+lib\/export\/crossWindowHandoff$/,
        replacement: fileURLToPath(new URL('./src/backward-standalone/exportHandoff.ts', import.meta.url)),
      },
    ],
  },
  build: {
    outDir: 'dist-port',
    emptyOutDir: true,
    rollupOptions: { input: { backward: fileURLToPath(new URL('./backward.html', import.meta.url)) } },
  },
})
