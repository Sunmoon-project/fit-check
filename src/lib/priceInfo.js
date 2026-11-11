// 상품 페이지 글에서 가격 읽기 + 여러 쇼핑몰에서 본 같은 상품끼리 가격 비교 (순수 함수, 네트워크 없음).
// - 정가(list): 할인율(35%) 바로 앞 가격, 판매가(sale): 할인율 바로 뒤(없으면 첫 가격),
//   쿠폰·혜택가(coupon): '최대혜택가·쿠폰적용가' 같은 말이 붙은 가격, 첫 구매가(first): 첫 구매일 때만 받는 가격.
// - 적립금, 'N만원 이상 결제 시', 카드·간편결제 할인처럼 조건이 붙은 가격은 '최대 할인가'에 넣지 않아요.
// - 쇼핑몰마다 화면 구조가 달라 틀릴 수 있어요. 무신사·29CM·W컨셉·아크테릭스 상품 페이지(2026-11-10)로만 확인했어요.
import { detectBrand, normalizeCode, modelTokens, modelSimilarity, cleanUrl } from './sizeChartDb.js'

const PRICE_LINE_RE = /^[￦₩]?\s?(\d{1,3}(?:,\d{3})+|\d{4,8})\s*원?$/
const PCT_RE = /^\d{1,2}\s?%$/
const BENEFIT_RE = /최대\s?혜택\s?가|최대\s?할인\s?가|쿠폰\s?(?:적용)?\s?가|혜택\s?가|할인\s?적용\s?가/
// '추가혜택가'(W컨셉)는 아래 카드·결제 할인 목록의 제목이라 쿠폰가 표시로 보지 않아요.
const isBenefit = (t) => BENEFIT_RE.test(t) && !/추가/.test(t)
const FIRST_RE = /첫\s?구매/
const SKIP_RE = /적립|이상\s?결제|포인트|카드|페이|배송|할부/
const STOP_RE = /^(?:장바구니|구매하기|바로\s?구매|결제\s?혜택|상품\s?정보|사이즈\s?정보|옵션\s?선택)$/
const MIN_PRICE = 1000
const MAX_PRICE = 50000000
const WINDOW = 30

const num = (t) => Number(String(t).replace(/[^\d]/g, ''))
const okPrice = (v) => Number.isFinite(v) && v >= MIN_PRICE && v <= MAX_PRICE

/** '29,580' + '원'처럼 나뉜 줄을 합쳐요. */
function mergeWonLines(lines) {
  const out = []
  for (const l of lines) {
    if (l === '원' && out.length && /^\d{1,3}(?:,\d{3})+$/.test(out[out.length - 1])) out[out.length - 1] += '원'
    else out.push(l)
  }
  return out
}

/**
 * lines: 화면 글 줄 목록(innerText를 줄로 나눈 것), name: 상품명, ldPrice: JSON-LD offers.price
 * @returns {{ list:number|null, sale:number|null, coupon:number|null, first:number|null, best:number|null, discountPct:number|null, source:string }}
 */
// 상품명 다음 줄들(WINDOW)에서 가격을 읽어요.
function readWindow(win) {
  const out = { list: null, sale: null, coupon: null, first: null }
  for (let i = 0; i < win.length; i++) {
    const l = win[i]
    if (STOP_RE.test(l)) break
    const m = l.match(PRICE_LINE_RE)
    if (!m) continue
    const v = num(m[1])
    if (!okPrice(v)) continue
    // 가격 옆 표시('첫 구매가', '최대혜택가')는 짧은 줄만 봐요. '첫 구매 20% 쿠폰 받으러 가기' 같은 배너 문구는 표시가 아니에요.
    const label = (t) => (t && t.length <= 12 ? t : '')
    const prev = label(win[i - 1])
    const next = label(win[i + 1])
    if (SKIP_RE.test(prev) || SKIP_RE.test(next)) continue
    if (FIRST_RE.test(next) || FIRST_RE.test(prev)) out.first ??= v
    else if (isBenefit(prev)) out.coupon ??= v // '최대혜택가 150,000원'처럼 표시가 가격 앞에 와요
    else if (PCT_RE.test(next) && out.list == null && out.sale == null) out.list = v
    else if (out.sale == null) out.sale = v
  }
  return out
}

