// 직접 재지 않은 둘레 치수를 비슷한 체형 후기로 보정해요 (순수 함수).
// 후기 한 건의 역산값 = 그 사람이 산 사이즈의 옷 실측 − 핏 평가에 맞는 여유분.
//   정사이즈 → 적당 구간 가운데, 작아요 → 타이트 쪽, 커요 → 넉넉 쪽 여유분을 뺍니다.
// 역산값(유사도 가중 평균)을 키·몸무게 공식 추정값과 섞고, 공식값에서 MAX_SHIFT 넘게 옮기지 않아요.
// 직접 잰 부위, 기장, 신발은 건드리지 않아요. 후기는 각자 취향으로 평가하니 휴리스틱이에요.

export const REVIEW_EST_PARTS = ['shoulder', 'chest', 'waist', 'hip', 'thigh']
const PRIOR_WEIGHT = 2 // 공식 추정값을 후기 몇 건(유사도 100%)만큼 믿을지
const MIN_REVIEWS = 2
const MAX_SHIFT = 6 // cm

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const half = (v) => Math.round(v * 2) / 2

/**
 * values: 공식 추정 + 직접 입력 치수, measured: Set(직접 잰 부위), reviews: 비슷한 체형 후기(size·fit·similarity),
 * measuresOf(size) → 그 사이즈의 실측 { part: cm }, rules: EASE_RULES (학습값이 있으면 그 기준)
 * @returns {{ values, reviewParts: { [part]: { n, from } } }}
 */
export function reviewBodyEstimate({ values, measured, reviews, measuresOf, rules }) {
  const out = { ...values }
  const reviewParts = {}
  for (const part of REVIEW_EST_PARTS) {
    const r = rules?.[part]
    if (!r || measured?.has(part) || !isNum(values[part])) continue
    const target = { small: (r.tight + r.snug) / 2, true: (r.snug + r.regular) / 2, large: (r.regular + r.relaxed) / 2 }
    let sum = 0
    let w = 0
    let n = 0
    for (const rv of reviews || []) {
      if (rv.size == null || !(rv.fit in target)) continue
      const g = measuresOf(rv.size)?.[part]
      if (!isNum(g)) continue
      const wt = ((rv.similarity ?? 50) / 100) * (rv.labelWeight ?? 1)
      if (!(wt > 0)) continue
      sum += (g - target[rv.fit]) * wt
      w += wt
      n += 1
    }
    if (n < MIN_REVIEWS) continue
    const blended = (values[part] * PRIOR_WEIGHT + sum) / (PRIOR_WEIGHT + w)
    const shift = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, blended - values[part]))
    out[part] = half(values[part] + shift)
    reviewParts[part] = { n, from: values[part] }
  }
  return { values: out, reviewParts }
}
