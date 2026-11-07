// 사용자가 고른 카테고리로 상품 정보를 다시 만들어요 (웹 결과 화면용).
// 원래 읽은 사이즈표 줄을 새 카테고리 기준으로 다시 해석하고, 분류는 '직접 선택'으로 표시합니다.
import { buildSizeChart, CATEGORY_EMOJI } from './productCore.js'
import { CATEGORY_ORDER, userChosen, categoryInfo } from './categoryClassifier.js'

export function recategorizeProduct(product, category) {
  if (!product || !CATEGORY_ORDER.includes(category)) return product
  if (product.category === category && product.categoryOverridden) return product
  let sizeChart = product.sizeChart
  if (sizeChart?.headers && sizeChart?.rows) {
    const rebuilt = buildSizeChart([[sizeChart.headers, ...sizeChart.rows]], category)
    if (rebuilt) sizeChart = { ...sizeChart, unit: rebuilt.unit, headers: rebuilt.headers, rows: rebuilt.rows, measures: rebuilt.measures }
  }
  const cls = userChosen(category, { candidates: product.categoryCandidates })
  return {
    ...product,
    category,
    emoji: CATEGORY_EMOJI[category],
    sizeChart,
    categoryConfidence: 'high',
    categoryEvidence: categoryInfo(cls).evidence,
    categoryCandidates: cls.candidates,
    categoryOverridden: true,
  }
}
