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
  if (/발\s*길이|발\s*볼|사이즈\s*\(\s*mm\s*\)/i.test(h)) return 'shoes'
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
  if (/발길이|발사이즈|footlength|footsize/i.test(h)) return { key: 'footLength' }
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
  `^(?:${ALPHA_SIZES}|\\d{1,2}\\(?(?:${ALPHA_SIZES})\\)|(?:${ALPHA_SIZES})\\(\\d{1,3}\\)|\\d{1,3}(?:\\.\\d)?|[0-9]{2,3}\\(?[A-Z]*\\)?)$`,
  'i',
)
// 영문 헤더(Length, Chest 등)도 읽어요. 공백은 지우고 비교합니다('발 길이' → '발길이').
const MEASURE_HEADER_RE = /어깨|가슴|총장|기장|허리|허벅지|엉덩이|소매|발길이|단면|품|밑위|밑단|암홀|길이|\b(?:length|chest|shoulder|waist|hip|thigh|sleeve)\b/i
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
// 옵션이 '블랙 / M', '블랙, 2(M)' 처럼 색상과 함께 읽히면 구분자로 나눈 조각도 후보로 써요 (조각 전체가 같을 때만 겹침).
function optionKeys(opt) {
  const n = normLabel(opt)
  const keys = new Set([n])
  const t = innerToken(n)
  if (t) keys.add(t)
  const parts = String(opt).split(/\s*[\/|,·]\s*|\s+-\s+/).map(normLabel).filter(Boolean)
  if (parts.length > 1) for (const p of parts) { keys.add(p); const pt = innerToken(p); if (pt) keys.add(pt) }
  return [...keys]
}
// 'M(95)' 처럼 글자 뒤에 치수 숫자가 붙은 표기의 글자 부분
const headToken = (n) => (n.match(/^([A-Z]{1,4})\(\d{1,3}\)$/) || [])[1] || null
function matchOption(label, optionList) {
  const n = normLabel(label)
  const t = innerToken(n) || headToken(n)
  const numeric = /^\d{1,2}$/.test(n)
  for (const o of optionList) {
    const keys = optionKeys(o)
    if (keys.includes(n) || (t && keys.includes(t))) return o
    if (numeric && keys.some((k) => outerNumber(k) === n)) return o
  }
  return null
}

// 글 한 조각을 모양 기호로: 사이즈 글자 L, 숫자 N, 그 외 T, 빈 칸은 _ (진단 리포트용, 글자 내용은 남기지 않아요)
export function shapeOfCell(t) {
  const s = displayText(t)
  if (!s) return '_'
  if (SIZE_LABEL_RE.test(s.replace(/\s/g, '')) && /\D/.test(s)) return 'L'
  if (/^[\d.,\s]+(cm|mm)?$/i.test(s)) return 'N'
  return 'T'
}
const shapeLine = (cells, max = 8) => cells.slice(0, max).map(shapeOfCell).join(' ')

const isLabelCell = (c) => SIZE_LABEL_RE.test(String(c).replace(/\s/g, ''))
const isMeasureRow = (r) => r.length >= 2 && MEASURE_HEADER_RE.test(r[0].replace(/\s/g, ''))
const MEASURE_WORD_RE = /어깨|가슴|허리|총장|기장|허벅지|엉덩이|소매|발길이|단면|길이|\b(?:length|chest|shoulder|waist|hip|thigh|sleeve)\b/i
const hasMeasureWord = (c) => MEASURE_WORD_RE.test(String(c).replace(/\s/g, ''))

// 사이즈 이름 줄 후보: 맨 앞 칸이 사이즈 이름이 아니면('사이즈', 'cm', 빈칸) 제목 칸이라 떼고 나머지가 모두 사이즈 이름이어야 해요.
function namesFromRow(row) {
  if (row.some(hasMeasureWord)) return null
  const n = row.length >= 2 && !isLabelCell(row[0]) ? row.slice(1) : row
  return n.length >= 1 && n.every(isLabelCell) ? n : null
}

