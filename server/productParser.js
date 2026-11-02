// 상품 페이지 HTML에서 상품 정보·사이즈표·리뷰를 뽑아냅니다.
// 사이트마다 구조가 달라서, 표준 메타데이터(JSON-LD, Open Graph)와 HTML 표를 일반적인 규칙으로 읽습니다.
// 리뷰를 자바스크립트로 따로 불러오는 사이트는 여기서 리뷰를 못 가져올 수 있어요.
import * as cheerio from 'cheerio'

// ---------- 카테고리 판단 ----------
const CATEGORY_RULES = [
  ['shoes', /스니커|운동화|신발|로퍼|부츠|샌들|슬리퍼|구두|러닝화|sneaker|shoe/i],
  ['dress', /원피스|드레스|dress/i],
  ['outer', /자켓|재킷|코트|패딩|점퍼|블루종|아우터|파카|바람막이|무스탕|jacket|coat|parka/i],
  ['bottom', /팬츠|바지|청바지|슬랙스|쇼츠|반바지|스커트|조거|치노|트라우저|jeans|pants|slacks|skirt|shorts/i],
  ['top', /티셔츠|셔츠|니트|맨투맨|후드|스웨트|반팔|긴팔|블라우스|가디건|탑|베스트|조끼|t-shirt|tee|shirt|knit|hoodie|sweat|cardigan/i],
]

export function guessCategory(text, headers = []) {
  const h = headers.join(' ')
  if (/발길이|발볼/.test(h)) return 'shoes'
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text || '')) return cat
  if (/허벅지|밑위|허리/.test(h) && !/어깨/.test(h)) return 'bottom'
  if (/어깨|가슴/.test(h)) return 'top'
  return 'top'
}

const CATEGORY_EMOJI = { top: '👕', outer: '🧥', bottom: '👖', dress: '👗', shoes: '👟' }
const LENGTH_KEY = { top: 'topLength', outer: 'outerLength', bottom: 'inseam', dress: 'dressLength' }

// ---------- 사이즈표 ----------
// 표 헤더 이름 → 핏 엔진이 쓰는 치수 키. 단면 값은 둘레(×2)로 바꿔 비교합니다.
function mapHeader(header, category) {
  const h = header.replace(/\s/g, '')
  const flat = /단면/.test(h)
  if (/어깨/.test(h)) return { key: 'shoulder' }
  if (/가슴|품|chest/i.test(h)) return { key: 'chest', flat, flatBelow: 75 }
  if (/허벅지|thigh/i.test(h)) return { key: 'thigh', flat, flatBelow: 42 }
  if (/엉덩이|힙|hip/i.test(h)) return { key: 'hip', flat, flatBelow: 70 }
  if (/허리|waist/i.test(h)) return { key: 'waist', flat, flatBelow: 55 }
  if (/소매|팔|sleeve/i.test(h)) return { key: 'arm', minValue: 40 }
  if (/발길이|발사이즈/.test(h)) return { key: 'footLength' }
  if (/총장|기장|총기장|length/i.test(h)) return LENGTH_KEY[category] ? { key: LENGTH_KEY[category] } : null
  return null
}

function toNumber(cell) {
  const m = String(cell).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : null
}

const SIZE_LABEL_RE = /^(XXS|XS|S|M|L|XL|XXL|2XL|3XL|XXXL|FREE|F|프리|ONE ?SIZE|\d{1,3}(?:\.\d)?|[0-9]{2,3}\(?[A-Z]*\)?)$/i

function tableToRows($, table) {
  const rows = []
  $(table)
    .find('tr')
    .each((_, tr) => {
      const cells = []
      $(tr)
        .find('th,td')
        .each((__, c) => cells.push($(c).text().replace(/\s+/g, ' ').trim()))
      if (cells.length) rows.push(cells)
    })
  return rows
}

