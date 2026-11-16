// 사진 역검색: 중고 판매글 사진 주소로 같은 상품(브랜드·모델명) 후보를 찾는 서버 쪽 처리.
//
// 이 파일은 외부 이미지 검색 서비스(공급자)의 "어댑터"를 모아 두고, 요청 검증·캐시·오류 정리를 해요.
//
// !! 미검증 !!
//   네트워크가 막힌 환경에서 만들어서 실제 API를 한 번도 호출하지 못했어요. 아래 Google Cloud Vision 어댑터의
//   요청·응답 모양, 인증 헤더, 가격, 제공 여부는 공개 문서를 기억한 대로 쓴 "추정"이에요. 키를 넣기 전에
//   공식 문서(Cloud Vision API: images:annotate, WEB_DETECTION)로 꼭 확인해야 해요.
//
// 원칙
//   - 사용자가 버튼을 눌렀을 때만 호출돼요(자동 호출 없음). 사진 주소가 외부 서비스로 전송된다는 고지는 화면에서 해요.
//   - 사진 주소는 https만, 사설 IP·localhost·사용자정보(user:pass@) 포함 주소는 거부해요(safeFetch의 SSRF 규칙).
//   - 키(IMAGE_SEARCH_API_KEY)는 서버만 읽어요. 응답·오류·로그에 넣지 않아요.
//   - 공급자 응답은 믿지 않는 입력이에요: 개수·길이 제한, 태그·제어문자 제거, 링크는 https만.
//   - 검색 결과 페이지를 크롤링해 사이즈표를 긁지 않아요. 결과 링크는 사용자가 직접 열어보게 링크로만 줘요.
import { assertPublicUrl, FetchError } from './safeFetch.js'

export const MAX_IMAGE_URL_LENGTH = 1000
export const MAX_CANDIDATES = 8
export const MAX_PAGES = 8
export const MAX_LABEL_LENGTH = 120
export const MAX_TITLE_LENGTH = 160
export const MAX_PAGE_URL_LENGTH = 500
const MAX_UPSTREAM_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000 // 같은 사진은 6시간 동안 다시 부르지 않아요
const DEFAULT_MAX_ENTRIES = 200
const RATE_LIMIT_PER_MINUTE = 20 // 서버 전체 기준, 실수로 비용이 커지는 것을 막는 안전장치

export class ImageSearchError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

// ── 응답 정리 (믿지 않는 입력) ──────────────────────────────────────────
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g

/** 태그·제어문자를 지우고 공백을 줄여 길이를 제한한 문자열. */
export function cleanText(v, max) {
  if (typeof v !== 'string') return ''
  let s = v.slice(0, max * 4)
  s = s.replace(/<[^>]*>/g, ' ').replace(/[<>]/g, ' ').replace(CONTROL, ' ')
  return s.replace(/\s+/g, ' ').trim().slice(0, max)
}

/** https 링크만 통과. 사용자정보 포함·너무 긴 주소는 버려요. 정규화한 주소를 돌려줘요. */
export function cleanHttpsLink(v) {
  if (typeof v !== 'string' || v.length > MAX_PAGE_URL_LENGTH || CONTROL.test(v)) {
    CONTROL.lastIndex = 0
    return ''
  }
  CONTROL.lastIndex = 0
  try {
    const u = new URL(v.trim())
    if (u.protocol !== 'https:' || u.username || u.password) return ''
    return u.toString()
  } catch {
    return ''
  }
}

// 후보에서 브랜드를 알아보기 위한 작은 목록(예시). 목록에 없으면 brand 없이 label/model만 줘요.
const KNOWN_BRANDS = [
  ['나이키', ['nike', '나이키']],
  ['아디다스', ['adidas', '아디다스']],
  ['뉴발란스', ['new balance', 'newbalance', '뉴발란스']],
  ['스투시', ['stussy', 'stüssy', '스투시']],
  ['칼하트', ['carhartt', '칼하트']],
  ['노스페이스', ['the north face', 'north face', '노스페이스']],
  ['파타고니아', ['patagonia', '파타고니아']],
  ['리바이스', ['levi', '리바이스']],
  ['폴로', ['polo ralph lauren', 'ralph lauren', '폴로']],
  ['컨버스', ['converse', '컨버스']],
  ['반스', ['vans', '반스']],
  ['푸마', ['puma', '푸마']],
  ['자라', ['zara', '자라']],
  ['유니클로', ['uniqlo', '유니클로']],
  ['커버낫', ['covernat', '커버낫']],
  ['디스이즈네버댓', ['thisisneverthat', 'this is never that', '디스이즈네버댓']],
]

