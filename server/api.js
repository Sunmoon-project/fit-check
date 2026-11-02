// 개발 서버(vite)에 붙는 작은 API.
//   POST /api/product  { url }                          → 상품 페이지를 가져와 상품·사이즈표·리뷰 추출
//   POST /api/tryon    { personImage, garmentImage, category } → fal.ai FASHN 가상 피팅
//   GET  /api/status                                    → 서버 기능 사용 가능 여부
// API 키(FAL_KEY)는 서버에만 있고 브라우저로 보내지 않습니다.
import { safeFetchHtml, FetchError } from './safeFetch.js'
import { parseProductHtml } from './productParser.js'

const MAX_BODY = 15 * 1024 * 1024 // 사진 두 장(data URI) 기준
const FAL_ENDPOINT = 'https://fal.run/fal-ai/fashn/tryon/v1.6'
const FASHN_CATEGORY = { top: 'tops', outer: 'tops', bottom: 'bottoms', dress: 'one-pieces' }

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('요청이 너무 커요. 사진 크기를 줄여주세요.'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}'))
      } catch {
        reject(Object.assign(new Error('JSON 형식이 아니에요.'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

const isImageInput = (v) =>
  typeof v === 'string' && (/^data:image\/(png|jpe?g|webp);base64,/.test(v) || /^https:\/\//.test(v))

async function handleProduct(req, res) {
  const { url } = await readJson(req)
  if (typeof url !== 'string' || url.length > 2000) return send(res, 400, { error: 'INVALID_URL', message: '상품 주소를 확인해주세요.' })
  try {
    const { html, finalUrl } = await safeFetchHtml(url.trim())
    const product = parseProductHtml(html, finalUrl)
    if (!product) return send(res, 422, { error: 'NOT_PRODUCT', message: '상품 정보를 읽지 못했어요.' })
    return send(res, 200, { product })
  } catch (e) {
    if (e instanceof FetchError) return send(res, 502, { error: e.code, message: e.message })
    throw e
  }
}

async function handleTryOn(req, res, falKey) {
  if (!falKey) {
    return send(res, 503, { error: 'NO_KEY', message: 'AI 합성 API 키(FAL_KEY)가 설정되지 않았어요.' })
  }
  const { personImage, garmentImage, category } = await readJson(req)
  if (!isImageInput(personImage) || !isImageInput(garmentImage)) {
    return send(res, 400, { error: 'INVALID_IMAGE', message: '사진 형식을 확인해주세요 (PNG, JPG, WEBP).' })
  }
  if (category === 'shoes') return send(res, 400, { error: 'UNSUPPORTED', message: '신발은 AI 합성을 지원하지 않아요.' })

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 120000)
  try {
    const r = await fetch(FAL_ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_image: personImage,
        garment_image: garmentImage,
        category: FASHN_CATEGORY[category] || 'auto',
        mode: 'balanced',
        garment_photo_type: 'auto',
        output_format: 'jpeg',
      }),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      console.error('[tryon] fal error', r.status, JSON.stringify(data).slice(0, 300))
      const message = r.status === 401 || r.status === 403 ? 'API 키가 올바르지 않아요.' : 'AI 합성에 실패했어요. 다른 사진으로 시도해보세요.'
      return send(res, 502, { error: 'TRYON_FAILED', message })
    }
    const image = data?.images?.[0]?.url
    if (!image) return send(res, 502, { error: 'TRYON_FAILED', message: '합성 결과가 비어 있어요.' })
    return send(res, 200, { image, model: 'FASHN v1.6 (fal.ai)' })
  } catch (e) {
    if (e.name === 'AbortError') return send(res, 504, { error: 'TIMEOUT', message: 'AI 합성이 너무 오래 걸려요. 잠시 후 다시 시도해주세요.' })
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export function fitCheckApi(env) {
  const falKey = env.FAL_KEY || ''
  const middleware = async (req, res, next) => {
    const path = (req.url || '').split('?')[0]
    if (!path.startsWith('/api/')) return next()
    try {
      if (path === '/api/status' && req.method === 'GET') return send(res, 200, { tryon: Boolean(falKey) })
      if (path === '/api/product' && req.method === 'POST') return await handleProduct(req, res)
      if (path === '/api/tryon' && req.method === 'POST') return await handleTryOn(req, res, falKey)
      return send(res, 404, { error: 'NOT_FOUND' })
    } catch (e) {
      console.error('[api]', e)
      return send(res, e.status || 500, { error: 'SERVER', message: e.status ? e.message : '서버 오류가 났어요.' })
    }
  }
  return {
    name: 'fit-check-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
