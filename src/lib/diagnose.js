// 사이즈표를 못 찾았을 때 "무엇을 찾고 무엇을 못 찾았는지" 알려주는 진단.
// 숫자와 참/거짓만 모으고, 페이지 글은 모양 기호(L/N/T)로 바꿔서 담아요.
// 프로필, 리뷰 글, 상품명, 주소의 쿼리·해시는 보고서에 들어가지 않습니다. 네트워크 호출은 없어요.
import { findGridCandidates, readTables, tableShapes, readGeometryRows, parsePage, MEASURE_RE, REVIEW_SELECTOR } from './pageParser.js'
import { shapeOfCell } from './productCore.js'
import { screenReviews } from './fitEngine.js'
import { outlierLine, REASON_KEYS } from './reviewOutliers.js'
import { cleanCategoryInfo, categoryEvidenceLine } from './categoryClassifier.js'

export const REPORT_MAX = 4000

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const all = (root, sel) => Array.from(root.querySelectorAll(sel))
const kids = (el) => Array.from(el.children || [])
const HEADING = /사이즈|실측|size/i

// 글 한 조각을 모양 기호로: 사이즈 글자 L, 숫자 N, 그 외 T, 빈 칸은 _
const shapeOfText = shapeOfCell

const safeToken = (t) => /^[A-Za-z0-9_-]{1,24}$/.test(t)

function describeNode(el) {
  const tag = String(el.tagName || el.nodeName || 'node').toLowerCase()
  const role = el.getAttribute?.('role')
  const cls = String(el.getAttribute?.('class') || '').split(/\s+/).filter(safeToken).slice(0, 3)
  return tag + (role && safeToken(role) ? `[${role}]` : '') + (cls.length ? '.' + cls.join('.') : '')
}

// 3단계 깊이까지 태그/역할/클래스 토큰과 자식 개수, 잎 글은 모양 기호로만 적는다.
function shapeTree(el, depth, indent, lines) {
  const list = kids(el)
  const label = list.length === 0 ? ` ${shapeOfText(el.textContent)}` : ` x${list.length}`
  lines.push(`${'  '.repeat(indent)}${describeNode(el)}${label}`)
  if (depth <= 1) return
  for (const c of list.slice(0, 4)) shapeTree(c, depth - 1, indent + 1, lines)
  if (list.length > 4) lines.push(`${'  '.repeat(indent + 1)}...`)
}

function headingAnchors(root) {
  return all(root, '*').filter((e) => kids(e).length === 0 && HEADING.test(clean(e.textContent)) && clean(e.textContent).length <= 30).slice(0, 150)
}

function nearbyRegions(anchor) {
  const out = []
  let cur = anchor
  for (let i = 0; i < 3 && cur; i++, cur = cur.parentElement) out.push(cur)
  return out
}

// 리뷰 글은 읽어서 개수만 셉니다. 글과 숫자 값은 결과에 담지 않아요.
const SCROLL_STOPS = ['reached-end', 'no-growth', 'limit', 'limit-time', 'aborted', 'not-run']

function reviewStats(reviews) {
  const list = reviews || []
  const n = (f) => list.filter(f).length
  const text = (r) => String(r.text || '')
  return {
    loaded: list.length,
    withHeight: n((r) => r.height != null),
    withWeight: n((r) => r.weight != null),
    withBoth: n((r) => r.height != null && r.weight != null),
    withSize: n((r) => !!r.size),
    withFit: n((r) => !!r.fit),
    numCm: n((r) => /\d\s*(cm|㎝|센치)/i.test(text(r))),
    numKg: n((r) => /\d\s*(kg|㎏|키로|킬로)/i.test(text(r))),
    wordHeight: n((r) => text(r).includes('키')),
    wordWeight: n((r) => text(r).includes('몸무게')),
  }
}

const DROP_KEYS = ['tooShort', 'tooLong', 'innerDuplicate', 'noClue', 'duplicate', 'inSizeChart']
const cleanCount = (v) => (Number.isInteger(v) && v >= 0 && v <= 100000 ? v : 0)
function cleanDropped(d) {
  return Object.fromEntries(DROP_KEYS.map((k) => [k, cleanCount(d?.[k])]))
}

// 후기 이상치 제외 결과는 건수만 담아요 (후기 글·키·몸무게 값은 담지 않음)
function cleanOutliers(product) {
  if (!product) return null
  try {
    const o = screenReviews(product.reviews || [], product)
    return {
      excludedTotal: cleanCount(o.excludedTotal),
      counts: Object.fromEntries(REASON_KEYS.map((k) => [k, cleanCount(o.counts[k])])),
      labelReduced: cleanCount(o.labelReduced),
      statApplied: o.statApplied === true,
    }
  } catch {
    return null
  }
}

