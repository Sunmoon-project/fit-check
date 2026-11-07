// 열려 있는 상품 페이지(DOM)에서 상품·사이즈표·리뷰를 읽습니다. 크롬 확장이 씁니다.
// document 대신 querySelectorAll / textContent / getAttribute만 쓰는 최소 인터페이스를 받아서
// 브라우저 DOM이 아니어도(테스트용 어댑터) 같은 코드로 읽을 수 있어요.
// 표 해석과 리뷰 문장 해석은 서버 파서와 같은 productCore.js를 씁니다.
import { guessCategory, analyzeSizeCharts, parseReviewText, CATEGORY_EMOJI, SIZE_LABEL_RE } from './productCore.js'

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

// ---------- <table>이 아닌 사이즈표 (div/grid, role=table, 세로 방향 등) ----------
// 실제 쇼핑몰 DOM은 확인하지 못했어요. 특정 몰에 맞춘 규칙이 아니라, 일반적인 반복 구조를 찾는 후보 전략입니다.
// textContent만 쓰므로 display:none 등으로 접힌 내용도 읽어요. 클릭·스크롤은 하지 않습니다.
export const MEASURE_RE = /어깨|가슴|총장|기장|허리|허벅지|엉덩이|소매|발길이|단면/
const HEADING_RE = /사이즈|실측|size/i
const MAX_ANCHORS = 250
const MAX_CLIMB = 6
const MAX_CHILDREN = 80

const childrenOf = (el) => Array.from(el.children || [])
const isLabel = (t) => SIZE_LABEL_RE.test(String(t).replace(/\s/g, ''))
// 'M cm'처럼 단위가 따로 붙은 칸에서 단위만 뗍니다.
const cellText = (el) => clean(el.textContent).replace(/\s*(cm|mm)$/i, '')
const sig = (rows) => JSON.stringify(rows)

function transpose(rows) {
  const w = Math.max(...rows.map((r) => r.length))
  if (!(w >= 2) || rows.some((r) => r.length !== rows[0].length)) return null
  return Array.from({ length: w }, (_, i) => rows.map((r) => r[i]))
}

// 칸(셀)이 한 줄로 늘어선 CSS grid: 첫 사이즈 글자가 나오는 위치를 열 개수로 보고 잘라요.
function chunkFlat(texts) {
  const first = texts.findIndex((t, i) => i > 0 && isLabel(t))
  if (first < 2 || texts.length % first !== 0) return null
  const rows = []
  for (let i = 0; i < texts.length; i += first) rows.push(texts.slice(i, i + first))
  return rows
}

// 컨테이너 하나를 "줄 배열"로 해석합니다. 자식 각각이 한 줄(안의 자식이 칸)이거나, 칸이 평평하게 나열된 경우.
function rowsOfContainer(el) {
  const kids = childrenOf(el)
  if (kids.length < 2 || kids.length > MAX_CHILDREN) return []
  const out = []
  const rows = kids.map((k) => {
    const cells = childrenOf(k)
    return cells.length >= 2 ? cells.map(cellText) : null
  })
  const good = rows.filter(Boolean)
  if (good.length >= 2) out.push(good)
  if (kids.every((k) => childrenOf(k).length === 0)) {
    const flat = chunkFlat(kids.map(cellText))
    if (flat) out.push(flat)
  }
  return out
}

