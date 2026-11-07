// 확장에서 쓰는 분석 한 번: 페이지 DOM + 프로필 → 화면에 보여줄 값.
// 추천은 웹 앱과 같은 generateFitComment를 그대로 씁니다.
import { parsePage } from './pageParser.js'
import { generateFitComment, describeEvidence, CONFIDENCE_LABEL } from './fitEngine.js'
import { CATEGORY_LABEL } from '../data/measurements.js'

const MIN_REVIEWS_WITHOUT_CHART = 3

export function analyzePage(root, pageUrl, profile) {
  const product = parsePage(root, pageUrl)
  if (!product) return { status: 'no-product', message: '상품 정보를 읽지 못했어요. 상품 상세 페이지에서 눌러주세요.' }

  // 사이즈표도 없고 참고할 리뷰도 거의 없으면 추천하지 않고 솔직하게 알립니다.
  if (!product.sizeChart && product.reviews.length < MIN_REVIEWS_WITHOUT_CHART) {
    return {
      status: 'no-data',
      name: product.name,
      message: '이 페이지에서 사이즈표와 충분한 리뷰를 찾지 못해 추천하지 않아요. 사이즈표나 리뷰를 펼친 뒤 다시 눌러보세요.',
      notes: product.notes,
    }
  }

  const result = generateFitComment(profile, product)
  const evidence = result.evidence ? describeEvidence(result.evidence, result.confidence) : null
  return {
    status: 'ok',
    name: product.name,
    categoryLabel: CATEGORY_LABEL[product.category] || '',
    recommendedSize: result.recommendedSize,
    confidence: result.confidence,
    confidenceLabel: CONFIDENCE_LABEL[result.confidence],
    summary: evidence?.summary || '',
    reasons: evidence?.reasons || [],
    headline: result.headline,
    body: result.body,
    note: result.note,
    notes: product.notes,
  }
}