// 본문 추출 결과는 건수만 담아요 (닉네임·상품명·본문·사진 주소는 담지 않음)
const BODY_KEYS = ['structured', 'fallback', 'deduped', 'withNick', 'withPhoto', 'withProductName']
function cleanBodyExtract(b) {
  return Object.fromEntries(BODY_KEYS.map((k) => [k, cleanCount(b?.[k])]))
}

function cleanScroll(s) {
  if (!s || typeof s !== 'object') return null
  const num = (v) => (Number.isInteger(v) && v >= 0 && v <= 100000 ? v : 0)
  return { before: num(s.before), after: num(s.after), stop: SCROLL_STOPS.includes(s.stop) ? s.stop : 'not-run' }
}

export function collectDiagnostics(root, pageUrl = '', extVersion = '', extra = {}) {
  const tables = readTables(root)
  const candidates = findGridCandidates(root)
  const anchors = headingAnchors(root)
  let labelNear = false
  let imgNear = false
  for (const a of anchors) {
    for (const region of nearbyRegions(a)) {
      const tokens = clean(region.textContent).slice(0, 3000).split(' ')
      if (tokens.some((t) => /^(XXS|XS|S|M|L|XL|XXL|2XL|3XL|FREE|F)$/i.test(t))) labelNear = true
      if (all(region, 'img').length > 0) imgNear = true
    }
  }
  const headerWords = [...tables, ...candidates.map((c) => c.rows)].some((rows) => rows.some((r) => r.some((c) => MEASURE_RE.test(c))))
  const product = parsePage(root, '', { categoryOverride: extra?.categoryOverride })
  const ogType = (root.querySelector?.('meta[property="og:type"]')?.getAttribute('content') || '').toLowerCase()

  // 구조 요약: 표 모양 후보 최대 3곳, 없으면 사이즈 제목 근처 영역
  const regionEls = candidates.slice(0, 3).map((c) => c.el)
  if (regionEls.length === 0) for (const a of anchors.slice(0, 3)) regionEls.push(nearbyRegions(a).slice(-1)[0] || a)
  const structure = regionEls.map((el) => {
    const lines = []
    shapeTree(el, 3, 0, lines)
    return lines.slice(0, 14).join('\n')
  })

  let origin = ''
  try {
    const u = new URL(pageUrl)
    origin = u.origin + u.pathname
  } catch {
    origin = ''
  }
  const ver = /^[\w.-]{1,20}$/.test(extVersion) ? extVersion : ''
  const ready = typeof root.readyState === 'string' && /^(loading|interactive|complete)$/.test(root.readyState) ? root.readyState : null

  return {
    url: origin,
    version: ver,
    tableCount: all(root, 'table').length,
    roleTableCount: all(root, '[role="table"],[role="grid"],[role="treegrid"]').length,
    gridCandidateCount: candidates.length,
    sizeLabelNearHeading: labelNear,
    headerWordsFound: headerWords,
    chartRowCount: product?.sizeChart ? product.sizeChart.rows.length : 0,
    reviewLikeCount: all(root, REVIEW_SELECTOR).length,
    reviewsKept: product ? product.reviews.length : 0,
    reviewTotalOnPage: product?.reviewTotalOnPage ?? null,
    optionLabelCount: product ? product.optionLabels.length : 0,
    category: product ? cleanCategoryInfo({ category: product.category, confidence: product.categoryConfidence, evidence: product.categoryEvidence }) : null,
    chart: chartJudgment(product?.sizeChartMeta),
    jsonLdProduct: hasLdProduct(root),
    ogType: /^[a-z][a-z._-]{0,20}$/.test(ogType) ? ogType : ogType ? 'other' : '',
    imageNearHeading: imgNear,
    readyState: ready,
    reviewStats: reviewStats(product?.reviews),
    outliers: cleanOutliers(product),
    reviewCards: cleanCount(product?.reviewMeta?.cards),
    reviewDropped: cleanDropped(product?.reviewMeta?.dropped),
    bodyExtract: cleanBodyExtract(product?.reviewMeta?.bodyExtract),
    scroll: cleanScroll(extra?.scroll),
    compareFailed: extra?.compareFailed === true,
    used: cleanUsed(extra?.used),
    structure,
    chartShape: chartShape(root, tables),
  }
}

