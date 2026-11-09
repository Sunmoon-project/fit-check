// 프로덕션 서버: vite 없이 dist/(빌드된 화면)와 /api 를 한 포트에서 서빙해요. Docker가 이걸 실행해요.
//   npm run build && npm start   →  http://localhost:3000
// 설정은 환경변수로만 받아요(HF_TOKEN, HF_SPACE, IMAGE_SEARCH_*, PORT). .env.example 참고.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, normalize, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fitCheckApi } from './api.js'

const DIST = fileURLToPath(new URL('../dist/', import.meta.url))
const PORT = Number(process.env.PORT) || 3000
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const api = fitCheckApi(process.env).middleware

async function serveStatic(req, res) {
  let path
  try {
    path = decodeURIComponent((req.url || '/').split('?')[0])
  } catch {
    return send404(res) // /%E0 같은 깨진 인코딩: 던지면 프로세스가 죽어요
  }
  if (path.endsWith('/')) path += 'index.html'
  const file = normalize(join(DIST, path))
  if (!file.startsWith(DIST)) return send404(res) // ../ 로 dist 밖을 읽지 못하게
  try {
    const body = await readFile(file)
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      // vite가 해시를 붙인 assets/ 는 오래 캐시, index.html은 항상 새로
      'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    res.end(body)
  } catch {
    send404(res)
  }
}

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not Found')
}

const server = http.createServer((req, res) => {
  if ((req.url || '') === '/healthz') return res.end('ok') // 배포·Docker 헬스체크용
  api(req, res, () => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send404(res)
    serveStatic(req, res).catch((e) => {
      console.error('[static]', e)
      if (!res.headersSent) send404(res)
      else res.destroy()
    })
  })
})

server.listen(PORT, () => console.log(`[fit-check] http://localhost:${PORT}`))
// docker stop 이 보내는 SIGTERM에 바로 종료
process.on('SIGTERM', () => server.close(() => process.exit(0)))
