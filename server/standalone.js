// 독립 실행 서버: Vite 없이 /api/*를 제공하고, 빌드된 화면(dist/)도 함께 내려줘요.
//   npm run build && npm run serve        → http://localhost:8787
// 모바일 앱(Capacitor)이나 따로 호스팅한 PWA가 이 서버의 API를 부르려면
// ALLOWED_ORIGINS에 그 출처를 적어야 해요 (.env.example 참고).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApiMiddleware } from './api.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')

// .env를 읽어요(Node 20.12+/21.7+의 내장 함수). 없으면 실제 환경변수만 써요.
try {
  process.loadEnvFile?.(path.join(ROOT, '.env'))
} catch {
  // .env가 없으면 무시
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

// dist 안의 파일만 내려줘요(경로 이탈 차단). 파일이 없으면 SPA 진입점(index.html)으로.
function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    return res.end()
  }
  let rel
  try {
    rel = decodeURIComponent((req.url || '/').split('?')[0])
  } catch {
    res.statusCode = 400
    return res.end()
  }
  let file = path.resolve(DIST, '.' + path.posix.normalize('/' + rel))
  if (file !== DIST && !file.startsWith(DIST + path.sep)) {
    res.statusCode = 403
    return res.end()
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  if (!fs.existsSync(file)) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.end('dist/가 없어요. 먼저 npm run build를 실행하세요.')
  }
  const base = path.basename(file)
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream')
  // 서비스 워커와 진입 HTML은 항상 최신으로, 해시가 붙은 assets/는 오래 캐시해요.
  res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache')
  if (base === 'sw.js') res.setHeader('Service-Worker-Allowed', '/')
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(file).pipe(res)
}

const api = createApiMiddleware(process.env)
const server = http.createServer((req, res) => {
  api(req, res, () => serveStatic(req, res)).catch((e) => {
    console.error('[server]', e)
    if (!res.headersSent) res.statusCode = 500
    res.end()
  })
})

const port = Number(process.env.PORT) || 8787
const host = process.env.HOST || '0.0.0.0'
server.listen(port, host, () => {
  console.log(`[fit-check] http://localhost:${port}  (API: /api/*, 화면: dist/)`)
})