// 사이즈표 후보의 모양(칸 글자는 미리 정한 실측 항목 이름만 남김, 개수 제한). 리뷰·닉네임·체형은 담지 않아요.
const CELL_OK_RE = /^(?:\d{0,2}\s*)(?:cm|mm|사이즈|총장|기장|어깨너비|어깨|가슴단면|가슴|소매길이|소매부리단면|소매|밑단단면|밑단|암홀|허리|허벅지|엉덩이|밑위|신발\s?길이|신발\s?너비|발\s?길이|굽\/?솔?\s?높이)$/
function chartShape(root, tables) {
  const sh = tableShapes(root)
  const cand = tables.find((rows) => rows.some((r) => r.some((c) => MEASURE_RE.test(c) || /길이|너비|높이/.test(c)))) || []
  const cells = cand
    .slice(0, 3)
    .flatMap((r) => r.slice(0, 10))
    .filter((c) => CELL_OK_RE.test(c))
    .slice(0, 24)
  let geo = null
  try {
    const g = readGeometryRows(root)
    geo = { leaves: smallInt(g.leaves), positioned: smallInt(g.positioned), rows: smallInt(g.rowCount), used: !!g.rows }
  } catch {
    geo = null
  }
  return { ...sh, cells, geometry: geo }
}


// 사이즈표 후보를 어떻게 판단했는지: 개수·종류·모양 분류·참/거짓만 담아요. 페이지 글은 담지 않아요.
function chartJudgment(m) {
  const meta = m || {}
  return {
    considered: meta.considered || 0,
    withHeader: meta.withHeader || 0,
    selectedIndex: Number.isInteger(meta.selectedIndex) ? meta.selectedIndex : null,
    selectedKind: ['table', 'grid', 'transposed', 'manual', 'geometry'].includes(meta.selectedKind) ? meta.selectedKind : null,
    rowCount: meta.rowCount || 0,
    labelCount: meta.labelCount || 0,
    labelClass: ['paren', 'alpha', 'numeric', 'mixed', 'none'].includes(meta.labelClass) ? meta.labelClass : 'none',
    monotonic: typeof meta.monotonic === 'boolean' ? meta.monotonic : null,
    flipped: meta.flipped || 0,
    normalRetry: meta.normalRetry || 0,
    headerPrefixStripped: smallInt(meta.headerPrefixStripped),
    skippedRows: smallInt(meta.skippedRows),
    dashColumns: smallInt(meta.dashColumns),
    rejectedMeasureHeader: meta.rejectedMeasureHeader || 0,
    rejectedNumeric: meta.rejectedNumeric || 0,
    rejectedNoOverlap: meta.rejectedNoOverlap || 0,
    overlap: meta.overlap || 0,
    optionCount: meta.optionCount || 0,
    namesFrom: ['table', 'other-table', 'options', 'normal-retry'].includes(meta.namesFrom) ? meta.namesFrom : null,
    candidates: cleanCandidates(meta.candidates),
  }
}

const CAND_REASON_TEXT = {
  'too-few-rows': '줄이 1개뿐',
  'no-measure-header': '실측 항목 글자 없음',
  'no-labeled-rows': '사이즈 이름으로 시작하는 줄 없음',
  'flipped-no-names': '첫 열이 실측 항목인데 사이즈 이름 줄을 못 찾음',
  'numeric-rule': '숫자 이름 규칙 위반(2줄 미만 또는 순서 증가 아님)',
  'flipped-numeric-no-options': '뒤집은 숫자 이름인데 구매 옵션이 없음',
  'no-overlap': '구매 옵션 이름과 안 겹침',
  'not-best': '읽을 수는 있었으나 다른 후보가 더 적합',
  selected: '선택함',
}
const NAMES_FROM_TEXT = { table: '같은 표', 'other-table': '다른 표', options: '구매 옵션 순서', 'normal-retry': '정상 표로 재시도(첫 열이 증가하는 정수)' }
const SHAPE_RE = /^[LNT_ ]{0,40}$/
const KINDS = ['table', 'grid', 'transposed', 'manual', 'geometry']
const smallInt = (v) => (Number.isInteger(v) && v >= 0 && v <= 999 ? v : 0)
function cleanCandidates(list) {
  return (Array.isArray(list) ? list : []).slice(0, 6).map((c) => ({
    index: smallInt(c.index),
    kind: KINDS.includes(c.kind) ? c.kind : null,
    rows: smallInt(c.rows),
    cols: smallInt(c.cols),
    head: SHAPE_RE.test(c.head || '') ? c.head : '',
    firstCol: SHAPE_RE.test(c.firstCol || '') ? c.firstCol : '',
    reason: Object.hasOwn(CAND_REASON_TEXT, c.reason) ? c.reason : 'not-best',
    flipped: c.flipped === true,
  }))
}