// 가로세로가 뒤바뀐 표(첫 열이 실측 항목, 첫 행이 사이즈)를 [사이즈, 항목...] 모양으로 뒤집어요.
// 사이즈 이름은 (1) 같은 표의 실측 줄 위쪽 줄, (2) 다른 후보 표의 이름 줄, (3) 구매 옵션 이름(개수가 딱 맞을 때) 순서로 찾고,
// 어디서 가져왔는지 source에 남겨요. 모두 없으면 null. 실측 줄 끝에 단위 칸('cm') 등이 더 붙어 있어도 앞쪽 칸만 써요.
function flipRows(rows, headerIdx, ctx) {
  const measureRows = rows.slice(headerIdx).filter(isMeasureRow)
  if (measureRows.length === 0) return null
  const counts = {}
  for (const r of measureRows) counts[r.length] = (counts[r.length] || 0) + 1
  const width = Number(Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0])
  let names = null
  let source = null
  for (let i = headerIdx - 1; i >= 0 && !names; i--) {
    const n = namesFromRow(rows[i])
    if (n && n.length + 1 <= width) {
      names = n
      source = 'table'
    }
  }
  if (!names) {
    const found = []
    for (const row of ctx.otherRows) {
      const n = namesFromRow(row)
      if (!n || n.length < 2 || n.length + 1 !== width) continue
      const cls = labelClassOf(n.map(normLabel))
      const ov = ctx.options.length ? n.filter((l) => matchOption(normLabel(l), ctx.options)).length : 0
      if (cls === 'numeric' && ov === 0) continue // 숫자뿐인 줄은 구매 옵션과 이어질 때만 믿어요
      found.push({ n, ov })
    }
    found.sort((a, b) => b.ov - a.ov)
    if (found.length) {
      names = found[0].n
      source = 'other-table'
    }
  }
  if (!names && ctx.options.length >= 2 && ctx.options.length === width - 1) {
    names = ctx.options
    source = 'options'
  }
  if (!names) return null
  const same = measureRows.filter((r) => r.length >= names.length + 1)
  if (same.length === 0) return null
  const body = names.map((name, j) => [name, ...same.map((r) => r[j + 1])])
  return { headers: ['사이즈', ...same.map((r) => r[0])], body, source }
}

const REASON_KEYS = ['too-few-rows', 'no-measure-header', 'no-labeled-rows', 'flipped-no-names', 'numeric-rule', 'flipped-numeric-no-options', 'no-overlap', 'not-best', 'selected']

