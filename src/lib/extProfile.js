// 크롬 확장의 체형 입력 → 핏 엔진이 읽는 프로필. 순수 함수라 테스트할 수 있어요.
export const EXT_PROFILE_KEY = 'fitcheckProfile'

const MEASURE_KEYS = ['shoulder', 'chest', 'waist', 'hip', 'thigh', 'arm', 'footLength']

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
  return { profile: { gender, height, weight, preferredFit, usual: { top: '', bottom: '' }, measurements } }
}

/** 저장된 프로필이 쓸 만한지 */
export function isUsableProfile(p) {
  return !!p && typeof p === 'object' && !buildProfile({ ...p, measurements: p.measurements }).error
}
