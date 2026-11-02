// 체형 매칭 + 핏 예측 로직 (규칙 기반, 데모용)
// 문서상 실제 서비스에서는 LLM이 후기 텍스트를 요약하지만,
// 프로토타입에서는 설명 가능한 간단한 규칙으로 "AI 핏 코멘트"를 흉내냅니다.
import { CATEGORY_MEASUREMENTS } from '../data/measurements.js'

// 두 체형(키/몸무게) 사이의 유사도 → 거리 기반 점수(0~100)
export function bodySimilarity(profile, review) {
  const dh = Math.abs(profile.height - review.height) // cm
  const dw = Math.abs(profile.weight - review.weight) // kg
  // 키 1cm, 몸무게 1kg 차이에 가중치. 체형 핏에는 몸무게 영향이 더 큼
  const distance = dh * 0.6 + dw * 1.0
  const score = Math.max(0, Math.round(100 - distance * 2.2))
  return score
}

// 내 체형과 비슷한 후기만 추려 유사도 순으로 반환
export function matchReviews(profile, reviews, threshold = 55) {
  return reviews
    .map((r) => ({ ...r, similarity: bodySimilarity(profile, r) }))
    .sort((a, b) => b.similarity - a.similarity)
    .filter((r) => r.similarity >= threshold)
}

// 비슷한 체형 후기들의 핏 투표를 종합해 사이즈별 경향을 집계
export function aggregateFit(matched) {
  // 후기가 몰린 대표 사이즈 찾기
  const bySize = {}
  for (const r of matched) {
    if (!bySize[r.size]) bySize[r.size] = { small: 0, true: 0, large: 0, count: 0, weight: 0 }
    const w = r.similarity / 100 // 유사도 가중
    bySize[r.size][r.fit] += w
    bySize[r.size].count += 1
    bySize[r.size].weight += w
  }
  return bySize
}

// 사용자 상세 치수 ↔ 사이즈표 치수 대조
// 각 사이즈에 대해 "모든 치수가 들어가는지(여유/부족)"를 평가해 적합도 점수를 계산.
// 반환: 사이즈별 { size, score, tightFields, looseFields } + 최적 사이즈
export function matchByMeasurements(measurements, product) {
  const chart = product.sizeChart
  if (!measurements || !chart?.measures) return null

  const results = []
  for (const [size, m] of Object.entries(chart.measures)) {
    let penalty = 0
    const tightFields = [] // 사용자 치수가 옷보다 커서 끼는 항목
    const looseFields = [] // 옷이 너무 커서 헐렁한 항목
    let compared = 0

    for (const key of Object.keys(m)) {
      const userVal = measurements[key]
      if (userVal == null) continue
      const garmentVal = m[key]
      compared += 1
      // 여유분(ease) = 옷 치수 - 내 치수. 양수면 여유, 음수면 꽉 낌
      const ease = garmentVal - userVal
      // 발 사이즈/길이 계열은 작은 차이도 민감, 둘레 계열은 어느 정도 여유 필요
      const isLength = /length|inseam|arm|foot/i.test(key)
      if (isLength) {
        if (ease < -5) { tightFields.push(key); penalty += Math.abs(ease) * 1.2 }
        else if (ease > 8) { looseFields.push(key); penalty += (ease - 8) * 0.4 }
        else penalty += Math.abs(ease) * 0.2
      } else {
        // 둘레: 약간의 여유(2~8cm)가 이상적
        if (ease < 0) { tightFields.push(key); penalty += Math.abs(ease) * 1.5 }
        else if (ease > 12) { looseFields.push(key); penalty += (ease - 12) * 0.5 }
        else penalty += Math.max(0, 2 - ease) * 0.3
      }
    }

    const score = compared === 0 ? 0 : Math.max(0, Math.round(100 - penalty * 2))
    results.push({ size, score, tightFields, looseFields, compared })
  }

  results.sort((a, b) => b.score - a.score)
  return { bestSize: results[0]?.size ?? null, perSize: results }
}

