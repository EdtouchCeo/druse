/* /backward/ 포트 빌드 설정. build.mjs가 워크스페이스 루트에 vite.port.config.ts로 복사한다. */
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/backward/',
  publicDir: false,
  plugins: [vue(), tailwindcss()],
  build: {
    outDir: 'dist-port',
    emptyOutDir: true,
    rollupOptions: { input: { backward: fileURLToPath(new URL('./backward.html', import.meta.url)) } },
  },
})