export function parseSizeChart($, category) {
  let best = null
  $('table').each((_, table) => {
    const rows = tableToRows($, table)
    if (rows.length < 2) return
    const headerIdx = rows.findIndex((r) => r.some((c) => /어깨|가슴|허리|총장|기장|허벅지|엉덩이|소매|발길이|단면/.test(c)))
    if (headerIdx < 0) return
    const headers = rows[headerIdx]
    const body = rows
      .slice(headerIdx + 1)
      .filter((r) => r.length === headers.length && SIZE_LABEL_RE.test(r[0].replace(/\s/g, '')))
    if (body.length === 0) return
    if (!best || body.length > best.body.length) best = { headers, body }
  })
  if (!best) return null

  const cat = category || guessCategory('', best.headers)
  const mapping = best.headers.map((h, i) => (i === 0 ? null : mapHeader(h, cat)))
  const measures = {}
  const rows = best.body.map((r) => {
    const label = r[0].replace(/\s/g, '').toUpperCase()
    const m = {}
    r.forEach((cell, i) => {
      const map = mapping[i]
      const v = toNumber(cell)
      if (!map || v == null) return
      if (map.minValue && v < map.minValue) return
      const circumference = map.flat || (map.flatBelow && v < map.flatBelow) ? v * 2 : v
      m[map.key] = Math.round(circumference * 10) / 10
    })
    if (Object.keys(m).length) measures[label] = m
    return [label, ...r.slice(1)]
  })
  return {
    unit: cat === 'shoes' ? 'mm' : 'cm',
    headers: ['사이즈', ...best.headers.slice(1)],
    rows,
    measures,
    category: cat,
  }
}

// ---------- 리뷰 문장에서 체형·사이즈·핏 읽기 ----------
const FIT_WORDS = {
  small: /작아|작게 나|작은 ?편|작음|작네|타이트|끼어|껴요|끼는|낍니다|짧아|짧게|한 ?치수 ?(?:크게|올려|업)|사이즈 ?업/g,
  large: /커요|크게 나|큰 ?편|커서|크네|넉넉|헐렁|루즈|길어요|한 ?치수 ?(?:작게|내려|다운)|사이즈 ?다운/g,
  true: /정사이즈|딱 ?맞|잘 ?맞|적당|정핏|무난하게 맞/g,
}

export function parseReviewText(text, sizeLabels = []) {
  const t = text || ''
  const height =
    toNumber((t.match(/키\s*[:：]?\s*(1[4-9]\d)/) || [])[1] ?? '') ??
    toNumber((t.match(/(1[4-9]\d)\s*(?:cm|센치|㎝|씨엠)/i) || [])[1] ?? '')
  const weight =
    toNumber((t.match(/몸무게\s*[:：]?\s*(\d{2,3})/) || [])[1] ?? '') ??
    toNumber((t.match(/(\d{2,3})\s*(?:kg|키로|킬로|㎏)/i) || [])[1] ?? '')

  let size = null
  const labels = sizeLabels.map((s) => String(s).toUpperCase())
  const sizeMatch =
    t.match(/(?:^|[^A-Za-z0-9])(XXS|XS|S|M|L|XL|XXL|2XL|3XL|FREE|프리)\s*(?:사이즈|로|으로|구매|샀|입|주문|사)/i) ||
    t.match(/(\d{2,3})\s*(?:사이즈|인치|로 구매|으로 구매|샀|구매)/)
  if (sizeMatch) {
    const s = sizeMatch[1].toUpperCase().replace('프리', 'FREE')
    if (labels.length === 0 || labels.includes(s)) size = s
  }

  const counts = {}
  for (const [k, re] of Object.entries(FIT_WORDS)) counts[k] = (t.match(re) || []).length
  let fit = null
  const max = Math.max(counts.small, counts.large, counts.true)
  if (max > 0) {
    if (counts.true === max) fit = 'true'
    else fit = counts.small >= counts.large ? 'small' : 'large'
  }

  return {
    height: height && height >= 140 && height <= 210 ? height : null,
    weight: weight && weight >= 35 && weight <= 150 ? weight : null,
    size,
    fit,
  }
}