// ---------- 신발: 사이즈 이름 자체가 발길이(mm)인 표 ----------
// '사이즈(mm) 230 240 250' 또는 'KR 230 240', 'US 5 6 7' 아래 mm 줄처럼 실측 제목이 없어도, 신발은 220~310 사이로 커지는 숫자가 곧 발길이예요.
const MM_CELL_RE = /^(2[0-9]\d|3[01]\d)(?:\.\d)?\s*(?:mm|㎜)?$/i
const mmOf = (c) => {
  const m = String(c).trim().match(MM_CELL_RE)
  return m ? Number(m[0].replace(/[^\d.]/g, '')) : null
}
function mmSequence(cells) {
  const nums = cells.map(mmOf).filter((n) => n != null)
  if (nums.length < 3 || nums.length < cells.length / 2) return null
  return nums.every((n, i) => i === 0 || n > nums[i - 1]) ? nums : null
}
function shoeEvidence(rowsList, options, category) {
  if (category === 'shoes') return true
  // 옵션만으로는: 220~319의 5mm 단위 숫자가 3개 이상일 때만 (의류 옵션과 헷갈리지 않게)
  const opt = [...new Set(mmOptionLabels(options).map(Number))]
  if (opt.length >= 3 && opt.every((n) => n % 5 === 0)) return true
  // 'KR 230 240 250' 처럼 맨 앞 칸이 단위·국가 표기이고 뒤가 mm 숫자 줄인 표
  if (rowsList.some((rows) => rows.some((r) => r.length >= 4 && /^(?:kr|mm|한국|국내|cm)$/i.test(String(r[0]).trim()) && mmSequence(r.slice(1)) != null))) return true
  return rowsList.some((rows) => rows.some((r) => r.some((c) => /^(?:사이즈|size|kr|mm)?\s*\(?\s*mm\s*\)?$/i.test(String(c).trim()) && /mm/i.test(c))))
}
const mmOptionLabels = (options) => options.map((o) => (String(o).match(/(?<![\d.])(2[0-9]\d|3[01]\d)(?:\.\d)?\s*(?:mm|㎜)?(?![\d.])/) || [])[1]).filter(Boolean)
function shoeMmChart(rowsList, options, category) {
  if (!shoeEvidence(rowsList, options, category)) return null
  let best = null
  rowsList.forEach((rows, index) => {
    const seqs = []
    for (const r of rows) seqs.push(mmSequence(r.length >= 2 && mmOf(r[0]) == null ? r.slice(1) : r))
    const width = Math.max(0, ...rows.map((r) => r.length))
    for (let c = 0; c < width; c++) seqs.push(mmSequence(rows.map((r) => r[c] ?? '').filter((x, i) => i > 0 || mmOf(x) != null || true).slice(rows.length > 1 && mmOf(rows[0][c] ?? '') == null ? 1 : 0)))
    for (const nums of seqs) if (nums && (!best || nums.length > best.nums.length)) best = { nums, index }
  })
  let nums = best?.nums
  let from = 'shoe-mm'
  if (nums && options.length) {
    const optNums = mmOptionLabels(options).map(Number)
    if (optNums.length && !nums.some((n) => optNums.includes(n))) nums = null
  }
  if (!nums) {
    const o = [...new Set(mmOptionLabels(options).map(Number))].sort((a, b) => a - b)
    if (o.length < (category === 'shoes' ? 2 : 3)) return null
    nums = o
    from = 'shoe-options'
  }
  const rows = nums.map((n) => [String(n), String(n)])
  const measures = Object.fromEntries(nums.map((n) => [String(n), { footLength: n }]))
  return {
    index: best?.index ?? null,
    source: from,
    nums,
    chart: {
      unit: 'mm',
      headers: ['사이즈', '발길이'],
      rows,
      measures,
      category: 'shoes',
      view: {
        flipped: false,
        namesFrom: from,
        headers: ['발길이'],
        used: [true],
        rows: nums.slice(0, 20).map((n) => ({ label: String(n), shown: String(n), cells: [{ raw: `${n}mm`, value: n, converted: false }] })),
      },
    },
  }
}