export function brandOf(label) {
  const low = label.toLowerCase()
  for (const [name, keys] of KNOWN_BRANDS) if (keys.some((k) => low.includes(k))) return name
  return ''
}

function normalizeCandidate(label, score) {
  const text = cleanText(label, MAX_LABEL_LENGTH)
  if (!text) return null
  const c = { label: text }
  const brand = brandOf(text)
  if (brand) c.brand = brand
  c.model = text
  if (typeof score === 'number' && Number.isFinite(score)) c.score = Math.min(1, Math.max(0, Math.round(score * 100) / 100))
  return c
}

/** 정리된 결과 { candidates, pages }로 마무리: 중복 제거와 상한 적용. */
export function finalizeResult(candidates, pages) {
  const seen = new Set()
  const cOut = []
  for (const c of candidates) {
    if (!c) continue
    const key = c.label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    cOut.push(c)
    if (cOut.length >= MAX_CANDIDATES) break
  }
  const seenUrl = new Set()
  const pOut = []
  for (const p of pages) {
    if (!p || seenUrl.has(p.url)) continue
    seenUrl.add(p.url)
    pOut.push(p)
    if (pOut.length >= MAX_PAGES) break
  }
  return { candidates: cOut, pages: pOut }
}

// ── 공급자 어댑터 ───────────────────────────────────────────────────────
// 어댑터 계약:
//   buildRequest({ imageUrl, apiKey }) → { url, init }       외부 API로 보낼 요청(fetch 인자)
//   parseResponse(json)                 → { candidates, pages } 정리된 결과. 공급자 오류면 ImageSearchError를 던져요.
// 새 공급자는 IMAGE_SEARCH_PROVIDERS에 이름으로 추가하면 돼요.

// [미검증] Google Cloud Vision Web Detection (images:annotate)
//   요청: POST https://vision.googleapis.com/v1/images:annotate
//         { requests: [{ image: { source: { imageUri } }, features: [{ type: 'WEB_DETECTION', maxResults }] }] }
//   응답(추정): responses[0].webDetection = {
//         bestGuessLabels: [{ label }], webEntities: [{ description, score }],
//         pagesWithMatchingImages: [{ url, pageTitle }] }  /  오류는 responses[0].error = { code, message }
//   인증: 문서에는 API 키를 `?key=` 쿼리로 쓰는 방식이 흔히 나오지만, 키가 주소(로그·프록시)에 남지 않도록
//         `X-Goog-Api-Key` 헤더를 쓰도록 썼어요. 이 헤더가 이 API에서 받아들여지는지 확인하지 못했어요(미검증).
//   가격·무료 한도·제공 여부도 확인하지 못했어요.
export const googleVisionAdapter = {
  name: 'google-vision',
  buildRequest({ imageUrl, apiKey }) {
    return {
      url: 'https://vision.googleapis.com/v1/images:annotate',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
        body: JSON.stringify({
          requests: [{ image: { source: { imageUri: imageUrl } }, features: [{ type: 'WEB_DETECTION', maxResults: 10 }] }],
        }),
      },
    }
  },
  parseResponse(json) {
    const first = Array.isArray(json?.responses) ? json.responses[0] : null
    if (!first || typeof first !== 'object') throw new ImageSearchError(502, 'BAD_UPSTREAM', '검색 서비스 응답을 읽지 못했어요.')
    if (first.error) {
      // 공급자 오류 문구는 그대로 쓰지 않아요(키·내부 정보가 섞일 수 있어서). 코드로만 구분해요.
      const code = Number(first.error.code)
      if (code === 429) throw new ImageSearchError(429, 'QUOTA', QUOTA_MESSAGE)
      if (code === 7 || code === 401 || code === 403) throw new ImageSearchError(502, 'PROVIDER_AUTH', AUTH_MESSAGE)
      throw new ImageSearchError(502, 'UPSTREAM_ERROR', IMAGE_FETCH_MESSAGE)
    }
    const web = first.webDetection && typeof first.webDetection === 'object' ? first.webDetection : {}
    const candidates = []
    for (const g of Array.isArray(web.bestGuessLabels) ? web.bestGuessLabels.slice(0, 5) : []) candidates.push(normalizeCandidate(g?.label))
    for (const e of Array.isArray(web.webEntities) ? web.webEntities.slice(0, 30) : []) candidates.push(normalizeCandidate(e?.description, e?.score))
    const pages = []
    for (const p of Array.isArray(web.pagesWithMatchingImages) ? web.pagesWithMatchingImages.slice(0, 30) : []) {
      const url = cleanHttpsLink(p?.url)
      if (url) pages.push({ url, title: cleanText(p?.pageTitle, MAX_TITLE_LENGTH) || new URL(url).hostname })
    }
    return finalizeResult(candidates, pages)
  },
}

