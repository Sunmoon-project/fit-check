// 착용 기록 → 익명 기여 레코드 변환 (순수 함수). 스키마 설명: docs/후기데이터_설계.md
// 상품명, URL 전체, 사진, 정확한 키·몸무게는 절대 포함하지 않아요.
export const SCHEMA_VERSION = 1

const RESULTS = ['small', 'true', 'large']

// 키 5cm 구간 (예: 172 → "170-174"), 몸무게 5kg 구간 (예: 63 → "60-64")
export function toBand(value, step) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  const lo = Math.floor(n / step) * step
  return `${lo}-${lo + step - 1}`
}

// URL에서 도메인만 남겨요. 경로·쿼리·계정 정보는 버립니다.
// IP, localhost, 사설·예약 호스트, 예시(데모) 도메인은 null이에요. 소규모 사설 호스트가 준식별자가 되는 걸 막기 위해서예요.
// 공개 접미사 목록으로 정규화하거나 허용 도메인 목록을 두는 건 서버 전송 전에 따로 해야 해요(docs/후기데이터_설계.md).
const RESERVED_TLDS = ['localhost', 'local', 'internal', 'lan', 'home', 'corp', 'test', 'example', 'invalid', 'onion']
const EXAMPLE_HOSTS = ['example.com', 'example.org', 'example.net']
export function toDomain(url) {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
    if (!h || !h.includes('.') || h.includes(':') || h.startsWith('[')) return null
    if (/^\d+(\.\d+)*$/.test(h)) return null // IPv4
    if (RESERVED_TLDS.includes(h.split('.').pop())) return null
    if (EXAMPLE_HOSTS.some((e) => h === e || h.endsWith(`.${e}`))) return null
    return h
  } catch {
    return null
  }
}

// 같은 상품·사이즈를 수정해 다시 저장할 때 대기열에서 이전 기록을 바꾸기 위한 로컬 전용 키예요.
// 서버로 보내는 레코드에는 들어가지 않아요(상품 주소 원문도 저장하지 않고 해시만 써요).
export function contributionKey(feedback) {
  if (!feedback) return null
  let base = String(feedback.url || '')
  try {
    const u = new URL(base)
    base = `${u.hostname}${u.pathname}`
  } catch {
    // URL이 아니면 원문 그대로 해시
  }
  const s = `${base}\u0000${feedback.category}\u0000${feedback.size}`
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

const SHAPE_AXES = ['shoulder', 'belly', 'lower']
function pickShape(shape) {
  if (!shape || typeof shape !== 'object') return null
  const out = {}
  for (const k of SHAPE_AXES) if (typeof shape[k] === 'string') out[k] = shape[k]
  return out
}

function toMonth(ts) {
  const d = new Date(Number.isFinite(ts) ? ts : Date.now())
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// 부위별 여유(cm)를 2cm 단위로 반올림
function roundParts(parts) {
  const out = {}
  for (const [k, v] of Object.entries(parts || {})) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v / 2) * 2
  }
  return out
}

// consented가 true가 아니거나 필수 값이 없으면 null.
// feedback: { url, productName, category, size, result, returned, parts, savedAt } (기존 형식 그대로)
// profile: { gender, height, weight, shape, preferredFit, ... }
export function toContribution(feedback, profile, consented) {
  if (consented !== true || !feedback || !profile) return null
  if (!RESULTS.includes(feedback.result) || !feedback.size || !feedback.category) return null
  const heightBand = toBand(profile.height, 5)
  const weightBand = toBand(profile.weight, 5)
  if (!heightBand || !weightBand) return null
  // 공개 쇼핑몰 도메인을 알 수 없으면(데모·사설 호스트·잘못된 주소) 기여 대상에서 빼요.
  const domain = toDomain(feedback.url)
  if (!domain) return null
  return {
    schemaVersion: SCHEMA_VERSION,
    month: toMonth(feedback.savedAt),
    domain,
    category: String(feedback.category),
    size: String(feedback.size),
    result: feedback.result,
    returned: Boolean(feedback.returned),
    parts: roundParts(feedback.parts),
    body: {
      gender: profile.gender === 'male' || profile.gender === 'female' ? profile.gender : null,
      heightBand,
      weightBand,
      shape: pickShape(profile.shape),
      preferredFit: profile.preferredFit || null,
    },
  }
}
