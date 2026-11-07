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
export function toDomain(url) {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return h || null
  } catch {
    return null
  }
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
  return {
    schemaVersion: SCHEMA_VERSION,
    month: toMonth(feedback.savedAt),
    domain: toDomain(feedback.url),
    category: String(feedback.category),
    size: String(feedback.size),
    result: feedback.result,
    returned: Boolean(feedback.returned),
    parts: roundParts(feedback.parts),
    body: {
      gender: profile.gender === 'male' || profile.gender === 'female' ? profile.gender : null,
      heightBand,
      weightBand,
      shape: profile.shape && typeof profile.shape === 'object' ? { ...profile.shape } : null,
      preferredFit: profile.preferredFit || null,
    },
  }
}