/** 사이즈표 후보 영역: [{ el, rows }] . rows는 buildSizeChart가 받는 [[셀,...],...] 모양이에요. */
export function findGridCandidates(root) {
  const found = []
  const seenEl = new Set()
  const seenRows = new Set(readTables(root).map(sig))
  const add = (el, rows, kind = 'grid') => {
    const key = sig(rows)
    if (seenRows.has(key)) return
    seenRows.add(key)
    found.push({ el, rows, kind })
  }

  // (a) role=table/grid 와 role=row / 셀 역할
  for (const t of all(root, '[role="table"],[role="grid"],[role="treegrid"]')) {
    const rows = all(t, '[role="row"]')
      .map((r) => all(r, '[role="cell"],[role="columnheader"],[role="rowheader"],[role="gridcell"]').map(cellText))
      .filter((r) => r.length)
    if (rows.length >= 2) {
      add(t, rows)
      const tr = transpose(rows)
      if (tr) add(t, tr, 'transposed')
    }
  }

  // (b)(c) 실측 항목 글자가 든 가장 안쪽 요소에서 위로 올라가며 반복 구조를 찾는다
  const anchors = all(root, '*')
    .filter((e) => childrenOf(e).length === 0 && MEASURE_RE.test(clean(e.textContent)) && clean(e.textContent).length <= 30)
    .slice(0, MAX_ANCHORS)
  for (const a of anchors) {
    let cur = a
    for (let up = 0; up < MAX_CLIMB && cur; up++, cur = cur.parentElement) {
      if (seenEl.has(cur)) continue
      seenEl.add(cur)
      for (const rows of rowsOfContainer(cur)) {
        if (!rows.some((r) => r.some((c) => MEASURE_RE.test(c))) && !transpose(rows)?.some((r) => r.some((c) => MEASURE_RE.test(c)))) continue
        add(cur, rows)
        // (d) 한 열이 한 사이즈인 세로 방향 표
        const tr = transpose(rows)
        if (tr) add(cur, tr, 'transposed')
      }
    }
  }
  return found
}

export function readSizeGrids(root) {
  return findGridCandidates(root).map((c) => c.rows)
}

/** 표 + 표가 아닌 반복 구조에서 읽은 사이즈표 후보 전체 */
export function readAllSizeRows(root) {
  return [...readTables(root), ...readSizeGrids(root)]
}

// ---------- 구매 옵션 이름 ('0 (S)', '1 (M)' ...) ----------
// 페이지의 textContent만 읽어요. 뒤에 배송 안내 같은 글이 붙어 있어도 앞부분의 "번호 (글자)"만 씁니다.
const OPTION_RE = /^(\d{1,2})\s*\(\s*(XXS|XS|S|M|L|XL|XXL|[2-5]XL|FREE|F)\s*\)(?![A-Za-z0-9])/i
const MAX_OPTIONS = 20

export function readOptionLabels(root) {
  const out = []
  const els = all(root, '*')
    .filter((e) => childrenOf(e).length <= 4)
    .slice(0, 6000)
  for (const e of els) {
    const text = clean(e.textContent)
    if (text.length > 80) continue
    const m = text.match(OPTION_RE)
    if (!m) continue
    // 안쪽 요소가 같은 모양이면 안쪽이 대표라 건너뛰어도 결과는 같아요. 중복은 아래에서 합칩니다.
    const label = `${m[1]} (${m[2].toUpperCase()})`
    if (!out.includes(label)) out.push(label)
    if (out.length >= MAX_OPTIONS) break
  }
  // 한두 개만 보이면 우연일 수 있어 옵션 목록으로 보지 않아요.
  return out.length >= 2 ? out : []
}

// ---------- 페이지에 표시된 전체 리뷰 수 ----------
// '후기 733', '리뷰 1,234개', '리뷰 (733)', '733개 리뷰'처럼 짧은 글 전체가 이 모양일 때만 읽어요.
const TOTAL_RES = [/^(?:구매\s*)?(?:리뷰|후기)\s*\(?\s*([\d,]{1,9})\s*\)?\s*(?:건|개)?$/, /^([\d,]{1,9})\s*(?:건|개)의?\s*(?:리뷰|후기)$/]
export function readReviewTotal(root) {
  let best = null
  const els = all(root, '*')
    .filter((e) => childrenOf(e).length <= 3)
    .slice(0, 6000)
  for (const e of els) {
    const text = clean(e.textContent)
    if (text.length > 25 || !/리뷰|후기/.test(text)) continue
    for (const re of TOTAL_RES) {
      const m = text.match(re)
      const n = m ? Number(m[1].replace(/,/g, '')) : NaN
      if (Number.isFinite(n) && n > 0 && n < 10000000 && (best == null || n > best)) best = n
    }
  }
  return best
}

export { HEADING_RE }

