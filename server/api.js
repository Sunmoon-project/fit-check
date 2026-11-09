// 개발 서버(vite)에 붙는 작은 API.
//   POST /api/product  { url }                          → 상품 페이지를 가져와 상품·사이즈표·리뷰 추출
//   POST /api/tryon    { personImage, garmentImage, category, garmentName? } → Hugging Face IDM-VTON 가상 피팅 (무료)
//   POST /api/image-search { imageUrl }                 → 사진 역검색(외부 서비스, 설정이 있을 때만). 미검증: server/imageSearch.js
//   GET  /api/status                                    → 서버 기능 사용 가능 여부와 사용하는 Space, imageSearch 켜짐 여부
// 키 없이도 동작해요. 선택 토큰(HF_TOKEN)과 사진 역검색 키(IMAGE_SEARCH_API_KEY)는 서버에만 있고 브라우저로 보내지 않습니다.
import { safeFetchHtml, FetchError } from './safeFetch.js'
import { parseProductHtml } from './productParser.js'
import { createImageSearchService, ImageSearchError } from './imageSearch.js'
import { runHfTryOn, isValidSpaceId, isTryOnSupported, DEFAULT_SPACE } from './hfTryOn.js'

const MAX_BODY = 15 * 1024 * 1024 // 사진 두 장(data URI) 기준
// ZeroGPU 대기열이 길 수 있어요. 중간에 끊어도 Space의 작업은 취소되지 않고 쿼터를 쓰므로 넉넉히 기다려요.
const TRYON_TIMEOUT = 300000

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

// 다른 사이트에서 몰래 보낸 POST를 막아요 (함께 쓰는 무료 GPU 쿼터 소모, 서버 대리 fetch 악용 방지).
// - Content-Type이 application/json이어야 해요. 그래야 브라우저가 preflight를 보내고, 다른 출처는 통과하지 못해요.
// - Origin 헤더가 있으면 이 서버의 주소(Host)와 같아야 해요. curl처럼 Origin이 없는 요청은 허용해요.
export function checkPostRequest(headers = {}) {
  const type = String(headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') return { status: 415, error: 'BAD_CONTENT_TYPE', message: 'JSON 요청만 받아요.' }
  const origin = headers.origin
  if (origin) {
    let host = null
    try {
      host = new URL(origin).host
    } catch {
      // 잘못된 Origin은 아래에서 거절
    }
    if (!host || host !== headers.host) return { status: 403, error: 'FORBIDDEN_ORIGIN', message: '허용되지 않은 출처의 요청이에요.' }
  }
  return null
}

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

async function handleTryOn(req, res, hf) {
  const { personImage, garmentImage, category, garmentName, model } = await readJson(req)
  if (!isImageInput(personImage) || !isImageInput(garmentImage)) {
    return send(res, 400, { error: 'INVALID_IMAGE', message: '사진 형식을 확인해주세요 (PNG, JPG, WEBP).' })
  }
  // model: 'leffa'(상의·하의·원피스) | 'idm'(상의·아우터). 모르는 값은 예전처럼 IDM-VTON이에요.
  if (!isTryOnSupported(category, model)) {
    return send(res, 400, { error: 'UNSUPPORTED', message: model === 'leffa' ? 'AI 합성은 상의·아우터·하의·원피스만 지원해요.' : 'AI 합성은 상의·아우터만 지원해요. 무료 IDM-VTON Space는 상반신만 인식해요.' })
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TRYON_TIMEOUT)
  try {
    const result = await runHfTryOn({
      personImage,
      garmentImage,
      category,
      garmentName: typeof garmentName === 'string' ? garmentName : undefined,
      space: hf.space,
      token: hf.token,
      signal: ctrl.signal,
      model,
    })
    return send(res, 200, result)
  } catch (e) {
    if (e.name === 'AbortError') {
      return send(res, 504, {
        error: 'TIMEOUT',
        message: 'AI 합성이 5분 넘게 걸려 기다리기를 멈췄어요. Space가 붐비는 중이에요. 다시 시도하면 무료 GPU 사용량을 한 번 더 쓰니 잠시 뒤에 눌러주세요.',
      })
    }
    if (e.status && e.code) return send(res, e.status, { error: e.code, message: e.message })
    throw e
  } finally {
    clearTimeout(timer)
  }
}

async function handleImageSearch(req, res, imageSearch) {
  const { imageUrl } = await readJson(req)
  try {
    const r = await imageSearch.search(imageUrl)
    return send(res, 200, { candidates: r.candidates, pages: r.pages })
  } catch (e) {
    if (e instanceof ImageSearchError) return send(res, e.status, { error: e.code, message: e.message })
    throw e
  }
}

export function fitCheckApi(env, opts = {}) {
  let space = env.HF_SPACE || DEFAULT_SPACE
  if (!isValidSpaceId(space)) {
    console.warn(`[api] HF_SPACE 형식이 올바르지 않아 기본값(${DEFAULT_SPACE})을 써요.`)
    space = DEFAULT_SPACE
  }
  const hf = { space, token: env.HF_TOKEN || '' }
  const imageSearch = opts.imageSearch || createImageSearchService(env)
  const middleware = async (req, res, next) => {
    const path = (req.url || '').split('?')[0]
    if (!path.startsWith('/api/')) return next()
    try {
      if (path === '/api/status' && req.method === 'GET') return send(res, 200, { tryon: true, provider: 'huggingface', space, token: Boolean(hf.token), ...imageSearch.status() })
      if (req.method === 'POST') {
        const bad = checkPostRequest(req.headers)
        if (bad) return send(res, bad.status, { error: bad.error, message: bad.message })
      }
      if (path === '/api/product' && req.method === 'POST') return await handleProduct(req, res)
      if (path === '/api/tryon' && req.method === 'POST') return await handleTryOn(req, res, hf)
      if (path === '/api/image-search' && req.method === 'POST') return await handleImageSearch(req, res, imageSearch)
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