/**
 * 사이즈표 후보 중에서 쓸 표를 고르고, 판단 과정을 meta로 돌려줘요.
 * rowsList: 표마다 [[셀 텍스트,...],...]. optionLabels: 페이지에서 읽은 구매 옵션 이름(없으면 []).
 * meta.candidates: 후보별 머리글 모양(L/N/T 기호)과 선택/버린 사유. 페이지 글은 담지 않아요.
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
    namesFrom: null,
    candidates: [],
  }
  const cands = rowsList.map((rows, index) => ({
    index,
    rows: rows.length,
    cols: Math.max(0, ...rows.map((r) => r.length)),
    head: '',
    firstCol: shapeLine(rows.map((r) => r[0] ?? ''), 6),
    reason: 'too-few-rows',
    flipped: false,
  }))
  const why = (index, reason, flipped = false) => {
    cands[index].reason = reason
    cands[index].flipped = flipped
  }
  let best = null
  rowsList.forEach((rows, index) => {
    if (rows.length < 2) return
    const headerIdx = rows.findIndex((r) => r.some(hasMeasureWord))
    cands[index].head = shapeLine(rows[Math.max(0, headerIdx)])
    if (headerIdx < 0) return why(index, 'no-measure-header')
    meta.withHeader++
    let headers = rows[headerIdx]
    let body
    // 첫 열 제목이 '총장' 같은 실측 항목이면 가로세로가 뒤바뀐 후보예요. 단, 아래 줄들이 사이즈 이름으로 시작하고
    // 칸 수가 하나 많으면 맨 앞 제목 칸만 빠진 일반 표라서 그렇게 읽어요.
    let flippedCand = MEASURE_HEADER_RE.test(headers[0].replace(/\s/g, ''))
    if (flippedCand) {
      const below = rows.slice(headerIdx + 1)
      if (!below.some(isMeasureRow) && below.filter((r) => r.length === headers.length + 1 && isLabelCell(r[0])).length >= 2) {
        headers = ['사이즈', ...headers]
        flippedCand = false
      }
    }
    let source = null
    if (flippedCand) {
      const ctx = { options, otherRows: rowsList.flatMap((rs, i) => (i === index ? [] : rs)) }
      const f = flipRows(rows, headerIdx, ctx)
      if (!f) {
        meta.rejectedMeasureHeader++
        return why(index, 'flipped-no-names', true)
      }
      headers = f.headers
      body = f.body
      source = f.source
    } else {
      body = rows.slice(headerIdx + 1).filter((r) => r.length === headers.length && isLabelCell(r[0]))
      if (body.length === 0) return why(index, 'no-labeled-rows')
    }
    const labels = body.map((r) => normLabel(r[0]))
    const labelClass = labelClassOf(labels)
    const monotonic = isIncreasing(labels.filter((l) => labelClassOf([l]) === 'numeric'))
    if (labelClass === 'numeric' && (body.length < 2 || !monotonic)) {
      meta.rejectedNumeric++
      return why(index, 'numeric-rule', flippedCand)
    }
    // 뒤집어 읽은 표의 숫자 이름은 구매 옵션 번호와 이어질 때만 믿어요(옵션이 없으면 실측 값일 수 있음).
    if (flippedCand && labelClass === 'numeric' && options.length === 0) {
      meta.rejectedMeasureHeader++
      return why(index, 'flipped-numeric-no-options', true)
    }
    const overlap = options.length ? labels.filter((l) => matchOption(l, options)).length : 0
    if (options.length && overlap === 0) {
      meta.rejectedNoOverlap++
      return why(index, 'no-overlap', flippedCand)
    }
    if (flippedCand) meta.flipped++
    why(index, 'not-best', flippedCand)
    const cand = { index, headers, body, labels, labelClass, monotonic, overlap, rank: CLASS_RANK[labelClass], flipped: flippedCand, source }
    const better =
      !best ||
      cand.overlap > best.overlap ||
      (cand.overlap === best.overlap &&
        (cand.rank > best.rank || (cand.rank === best.rank && cand.body.length > best.body.length)))
    if (better) best = cand
  })
  if (best) cands[best.index].reason = 'selected'
  // 리포트에는 실측 제목이 있었던 후보(또는 선택된 후보)를 우선해서 최대 6개만 남겨요.
  meta.candidates = cands
    .filter((c) => c.head !== '' || c.reason === 'selected')
    .sort((a, b) => (b.reason === 'selected') - (a.reason === 'selected') || a.index - b.index)
    .slice(0, 6)
    .map((c) => ({ ...c, reason: REASON_KEYS.includes(c.reason) ? c.reason : 'not-best' }))
  if (!best) {
    const shoe = shoeMmChart(rowsList, options, category)
    if (!shoe) return { chart: null, meta }
    if (shoe.index != null && cands[shoe.index]) cands[shoe.index].reason = 'selected'
    meta.candidates = cands.filter((c) => c.head !== '' || c.reason === 'selected').slice(0, 6).map((c) => ({ ...c, reason: REASON_KEYS.includes(c.reason) ? c.reason : 'not-best' }))
    Object.assign(meta, { selectedIndex: shoe.index, rowCount: shoe.nums.length, labelCount: shoe.nums.length, labelClass: 'numeric', monotonic: true, overlap: options.length ? mmOptionLabels(options).filter((n) => shoe.nums.includes(Number(n))).length : 0, namesFrom: shoe.source })
    return { chart: shoe.chart, meta }
  }

  const cat = category || guessCategory('', best.headers)
  const mapping = best.headers.map((h, i) => (i === 0 ? null : mapHeader(h, cat)))
  const measures = {}
  const display = {}
  const viewRows = []
  const rows = best.body.map((r) => {
    const matched = options.length ? matchOption(normLabel(r[0]), options) : null
    // 숫자만 있는 라벨('0')은 옵션 이름('0(S)')을 줄 이름으로 써서 리뷰의 'S' 같은 글자와도 이어지게 해요.
    const n0 = normLabel(r[0])
    // 숫자만 있는 라벨('0')은 옵션 안의 '0(S)' 조각을 줄 이름으로 써서 리뷰의 'S'와도 이어지게 해요. 그 외에는 표 라벨을 그대로 둡니다.
    const paren = matched && /^\d{1,2}$/.test(n0) ? optionKeys(matched).find((k) => outerNumber(k) === n0) : null
    const label = paren || n0
    // 옵션 이름이 표 줄 이름과 같거나('1 (M)' ↔ '1(M)') 괄호 조각일 때만 옵션 표기를 보여줘요. '95/100', 'S/M' 같은 묶음 옵션은 줄마다 표 라벨을 씁니다.
    const mn = matched ? normLabel(matched) : ''
    const shown = matched && (mn === label || mn === n0 || innerToken(mn) === label || paren) ? matched : displayText(r[0])
    if (shown !== label) display[label] = shown
    const m = {}
    const cells = []
    r.forEach((cell, i) => {
      const map = mapping[i]
      const v = toNumber(cell)
      if (i > 0) cells.push({ raw: displayText(cell), value: null, converted: false })
      if (!map || v == null) return
      if (map.minValue && v < map.minValue) return
      const circumference = map.flat || (map.flatBelow && v < map.flatBelow) ? v * 2 : v
      m[map.key] = Math.round(circumference * 10) / 10
      cells[i - 1].value = m[map.key]
      cells[i - 1].converted = circumference !== v
    })
    if (Object.keys(m).length) measures[label] = m
    viewRows.push({ label, shown, cells: cells.slice(0, 10) })
    return [label, ...r.slice(1)]
  })
  Object.assign(meta, {
    selectedIndex: best.index,
    rowCount: best.body.length,
    labelCount: best.labels.length,
    labelClass: best.labelClass,
    monotonic: best.monotonic,
    overlap: best.overlap,
    namesFrom: best.source,
  })
  const chart = {
    unit: cat === 'shoes' ? 'mm' : 'cm',
    headers: ['사이즈', ...best.headers.slice(1)],
    rows,
    measures,
    category: cat,
    // 화면에 "읽은 그대로"를 보여주기 위한 값: 원문 머리글·칸과 우리가 계산에 쓴 값
    view: {
      flipped: best.flipped,
      namesFrom: best.source,
      headers: best.headers.slice(1, 11).map(displayText),
      used: mapping.slice(1, 11).map(Boolean),
      rows: viewRows.slice(0, 20),
    },
  }
  if (Object.keys(display).length) chart.display = display
  return { chart, meta }
}

/** rowsList: 표마다 [[셀 텍스트,...],...] 배열. 가장 알맞은 사이즈표를 골라 핏 엔진용 구조로 바꿉니다. */
export function buildSizeChart(rowsList, category, optionLabels = []) {
  const { chart } = analyzeSizeCharts(rowsList, category, optionLabels)
  if (!chart) return null
  const { view, ...rest } = chart // 화면 표시용 값은 서버 파서 결과에 넣지 않아요
  return rest
}