// 리뷰 한 건으로 보이는 요소: class/data-* 에 review가 들어 있고 글이 적당한 길이인 가장 안쪽 요소.
// 쇼핑몰마다 달라서 일반 규칙일 뿐이며, 특정 쇼핑몰에서 맞는지는 확인하지 않았어요.
export const REVIEW_SELECTOR = [
  '[class*="review" i]',
  '[class*="Review"]',
  '[data-testid*="review" i]',
  '[itemprop="review"]',
  '[data-review-id]',
  '[data-review-no]',
  '[data-review]',
  // 리뷰 목록 안의 li (컨테이너의 class/id/aria에 review·후기가 있을 때)
  '[class*="review" i] li',
  '[id*="review" i] li',
  '[aria-label*="리뷰"] li',
  '[aria-label*="후기"] li',
].join(',')
const REVIEW_MIN = 15
const REVIEW_MAX = 600

/** 안쪽에 같은 조건의 요소가 있으면 안쪽을 쓰도록 건너뜁니다. dropped에 버린 사유별 개수를 더해요. */
export function readReviewElements(root, dropped = {}) {
  const bump = (k) => (dropped[k] = (dropped[k] || 0) + 1)
  const els = [...new Set(all(root, REVIEW_SELECTOR))]
  const texts = []
  for (const el of els) {
    const text = clean(el.textContent)
    if (text.length < REVIEW_MIN) {
      bump('tooShort')
      continue
    }
    if (text.length > REVIEW_MAX) {
      bump('tooLong')
      continue
    }
    const hasInner = all(el, REVIEW_SELECTOR).some((c) => {
      const t = clean(c.textContent)
      return t.length >= REVIEW_MIN && t.length <= REVIEW_MAX && t !== text
    })
    if (hasInner) {
      bump('innerDuplicate')
      continue
    }
    texts.push(text)
  }
  return [...new Set(texts)]
}

// ---------- 리뷰 카드: 같은 구조로 반복되는 형제 요소 ----------
// 키·몸무게가 본문과 다른 요소에 있어도 읽도록, 단서가 든 요소에서 위로 올라가며
// '같은 tag+자식 구조'가 3개 이상 형제로 반복되는 가장 큰 요소(1200자 이하)를 리뷰 카드로 봐요.
// 클래스 이름은 보지 않아요. 쇼핑몰마다 달라서 일반 규칙일 뿐이며, 실제 쇼핑몰에서 맞는지는 확인하지 않았어요.
const CARD_MAX = 1200
const CARD_MIN_REPEAT = 3
const CARD_CLIMB = 8
const CARD_SEED_LIMIT = 6000
const CLUE_LEAF_RE = /(?<![\d.,])\d{3}(?:\.\d)?\s*(?:cm|㎝)|(?<![\d.,])\d{2,3}(?:\.\d)?\s*(?:kg|㎏)|구매\s*옵션|몸무게\s*[:：]?\s*\d/i

const REVIEW_CUE_RE = /구매\s*옵션|\d{2,4}[.\-/]\d{1,2}[.\-/]\d{1,2}|구매|착용|입어|입었|샀|배송|추천|만족|아쉬|좋아|예뻐|편해|커요|작아|커서|작은|크게|딱/

function shape(el, depth = 2) {
  const kids = childrenOf(el)
  return `${el.tagName}${depth > 0 && kids.length ? `(${kids.slice(0, 8).map((k) => shape(k, depth - 1)).join(',')})` : ''}`
}

// 표 안의 셀은 사이즈표 값(150cm 등)이라 리뷰 카드 시드로 쓰지 않아요.
function inTable(el) {
  for (let cur = el, i = 0; cur && i < 6; cur = cur.parentElement, i++) if (/^(TD|TH|TR|TABLE)$/i.test(cur.tagName)) return true
  return false
}

