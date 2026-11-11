// 가격 검색: 네이버 쇼핑 검색 API(무료, 하루 25,000회)로 같은 상품을 파는 쇼핑몰과 표시 최저가를 찾아요.
// 문서: https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md (2026-11-10 확인)
//   GET https://openapi.naver.com/v1/search/shop.json?query=&display=&sort=&exclude=
//   헤더 X-Naver-Client-Id, X-Naver-Client-Secret / 응답 items[].title(<b> 포함)·link·image·lprice·mallName·productType·brand
// 원칙
//   - 사용자가 버튼을 눌렀을 때만 불러요(자동 호출 없음). 검색어(상품명)만 보내고 체형·주소·사진은 보내지 않아요.
//   - 키(NAVER_CLIENT_ID/NAVER_CLIENT_SECRET)는 서버만 읽어요. 응답·오류·로그에 넣지 않아요.
//   - 응답은 믿지 않는 입력이에요: 개수·길이 제한, 태그 제거, 링크는 https(네이버 링크의 http는 https로 바꿔요)만.
//   - lprice는 네이버 쇼핑에 표시된 최저가라 쿠폰·카드 할인 전 가격일 수 있어요(화면에서 그렇게 안내해요).
//   - 실제 키로는 아직 호출해 보지 못했어요(가짜 fetch 테스트만). 키를 넣은 뒤 한 번 확인이 필요해요.
import { cleanText } from './imageSearch.js'

const ENDPOINT = 'https://openapi.naver.com/v1/search/shop.json'
export const MAX_QUERY_LENGTH = 60
export const MAX_ITEMS = 20
const TIMEOUT_MS = 10000
const TTL_MS = 30 * 60 * 1000 // 같은 검색어는 30분 동안 다시 부르지 않아요
const MAX_CACHE = 200
const RATE_LIMIT_PER_MINUTE = 30
const NEW_GOODS_TYPES = new Set([1, 2, 3]) // 일반상품(가격비교·비매칭·매칭). 중고·단종·판매예정은 빼요

export class PriceSearchError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const PRICE_SEARCH_DISABLED_MESSAGE = '네이버 쇼핑 가격 검색은 서버에 NAVER_CLIENT_ID·NAVER_CLIENT_SECRET 설정이 없어 꺼져 있어요.'

/** https 링크만(네이버 도메인의 http는 https로 바꿔요). 아니면 '' */
export function cleanShopLink(v) {
  if (typeof v !== 'string' || v.length > 600) return ''
  try {
    const u = new URL(v.trim())
    if (u.username || u.password) return ''
    if (u.protocol === 'http:' && /(?:^|\.)naver\.com$/.test(u.hostname)) u.protocol = 'https:'
    return u.protocol === 'https:' ? u.toString() : ''
  } catch {
    return ''
  }
}

/** 검색어 검증: 2~60자, 태그·제어문자 제거 */
export function cleanQuery(q) {
  const t = cleanText(typeof q === 'string' ? q : '', MAX_QUERY_LENGTH)
  return t.length >= 2 ? t : ''
}

/** 네이버 응답 → [{ title, mall, price, link, image, brand }] 가격 오름차순 */
export function normalizeItems(body) {
  const items = Array.isArray(body?.items) ? body.items.slice(0, 100) : []
  const out = []
  for (const it of items) {
    const type = Number(it?.productType)
    if (Number.isFinite(type) && !NEW_GOODS_TYPES.has(type)) continue
    const price = Number(it?.lprice)
    const link = cleanShopLink(it?.link)
    const title = cleanText(it?.title, 120)
    if (!(price >= 1000 && price <= 50000000) || !link || !title) continue
    out.push({ title, mall: cleanText(it?.mallName, 40) || '네이버', price, link, image: cleanShopLink(it?.image) || null, brand: cleanText(it?.brand, 40) })
  }
  return out.sort((a, b) => a.price - b.price).slice(0, MAX_ITEMS)
}

export function createPriceSearchService(env = {}, opts = {}) {
  const id = String(env.NAVER_CLIENT_ID || '').trim()
  const secret = String(env.NAVER_CLIENT_SECRET || '').trim()
  const enabled = Boolean(id && secret)
  const fetchFn = opts.fetch || globalThis.fetch
  const now = opts.now || Date.now
  const cache = new Map()
  let windowStart = 0
  let calls = 0

  async function callApi(query) {
    const url = `${ENDPOINT}?${new URLSearchParams({ query, display: '40', sort: 'sim', exclude: 'used:rental:cbshop' })}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    let res
    try {
      res = await fetchFn(url, { headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret, Accept: 'application/json' }, signal: ctrl.signal })
    } catch (e) {
      if (e?.name === 'AbortError') throw new PriceSearchError(504, 'TIMEOUT', '가격 검색 응답이 너무 느려서 멈췄어요. 잠시 뒤에 다시 시도해주세요.')
      throw new PriceSearchError(502, 'UPSTREAM', '가격 검색 서비스에 연결하지 못했어요.')
    } finally {
      clearTimeout(timer)
    }
    if (res.status === 401 || res.status === 403) throw new PriceSearchError(502, 'AUTH', '가격 검색 인증에 실패했어요. 서버 설정(네이버 키)을 확인해야 해요.')
    if (res.status === 429) throw new PriceSearchError(429, 'QUOTA', '가격 검색 사용 한도에 도달했어요. 잠시 뒤에 다시 시도해주세요.')
    if (!res.ok) throw new PriceSearchError(502, 'UPSTREAM', '가격 검색 서비스에 문제가 있어요. 잠시 뒤에 다시 시도해주세요.')
    const body = await res.json().catch(() => null)
    return normalizeItems(body)
  }

  return {
    status: () => ({ priceSearch: enabled }),
    /** @returns {Promise<{ items, cached:boolean }>} */
    async search(rawQuery) {
      if (!enabled) throw new PriceSearchError(503, 'DISABLED', PRICE_SEARCH_DISABLED_MESSAGE)
      const query = cleanQuery(rawQuery)
      if (!query) throw new PriceSearchError(400, 'INVALID_QUERY', '검색할 상품명을 2자 이상 넣어 주세요.')
      const key = query.toLowerCase()
      const hit = cache.get(key)
      if (hit && now() - hit.at < TTL_MS) return { items: hit.items, cached: true }
      const t = now()
      if (t - windowStart > 60000) {
        windowStart = t
        calls = 0
      }
      if (++calls > RATE_LIMIT_PER_MINUTE) throw new PriceSearchError(429, 'BUSY', '요청이 너무 많아요. 잠시 뒤에 다시 시도해주세요.')
      const items = await callApi(query)
      cache.set(key, { at: t, items })
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value)
      return { items, cached: false }
    },
  }
}