// ---------- 리뷰 문장에서 체형·사이즈·핏 읽기 ----------
const FIT_WORDS = {
  small: /작아|작게 나|작은 ?편|작음|작네|타이트|끼어|껴요|끼는|낍니다|짧아|짧게|한 ?치수 ?(?:크게|올려|업)|사이즈 ?업/g,
  large: /커요|크게 나|큰 ?편|커서|크네|넉넉|헐렁|루즈|길어요|한 ?치수 ?(?:작게|내려|다운)|사이즈 ?다운/g,
  true: /정사이즈|딱 ?맞|잘 ?맞|적당|정핏|무난하게 맞/g,
}

// 리뷰 글에서 '산 사이즈'를 고릅니다. 확신이 없으면 null.
// 1) '구매 옵션' 뒤 값(평소·입는·마침표 등에서 끊은 짧은 구간) 안에서만 찾고,
// 2) 없으면 '평소/보통 L 입는데' 같은 평소 사이즈 표현을 뺀 본문에서 'M 샀어요/구매/주문' 표현만 봅니다.
// 서로 다른 사이즈가 둘 이상 나오면 어느 쪽인지 알 수 없어 비워 둬요.
const SIZE_TOK = 'XXS|XS|S|M|L|XL|XXL|2XL|3XL|FREE|프리'
const USUAL_RE = new RegExp(`(?:평소|보통|원래|항상|주로|평상시|늘)\\s*(?:에는|엔|는|은)?\\s*(?:사이즈\\s*(?:는|가)?\\s*)?(?:${SIZE_TOK}|\\d{2,3})(?![A-Za-z0-9])\\s*(?:사이즈|로|으로)?`, 'gi')
const HABIT_RE = new RegExp(`(?<![A-Za-z0-9])(?:${SIZE_TOK}|\\d{2,3})\\s*(?:mm|㎜)?\\s*(?:사이즈)?\\s*(?:입는|신는)`, 'gi')
const OPTION_CUT_RE = /평소|보통|원래|항상|주로|평상시|입는|키\s*\d|몸무게|\d{2,3}\s*(?:cm|kg)|[.!?。]/i
const normTok = (x) => x.toUpperCase().replace('프리', 'FREE')

