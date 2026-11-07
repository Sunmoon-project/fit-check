// 상품 페이지 HTML에서 상품 정보·사이즈표·리뷰를 뽑아냅니다.
// 사이트마다 구조가 달라서, 표준 메타데이터(JSON-LD, Open Graph)와 HTML 표를 일반적인 규칙으로 읽습니다.
// 리뷰를 자바스크립트로 따로 불러오는 사이트는 여기서 리뷰를 못 가져올 수 있어요.
import * as cheerio from 'cheerio'
import { classifyCategory, ldCategoryHints, categoryInfo } from '../src/lib/categoryClassifier.js'
import { guessCategory, buildSizeChart, parseReviewText, CATEGORY_EMOJI } from '../src/lib/productCore.js'

export { guessCategory, parseReviewText }

// ---------- 사이즈표 ----------
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
  const rowsList = []
  $('table').each((_, table) => {
    rowsList.push(tableToRows($, table))
  })
  return buildSizeChart(rowsList, category)
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

  // 같은 분류 함수(근거 점수 합산)를 확장·웹과 함께 써요.
  const headers = []
  $('table').each((_, t) => headers.push(...tableToRows($, t).slice(0, 1).flat().slice(0, 12)))
  const classifyInput = { name, ...ldCategoryHints(ld), headers }
  const auto = classifyCategory(classifyInput)
  const preCategory = auto.category
  const sizeChart = parseSizeChart($, preCategory)
  const category = sizeChart?.category || preCategory
  const cls = sizeChart && sizeChart.category !== auto.category ? classifyCategory({ ...classifyInput, chartCategory: sizeChart.category }) : auto
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
    categoryConfidence: cls.category === category ? cls.confidence : 'low',
    categoryEvidence: categoryInfo({ ...cls, category }).evidence,
    categoryCandidates: cls.candidates,
    price,
    image: typeof image === 'string' ? new URL(image, pageUrl).toString() : null,
    emoji: CATEGORY_EMOJI[category],
    rating,
    sizeChart: sizeChart ? { unit: sizeChart.unit, headers: sizeChart.headers, rows: sizeChart.rows, measures: sizeChart.measures } : null,
    reviews,
    notes,
  }
}