// 중고 판매글 읽기 결과: 건수와 정해진 값만 담아요(제목·본문·사진 주소 없음).
const USED_BASES = ['listing', 'chart-db', 'default', 'none']
function cleanUsed(u) {
  if (!u || typeof u !== 'object') return null
  return {
    measureCount: smallInt(u.measureCount),
    sizeCount: smallInt(u.sizeCount),
    droppedCount: smallInt(u.droppedCount),
    photoCount: smallInt(u.photoCount),
    basis: USED_BASES.includes(u.basis) ? u.basis : 'none',
    siteKnown: u.siteKnown === true,
  }
}
const USED_BASIS_TEXT = { listing: '판매글 실측', 'chart-db': '사이즈표 DB', default: '기본값', none: '없음' }
function usedLines(d) {
  const u = d.used
  if (!u) return []
  return [`중고 판매글 읽기: 실측 ${u.measureCount}개, 사이즈 표기 ${u.sizeCount}개, 버린 값 ${u.droppedCount}개, 사진 ${u.photoCount}개, 사용한 근거 ${USED_BASIS_TEXT[u.basis]}, 알려진 중고 사이트 주소 ${yn(u.siteKnown)}`]
}

function hasLdProduct(root) {
  return all(root, 'script[type="application/ld+json"]').some((s) => /"@type"\s*:\s*\[?\s*"Product"/.test(s.textContent || ''))
}

const yn = (b) => (b ? '예' : '아니요')

// 사람이 읽는 한 줄 요약들 (카드에 그대로 보여줘요)
export function diagnosticLines(d) {
  return [
    `table ${d.tableCount}개, role=table ${d.roleTableCount}개, 표 모양 후보 ${d.gridCandidateCount}개`,
    `사이즈 제목 근처 사이즈 글자: ${yn(d.sizeLabelNearHeading)}, 실측 항목 글자: ${yn(d.headerWordsFound)}`,
    `읽은 사이즈표 줄 ${d.chartRowCount}개, 리뷰 후보 ${d.reviewLikeCount}개, 인정한 리뷰 ${d.reviewsKept}개`,
    `사이즈 제목 근처에 이미지: ${yn(d.imageNearHeading)}`,
    ...(categoryEvidenceLine(d.category) ? [categoryEvidenceLine(d.category)] : []),
    ...chartLines(d),
    ...shapeLines(d),
    ...reviewStatLines(d),
    ...usedLines(d),
  ]
}

function shapeLines(d) {
  const s = d.chartShape
  if (!s) return []
  const out = s.tables.map((t, i) => `표 ${i + 1}: ${t.rows}줄 x ${t.cols}칸, thead ${yn(t.thead)}, tbody ${yn(t.tbody)}, colspan ${t.colspan}개`)
  out.push(`머리글/본문 표 이어 붙이기: 시도 ${s.mergeAttempted}회, 성공 ${s.merged}회`)
  if (s.cells.length) out.push(`사이즈표 후보 칸 글자: ${s.cells.join(' | ')}`)
  if (s.geometry) out.push(`화면 위치 읽기: 글자 요소 ${s.geometry.leaves}개 중 위치 있음 ${s.geometry.positioned}개, ${s.geometry.rows}줄, ${s.geometry.used ? '사용' : '미사용'}`)
  return out
}

function reviewStatLines(d) {
  const r = d.reviewStats
  const out = []
  if (r) {
    out.push(`리뷰 ${r.loaded}건 중 키 읽음 ${r.withHeight}, 몸무게 읽음 ${r.withWeight}, 둘 다 ${r.withBoth}, 사이즈 읽음 ${r.withSize}, 핏 읽음 ${r.withFit}`)
    out.push(`리뷰 글 모양: 숫자+cm ${r.numCm}건, 숫자+kg ${r.numKg}건, '키' 낱말 ${r.wordHeight}건, '몸무게' 낱말 ${r.wordWeight}건`)
  }
  if (d.reviewDropped) {
    const x = d.reviewDropped
    out.push(`버린 리뷰 후보 사유: 너무 짧음 ${x.tooShort}, 너무 김 ${x.tooLong}, 안쪽 중복 ${x.innerDuplicate}, 단서 없음 ${x.noClue}, 중복 ${x.duplicate}, 사이즈표 안 ${x.inSizeChart}`)
    out.push(`리뷰 카드로 묶은 개수: ${d.reviewCards || 0}`)
  }
  if (d.bodyExtract) {
    const b = d.bodyExtract
    out.push(`본문 추출: 라벨 구조 ${b.structured}건, 전체 글 대체 ${b.fallback}건, 접힘/펼침 중복 제거 ${b.deduped}건 | 닉네임 읽음 ${b.withNick}건, 상품명 읽음 ${b.withProductName}건, 사진 있는 리뷰 ${b.withPhoto}건`)
  }
  if (d.outliers) out.push(outlierLine(d.outliers))
  if (d.compareFailed) out.push('사이즈별 비교 표를 만들지 못해 표시하지 않았어요')
  if (d.scroll) out.push(`리뷰 불러오기: ${d.scroll.before}건 -> ${d.scroll.after}건, 멈춘 이유 ${d.scroll.stop}`)
  return out
}

// 후보별 한 줄: 머리글 모양(L=사이즈 글자, N=숫자, T=그 외 글, _=빈칸)과 첫 열 모양, 선택/버린 사유. 페이지 글은 없어요.
function candidateLines(c) {
  const out = (c.candidates || []).map(
    (x) => `후보 ${x.index + 1}번(${x.kind || '?'}, ${x.rows}줄 x ${x.cols}칸${x.flipped && ['selected', 'not-best'].includes(x.reason) ? ', 뒤집어 읽음' : ''}) 머리글 [${x.head}] 첫 열 [${x.firstCol}] -> ${CAND_REASON_TEXT[x.reason]}`,
  )
  if (c.namesFrom) out.push(`${c.namesFrom === 'normal-retry' ? '사이즈 이름 출처' : '뒤집어 읽을 때 사이즈 이름 출처'}: ${NAMES_FROM_TEXT[c.namesFrom]}`)
  return out
}

function chartLines(d) {
  const c = d.chart
  if (!c) return []
  const sel = c.selectedIndex == null ? '선택된 표 없음' : `선택한 후보 ${c.selectedIndex + 1}번(${c.selectedKind || '?'}, ${c.rowCount}줄)`
  const total = d.reviewTotalOnPage != null ? `, 페이지 표시 전체 리뷰 약 ${d.reviewTotalOnPage}건` : ', 페이지에 표시된 전체 리뷰 수 못 찾음'
  return [
    `사이즈표 후보 ${c.considered}개 검토(실측 제목 있는 후보 ${c.withHeader}개), ${sel}`,
    `뒤집어 읽은 후보 ${c.flipped}개, 뒤집어도 못 쓴 후보 ${c.rejectedMeasureHeader}개, 숫자 이름 규칙 위반 ${c.rejectedNumeric}개, 구매 옵션과 안 겹쳐 버린 후보 ${c.rejectedNoOverlap}개, 정상 표로 재시도해 읽은 후보 ${c.normalRetry}개`,
    ...candidateLines(c),
    `머리글 열 번호 접두 제거한 후보 ${c.headerPrefixStripped}개, 건너뛴 줄(내 사이즈 안내 등) ${c.skippedRows}개, 전부 '-'인 열 ${c.dashColumns}개`,
    `사이즈 이름 ${c.labelCount}개, 모양 ${c.labelClass}, 숫자 이름 순서 증가: ${c.monotonic == null ? '해당 없음' : yn(c.monotonic)}`,
    `구매 옵션 이름 ${d.optionLabelCount ?? c.optionCount}개, 표와 겹침 ${c.overlap}개`,
    `불러온 리뷰 ${d.reviewsKept}건${total}`,
  ]
}

export function formatReport(d) {
  const out = ['[핏체크 진단 리포트]']
  out.push(`주소: ${d.url || '(알 수 없음)'}`)
  if (d.version) out.push(`확장 버전: ${d.version}`)
  if (d.readyState) out.push(`readyState: ${d.readyState}`)
  out.push(...diagnosticLines(d))
  out.push(`JSON-LD Product: ${yn(d.jsonLdProduct)}, og:type: ${d.ogType || '없음'}`)
  if (d.errorName) out.push(`오류: ${String(d.errorName).replace(/[^A-Za-z]/g, '').slice(0, 30)}`)
  if (d.errorName && ['profile', 'wait', 'analyze', 'render'].includes(d.errorWhere)) {
    const ident = typeof d.errorIdent === 'string' && /^[A-Za-z_$][\w$]{0,40}$/.test(d.errorIdent) ? d.errorIdent : ''
    out.push(`오류 위치: ${d.errorWhere}${ident ? `, 식별자: ${ident}` : ''}`)
  }
  d.structure.forEach((s, i) => out.push(`\n구조 ${i + 1} (L=사이즈 글자, N=숫자, T=그 외 글, _=빈칸)\n${s}`))
  return out.join('\n').slice(0, REPORT_MAX)
}
