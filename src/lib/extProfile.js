// 크롬 확장의 체형 입력 → 핏 엔진이 읽는 프로필. 순수 함수라 테스트할 수 있어요.
export const EXT_PROFILE_KEY = 'fitcheckProfile'

const MEASURE_KEYS = ['shoulder', 'chest', 'waist', 'hip', 'thigh', 'arm', 'leg', 'footLength']

/** 폼 값(문자열) → 프로필. 잘못된 값이면 { error }. */
export function buildProfile(form) {
  const gender = form.gender === 'female' ? 'female' : form.gender === 'male' ? 'male' : ''
  if (!gender) return { error: '성별을 골라주세요.' }
  const height = Number(form.height)
  const weight = Number(form.weight)
  if (!(height >= 130 && height <= 220)) return { error: '키는 130~220cm 사이로 입력해주세요.' }
  if (!(weight >= 30 && weight <= 200)) return { error: '몸무게는 30~200kg 사이로 입력해주세요.' }
  const preferredFit = ['slim', 'regular', 'relaxed'].includes(form.preferredFit) ? form.preferredFit : 'regular'
  const measurements = {}
  for (const k of MEASURE_KEYS) {
    const raw = form.measurements?.[k]
    if (raw === '' || raw == null) continue
    const v = Number(raw)
    if (Number.isFinite(v) && v > 0) measurements[k] = v
  }
  // 발볼은 선택 항목이에요. 없거나 알 수 없는 값이면 저장하지 않아요(예전 프로필과 호환).
  const footWidth = ['narrow', 'normal', 'wide'].includes(form.footWidth) ? form.footWidth : ''
  return { profile: { gender, height, weight, preferredFit, usual: { top: '', bottom: '' }, measurements, ...(footWidth ? { footWidth } : {}) } }
}

/** 저장된 프로필이 쓸 만한지 */
export function isUsableProfile(p) {
  return !!p && typeof p === 'object' && !buildProfile({ ...p, measurements: p.measurements }).error
}
