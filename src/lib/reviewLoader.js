// "리뷰 더 불러오기"에서 쓰는 순수 판단 함수들. DOM이나 네트워크를 쓰지 않아요.
// 사용자가 버튼을 눌렀을 때만 동작하고, 리뷰 영역의 '더보기' 버튼만 누르도록 좁게 허용합니다.

export const MAX_STEPS = 20 // 한 번에 반복할 최대 횟수
export const MAX_MS = 30000 // 한 번에 쓸 최대 시간
export const STALL_LIMIT = 2 // 리뷰가 늘지 않은 단계가 이만큼 이어지면 멈춤

export const STOP_REASONS = ['no-more', 'limit-steps', 'limit-time', 'aborted', 'reached-total']

export const STOP_LABEL = {
  'no-more': '더 불러올 리뷰가 없어 보여요',
  'limit-steps': '반복 횟수 한도에 도달했어요',
  'limit-time': '시간 한도(30초)에 도달했어요',
  aborted: '중단했어요',
  'reached-total': '페이지에 표시된 전체 리뷰 수만큼 불러왔어요',
}

// 멈춘 이유를 진단 리포트(diagnose.js)의 scroll.stop 값으로 바꿉니다.
const TO_REPORT = {
  'no-more': 'no-growth',
  'limit-steps': 'limit',
  'limit-time': 'limit-time',
  aborted: 'aborted',
  'reached-total': 'reached-end',
}

export function toReportStop(reason) {
  return TO_REPORT[reason] || 'not-run'
}

export function shouldStop({ steps = 0, elapsedMs = 0, stalls = 0, aborted = false, count = 0, total = null } = {}) {
  if (aborted) return 'aborted'
  if (Number.isFinite(total) && total > 0 && count >= total) return 'reached-total'
  if (stalls >= STALL_LIMIT) return 'no-more'
  if (steps >= MAX_STEPS) return 'limit-steps'
  if (elapsedMs >= MAX_MS) return 'limit-time'
  return null
}

const ALLOWED = /^(리뷰|후기)?\s?더\s?보기$/
const FORBIDDEN = /구매|장바구니|좋아요|찜|바로|주문|결제|삭제|신고|작성|로그인/

// text: 버튼에 보이는 글, ancestorInfo: { inReviewContainer: boolean }
export function isSafeMoreButton(text, ancestorInfo) {
  if (!ancestorInfo || ancestorInfo.inReviewContainer !== true) return false
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!t || t.length > 8) return false
  if (FORBIDDEN.test(t)) return false
  return ALLOWED.test(t)
}
