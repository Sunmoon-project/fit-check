// 리뷰 불러오기에서 쓰는 순수 판단 함수들. DOM이나 네트워크를 쓰지 않아요.
// '내 사이즈 찾기'를 누르면 리뷰를 AUTO_TARGET건까지 자동으로 불러오고, '리뷰 더 불러오기'는 누를 때마다 MORE_STEP건씩 더 불러와요.
// 리뷰 영역의 '더보기'·'다음'·다음 쪽 번호 버튼만 누르도록 좁게 허용합니다.

export const AUTO_TARGET = 30 // '내 사이즈 찾기'를 누르면 이만큼까지 자동으로 불러와요
export const MORE_STEP = 10 // '리뷰 더 불러오기'를 한 번 누를 때 더 불러올 건수
export const MAX_STEPS = 15 // 한 번에 반복할 최대 횟수
export const MAX_MS = 20000 // 한 번에 쓸 최대 시간
export const STALL_LIMIT = 2 // 리뷰가 늘지 않은 단계가 이만큼 이어지면 멈춤

export const STOP_REASONS = ['no-more', 'limit-steps', 'limit-time', 'aborted', 'reached-total', 'reached-target']

// 멈춘 이유를 진단 리포트(diagnose.js)의 scroll.stop 값으로 바꿉니다.
const TO_REPORT = {
  'no-more': 'no-growth',
  'limit-steps': 'limit',
  'limit-time': 'limit-time',
  aborted: 'aborted',
  'reached-total': 'reached-end',
  'reached-target': 'limit',
}

export function toReportStop(reason) {
  return TO_REPORT[reason] || 'not-run'
}

/** 이번에 불러올 목표 건수: 자동(auto)은 AUTO_TARGET건까지, 더 불러오기(more)는 지금 건수 + MORE_STEP건 */
export function loadTarget(current, mode) {
  const n = Number.isFinite(current) && current > 0 ? Math.floor(current) : 0
  return mode === 'auto' ? AUTO_TARGET : n + MORE_STEP
}

export function shouldStop({ steps = 0, elapsedMs = 0, stalls = 0, aborted = false, count = 0, total = null, target = null } = {}) {
  if (aborted) return 'aborted'
  if (Number.isFinite(total) && total > 0 && count >= total) return 'reached-total'
  if (Number.isFinite(target) && target > 0 && count >= target) return 'reached-target'
  if (stalls >= STALL_LIMIT) return 'no-more'
  if (steps >= MAX_STEPS) return 'limit-steps'
  if (elapsedMs >= MAX_MS) return 'limit-time'
  return null
}

const ALLOWED = /^(?:(?:리뷰|후기)\s?)?더\s?보기$|^다음(?:\s?페이지)?$/
const PAGE_NO = /^\d{1,3}$/
// 이런 글이 하나라도 들어 있으면 리뷰 영역 안이어도 누르지 않아요 (구매·상태 변경·이동·작성 버튼).
const FORBIDDEN = /구매|장바구니|좋아요|찜|바로|주문|결제|쿠폰|삭제|신고|작성|로그인|공유|댓글|팔로우|문의|선물|구독|다운|적립|응모/

// text: 버튼에 보이는 글
// ancestorInfo: { inReviewContainer: boolean, currentPage?: number }
// 쪽 번호 버튼('2')은 리뷰 영역 안이고 지금 쪽(currentPage)을 알 때, 바로 다음 쪽 번호만 허용해요.
export function isSafeMoreButton(text, ancestorInfo) {
  if (!ancestorInfo || ancestorInfo.inReviewContainer !== true) return false
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!t || t.length > 8) return false
  if (FORBIDDEN.test(t)) return false
  if (PAGE_NO.test(t)) {
    const cur = ancestorInfo.currentPage
    return Number.isInteger(cur) && cur >= 1 && Number(t) === cur + 1
  }
  return ALLOWED.test(t)
}

// 리뷰를 여는 탭인지: '스냅·후기', '후기', '리뷰', '후기 1,234', '스냅·후기(733)'처럼 글 전체가 이 모양이어야 해요.
const REVIEW_TAB_RE = /^(?:스냅\s*[·ㆍ･・/]\s*)?(?:후기|리뷰)\s*\(?\s*[\d,]{0,9}\s*\)?$/

/**
 * '스냅·후기' 같은 탭을 눌러도 되는지 판단합니다.
 * 탭은 같은 페이지 안에서 보이는 영역만 바꾸고 구매·저장 같은 상태를 바꾸지 않아서, 아래 조건을 모두 만족할 때만 눌러요.
 * - 글 전체가 리뷰를 여는 탭 이름 모양이고 금지 낱말이 없음
 * - role="tab"이거나 role="tablist" 안에 있음 (탭이라고 화면이 직접 밝힌 것만. 클래스 이름으로 짐작하지 않아요)
 * - 아직 선택되지 않음 (aria-selected="true"면 이미 열려 있어 누를 필요가 없어요)
 * - 링크라면 같은 페이지 안 이동(#...)만 허용 (다른 페이지로 떠나면 분석하던 화면이 사라져요)
 * @param {string} text
 * @param {{ role?: string|null, inTablist?: boolean, selected?: boolean, href?: string|null }} info
 */
export function isReviewTab(text, info) {
  if (!info) return false
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!t || t.length > 16 || FORBIDDEN.test(t) || !REVIEW_TAB_RE.test(t)) return false
  if (info.role !== 'tab' && info.inTablist !== true) return false
  if (info.selected === true) return false
  const href = info.href == null ? '' : String(info.href).trim()
  if (href && !href.startsWith('#')) return false
  return true
}

/** 안쪽 스크롤 상자인지: overflow-y가 auto/scroll이고 내용이 상자보다 길어야 해요 */
export function isInnerScroller({ overflowY, scrollHeight, clientHeight } = {}) {
  if (!/^(?:auto|scroll|overlay)$/.test(String(overflowY || ''))) return false
  return Number.isFinite(scrollHeight) && Number.isFinite(clientHeight) && clientHeight > 0 && scrollHeight > clientHeight + 4
}

/**
 * 불러오기가 끝난 뒤 보여줄 한 줄.
 * before/after: 분석에 쓴 리뷰 수(카드에 보이는 숫자), grewOnPage: 화면의 리뷰 요소가 늘었는지,
 * clicked: 더보기·다음 쪽·리뷰 탭 중 하나라도 눌렀는지, reason: shouldStop 결과
 * 'N건에서 N건으로' 같은 문구는 쓰지 않아요.
 */
export function loadResultText({ before = 0, after = 0, reason = null, clicked = false, grewOnPage = false } = {}) {
  const b = Number.isFinite(before) && before > 0 ? before : 0
  const a = Number.isFinite(after) && after > 0 ? after : 0
  if (a > b) return `리뷰 ${a - b}건을 더 불러왔어요(총 ${a}건)`
  if (reason === 'aborted') return `불러오기를 중단했어요(현재 ${a}건)`
  if (grewOnPage) return `리뷰를 더 불러왔지만 키·몸무게·사이즈를 읽을 수 있는 리뷰는 늘지 않았어요(현재 ${a}건)`
  if (reason === 'reached-total' || clicked) return `더 불러올 리뷰가 없어요(현재 ${a}건)`
  return `리뷰를 더 불러오지 못했어요(현재 ${a}건) — 리뷰 탭을 열고 다시 눌러 주세요`
}