export function extractPrices({ lines = [], name = '', ldPrice = null } = {}) {
  let out = { list: null, sale: null, coupon: null, first: null }
  const all = mergeWonLines(lines.map((l) => String(l).trim()).filter(Boolean).slice(0, 4000))
  const tail = String(name).replace(/\s+/g, ' ').trim().slice(-12)
  let source = 'none'
  // 상품명은 스크롤 시 나타나는 고정 바(이름 + 판매가만)처럼 여러 번 나올 수 있어요: 가격 정보가 가장 많은 곳을 써요.
  const score = (o) => Object.values(o).filter((v) => v != null).length
  if (tail.length >= 4) {
    let seen = 0
    for (let i = 0; i < all.length && seen < 20; i++) {
      if (!all[i].includes(tail)) continue
      seen++
      const got = readWindow(all.slice(i + 1, i + 1 + WINDOW))
      if (score(got) > score(out)) out = got
    }
    if (out.sale != null || out.list != null) source = 'text'
  }
  const ld = Number(ldPrice)
  // 글에서 가격 하나만 읽었는데 JSON-LD 판매가가 더 싸면(스크립트가 할인가를 나중에 그리는 페이지), 글의 값은 정가예요.
  if (out.list == null && out.sale != null && okPrice(ld) && ld < out.sale) {
    out.list = out.sale
    out.sale = ld
  }
  if (out.sale == null && okPrice(ld)) {
    out.sale = ld
    source = source === 'none' ? 'json-ld' : source
  }
  if (out.sale == null && out.list != null) [out.sale, out.list] = [out.list, null]
  if (out.list != null && out.sale != null && out.list <= out.sale) out.list = null
  if (out.coupon != null && out.sale != null && out.coupon > out.sale) out.coupon = null
  const best = [out.sale, out.coupon].filter(okPrice)
  const bestPrice = best.length ? Math.min(...best) : null
  const discountPct = out.list && bestPrice ? Math.round((1 - bestPrice / out.list) * 100) : null
  return { ...out, best: bestPrice, discountPct, source }
}

/** 상품 → 가격 비교용 항목 (상품명·브랜드·품번·주소·가격만, 체형·후기는 담지 않아요) */
export function priceEntryOf(product, prices, { pageUrl = '', now = Date.now() } = {}) {
  const url = cleanUrl(product?.url || pageUrl)
  if (!url || !prices?.best) return null
  let mall = ''
  try {
    mall = new URL(url).hostname.replace(/^(?:www|m|display|shop)\./, '')
  } catch {
    mall = ''
  }
  const name = String(product.name || '').slice(0, 120)
  const brandKey = detectBrand(`${product.chartBrand || ''} ${name}`) || null
  const code = normalizeCode(product.chartCode || (name.match(/\(([A-Z0-9-]{6,20})\)/i) || [])[1] || '')
  return {
    url,
    mall,
    name,
    brandKey,
    code: code.length >= 6 ? code : '',
    image: typeof product.image === 'string' && /^https:\/\//.test(product.image) ? product.image.slice(0, 500) : null,
    prices: { list: prices.list, sale: prices.sale, coupon: prices.coupon, first: prices.first, best: prices.best },
    seenAt: now,
  }
}

/** 같은 상품으로 볼지: 품번이 같거나, 같은 브랜드에 상품명이 많이 겹치면 */
export function isSameItem(a, b) {
  if (!a || !b || a.url === b.url) return false
  if (a.code && b.code && a.code === b.code) return true
  if (a.brandKey && b.brandKey && a.brandKey !== b.brandKey) return false
  const sim = modelSimilarity(modelTokens(a.name, a.brandKey), modelTokens(b.name, b.brandKey))
  return a.brandKey && a.brandKey === b.brandKey ? sim >= 0.6 : sim >= 0.8
}

