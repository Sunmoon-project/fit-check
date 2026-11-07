// 상품 페이지 해석의 순수 로직 (의존성 없음). 서버(cheerio)와 크롬 확장(DOM)이 함께 씁니다.
// 입력은 이미 "텍스트 행 배열"로 바뀐 표이고, HTML을 읽는 방법은 각 파서가 맡아요.

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

export const CATEGORY_EMOJI = { top: '👕', outer: '🧥', bottom: '👖', dress: '👗', shoes: '👟' }
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

export function toNumber(cell) {
  const m = String(cell).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : null
}

const ALPHA_SIZES = 'XXS|XS|S|M|L|XL|XXL|[2-5]XL|XXXL|FREE|F|프리|ONE ?SIZE'
// '0 (S)', '1(M)', '4 (2XL)' 같은 "번호 (글자)" 표기, 글자 사이즈, 숫자 사이즈(95/100/105 등)를 모두 받아요.
export const SIZE_LABEL_RE = new RegExp(
  `^(?:${ALPHA_SIZES}|\\d{1,2}\\(?(?:${ALPHA_SIZES})\\)|\\d{1,3}(?:\\.\\d)?|[0-9]{2,3}\\(?[A-Z]*\\)?)$`,
  'i',
)
const MEASURE_HEADER_RE = /어깨|가슴|총장|기장|허리|허벅지|엉덩이|소매|발길이|단면|품|밑위|밑단|암홀/
const ALPHA_ONLY_RE = new RegExp(`^(?:${ALPHA_SIZES})$`, 'i')
const PAREN_RE = new RegExp(`^\\d{1,2}\\((?:${ALPHA_SIZES})\\)$`, 'i')

/** 공백을 없애고 대문자로 맞춘 비교용 이름. '1 (M)' → '1(M)' */
export const normLabel = (s) => String(s || '').replace(/\s/g, '').toUpperCase()
const displayText = (s) => String(s || '').replace(/\s+/g, ' ').trim()
// '1(M)' 안의 글자 'M' (없으면 null)
const innerToken = (n) => (n.match(/^\d{1,2}\(([^)]+)\)$/) || [])[1] || null

/** 라벨 모양: paren('1(M)'), alpha('M'), numeric('95'), mixed */
export function labelClassOf(labels) {
  const classes = new Set(labels.map((l) => (PAREN_RE.test(l) ? 'paren' : ALPHA_ONLY_RE.test(l) ? 'alpha' : 'numeric')))
  return classes.size === 1 ? [...classes][0] : classes.size === 0 ? 'none' : 'mixed'
}
const CLASS_RANK = { paren: 3, alpha: 3, mixed: 2, numeric: 1, none: 0 }
const numOf = (l) => Number(String(l).replace(/[^\d.]/g, ''))
const isIncreasing = (labels) => labels.every((l, i) => i === 0 || numOf(l) > numOf(labels[i - 1]))

