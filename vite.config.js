import vue from '@vitejs/plugin-vue'
import { quasar } from '@quasar/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), quasar()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
