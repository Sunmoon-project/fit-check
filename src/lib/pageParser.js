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
const TAIL_MM_RE = /(?:^|[\s\/·,|-])(2[0-9]\d|3[01]\d)(?:\s*(?:mm|㎜))?\s*$/i
const TAIL_OPTION_RE = /(?:^|[\s\/·,|-])(\d{1,2})\s*\(\s*(XXS|XS|S|M|L|XL|XXL|[2-5]XL|FREE|F)\s*\)\s*$/i

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
  // select/option, 버튼 목록, JSON-LD Product offers(name/sku)에서는 '블랙 / 0 (S)'처럼 색상 뒤에 붙은 끝부분도 읽어요.
  const add = (text) => {
    const t = clean(text)
    if (t.length > 80) return
    const mm = t.match(TAIL_MM_RE)
    if (mm) {
      // 신발: '화이트 / 250' 처럼 mm 숫자로 끝나는 옵션
      if (!out.includes(mm[1]) && out.length < MAX_OPTIONS) out.push(mm[1])
      return
    }
    const m = t.match(TAIL_OPTION_RE)
    if (!m) return
    const label = `${m[1]} (${m[2].toUpperCase()})`
    if (!out.includes(label) && out.length < MAX_OPTIONS) out.push(label)
  }
  for (const e of all(root, 'option,button,[role="option"],li,[hidden],[aria-hidden="true"]')) if (childrenOf(e).length <= 4) add(e.textContent)
  for (const n of collectJsonLd(root)) {
    const offers = [].concat(n.offers || [], n.offers?.offers || [])
    for (const o of offers) if (o && typeof o === 'object') for (const k of ['name', 'sku']) if (typeof o[k] === 'string') add(o[k])
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

// ---------- 사이즈표 영역: 리뷰 후보에서 통째로 제외 ----------
// 첫 칸이 사이즈 이름인 줄(또는 열)이 2개 이상인 후보만 사이즈표 영역으로 봐요.
// (실측 낱말이 든 리뷰 목록이 통째로 제외되지 않게 하려는 조건입니다.)
const looksLikeChart = (rows) => rows.filter((r) => r.length >= 2 && isLabel(r[0])).length >= 2

/** 사이즈표로 보이는 영역의 요소 목록 (표, role=table, div 격자) */
export function sizeChartRegions(root, grids = findGridCandidates(root)) {
  const regions = []
  for (const t of all(root, 'table')) if (looksLikeChart(readTables(t)[0] || [])) regions.push(t)
  for (const g of grids) if (looksLikeChart(g.rows) || looksLikeChart(transpose(g.rows) || [])) regions.push(g.el)
  return regions
}

const insideAny = (el, regions) => regions.some((r) => r === el || r.contains?.(el))

// 카드 글에서 숫자·단위·사이즈 글자·기호를 빼고도 이만큼 글자가 남아야 서술형 글로 봐요.
const CARD_MIN_PROSE = 6
const SIZE_TOKEN_G = /(?<![A-Za-z0-9])(?:XXS|XS|S|M|L|XL|XXL|[2-5]XL|FREE|F)(?![A-Za-z0-9])/gi
function hasProse(text) {
  const rest = String(text).replace(/\d+(?:\.\d+)?\s*(?:cm|mm|kg|㎝|㎏)?/gi, ' ').replace(SIZE_TOKEN_G, ' ').replace(/[^A-Za-z가-힣]/g, '')
  return rest.length >= CARD_MIN_PROSE
}

/** 안쪽에 같은 조건의 요소가 있으면 안쪽을 쓰도록 건너뜁니다. dropped에 버린 사유별 개수를 더해요. */
export function readReviewElements(root, dropped = {}, regions = sizeChartRegions(root)) {
  const bump = (k) => (dropped[k] = (dropped[k] || 0) + 1)
  const els = [...new Set(all(root, REVIEW_SELECTOR))]
  const texts = []
  for (const el of els) {
    if (insideAny(el, regions)) {
      bump('inSizeChart')
      continue
    }
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

export function readReviewCardEls(root, regions = sizeChartRegions(root)) {
  const seeds = new Set(all(root, REVIEW_SELECTOR))
  let scanned = 0
  for (const e of all(root, '*')) {
    if (++scanned > CARD_SEED_LIMIT) break
    if (childrenOf(e).length > 1) continue
    const t = clean(e.textContent)
    if (t.length <= 80 && CLUE_LEAF_RE.test(t) && !inTable(e) && !insideAny(e, regions)) seeds.add(e)
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
    if (best && !insideAny(best, regions)) cards.add(best)
  }
  // 카드 안에 다른 카드가 들어 있으면 바깥 것은 뺍니다
  const list = [...cards]
  // 값만 반복되는 div 격자(사이즈표)를 걸러요: 카드 글에 리뷰 단서(구매 옵션·날짜·후기 말투) 하나는 있어야 해요.
  return list.filter((c) => !list.some((o) => o !== c && c.contains?.(o))).filter((c) => REVIEW_CUE_RE.test(clean(c.textContent)) && hasProse(clean(c.textContent)))
}

export function readReviewCards(root, regions) {
  return readReviewCardEls(root, regions).map((c) => clean(c.textContent))
}

// ---------- 리뷰 카드 한 장에서 필요한 항목만 읽기 ----------
// 닉네임·상품명·구매 사이즈·체형 정보·리뷰 본문·사진만 골라요. 날짜·별점·'더보기'·'도움돼요'·'댓글' 같은 화면 글자는 버립니다.
// 클래스 이름은 보지 않고 '상품명', '구매옵션', '체형정보' 라벨 글자와 요소 순서만 써요.
// 실제 쇼핑몰 화면은 확인하지 못했고, 지어낸 HTML 구조로만 시험했어요.
// 여기서 읽은 값은 화면에 그릴 때만 메모리에 두며 저장하거나 어디로도 보내지 않아요.
const UI_ONLY_RE = /^(?:더보기|접기|도움\s*돼요(?:\s*\d+)?|댓글(?:\s*\d+)?|신고|공유|좋아요(?:\s*\d+)?|\d+명에게 도움이 됐어요)$/
const DATE_RE = /^\d{2,4}[.\-/]\d{1,2}[.\-/]\d{1,2}\.?$/
const RATING_RE = /^[1-5](?:\.\d)?$/
const LABEL_KIND = { 상품명: 'product', 구매옵션: 'option', 체형정보: 'body' }
const OPTION_SIZE_RE = /^(?:\d{1,2}\s*\(\s*(?:XXS|XS|S|M|L|XL|XXL|[2-5]XL|FREE|F)\s*\)|XXS|XS|S|M|L|XL|XXL|[2-5]XL|FREE|F|\d{1,3})$/i
const AVATAR_ALT_RE = /프로필|profile|avatar|아이콘|icon|logo|badge/i
const MAX_PHOTOS = 5
const MAX_SENTENCES = 40
const HARD_SKIP_TAG = /^(?:BUTTON|SELECT|SCRIPT|STYLE)$/
const SOFT_SKIP_TAG = /^A$/
const INLINE_TAG = /^(?:B|I|U|EM|STRONG|SPAN|MARK|SMALL|SUB|SUP|S|DEL|FONT|A|IMG|BR|WBR)$/
// 닉네임 앞에 붙는 배지·등급 글자는 닉네임으로 보지 않아요.
const BADGE_RE = /^(?:베스트|BEST|포토|사진|동영상|신규|NEW|구매\s*확정|한\s*달\s*사용|스토어|(?:LV|Lv|lv)\.?\s*\d+|등급\s*\S*|.{0,6}리뷰어?|.{0,6}등급)$/i
const PLACEHOLDER_RE = /(?:blank|spacer|placeholder|transparent|pixel|loading|dummy|1x1|noimage|no_image)[^/]*\.(?:gif|png|jpe?g|svg|webp)(?:[?#]|$)|\.gif(?:[?#]|$)/i
const LAZY_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'src']

const cleanLines = (s) =>
  String(s || '')
    .split('\n')
    .map(clean)
    .filter(Boolean)
    .join('\n')

// 줄바꿈: <br>만 든 요소는 childNodes가 있으면 <br>을 줄바꿈으로 바꿔요.
// (테스트용 가짜 DOM의 textContent는 <br>을 버려서, childNodes를 쓸 수 있을 때만 줄바꿈이 살아요.)
function blockText(e) {
  const kids = childrenOf(e)
  if (kids.length && e.childNodes) {
    return cleanLines(
      Array.from(e.childNodes)
        .map((n) => (n.nodeType === 3 ? n.nodeValue : String(n.tagName).toUpperCase() === 'BR' ? '\n' : n.nodeType === 1 ? n.textContent : ''))
        .join(''),
    )
  }
  return clean(e.textContent)
}

// 끝에 붙은 '...더보기', '…', ' ...' 같은 잘림 표시를 걷어냅니다.
function stripTail(s) {
  let t = String(s)
  for (let i = 0; i < 4; i++) {
    const before = t
    t = t.replace(/\s*(?:\.{3}|…)?\s*(?:더보기|접기)\s*$/, '').replace(/\s+(?:\.{3}|…)\s*$/, '').replace(/…\s*$/, '')
    if (t === before) break
  }
  return t.trim()
}
const looseKey = (s) => stripTail(s).replace(/[.…\s]+$/, '')

// 같은 글이 두 번 이어 붙은 경우(전체 + 잘린 미리보기)에는 앞의 한 번만 남겨요.
function collapseRepeat(s) {
  const t = stripTail(s)
  const head = t.slice(0, 12)
  if (head.length < 12) return t
  const j = t.indexOf(head, 12)
  if (j <= 0) return t
  const first = t.slice(0, j).trim()
  const rest = looseKey(t.slice(j))
  return rest && looseKey(first).startsWith(rest) ? first : t
}

function sizePartOf(option) {
  for (const seg of String(option || '').split(/[·/,]/)) {
    const s = clean(seg)
    if (OPTION_SIZE_RE.test(s)) return s
  }
  return ''
}

function photoUrl(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  try {
    const u = new URL(s.startsWith('//') ? `https:${s}` : s)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

/**
 * 리뷰 카드 요소에서 화면에 보여줄 항목만 읽습니다.
 * @returns {{ nick, productName, option, sizePart, bodyInfo, body, photos, structured, deduped }}
 */
export function extractCardView(card) {
  const order = all(card, '*')
  const idx = new Map(order.map((e, i) => [e, i]))
  const within = (e, tagRe, roleRe) => {
    // 카드 요소 자신이 <a>로 감싸인 경우에도 안쪽 글을 읽도록 카드는 검사하지 않아요.
    for (let cur = e; cur && cur !== card; cur = cur.parentElement) {
      if (tagRe.test(String(cur.tagName).toUpperCase())) return true
      if (roleRe.test(cur.getAttribute?.('role') || '')) return true
    }
    return false
  }
  const blocks = []
  const covered = new Set() // 글과 인라인 태그가 섞인 블록 안쪽 요소는 따로 블록으로 세지 않아요
  // 직접 글 노드가 있고 안쪽이 전부 인라인 태그인 요소(<p>가볍고 <b>정말</b> 따뜻해요</p>)는 한 블록
  const mixedInline = (e) =>
    !!e.childNodes &&
    Array.from(e.childNodes).some((n) => n.nodeType === 3 && clean(n.nodeValue)) &&
    all(e, '*').every((d) => INLINE_TAG.test(String(d.tagName).toUpperCase()))
  for (const e of order) {
    const tag = String(e.tagName).toUpperCase()
    if (covered.has(e.parentElement)) {
      covered.add(e)
      continue
    }
    const mixed = tag !== 'IMG' && tag !== 'BR' && childrenOf(e).length > 0 && mixedInline(e)
    if (mixed) covered.add(e)
    if (tag === 'IMG' || tag === 'BR' || (!mixed && !childrenOf(e).every((k) => String(k.tagName).toUpperCase() === 'BR'))) continue
    const text = blockText(e)
    if (!text) continue
    if (within(e, HARD_SKIP_TAG, /^button$/i)) continue
    blocks.push({ el: e, text, at: blocks.length, soft: within(e, SOFT_SKIP_TAG, /^link$/i), kind: LABEL_KIND[text.replace(/\s/g, '')] || null })
  }
  const uiOnly = (t) => UI_ONLY_RE.test(t) || DATE_RE.test(t) || RATING_RE.test(t)
  const plain = (b) => !b.soft && !b.kind && !uiOnly(b.text)

  const found = {}
  const used = new Set()
  blocks.forEach((b, i) => {
    if (!b.kind || found[b.kind] != null) return
    const parent = b.el.parentElement
    const next = blocks[i + 1]
    let value = ''
    if (next && !next.kind && parent?.contains?.(next.el)) {
      value = next.text
      used.add(next)
    } else {
      const ptext = parent ? clean(parent.textContent) : ''
      const rest = ptext.startsWith(b.text) ? clean(ptext.slice(b.text.length)) : ''
      if (rest) value = rest
      else if (next && !next.kind) {
        value = next.text
        used.add(next)
      }
    }
    found[b.kind] = { index: i, value, el: b.el }
  })

  const firstLabel = Math.min(...Object.values(found).map((f) => f.index), Infinity)
  const structured = Object.keys(found).length > 0
  let nickBlock = null
  if (structured) {
    nickBlock = blocks.slice(0, firstLabel).find((b) => plain(b) && b.text.length <= 20 && !/^\d+$/.test(b.text) && !BADGE_RE.test(b.text) && !used.has(b)) || null
  }

  let body = ''
  let deduped = false
  const pool = blocks.filter((b) => plain(b) && !used.has(b) && b !== nickBlock && b.kind == null)
  if (structured) {
    // 라벨 뒤의 글 덩어리를 모두 이어 붙이되, 접힌 미리보기·펼친 전체처럼 같은 글이 겹친 것은 긴 쪽 하나만 남겨요.
    let prose = pool.filter((b) => hasProse(b.text))
    const afterLabel = prose.filter((b) => b.at > firstLabel)
    if (afterLabel.length) prose = afterLabel
    const items = prose.map((b, i) => ({ b, i, text: collapseRepeat(b.text), key: looseKey(collapseRepeat(b.text)), cut: /(?:\.{3}|…|더보기)\s*$/.test(b.text) }))
    const kept = items.filter((x) =>
      !items.some((y) => y !== x && y.key.includes(x.key) && (y.key.length > x.key.length || (x.cut && !y.cut) || (x.cut === y.cut && y.i < x.i))),
    )
    deduped = kept.length < items.length || items.some((x) => x.text !== stripTail(x.b.text))
    body = kept.map((x) => stripTail(x.text)).join('\n')
  } else {
    body = stripTail(cleanLines(pool.map((b) => b.text).join('\n')))
  }

  const photos = []
  for (const img of all(card, 'img')) {
    // 지연 로딩 사진은 src가 빈 그림이라, data-src 같은 진짜 주소를 먼저 보고 빈 그림 주소는 버려요.
    let url = null
    for (const a of LAZY_ATTRS) {
      const u = photoUrl(img.getAttribute(a))
      if (u && !PLACEHOLDER_RE.test(u)) {
        url = u
        break
      }
    }
    if (!url || photos.includes(url)) continue
    const w = parseInt(img.getAttribute('width') || '', 10)
    const h = parseInt(img.getAttribute('height') || '', 10)
    if ((Number.isFinite(w) && w <= 48) || (Number.isFinite(h) && h <= 48)) continue
    if (AVATAR_ALT_RE.test(img.getAttribute('alt') || '')) continue
    const at = idx.get(img)
    if (nickBlock && (at < idx.get(nickBlock.el) || img.parentElement === nickBlock.el.parentElement)) continue
    if (found.product && at < idx.get(found.product.el)) continue
    photos.push(url)
    if (photos.length >= MAX_PHOTOS) break
  }

  const option = found.option?.value || ''
  return {
    nick: nickBlock?.text || '',
    productName: found.product?.value || '',
    option,
    sizePart: sizePartOf(option),
    bodyInfo: found.body?.value || '',
    body,
    photos,
    structured,
    deduped,
  }
}

/**
 * 리뷰 본문을 문장 단위로 나눕니다. 줄바꿈과 문장 끝 기호(. ! ? 。 …, 연속 포함) 뒤 공백에서 자르고,
 * 2.5 나 ver.2 처럼 기호 바로 뒤에 글자가 붙은 곳은 자르지 않아요. 끝 기호는 앞 문장에 남깁니다.
 */
export function splitSentences(body, limit = MAX_SENTENCES) {
  const out = []
  for (const line of String(body || '').split(/\n+/)) {
    const t = clean(line)
    if (!t) continue
    for (const m of t.match(/[^]*?(?:[.!?。…]+(?=\s|$)|$)/g) || []) {
      const s = m.trim()
      if (s) out.push(s)
    }
  }
  return out.slice(0, limit)
}

export const SENTENCE_LIMIT = MAX_SENTENCES

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

// 리뷰의 체형 정보 줄('남성 · 170cm · 70kg')에서 성별을 읽어요. 설계상 추정이고 실제 사이트로 확인한 것이 아니에요.
// strict=false: 체형 정보 칸 전용이라 줄 안의 성별 단어를 읽어요.
// strict=true: 카드 전체 글에서는 성별 단어 바로 옆에 키/몸무게 숫자가 붙은 경우만 읽어서 본문 속 단어를 오인하지 않아요.
const GENDER_WORD = '(남성|여성|남자|여자|남|여)'
const GENDER_BOUND_L = '(?<![가-힣A-Za-z])'
const GENDER_BOUND_R = '(?![가-힣A-Za-z])'
const GENDER_LOOSE_RE = new RegExp(`${GENDER_BOUND_L}${GENDER_WORD}${GENDER_BOUND_R}`)
const GENDER_STRICT_RE = new RegExp(
  `${GENDER_BOUND_L}${GENDER_WORD}\\s*[·/,|•ㆍ]?\\s*(?:\\d{3}(?:\\.\\d)?\\s*(?:cm|㎝)|\\d{2,3}\\s*(?:kg|㎏))|(?:\\d\\s*(?:cm|㎝|kg|㎏))\\s*[·/,|•ㆍ]?\\s*${GENDER_WORD}${GENDER_BOUND_R}`,
  'i',
)
export function parseGender(text, strict = false) {
  const t = String(text || '')
  const m = t.match(strict ? GENDER_STRICT_RE : GENDER_LOOSE_RE)
  if (!m) return null
  const w = m[1] || m[2]
  return w.startsWith('남') ? 'male' : 'female'
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
  // 사이즈표를 못 읽었어도 구매 옵션 이름이 있으면 그 글자로 교차 확인해요.
  const sizeLabels = sizeChart
    ? sizeChart.rows.flatMap((r) => [r[0], (r[0].match(/^\d{1,2}\(([^)]+)\)$/) || [])[1]].filter(Boolean))
    : optionLabels.map((l) => (l.match(/\(([^)]+)\)/) || [])[1]).filter(Boolean)

  const texts = []
  for (const n of [ldProduct, ...ld.filter((x) => isType(x, 'Review'))]) {
    if (!n) continue
    const list = isType(n, 'Review') ? [n] : Array.isArray(n.review) ? n.review : n.review ? [n.review] : []
    for (const r of list) texts.push(clean(r.reviewBody || r.description).slice(0, 500))
  }
  // 화면 요소에서 찾은 글은 키·몸무게·사이즈·핏 단서가 하나라도 있어야 리뷰로 셉니다
  // ("리뷰 작성하고 적립금 받기" 같은 안내 문구가 건수를 부풀리지 않게).
  // 카드(반복되는 형제 요소) 단위를 먼저 읽고, 그 안에 든 글은 중복으로 버려요.
  const reviewDropped = { tooShort: 0, tooLong: 0, innerDuplicate: 0, noClue: 0, duplicate: 0, inSizeChart: 0 }
  const entries = []
  const hasClue = (p) => p.height || p.weight || p.size || p.fit
  const regions = sizeChartRegions(root, grids)
  const cardEls = readReviewCardEls(root, regions)
  const cardTexts = cardEls.map((c) => clean(c.textContent))
  const cardJoined = cardTexts.join('\n')
  const bodyExtract = { structured: 0, fallback: 0, deduped: 0, withNick: 0, withPhoto: 0, withProductName: 0 }
  cardEls.forEach((cardEl, i) => {
    const t = cardTexts[i]
    const v = extractCardView(cardEl)
    // 구조를 찾았으면 상품명이 아닌 실제 본문·옵션·체형 정보로만 해석해요.
    const synthesized = v.structured ? [v.sizePart ? `구매 옵션 ${v.sizePart}.` : '', v.bodyInfo, v.body].filter(Boolean).join(' ') : t
    const parsed = parseReviewText(synthesized, sizeLabels)
    parsed.gender = v.structured && v.bodyInfo ? parseGender(v.bodyInfo) : parseGender(t, true)
    if (!hasClue(parsed)) {
      reviewDropped.noClue += 1
      return
    }
    // 화면에 그릴 때만 메모리에 두는 값이에요. 저장하거나 보내지 않습니다.
    entries.push({ text: t, parsed, view: { nick: v.nick, productName: v.productName, body: v.body, photos: v.photos }, stat: v })
  })
  for (const t of readReviewElements(root, reviewDropped, regions)) {
    if (cardJoined.includes(t)) {
      reviewDropped.duplicate += 1
      continue
    }
    const parsed = parseReviewText(t.slice(0, 500), sizeLabels)
    parsed.gender = parseGender(t, true)
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
    const isItem = typeof item !== 'string'
    if (isItem && item.stat) {
      const s = item.stat
      if (s.structured) bodyExtract.structured += 1
      else bodyExtract.fallback += 1
      if (s.deduped) bodyExtract.deduped += 1
      if (s.nick) bodyExtract.withNick += 1
      if (s.photos.length) bodyExtract.withPhoto += 1
      if (s.productName) bodyExtract.withProductName += 1
    }
    reviews.push({
      id: reviews.length + 1,
      nick: '구매자',
      text,
      ...(isItem ? item.parsed : parseReviewText(text, sizeLabels)),
      ...(isItem && item.view ? { view: item.view } : {}),
    })
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
          ...(sizeChart.view ? { view: { ...sizeChart.view, manual: chartMeta.selectedIndex != null && kinds[chartMeta.selectedIndex] === 'manual' } } : {}),
        }
      : null,
    optionLabels,
    reviewTotalOnPage,
    reviewMeta: { cards: cardTexts.length, dropped: reviewDropped, bodyExtract },
    sizeChartMeta: {
      ...chartMeta,
      selectedKind: chartMeta.selectedIndex == null ? null : kinds[chartMeta.selectedIndex] || null,
      candidates: (chartMeta.candidates || []).map((c) => ({ ...c, kind: kinds[c.index] || null })),
    },
    reviews,
    notes,
  }
}