// AI 핏 코멘트 생성 (후기 종합 + 사이즈표 대조 흉내)
export function generateFitComment(profile, product) {
  const matched = matchReviews(profile, product.reviews)
  const measureResult = matchByMeasurements(profile.measurements, product)

  if (matched.length === 0) {
    // 후기는 부족해도 상세 치수가 있으면 치수 대조로 추천
    if (measureResult && measureResult.bestSize) {
      const best = measureResult.perSize[0]
      return {
        matched,
        measureResult,
        recommendedSize: measureResult.bestSize,
        confidence: best.score >= 80 ? 'medium' : 'low',
        headline: `${measureResult.bestSize} 사이즈를 추천해요`,
        body: `입력한 실측 사이즈로 비교했어요. ${describeMeasureFit(best, product)}`,
        note: '비슷한 체형의 후기가 적어 실측 비교 위주로 판단했어요. 후기가 쌓이면 더 정확해져요.',
      }
    }
    return {
      matched,
      measureResult,
      recommendedSize: null,
      confidence: 'low',
      headline: '아직 추천이 어려워요',
      body: '나와 비슷한 체형의 후기가 충분하지 않아요. 아래 사이즈표를 참고하고, 평소 즐겨 입는 핏으로 골라보세요.',
      note: '후기가 쌓이면 더 정확한 추천을 받을 수 있어요.',
    }
  }

  const bySize = aggregateFit(matched)
  // 가장 많은 가중치가 쌓인 사이즈를 추천 후보로
  const sizes = Object.entries(bySize).sort((a, b) => b[1].weight - a[1].weight)
  const [topSize, stat] = sizes[0]

  const smallVotes = stat.small
  const trueVotes = stat.true
  const largeVotes = stat.large
  const total = smallVotes + trueVotes + largeVotes || 1

  let tendency = 'true'
  if (smallVotes > trueVotes && smallVotes >= largeVotes) tendency = 'small'
  else if (largeVotes > trueVotes && largeVotes >= smallVotes) tendency = 'large'

  // 신뢰도: 비슷한 체형 후기 수 + 최고 유사도
  const topSim = matched[0].similarity
  let confidence = 'low'
  if (matched.length >= 3 && topSim >= 75) confidence = 'high'
  else if (matched.length >= 2 && topSim >= 65) confidence = 'medium'

  const sizeList = product.sizeChart.rows.map((r) => r[0])
  const topIdx = sizeList.indexOf(topSize)

  let recommendedSize = topSize
  let adjust = ''
  if (tendency === 'small' && topIdx < sizeList.length - 1) {
    recommendedSize = sizeList[topIdx + 1]
    adjust = `${topSize}가 작다는 후기가 많아 한 치수 큰 ${recommendedSize}를 추천해요.`
  } else if (tendency === 'large' && topIdx > 0) {
    recommendedSize = sizeList[topIdx - 1]
    adjust = `${topSize}가 크다는 후기가 있어, 딱 맞게 입으려면 ${recommendedSize}도 좋아요.`
  }

  const headline =
    confidence === 'high'
      ? `${recommendedSize} 사이즈를 추천해요`
      : `${recommendedSize} 사이즈가 무난해요`

  const pct = Math.round((Math.max(smallVotes, trueVotes, largeVotes) / total) * 100)
  const tendencyText =
    tendency === 'small'
      ? '작게 나온다'
      : tendency === 'large'
      ? '크게 나온다'
      : '정사이즈다'

  let body =
    `나와 비슷한 체형의 후기 ${matched.length}건 중 ${pct}%가 ${tendencyText}고 느꼈어요. ` +
    (adjust || `보통 체형이라면 ${recommendedSize}를 가장 많이 선택했어요.`)

  // 상세 치수 대조 결과를 덧붙여 교차 검증
  if (measureResult && measureResult.bestSize) {
    const best = measureResult.perSize[0]
    if (measureResult.bestSize === recommendedSize) {
      body += ` 입력한 실측 사이즈로 봐도 ${recommendedSize}가 가장 잘 맞아요.`
      if (best.score >= 80 && confidence !== 'high') confidence = 'high'
    } else {
      body += ` 다만 실측 사이즈만 보면 ${measureResult.bestSize}가 더 가까워요. ${describeMeasureFit(best, product)}`
    }
  }

  return {
    matched,
    measureResult,
    recommendedSize,
    confidence,
    tendency,
    headline,
    body,
    note: '후기와 사이즈표를 종합한 참고용 추천이에요. 원단 소재와 착용감에 따라 다를 수 있어요.',
  }
}

// 특정 사이즈의 치수 적합도를 사람이 읽을 문장으로
function describeMeasureFit(sizeResult, product) {
  const labelMap = getFieldLabelMap(product.category)
  const parts = []
  if (sizeResult.tightFields.length) {
    const names = sizeResult.tightFields.map((k) => labelMap[k] || k).join('·')
    parts.push(`${names}은 다소 타이트할 수 있어요`)
  }
  if (sizeResult.looseFields.length) {
    const names = sizeResult.looseFields.map((k) => labelMap[k] || k).join('·')
    parts.push(`${names}은 여유 있게 맞아요`)
  }
  if (parts.length === 0) return '주요 치수가 잘 맞아요.'
  return parts.join(', ') + '.'
}

// 카테고리의 치수 key→라벨 매핑 (measurements.js와 동일 라벨 사용)
function getFieldLabelMap(category) {
  const def = CATEGORY_MEASUREMENTS[category]
  const map = {}
  if (def) for (const f of def.fields) map[f.key] = f.label
  return map
}

export const CONFIDENCE_LABEL = {
  high: { text: '추천 정확도 높음', color: '#2f7a53' },
  medium: { text: '추천 정확도 보통', color: '#a86a1f' },
  low: { text: '참고용', color: '#8a8a8a' },
}

export const FIT_LABEL = {
  small: '작아요',
  true: '잘 맞아요',
  large: '커요',
}