export const IMAGE_SEARCH_PROVIDERS = Object.freeze({ [googleVisionAdapter.name]: googleVisionAdapter })

// ── 사용자 친화 문구 ────────────────────────────────────────────────────
export const DISABLED_MESSAGE = '사진 역검색은 서버에 검색 서비스 설정이 없어 꺼져 있어요.'
const INVALID_URL_MESSAGE = '사진 주소를 확인해주세요. https로 시작하는 공개 사진 주소만 쓸 수 있어요.'
const QUOTA_MESSAGE = '검색 서비스 사용 한도에 도달했어요. 잠시 뒤에 다시 시도해주세요.'
const AUTH_MESSAGE = '검색 서비스 인증에 실패했어요. 서버 설정(키)을 확인해야 해요.'
const IMAGE_FETCH_MESSAGE = '검색 서비스가 이 사진을 처리하지 못했어요. 다른 사진 주소로 시도해보세요.'
const TIMEOUT_MESSAGE = '검색 서비스 응답이 너무 느려서 멈췄어요. 잠시 뒤에 다시 시도해주세요.'
const UPSTREAM_MESSAGE = '검색 서비스에 문제가 있어요. 잠시 뒤에 다시 시도해주세요.'
const BUSY_MESSAGE = '요청이 너무 많아요. 잠시 뒤에 다시 시도해주세요.'

/**
 * 사진 주소 검증. https만, 사용자정보·localhost·사설 IP 거부(safeFetch의 DNS·사설 대역 검사 재사용).
 * @param resolve 테스트에서 DNS 없이 쓰려고 바꿀 수 있어요. 기본은 safeFetch의 assertPublicUrl.
 */
export async function validateImageUrl(raw, resolve = assertPublicUrl) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_IMAGE_URL_LENGTH) throw new ImageSearchError(400, 'INVALID_URL', INVALID_URL_MESSAGE)
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    throw new ImageSearchError(400, 'INVALID_URL', INVALID_URL_MESSAGE)
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw new ImageSearchError(400, 'INVALID_URL', INVALID_URL_MESSAGE)
  if (url.port && url.port !== '443') throw new ImageSearchError(400, 'INVALID_URL', INVALID_URL_MESSAGE)
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new ImageSearchError(400, 'INVALID_URL', INVALID_URL_MESSAGE)
  }
  try {
    await resolve(url.toString())
  } catch (e) {
    if (e instanceof FetchError) throw new ImageSearchError(400, 'INVALID_URL', INVALID_URL_MESSAGE)
    throw e
  }
  url.hash = ''
  return url.toString()
}

/**
 * 서비스 만들기. env는 서버만 읽어요(IMAGE_SEARCH_PROVIDER, IMAGE_SEARCH_API_KEY).
 * 둘 중 하나라도 없거나 공급자 이름을 모르면 비활성(enabled=false)이에요.
 */
