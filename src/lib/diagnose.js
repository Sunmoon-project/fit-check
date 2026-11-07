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

export function collectDiagnostics(root, pageUrl = '', extVersion = '') {
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
    jsonLdProduct: hasLdProduct(root),
    ogType: /^[a-z][a-z._-]{0,20}$/.test(ogType) ? ogType : ogType ? 'other' : '',
    imageNearHeading: imgNear,
    readyState: ready,
    structure,
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
