// 사이즈표를 못 찾았을 때 "무엇을 찾고 무엇을 못 찾았는지" 알려주는 진단.
// 숫자와 참/거짓만 모으고, 페이지 글은 모양 기호(L/N/T)로 바꿔서 담아요.
// 프로필, 리뷰 글, 상품명, 주소의 쿼리·해시는 보고서에 들어가지 않습니다. 네트워크 호출은 없어요.
import { findGridCandidates, readTables, parsePage, MEASURE_RE, REVIEW_SELECTOR } from './pageParser.js'
import { SIZE_LABEL_RE } from './productCore.js'

export const REPORT_MAX = 4000

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const all = (root, sel) => Array.from(root.querySelectorAll(sel))
const kids = (el) => Array.from(el.children || [])
const HEADING = /사이즈|실측|size/i

// 글 한 조각을 모양 기호로: 사이즈 글자 L, 숫자 N, 그 외 T, 빈 칸은 _
function shapeOfText(t) {
  const s = clean(t)
  if (!s) return '_'
  if (SIZE_LABEL_RE.test(s.replace(/\s/g, '')) && /\D/.test(s)) return 'L'
  if (/^[\d.,\s]+(cm|mm)?$/i.test(s)) return 'N'
  return 'T'
}

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
  const product = parsePage(root, '')
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
    chart: chartJudgment(product?.sizeChartMeta),
    jsonLdProduct: hasLdProduct(root),
    ogType: /^[a-z][a-z._-]{0,20}$/.test(ogType) ? ogType : ogType ? 'other' : '',
    imageNearHeading: imgNear,
    readyState: ready,
    reviewStats: reviewStats(product?.reviews),
    scroll: cleanScroll(extra?.scroll),
    structure,
  }
}

// 사이즈표 후보를 어떻게 판단했는지: 개수·종류·모양 분류·참/거짓만 담아요. 페이지 글은 담지 않아요.
function chartJudgment(m) {
  const meta = m || {}
  return {
    considered: meta.considered || 0,
    withHeader: meta.withHeader || 0,
    selectedIndex: Number.isInteger(meta.selectedIndex) ? meta.selectedIndex : null,
    selectedKind: ['table', 'grid', 'transposed', 'manual'].includes(meta.selectedKind) ? meta.selectedKind : null,
    rowCount: meta.rowCount || 0,
    labelCount: meta.labelCount || 0,
    labelClass: ['paren', 'alpha', 'numeric', 'mixed', 'none'].includes(meta.labelClass) ? meta.labelClass : 'none',
    monotonic: typeof meta.monotonic === 'boolean' ? meta.monotonic : null,
    rejectedMeasureHeader: meta.rejectedMeasureHeader || 0,
    rejectedNumeric: meta.rejectedNumeric || 0,
    rejectedNoOverlap: meta.rejectedNoOverlap || 0,
    overlap: meta.overlap || 0,
    optionCount: meta.optionCount || 0,
  }
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
    ...chartLines(d),
    ...reviewStatLines(d),
  ]
}

function reviewStatLines(d) {
  const r = d.reviewStats
  const out = []
  if (r) {
    out.push(`리뷰 ${r.loaded}건 중 키 읽음 ${r.withHeight}, 몸무게 읽음 ${r.withWeight}, 둘 다 ${r.withBoth}, 사이즈 읽음 ${r.withSize}, 핏 읽음 ${r.withFit}`)
    out.push(`리뷰 글 모양: 숫자+cm ${r.numCm}건, 숫자+kg ${r.numKg}건, '키' 낱말 ${r.wordHeight}건, '몸무게' 낱말 ${r.wordWeight}건`)
  }
  if (d.scroll) out.push(`리뷰 불러오기: ${d.scroll.before}건 -> ${d.scroll.after}건, 멈춘 이유 ${d.scroll.stop}`)
  return out
}

function chartLines(d) {
  const c = d.chart
  if (!c) return []
  const sel = c.selectedIndex == null ? '선택된 표 없음' : `선택한 후보 ${c.selectedIndex + 1}번(${c.selectedKind || '?'}, ${c.rowCount}줄)`
  const total = d.reviewTotalOnPage != null ? `, 페이지 표시 전체 리뷰 약 ${d.reviewTotalOnPage}건` : ', 페이지에 표시된 전체 리뷰 수 못 찾음'
  return [
    `사이즈표 후보 ${c.considered}개 검토(실측 제목 있는 후보 ${c.withHeader}개), ${sel}`,
    `첫 열 제목이 실측 항목이라 버린 후보 ${c.rejectedMeasureHeader}개, 숫자 이름 규칙 위반 ${c.rejectedNumeric}개, 구매 옵션과 안 겹쳐 버린 후보 ${c.rejectedNoOverlap}개`,
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
  d.structure.forEach((s, i) => out.push(`\n구조 ${i + 1} (L=사이즈 글자, N=숫자, T=그 외 글, _=빈칸)\n${s}`))
  return out.join('\n').slice(0, REPORT_MAX)
}
