import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fitCheckApi } from './server/api.js'

export default defineConfig(({ mode }) => {
  // 접두사 없이 모두 읽지만, 서버 플러그인에만 넘기고 브라우저 번들에는 넣지 않습니다.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), fitCheckApi(env)],
  }
})