export function createImageSearchService(env = {}, opts = {}) {
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a))
  const now = opts.now || (() => Date.now())
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const providers = opts.providers || IMAGE_SEARCH_PROVIDERS
  const resolve = opts.resolve || assertPublicUrl

  const providerName = String(env.IMAGE_SEARCH_PROVIDER || '').trim()
  const apiKey = String(env.IMAGE_SEARCH_API_KEY || '').trim()
  const adapter = Object.prototype.hasOwnProperty.call(providers, providerName) ? providers[providerName] : null
  const enabled = Boolean(adapter && apiKey)
  if (providerName && !adapter) console.warn('[api] IMAGE_SEARCH_PROVIDER 값을 알 수 없어 사진 역검색을 꺼요.')

  const cache = new Map() // 주소 → { value, expires }
  const inflight = new Map() // 같은 주소 동시 요청 합치기
  let windowStart = 0
  let windowCount = 0

  function cacheGet(key) {
    const hit = cache.get(key)
    if (!hit) return null
    if (hit.expires <= now()) {
      cache.delete(key)
      return null
    }
    return hit.value
  }
  function cacheSet(key, value) {
    cache.delete(key)
    cache.set(key, { value, expires: now() + ttlMs })
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value)
  }

  async function callProvider(imageUrl) {
    const t = now()
    if (t - windowStart >= 60000) {
      windowStart = t
      windowCount = 0
    }
    if (++windowCount > RATE_LIMIT_PER_MINUTE) throw new ImageSearchError(429, 'BUSY', BUSY_MESSAGE)

    const { url, init } = adapter.buildRequest({ imageUrl, apiKey })
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      let res
      try {
        res = await fetchImpl(url, { ...init, signal: ctrl.signal })
      } catch (e) {
        // 오류 객체 문구에 주소·키가 섞일 수 있어 내용은 쓰지 않아요.
        if (e?.name === 'AbortError') throw new ImageSearchError(504, 'TIMEOUT', TIMEOUT_MESSAGE)
        throw new ImageSearchError(502, 'UPSTREAM_ERROR', UPSTREAM_MESSAGE)
      }
      if (res.status === 429) throw new ImageSearchError(429, 'QUOTA', QUOTA_MESSAGE)
      if (res.status === 401 || res.status === 403) throw new ImageSearchError(502, 'PROVIDER_AUTH', AUTH_MESSAGE)
      if (res.status === 400) throw new ImageSearchError(502, 'UPSTREAM_ERROR', IMAGE_FETCH_MESSAGE)
      if (!res.ok) throw new ImageSearchError(502, 'UPSTREAM_ERROR', UPSTREAM_MESSAGE)
      let text
      try {
        text = await res.text()
      } catch (e) {
        if (e?.name === 'AbortError') throw new ImageSearchError(504, 'TIMEOUT', TIMEOUT_MESSAGE)
        throw new ImageSearchError(502, 'BAD_UPSTREAM', UPSTREAM_MESSAGE)
      }
      if (typeof text !== 'string' || text.length > MAX_UPSTREAM_BYTES) throw new ImageSearchError(502, 'BAD_UPSTREAM', UPSTREAM_MESSAGE)
      let json
      try {
        json = JSON.parse(text)
      } catch {
        throw new ImageSearchError(502, 'BAD_UPSTREAM', UPSTREAM_MESSAGE)
      }
      return adapter.parseResponse(json)
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    enabled,
    /** /api/status에 넣을 값. 공급자 이름·키는 알려주지 않고 켜졌는지만 알려줘요. */
    status: () => ({ imageSearch: enabled }),
    /** @returns {Promise<{candidates, pages, cached}>} 오류는 ImageSearchError로 던져요. */
    async search(rawUrl) {
      if (!enabled) throw new ImageSearchError(503, 'DISABLED', DISABLED_MESSAGE)
      const imageUrl = await validateImageUrl(rawUrl, resolve)
      const hit = cacheGet(imageUrl)
      if (hit) return { ...hit, cached: true }
      let pending = inflight.get(imageUrl)
      if (!pending) {
        pending = callProvider(imageUrl)
          .then((r) => {
            cacheSet(imageUrl, r)
            return r
          })
          .finally(() => inflight.delete(imageUrl))
        inflight.set(imageUrl, pending)
      }
      return { ...(await pending), cached: false }
    },
  }
}
