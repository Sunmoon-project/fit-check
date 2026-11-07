// 브라우저(localStorage)에만 저장합니다. 서버로 보내지 않아요.
// 예외: 사용자가 'AI로 합성하기'를 누르면 그때만 전신 사진이 /api/tryon을 거쳐 Hugging Face Space로 전송돼요.
const PROFILE_KEY = 'fitcheck.profile.v2'
const PHOTO_KEY = 'fitcheck.photo.v1'
const FEEDBACK_KEY = 'fitcheck.feedback.v1'
const WARDROBE_KEY = 'fitcheck.wardrobe.v1'

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // 용량 초과 등
    return false
  }
}

export const loadProfile = () => read(PROFILE_KEY, null)
export const saveProfile = (p) => write(PROFILE_KEY, p)

// 사진은 용량이 커서 따로 저장. 실패하면(용량 초과) 이번 세션에서만 씁니다.
export const loadPhoto = () => read(PHOTO_KEY, null)
export const savePhoto = (dataUrl) => write(PHOTO_KEY, dataUrl)

export const loadFeedback = () => read(FEEDBACK_KEY, [])
export const saveFeedback = (list) => write(FEEDBACK_KEY, list)

// 익명 통계 기여: 동의 상태와 전송 대기열. 서버 저장소가 없어서 대기열은 이 브라우저에만 있어요.
// 철회(false)하면 대기열도 함께 지웁니다. 피드백 키(fitcheck.feedback.v1)와는 별개예요.
const CONSENT_KEY = 'fitcheck.consent.v1'
const QUEUE_KEY = 'fitcheck.contribQueue.v1'
export const loadConsent = (version) => {
  const c = read(CONSENT_KEY, null)
  return Boolean(c && c.agreed === true && c.version === version)
}
export function saveConsent(agreed, version) {
  if (!agreed) {
    write(QUEUE_KEY, null)
    return write(CONSENT_KEY, null)
  }
  return write(CONSENT_KEY, { agreed: true, version, at: Date.now() })
}
export const loadContribQueue = () => read(QUEUE_KEY, [])
export function enqueueContribution(record) {
  if (!record) return false
  // 같은 상품 도메인·종류·사이즈 기록은 최신 것으로 바꿔요(중복 집계 방지).
  const rest = loadContribQueue().filter((r) => !(r.domain === record.domain && r.category === record.category && r.size === record.size && r.month === record.month))
  return write(QUEUE_KEY, [...rest, record].slice(-200))
}

// 옷장: 최근 순으로 최대 WARDROBE_MAX개. 용량이 부족하면 오래된 항목의 이미지부터 뺍니다.
export const WARDROBE_MAX = 30
export const loadWardrobe = () => read(WARDROBE_KEY, [])
export function saveWardrobe(list) {
  let next = list.slice(0, WARDROBE_MAX)
  if (write(WARDROBE_KEY, next)) return { list: next, trimmed: next.length < list.length }
  for (let i = next.length - 1; i >= 0; i--) {
    if (!next[i].image) continue
    next = next.map((w, j) => (j === i ? { ...w, image: null, imageKind: null } : w))
    if (write(WARDROBE_KEY, next)) return { list: next, trimmed: true }
  }
  return { list: next, trimmed: true, failed: true }
}
