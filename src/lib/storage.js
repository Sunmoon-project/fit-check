// 브라우저(localStorage)에만 저장합니다. 서버로 보내지 않아요.
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