export function readReviewCardEls(root) {
  const seeds = new Set(all(root, REVIEW_SELECTOR))
  let scanned = 0
  for (const e of all(root, '*')) {
    if (++scanned > CARD_SEED_LIMIT) break
    if (childrenOf(e).length > 1) continue
    const t = clean(e.textContent)
    if (t.length <= 80 && CLUE_LEAF_RE.test(t) && !inTable(e)) seeds.add(e)
  }
  const cards = new Set()
  const shapes = new Map()
  const sig = (el) => {
    if (!shapes.has(el)) shapes.set(el, shape(el))
    return shapes.get(el)
  }
  for (const seed of seeds) {
    let best = null
    let cur = seed
    for (let up = 0; up < CARD_CLIMB && cur && cur.parentElement; up++, cur = cur.parentElement) {
      if (clean(cur.textContent).length > CARD_MAX) break
      if (childrenOf(cur).length < 2) continue
      const mine = sig(cur)
      const same = childrenOf(cur.parentElement).filter((c) => sig(c) === mine).length
      if (same >= CARD_MIN_REPEAT) best = cur
    }
    if (best) cards.add(best)
  }
  // 카드 안에 다른 카드가 들어 있으면 바깥 것은 뺍니다
  const list = [...cards]
  // 값만 반복되는 div 격자(사이즈표)를 걸러요: 카드 글에 리뷰 단서(구매 옵션·날짜·후기 말투) 하나는 있어야 해요.
  return list.filter((c) => !list.some((o) => o !== c && c.contains?.(o))).filter((c) => REVIEW_CUE_RE.test(clean(c.textContent)))
}

export function readReviewCards(root) {
  return readReviewCardEls(root).map((c) => clean(c.textContent))
}

// 상품 페이지로 보이는지: JSON-LD Product, og:type=product, 또는 사이즈표가 있는 경우.
// 주문·목록 같은 다른 페이지에 버튼이 뜨지 않게 하는 용도이며, 완벽한 판별은 아니에요.
export function isProductPage(root) {
  if (collectJsonLd(root).some((n) => isType(n, 'Product'))) return true
  if (/product/i.test(metaContent(root, 'og:type') || '')) return true
  return analyzeSizeCharts(readAllSizeRows(root), guessCategory(clean(all(root, 'h1')[0]?.textContent)), readOptionLabels(root)).chart != null
}

// '사이즈'·'실측' 제목 근처(위로 3단계)에 이미지가 있는지. 사이즈표가 이미지로만 올라온 경우를 안내하는 데 써요.
function hasImageNearSizeHeading(root) {
  const anchors = all(root, '*')
    .filter((e) => childrenOf(e).length === 0 && HEADING_RE.test(clean(e.textContent)) && clean(e.textContent).length <= 30)
    .slice(0, 150)
  for (const a of anchors) {
    let cur = a
    for (let i = 0; i < 3 && cur; i++, cur = cur.parentElement) if (all(cur, 'img').length > 0) return true
  }
  return false
}

/**
 * @param root document 또는 같은 메서드를 가진 객체
 * @param pageUrl 현재 주소 (표시용)
 * @returns 서버 파서와 같은 모양의 상품 객체 (엔진 입력). 이름도 못 읽으면 null.
 */
