// 사용자가 고른 카테고리로 상품 정보를 다시 만들어요 (웹 결과 화면용).
// 원래 읽은 사이즈표 줄을 새 카테고리 기준으로 다시 해석하고, 분류는 '직접 선택'으로 표시합니다.
import { buildSizeChart, CATEGORY_EMOJI } from './productCore.js'
import { shoeChartNotice, chartForNotice } from './shoeChartNotice.js'
import { CATEGORY_ORDER, userChosen, categoryInfo } from './categoryClassifier.js'

export function recategorizeProduct(product, category) {
  if (!product || !CATEGORY_ORDER.includes(category)) return product
  if (product.category === category && product.categoryOverridden) return product
  let sizeChart = product.sizeChart
  if (category !== product.category && sizeChart?.headers && sizeChart?.rows) {
    const rebuilt = buildSizeChart([[sizeChart.headers, ...sizeChart.rows]], category)
    if (rebuilt) sizeChart = { ...sizeChart, unit: rebuilt.unit, headers: rebuilt.headers, rows: rebuilt.rows, measures: rebuilt.measures }
  }
  // 신발 mm 표를 옷 종류로, 옷 표를 신발로 고른 경우: 고른 종류는 따르되 맞지 않는 표는 비교에 쓰지 않고 안내해요.
  const notice = shoeChartNotice(product, category)
  sizeChart = chartForNotice(sizeChart, notice)
  const cls = userChosen(category, { candidates: product.categoryCandidates })
  return {
    ...product,
    categoryNotice: notice,
    category,
    emoji: CATEGORY_EMOJI[category],
    sizeChart,
    categoryConfidence: 'high',
    categoryEvidence: categoryInfo(cls).evidence,
    categoryCandidates: cls.candidates,
    categoryOverridden: true,
  }
}
