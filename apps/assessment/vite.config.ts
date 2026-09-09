import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
// OneDrive/Windows can lock directories during synchronization. Keep the
// directory in place; the publisher selects only assets in the current HTML.
export default defineConfig({ plugins: [vue()], base: '/assessment/', build: { outDir: 'dist', emptyOutDir: false } })