// ---------- JSON-LD ----------
function collectJsonLd($) {
  const out = []
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const data = JSON.parse($(s).contents().text())
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
  })
  return out
}

function isType(node, type) {
  const t = node['@type']
  return Array.isArray(t) ? t.includes(type) : t === type
}

function first(v) {
  return Array.isArray(v) ? v[0] : v
}

function formatPrice(offer) {
  const o = first(offer)
  if (!o) return null
  const p = o.price ?? o.lowPrice
  if (p == null) return null
  const n = Number(p)
  if (Number.isNaN(n)) return String(p)
  return (o.priceCurrency && o.priceCurrency !== 'KRW' ? o.priceCurrency + ' ' : '') + n.toLocaleString('ko-KR') + (o.priceCurrency && o.priceCurrency !== 'KRW' ? '' : '원')
}

// ---------- 전체 ----------
export function parseProductHtml(html, pageUrl) {
  const $ = cheerio.load(html)
  const meta = (p) => $(`meta[property="${p}"]`).attr('content') || $(`meta[name="${p}"]`).attr('content') || null
  const ld = collectJsonLd($)
  const product = ld.find((n) => isType(n, 'Product')) || null
  const notes = []

  const name = (product?.name || meta('og:title') || $('title').text() || '').trim()
  const image = first(product?.image)?.url || first(product?.image) || meta('og:image') || null
  const price = formatPrice(product?.offers) || (meta('product:price:amount') ? Number(meta('product:price:amount')).toLocaleString('ko-KR') + '원' : null)
  const mall = meta('og:site_name') || new URL(pageUrl).hostname.replace(/^www\./, '')

  const preCategory = guessCategory(name)
  const sizeChart = parseSizeChart($, preCategory)
  const category = sizeChart?.category || preCategory
  if (!sizeChart) notes.push('페이지에서 사이즈표를 찾지 못했어요. 사이즈표가 이미지로 올라간 사이트가 많아요.')

  const sizeLabels = sizeChart ? sizeChart.rows.map((r) => r[0]) : []
  const rawReviews = []
  for (const n of [product, ...ld.filter((x) => isType(x, 'Review'))]) {
    if (!n) continue
    const list = isType(n, 'Review') ? [n] : Array.isArray(n.review) ? n.review : n.review ? [n.review] : []
    rawReviews.push(...list)
  }
  const reviews = rawReviews
    .map((r, i) => {
      const text = String(r.reviewBody || r.description || '').replace(/\s+/g, ' ').trim().slice(0, 500)
      if (!text) return null
      const parsed = parseReviewText(text, sizeLabels)
      return {
        id: i + 1,
        nick: String(first(r.author)?.name || first(r.author) || '구매자').slice(0, 20),
        rating: Number(r.reviewRating?.ratingValue) || null,
        text,
        ...parsed,
      }
    })
    .filter(Boolean)
  if (reviews.length === 0) notes.push('페이지에 리뷰가 들어 있지 않았어요. 리뷰를 따로 불러오는 사이트는 아직 지원하지 않아요.')

  const rating = product?.aggregateRating
    ? { value: Number(product.aggregateRating.ratingValue) || null, count: Number(product.aggregateRating.reviewCount || product.aggregateRating.ratingCount) || null }
    : null

  if (!name) return null
  return {
    url: pageUrl,
    source: 'live',
    mall,
    name: name.slice(0, 120),
    category,
    price,
    image: typeof image === 'string' ? new URL(image, pageUrl).toString() : null,
    emoji: CATEGORY_EMOJI[category],
    rating,
    sizeChart: sizeChart ? { unit: sizeChart.unit, headers: sizeChart.headers, rows: sizeChart.rows, measures: sizeChart.measures } : null,
    reviews,
    notes,
  }
}
