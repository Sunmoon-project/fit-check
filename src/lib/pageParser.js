// 열려 있는 상품 페이지(DOM)에서 상품·사이즈표·리뷰를 읽습니다. 크롬 확장이 씁니다.
// document 대신 querySelectorAll / textContent / getAttribute만 쓰는 최소 인터페이스를 받아서
// 브라우저 DOM이 아니어도(테스트용 어댑터) 같은 코드로 읽을 수 있어요.
// 표 해석과 리뷰 문장 해석은 서버 파서와 같은 productCore.js를 씁니다.
import { guessCategory, buildSizeChart, parseReviewText, CATEGORY_EMOJI } from './productCore.js'

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const all = (root, sel) => Array.from(root.querySelectorAll(sel))

function metaContent(root, key) {
  for (const sel of [`meta[property="${key}"]`, `meta[name="${key}"]`]) {
    const el = root.querySelector ? root.querySelector(sel) : all(root, sel)[0]
    const v = el?.getAttribute('content')
    if (v) return v
  }
  return null
}

function collectJsonLd(root) {
  const out = []
  for (const s of all(root, 'script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent)
      const stack = Array.isArray(data) ? [...data] : [data]
      while (stack.length) {
        const n = stack.pop()
        if (!n || typeof n !== 'object') continue
        out.push(n)
        if (Array.isArray(n['@graph'])) stack.push(...n['@graph'])
      }
    } catch {
      /* 깨진 JSON-LD는 무시 */
    }
  }
  return out
}

const isType = (n, t) => (Array.isArray(n['@type']) ? n['@type'].includes(t) : n['@type'] === t)

export function readTables(root) {
  return all(root, 'table').map((table) => {
    const rows = []
    for (const tr of all(table, 'tr')) {
      const cells = all(tr, 'th,td').map((c) => clean(c.textContent))
      if (cells.length) rows.push(cells)
    }
    return rows
  })
}

// 리뷰 한 건으로 보이는 요소: class/data-* 에 review가 들어 있고 글이 적당한 길이인 가장 안쪽 요소.
// 쇼핑몰마다 달라서 일반 규칙일 뿐이며, 특정 쇼핑몰에서 맞는지는 확인하지 않았어요.
const REVIEW_SELECTOR = '[class*="review" i],[class*="Review"],[data-testid*="review" i],[itemprop="review"]'
const REVIEW_MIN = 15
const REVIEW_MAX = 600

export function readReviewElements(root) {
  const els = all(root, REVIEW_SELECTOR)
  const texts = []
  for (const el of els) {
    const text = clean(el.textContent)
    if (text.length < REVIEW_MIN || text.length > REVIEW_MAX) continue
    // 안쪽에 같은 조건의 요소가 있으면 안쪽을 쓰도록 건너뜁니다.
    const hasInner = all(el, REVIEW_SELECTOR).some((c) => {
      const t = clean(c.textContent)
      return t.length >= REVIEW_MIN && t.length <= REVIEW_MAX && t !== text
    })
    if (hasInner) continue
    texts.push(text)
  }
  return [...new Set(texts)]
}

/**
 * @param root document 또는 같은 메서드를 가진 객체
 * @param pageUrl 현재 주소 (표시용)
 * @returns 서버 파서와 같은 모양의 상품 객체 (엔진 입력). 이름도 못 읽으면 null.
 */
export function parsePage(root, pageUrl = '') {
  const ld = collectJsonLd(root)
  const ldProduct = ld.find((n) => isType(n, 'Product')) || null
  const h1 = clean(all(root, 'h1')[0]?.textContent)
  const name = clean(ldProduct?.name || metaContent(root, 'og:title') || h1 || all(root, 'title')[0]?.textContent)
  if (!name) return null

  const notes = []
  const preCategory = guessCategory(name)
  const sizeChart = buildSizeChart(readTables(root), preCategory)
  const category = sizeChart?.category || preCategory
  if (!sizeChart) notes.push('이 페이지에서 사이즈표를 찾지 못했어요. 사이즈표가 이미지로 올라간 경우가 많아요.')
  const sizeLabels = sizeChart ? sizeChart.rows.map((r) => r[0]) : []

  const texts = []
  for (const n of [ldProduct, ...ld.filter((x) => isType(x, 'Review'))]) {
    if (!n) continue
    const list = isType(n, 'Review') ? [n] : Array.isArray(n.review) ? n.review : n.review ? [n.review] : []
    for (const r of list) texts.push(clean(r.reviewBody || r.description).slice(0, 500))
  }
  texts.push(...readReviewElements(root).map((t) => t.slice(0, 500)))

  const seen = new Set()
  const reviews = []
  for (const text of texts) {
    if (!text || seen.has(text)) continue
    seen.add(text)
    reviews.push({ id: reviews.length + 1, nick: '구매자', text, ...parseReviewText(text, sizeLabels) })
  }
  if (reviews.length === 0) notes.push('이 페이지에서 리뷰를 찾지 못했어요. 리뷰가 아직 불러와지지 않았을 수 있어요.')

  return {
    url: pageUrl,
    source: 'extension',
    name: name.slice(0, 120),
    category,
    emoji: CATEGORY_EMOJI[category],
    sizeChart: sizeChart ? { unit: sizeChart.unit, headers: sizeChart.headers, rows: sizeChart.rows, measures: sizeChart.measures } : null,
    reviews,
    notes,
  }
}