/** 지금 상품과 같은 상품(다른 쇼핑몰) 목록을 최대 할인가 순으로. 가장 싼 곳에 cheapest: true */
export function comparePrices(current, entries = []) {
  const same = entries.filter((e) => isSameItem(current, e))
  // 같은 쇼핑몰은 가장 최근에 본 것만
  const byMall = new Map()
  for (const e of [current, ...same].filter(Boolean)) {
    const k = e.mall || e.url
    if (!byMall.has(k) || byMall.get(k).seenAt < e.seenAt || e === current) byMall.set(k, e)
  }
  return rankPrices([...byMall.values()], current)
}

/** 최대 할인가 순으로 줄 세우고 가장 싼 곳(cheapest)과 최저가와의 차이(diff)를 붙여요. */
export function rankPrices(entries, current = entries[0]) {
  const rows = entries.filter((e) => e?.prices?.best).sort((x, y) => x.prices.best - y.prices.best)
  const min = rows[0]?.prices.best
  return rows.map((e) => ({ ...e, current: e === current, cheapest: rows.length > 1 && e.prices.best === min, diff: e.prices.best - min }))
}

// 다른 쇼핑몰에서 같은 상품 찾아보기 (검색 결과 페이지로 가는 링크만 만들어요. 가져오거나 보내지 않아요)
export const SEARCH_MALLS = [
  { mall: 'musinsa.com', label: '무신사', url: (q) => `https://www.musinsa.com/search/goods?keyword=${q}` },
  { mall: '29cm.co.kr', label: '29CM', url: (q) => `https://www.29cm.co.kr/store/search?keyword=${q}` },
  { mall: 'wconcept.co.kr', label: 'W컨셉', url: (q) => `https://display.wconcept.co.kr/search?keyword=${q}` },
  { mall: 'naver.com', label: '네이버 쇼핑', url: (q) => `https://search.shopping.naver.com/search/all?query=${q}` },
  { mall: 'bunjang.co.kr', label: '번개장터(중고)', url: (q) => `https://m.bunjang.co.kr/search/products?q=${q}` },
  { mall: 'fruitsfamily.com', label: '후르츠패밀리(중고)', url: (q) => `https://fruitsfamily.com/search/${q}` },
]

/** 검색어: 대괄호 태그·색상 수·쇼핑몰 꼬리를 뺀 상품명 */
export function searchQueryOf(name) {
  return String(name || '')
    .replace(/\[[^\]]*\]|\([^)]*\)|©|®|™/g, ' ')
    .replace(/_?\d+\s?COLOR\b/gi, ' ')
    .replace(/\s*[|\-–].*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
}

export function searchLinks(name, exceptMall = '') {
  const q = encodeURIComponent(searchQueryOf(name))
  if (!q) return []
  return SEARCH_MALLS.filter((m) => !String(exceptMall).endsWith(m.mall)).map((m) => ({ label: m.label, url: m.url(q) }))
}

export const won = (v) => (v == null ? '-' : `${Number(v).toLocaleString('ko-KR')}원`)

// ---- 이 브라우저에 저장하는 가격 기록 (chrome.storage.local / localStorage 어댑터: { get, set, remove }) ----
export const PRICE_STORE_KEY = 'fitcheck.prices.v1'
const PRICE_STORE_MAX = 200

export function createPriceStore(adapter) {
  const list = async () => {
    const v = await adapter.get(PRICE_STORE_KEY)
    return Array.isArray(v?.entries) ? v.entries.filter((e) => e && e.url && e.prices?.best) : []
  }
  return {
    list,
    /** 같은 주소는 최신으로 바꾸고, 오래된 것부터 PRICE_STORE_MAX개까지만 남겨요. */
    async put(entry) {
      if (!entry?.url || !entry.prices?.best) return false
      const rest = (await list()).filter((e) => e.url !== entry.url)
      return adapter.set(PRICE_STORE_KEY, { v: 1, entries: [entry, ...rest].slice(0, PRICE_STORE_MAX) })
    },
    clear: () => adapter.remove(PRICE_STORE_KEY),
  }
}