// 구매 옵션 이름과 표 라벨이 겹치는지: 이름이 같거나, 표 라벨이 옵션 안의 글자('S' vs '0 (S)')와 같으면 겹쳐요.
// 숫자만 있는 표 라벨('0')은 옵션 '0 (S)'의 번호 부분과 비교해요. 옵션이 있을 때만 호출되므로 옵션 없이 숫자를 사이즈로 읽지 않아요.
const outerNumber = (n) => (n.match(/^(\d{1,2})\(/) || [])[1] || null
function optionKeys(opt) {
  const n = normLabel(opt)
  const t = innerToken(n)
  return t ? [n, t] : [n]
}
function matchOption(label, optionList) {
  const n = normLabel(label)
  const t = innerToken(n)
  const numeric = /^\d{1,2}$/.test(n)
  for (const o of optionList) {
    const keys = optionKeys(o)
    if (keys.includes(n) || (t && keys.includes(t))) return o
    if (numeric && outerNumber(normLabel(o)) === n) return o
  }
  return null
}

// 가로세로가 뒤바뀐 표(첫 열이 실측 항목, 첫 행이 사이즈)를 [사이즈, 항목...] 모양으로 뒤집어요.
// 사이즈 이름은 실측 항목 줄 바로 위 줄에서 가져와요. 그런 줄이 없으면 null.
function flipRows(rows, headerIdx) {
  const isMeasureRow = (r) => r.length >= 2 && MEASURE_HEADER_RE.test(r[0].replace(/\s/g, ''))
  const nameRow = headerIdx > 0 ? rows[headerIdx - 1] : null
  const measureRows = rows.slice(headerIdx).filter(isMeasureRow)
  if (!nameRow || measureRows.length === 0) return null
  const width = measureRows[0].length
  const same = measureRows.filter((r) => r.length === width)
  // 맨 앞 칸이 '사이즈' 같은 제목이면 떼고, 칸 수가 항목 줄보다 하나 적으면 그대로 써요.
  const names = nameRow.length === width ? nameRow.slice(1) : nameRow.length === width - 1 ? nameRow : null
  if (!names || names.length < 1 || names.some((c) => !SIZE_LABEL_RE.test(c.replace(/\s/g, '')))) return null
  const body = names.map((name, j) => [name, ...same.map((r) => r[j + 1])])
  return { headers: ['사이즈', ...same.map((r) => r[0])], body }
}

/**
 * 사이즈표 후보 중에서 쓸 표를 고르고, 판단 과정을 meta로 돌려줘요.
 * rowsList: 표마다 [[셀 텍스트,...],...]. optionLabels: 페이지에서 읽은 구매 옵션 이름(없으면 []).
 * @returns {{ chart: object|null, meta: object }}
 */
export function analyzeSizeCharts(rowsList, category, optionLabels = []) {
  const options = (optionLabels || []).map(displayText).filter(Boolean)
  const meta = {
    considered: rowsList.length,
    withHeader: 0,
    flipped: 0,
    rejectedMeasureHeader: 0,
    rejectedNumeric: 0,
    rejectedNoOverlap: 0,
    selectedIndex: null,
    rowCount: 0,
    labelCount: 0,
    labelClass: 'none',
    monotonic: null,
    overlap: 0,
    optionCount: options.length,
  }
  let best = null
  rowsList.forEach((rows, index) => {
    if (rows.length < 2) return
    const headerIdx = rows.findIndex((r) => r.some((c) => /어깨|가슴|허리|총장|기장|허벅지|엉덩이|소매|발길이|단면/.test(c)))
    if (headerIdx < 0) return
    meta.withHeader++
    let headers = rows[headerIdx]
    let body
    // 첫 열 제목이 '총장' 같은 실측 항목이면 가로세로가 뒤바뀐 후보예요. 그 열의 숫자(67 등)는 사이즈 이름이 아니라서,
    // 실측 줄 위쪽의 사이즈 이름 줄을 가져와 뒤집어 읽어요. 그 줄이 없으면 쓰지 않습니다.
    const flippedCand = MEASURE_HEADER_RE.test(headers[0].replace(/\s/g, ''))
    if (flippedCand) {
      const f = flipRows(rows, headerIdx)
      if (!f) {
        meta.rejectedMeasureHeader++
        return
      }
      headers = f.headers
      body = f.body
    } else {
      body = rows
        .slice(headerIdx + 1)
        .filter((r) => r.length === headers.length && SIZE_LABEL_RE.test(r[0].replace(/\s/g, '')))
      if (body.length === 0) return
    }
    const labels = body.map((r) => normLabel(r[0]))
    const labelClass = labelClassOf(labels)
    const monotonic = isIncreasing(labels.filter((l) => labelClassOf([l]) === 'numeric'))
    if (labelClass === 'numeric' && (body.length < 2 || !monotonic)) {
      meta.rejectedNumeric++
      return
    }
    // 뒤집어 읽은 표의 숫자 이름은 구매 옵션 번호와 이어질 때만 믿어요(옵션이 없으면 실측 값일 수 있음).
    if (flippedCand && labelClass === 'numeric' && options.length === 0) {
      meta.rejectedMeasureHeader++
      return
    }
    const overlap = options.length ? labels.filter((l) => matchOption(l, options)).length : 0
    if (options.length && overlap === 0) {
      meta.rejectedNoOverlap++
      return
    }
    if (flippedCand) meta.flipped++
    const cand = { index, headers, body, labels, labelClass, monotonic, overlap, rank: CLASS_RANK[labelClass] }
    const better =
      !best ||
      cand.overlap > best.overlap ||
      (cand.overlap === best.overlap &&
        (cand.rank > best.rank || (cand.rank === best.rank && cand.body.length > best.body.length)))
    if (better) best = cand
  })
  if (!best) return { chart: null, meta }

  const cat = category || guessCategory('', best.headers)
  const mapping = best.headers.map((h, i) => (i === 0 ? null : mapHeader(h, cat)))
  const measures = {}
  const display = {}
  const rows = best.body.map((r) => {
    const matched = options.length ? matchOption(normLabel(r[0]), options) : null
    // 숫자만 있는 라벨('0')은 옵션 이름('0(S)')을 줄 이름으로 써서 리뷰의 'S' 같은 글자와도 이어지게 해요.
    const label = matched && /^\d{1,2}$/.test(normLabel(r[0])) ? normLabel(matched) : normLabel(r[0])
    const shown = matched || displayText(r[0])
    if (shown !== label) display[label] = shown
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
  Object.assign(meta, {
    selectedIndex: best.index,
    rowCount: best.body.length,
    labelCount: best.labels.length,
    labelClass: best.labelClass,
    monotonic: best.monotonic,
    overlap: best.overlap,
  })
  const chart = {
    unit: cat === 'shoes' ? 'mm' : 'cm',
    headers: ['사이즈', ...best.headers.slice(1)],
    rows,
    measures,
    category: cat,
  }
  if (Object.keys(display).length) chart.display = display
  return { chart, meta }
}

/** rowsList: 표마다 [[셀 텍스트,...],...] 배열. 가장 알맞은 사이즈표를 골라 핏 엔진용 구조로 바꿉니다. */
export function buildSizeChart(rowsList, category, optionLabels = []) {
  return analyzeSizeCharts(rowsList, category, optionLabels).chart
}

// ---------- 리뷰 문장에서 체형·사이즈·핏 읽기 ----------
const FIT_WORDS = {
  small: /작아|작게 나|작은 ?편|작음|작네|타이트|끼어|껴요|끼는|낍니다|짧아|짧게|한 ?치수 ?(?:크게|올려|업)|사이즈 ?업/g,
  large: /커요|크게 나|큰 ?편|커서|크네|넉넉|헐렁|루즈|길어요|한 ?치수 ?(?:작게|내려|다운)|사이즈 ?다운/g,
  true: /정사이즈|딱 ?맞|잘 ?맞|적당|정핏|무난하게 맞/g,
}

export function parseReviewText(text, sizeLabels = []) {
  const t = text || ''
  const H = '(1[4-9]\\d|20\\d|210)(?:\\.\\d)?'
  const pairM = t.match(new RegExp(`(?<![\\d.,/:-])${H}\\s*[/·]\\s*(\\d{2,3})(?:\\.\\d)?(?![\\d.,%:/-]|\\s*(?:원|%|[-/]\\s*\\d))`))
  // '175/100 사이즈', '사이즈 175/100' 같은 의류 사이즈 표기는 키·몸무게가 아님
  const pairEnd = pairM ? pairM.index + pairM[0].length : 0
  const sizeName =
    pairM &&
    (/^\s*(?:사이즈|size|호|구매|샀|주문|선택|입었|추천)/i.test(t.slice(pairEnd)) || /(?:사이즈|size|옵션|option)\s*[:：]?\s*$/i.test(t.slice(0, pairM.index)))
  const pair = pairM && !sizeName && Number(pairM[2]) >= 35 && Number(pairM[2]) <= 150 ? pairM : null
  const height =
    toNumber((t.match(/키\s*[:：]?\s*(1[4-9]\d(?:\.\d)?|20\d(?:\.\d)?|210)(?![\d.]*\d)/) || [])[1] ?? '') ??
    toNumber((t.match(/(?<![\d.,])(1[4-9]\d(?:\.\d)?|20\d(?:\.\d)?)\s*(?:cm|센치|㎝|씨엠)/i) || [])[1] ?? '') ??
    toNumber(pair ? t.slice(pair.index).match(/\d+(?:\.\d)?/)[0] : '')
  const weight =
    toNumber((t.match(/몸무게\s*[:：]?\s*(\d{2,3})/) || [])[1] ?? '') ??
    toNumber((t.match(/(?<![\d.,])(\d{2,3}(?:\.\d)?)\s*(?:kg|키로|킬로|㎏)/i) || [])[1] ?? '') ??
    toNumber(pair ? pair[2] : '')

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