function uniqueSize(found, labels) {
  const set = [...new Set(found.map(normTok))]
  if (set.length !== 1) return null
  return labels.length === 0 || labels.includes(set[0]) ? set[0] : null
}

function pickReviewSize(t, sizeLabels) {
  const labels = sizeLabels.map((s) => String(s).toUpperCase())
  const opt = t.match(/구매\s*옵션/)
  if (opt) {
    let seg = t.slice(opt.index + opt[0].length, opt.index + opt[0].length + 40)
    const cut = seg.search(OPTION_CUT_RE)
    if (cut >= 0) seg = seg.slice(0, cut)
    const re = new RegExp(`(?<![A-Za-z0-9가-힣])(?:\\d{1,2}\\s*\\(\\s*)?(${SIZE_TOK})(?![A-Za-z0-9가-힣])`, 'gi')
    const found = [...seg.matchAll(re)].map((m) => m[1])
    if (found.length) return uniqueSize(found, labels)
    // 신발: 구매옵션이 '화이트 / 255' 처럼 mm 숫자로 끝나는 경우
    const mm = [...seg.matchAll(/(?<![\d.])(2[0-9]\d|3[01]\d)(?:\s*(?:mm|㎜))?(?![\d.])/g)].map((m) => m[1])
    if (mm.length) return uniqueSize(mm, labels)
  }
  const body = t.replace(USUAL_RE, ' ').replace(HABIT_RE, ' ')
  const patterns = [
    new RegExp(`(?:^|[^A-Za-z0-9])(${SIZE_TOK})\\s*(?:사이즈|로|으로|구매|샀|입|주문|사)`, 'gi'),
    new RegExp(`(?<![A-Za-z0-9])\\d{1,2}\\s*\\(\\s*(${SIZE_TOK})\\s*\\)`, 'gi'),
    /(?<![\d.,])(\d{2,3})\s*(?:mm|㎜)?\s*(?:사이즈|인치|로 구매|으로 구매|샀|구매|주문|신어|신었|신고)/g,
    /(?<![\d.])(2[0-9]\d|3[01]\d)\s*(?:mm|㎜)(?![A-Za-z])/g, // 신발 '265mm'
  ]
  for (const re of patterns) {
    const found = [...body.matchAll(re)].map((m) => m[1])
    if (found.length) return uniqueSize(found, labels)
  }
  return null
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

  const size = pickReviewSize(t, sizeLabels)

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

