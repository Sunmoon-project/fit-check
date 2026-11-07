// 내 체형과 후기 작성자 체형을 항목별로 비교합니다 (순수 함수, 웹과 확장 프로그램이 같이 써요).
// 유사도 숫자는 fitEngine의 bodySimilarity를 그대로 써서 어디서나 똑같이 나옵니다.
import { BODY_SIM, bodySimilarity } from './fitEngine.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const asGender = (g) => (g === 'male' || g === 'female' ? g : null)
const clamp01 = (v) => Math.min(1, Math.max(0, v))

// 1에 가까울수록 비슷해요. BODY_SIM의 가중치와 기울기를 그대로 써서 유사도와 같은 기준이에요.
function closeness(diff, weight) {
  return clamp01(1 - (diff * weight * BODY_SIM.slope) / 100)
}

function measure(mine, theirs, weight) {
  if (!isNum(mine) || !isNum(theirs)) return { me: isNum(mine) ? mine : null, review: isNum(theirs) ? theirs : null, diff: null, fill: 0 }
  const diff = Math.abs(mine - theirs)
  return { me: mine, review: theirs, diff, fill: closeness(diff, weight) }
}

export function compareBody(profile, review) {
  const me = asGender(profile?.gender)
  const theirs = asGender(review?.gender)
  const state = me && theirs ? (me === theirs ? 'same' : 'diff') : 'unknown'
  return {
    gender: { me, review: theirs, state },
    height: measure(profile?.height, review?.height, BODY_SIM.heightWeight),
    weight: measure(profile?.weight, review?.weight, BODY_SIM.weightWeight),
    similarity: bodySimilarity(profile || {}, review || {}),
  }
}

// 유사도 구간: 비슷한 체형 기준(BODY_SIM.threshold) 이상이면 high, 절반 이상이면 mid, 그 아래는 low (막대 색 구분용)
export function similarityTier(sim) {
  if (!isNum(sim)) return 'low'
  return sim >= BODY_SIM.threshold ? 'high' : sim >= BODY_SIM.threshold / 2 ? 'mid' : 'low'
}
export const TIER_LABEL = { high: '비슷한 체형', mid: '조금 달라요', low: '많이 달라요' }

// '키 3cm · 몸무게 2kg 차이' (차이를 알 수 없으면 null)
export function diffText(c) {
  if (!isNum(c?.height?.diff) || !isNum(c?.weight?.diff)) return null
  const r = (n) => Math.round(n * 10) / 10
  return `키 ${r(c.height.diff)}cm · 몸무게 ${r(c.weight.diff)}kg 차이`
}

// 숫자가 0에서 target까지 올라가는 값 (easeOutCubic). 항상 정수이고 0~target 범위에 있어요.
export function countUpValue(elapsedMs, durationMs, target) {
  const end = isNum(target) ? Math.max(0, Math.round(target)) : 0
  if (!isNum(elapsedMs) || !isNum(durationMs) || durationMs <= 0 || elapsedMs >= durationMs) return end
  if (elapsedMs <= 0) return 0
  const t = elapsedMs / durationMs
  const eased = 1 - (1 - t) ** 3
  return Math.min(end, Math.max(0, Math.round(end * eased)))
}
