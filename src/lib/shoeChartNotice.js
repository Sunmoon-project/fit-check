// 사용자가 고른 종류와 사이즈표(mm 신발표 ↔ 옷 실측표)가 맞지 않을 때의 정책. 확장 카드와 웹 결과 화면이 같은 함수를 씁니다.
// 고른 종류는 존중하되, 신발 mm 표·옵션은 옷 실측 비교에 쓰지 않고(발길이 열 제외) 이유와 되돌리기 칩을 알려요.
import { CATEGORY_LABEL } from '../data/measurements.js'

export const SHOE_CHART_NOT_SHOES_MESSAGE = '신발 사이즈표라 이 종류로는 실측 비교를 하지 않아요'
export const CLOTHING_CHART_AS_SHOES_MESSAGE = '옷 사이즈표라 신발로는 발길이 비교를 하지 않아요'
export const SHOE_REVERT_LABEL = '신발로 다시 보기'
const FOOT_PARTS = ['footLength', 'footWidth']

const hasFootColumn = (chart) => !!chart?.measures && Object.values(chart.measures).some((m) => m && FOOT_PARTS.some((p) => p in m))

/** 신발 상품인가: 신발로 분류됐거나, mm 사이즈표·발길이 열·신발 옵션 범위가 있으면 신발이에요. product는 '고르기 전' 원래 모양이어야 해요. */
export function isShoeProduct(product) {
  if (!product) return false
  const chart = product.sizeChart
  return product.category === 'shoes' || chart?.category === 'shoes' || chart?.unit === 'mm' || hasFootColumn(chart) || (product.shoeOptionLabels || []).length > 0
}

/**
 * @param product  고르기 전 상품 ({ category, sizeChart, shoeOptionLabels })
 * @param chosen   사용자가 고른 종류 키 (없으면 null)
 * @returns {{ kind: 'shoe-chart-not-shoes'|'clothing-chart-as-shoes', message: string, actionCategory: string, actionLabel: string }|null}
 */
export function shoeChartNotice(product, chosen) {
  if (!product || !chosen || !CATEGORY_LABEL[chosen]) return null
  const shoe = isShoeProduct(product)
  if (shoe && chosen !== 'shoes') {
    return { kind: 'shoe-chart-not-shoes', message: SHOE_CHART_NOT_SHOES_MESSAGE, actionCategory: 'shoes', actionLabel: SHOE_REVERT_LABEL }
  }
  if (!shoe && chosen === 'shoes' && product.category && product.category !== 'shoes' && CATEGORY_LABEL[product.category]) {
    return { kind: 'clothing-chart-as-shoes', message: CLOTHING_CHART_AS_SHOES_MESSAGE, actionCategory: product.category, actionLabel: `${CATEGORY_LABEL[product.category]}로 다시 보기` }
  }
  return null
}

/** 안내가 있을 때 비교에 쓸 사이즈표: 신발표는 발길이·발볼을 빼고(남는 실측이 없으면 표 없음), 옷표를 신발로 고른 경우는 쓰지 않아요. */
export function chartForNotice(chart, notice) {
  if (!notice || !chart) return chart
  if (notice.kind === 'clothing-chart-as-shoes') return null
  if (chart.category === 'shoes' || chart.unit === 'mm') return null
  if (!hasFootColumn(chart)) return chart
  const measures = {}
  for (const [size, m] of Object.entries(chart.measures)) {
    const rest = Object.fromEntries(Object.entries(m || {}).filter(([p]) => !FOOT_PARTS.includes(p)))
    if (Object.keys(rest).length) measures[size] = rest
  }
  return Object.keys(measures).length ? { ...chart, measures } : null
}