export function parsePage(root, pageUrl = '', opts = {}) {
  const ld = collectJsonLd(root)
  const ldProduct = ld.find((n) => isType(n, 'Product')) || null
  const h1 = clean(all(root, 'h1')[0]?.textContent)
  const name = clean(ldProduct?.name || metaContent(root, 'og:title') || h1 || all(root, 'title')[0]?.textContent)
  if (!name) return null

  const notes = []
  const preCategory = guessCategory(name)
  const optionLabels = readOptionLabels(root)
  const extra = opts.extraRows || []
  const tables = readTables(root)
  const grids = findGridCandidates(root)
  const kinds = [...tables.map(() => 'table'), ...grids.map((c) => c.kind), ...extra.map(() => 'manual')]
  const { chart: sizeChart, meta: chartMeta } = analyzeSizeCharts(
    [...tables, ...grids.map((c) => c.rows), ...extra],
    preCategory,
    optionLabels,
  )
  const category = sizeChart?.category || preCategory
  if (!sizeChart) {
    if (chartMeta.rejectedNoOverlap > 0) notes.push('읽은 사이즈표의 사이즈 이름이 이 페이지의 구매 옵션과 맞지 않아 사용하지 않았어요.')
    else if (chartMeta.rejectedMeasureHeader > 0 && chartMeta.withHeader === chartMeta.rejectedMeasureHeader)
      notes.push('읽은 표의 가로세로가 뒤바뀐 것으로 보였지만 사이즈 이름 줄을 찾지 못해 뒤집어 읽을 수 없었어요.')
    notes.push('이 페이지에서 사이즈표를 찾지 못했어요. 사이즈표가 이미지로 올라간 경우가 많아요.')
    if (hasImageNearSizeHeading(root)) notes.push('사이즈표가 이미지로 제공된 것 같아요. 사이즈표 직접 입력을 이용해 주세요.')
  }
  // 리뷰의 'M' 같은 글자가 '1(M)' 표기의 사이즈와 이어지도록 괄호 안 글자도 후보에 넣어요.
  const sizeLabels = sizeChart ? sizeChart.rows.flatMap((r) => [r[0], (r[0].match(/^\d{1,2}\(([^)]+)\)$/) || [])[1]].filter(Boolean)) : []

  const texts = []
  for (const n of [ldProduct, ...ld.filter((x) => isType(x, 'Review'))]) {
    if (!n) continue
    const list = isType(n, 'Review') ? [n] : Array.isArray(n.review) ? n.review : n.review ? [n.review] : []
    for (const r of list) texts.push(clean(r.reviewBody || r.description).slice(0, 500))
  }
  // 화면 요소에서 찾은 글은 키·몸무게·사이즈·핏 단서가 하나라도 있어야 리뷰로 셉니다
  // ("리뷰 작성하고 적립금 받기" 같은 안내 문구가 건수를 부풀리지 않게).
  // 카드(반복되는 형제 요소) 단위를 먼저 읽고, 그 안에 든 글은 중복으로 버려요.
  const reviewDropped = { tooShort: 0, tooLong: 0, innerDuplicate: 0, noClue: 0, duplicate: 0 }
  const entries = []
  const hasClue = (p) => p.height || p.weight || p.size || p.fit
  const cardTexts = readReviewCards(root)
  const cardJoined = cardTexts.join('\n')
  for (const t of cardTexts) {
    const parsed = parseReviewText(t, sizeLabels)
    if (hasClue(parsed)) entries.push({ text: t, parsed })
    else reviewDropped.noClue += 1
  }
  for (const t of readReviewElements(root, reviewDropped)) {
    if (cardJoined.includes(t)) {
      reviewDropped.duplicate += 1
      continue
    }
    const parsed = parseReviewText(t.slice(0, 500), sizeLabels)
    if (hasClue(parsed)) entries.push({ text: t.slice(0, 500), parsed })
    else reviewDropped.noClue += 1
  }
  for (const e of entries) texts.push(e)

  const seen = new Set()
  const reviews = []
  for (const item of texts) {
    const text = typeof item === 'string' ? item : item.text
    if (!text || seen.has(text)) {
      if (text) reviewDropped.duplicate += 1
      continue
    }
    seen.add(text)
    reviews.push({ id: reviews.length + 1, nick: '구매자', text, ...(typeof item === 'string' ? parseReviewText(text, sizeLabels) : item.parsed) })
  }
  const reviewTotalOnPage = readReviewTotal(root)
  if (reviews.length === 0) notes.push('이 페이지에서 리뷰를 찾지 못했어요. 리뷰가 아직 불러와지지 않았을 수 있어요.')

  return {
    url: pageUrl,
    source: 'extension',
    name: name.slice(0, 120),
    category,
    emoji: CATEGORY_EMOJI[category],
    sizeChart: sizeChart
      ? {
          unit: sizeChart.unit,
          headers: sizeChart.headers,
          rows: sizeChart.rows,
          measures: sizeChart.measures,
          ...(sizeChart.display ? { display: sizeChart.display } : {}),
        }
      : null,
    optionLabels,
    reviewTotalOnPage,
    reviewMeta: { cards: cardTexts.length, dropped: reviewDropped },
    sizeChartMeta: { ...chartMeta, selectedKind: chartMeta.selectedIndex == null ? null : kinds[chartMeta.selectedIndex] || null },
    reviews,
    notes,
  }
}
