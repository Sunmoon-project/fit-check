// 확장에서 쓰는 분석 한 번: 페이지 DOM + 프로필 → 화면에 보여줄 값.
// 추천은 웹 앱과 같은 generateFitComment를 그대로 씁니다.
import { parsePage, splitSentences, isProductPage, SENTENCE_LIMIT } from './pageParser.js'
import { collectDiagnostics, diagnosticLines } from './diagnose.js'
import { generateFitComment, describeEvidence, bodyValuesForProfile, CONFIDENCE_LABEL, FIT_LABEL } from './fitEngine.js'
import { compareSizes, compactCompare, MEASURE_ONLY_LABEL } from './sizeCompare.js'
// 사용자가 직접 적은 사이즈표: 열 이름(예: 어깨 가슴 총장)과 줄(예: M 50 57 68) → buildSizeChart 입력 모양.
// 저장하지 않고 이번 분석에만 씁니다. 잘못된 줄은 버려요.
export function manualChartRows(columnsText, linesText) {
  const cols = String(columnsText || '').split(/[\s,]+/).filter(Boolean).slice(0, 8)
  if (cols.length === 0) return []
  const rows = [['사이즈', ...cols]]
  for (const line of String(linesText || '').split(/\n/).slice(0, 20)) {
    const cells = line.trim().split(/[\s,]+/).filter(Boolean)
    if (cells.length === cols.length + 1) rows.push(cells.slice(0, 9))
  }
  return rows.length > 1 ? [rows] : []
}

import { CATEGORY_LABEL } from '../data/measurements.js'

export const NOT_PRODUCT_MESSAGE = '상품 상세 페이지가 아니에요. 무신사·29CM·W컨셉 같은 쇼핑몰에서 옷 한 벌의 상세 페이지를 열고 다시 눌러주세요. (목록·장바구니·검색 화면에서는 사이즈를 찾을 수 없어요.)'
const MIN_REVIEWS_WITHOUT_CHART = 3
const MAX_SHOWN = { matched: 50, others: 100 }

// 카드에서 "페이지에서 읽은 그대로"를 보여주기 위한 값. 이 브라우저 화면에만 쓰고 저장·전송하지 않아요.
// 읽지 못한 항목은 null로 남겨서 화면에서 '못 읽음'으로 표시합니다.
function reviewView(r, disp = (x) => x) {
  const v = r.view
  const allSent = v ? splitSentences(v.body, Infinity) : []
  const urls = (v?.photos || []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 5)
  return {
    text: String(v ? v.body : r.text || ''),
    nick: v?.nick || '',
    productName: v?.productName || '',
    body: v?.body || '',
    sentences: allSent.slice(0, SENTENCE_LIMIT),
    sentencesCut: allSent.length > SENTENCE_LIMIT,
    photos: urls,
    height: r.height ?? null,
    weight: r.weight ?? null,
    size: r.size ? disp(r.size) : null,
    gender: r.gender === 'male' || r.gender === 'female' ? r.gender : null,
    fit: r.fit ?? null,
    fitLabel: r.fit ? FIT_LABEL[r.fit] || null : null,
    similarity: Number.isFinite(r.similarity) ? r.similarity : null,
  }
}

// 옷장으로 보낼 때만 쓰는 값 (사용자가 '내 옷장으로 보내기'를 누를 때 wardrobeImport가 검사해서 담아요).
// 진단 리포트·기여 기록에는 쓰이지 않습니다.
function exportData(product, pageUrl, result) {
  let mall = ''
  try {
    mall = new URL(pageUrl).hostname.replace(/^www\./, '')
  } catch {
    mall = ''
  }
  const size = result.recommendedSize ?? null
  const key = size == null ? null : Object.keys(product.sizeChart?.measures || {}).find((k) => String(k).toUpperCase() === String(size).toUpperCase())
  return {
    mall,
    category: product.category,
    image: product.image || null,
    url: /^https?:\/\//i.test(pageUrl || '') ? pageUrl : '',
    size: size == null ? null : String(result.recommendedLabel || size),
    measures: key == null ? null : product.sizeChart.measures[key],
    verdicts: (result.verdicts || []).map((v) => ({ part: v.part, label: v.label, verdict: v.verdict, key: v.key, ease: v.ease })),
  }
}

// 사이즈 탭별 비교 표용 값: 내 치수(직접 입력/추정) vs 옷 실측 vs 여유 → 판정. 실측만 있는 부위는 그대로 표시해요.
function compareView(product, profile, result) {
  if (!product.sizeChart) return null
  try {
    const { values } = bodyValuesForProfile(profile)
    const cmp = compareSizes({ chart: product.sizeChart, bodyValues: values, measured: result.measured, category: product.category })
    return cmp.sizes.length ? { ...compactCompare(cmp), measureOnlyLabel: MEASURE_ONLY_LABEL, recommended: result.recommendedSize ?? null } : null
  } catch {
    return null
  }
}

export function analyzePage(root, pageUrl, profile, extVersion = '', opts = {}) {
  const product = parsePage(root, pageUrl, opts)
  if (!product) return { status: 'no-product', message: NOT_PRODUCT_MESSAGE }

  // 사이즈표도 없고 참고할 리뷰도 거의 없으면 추천하지 않고 솔직하게 알립니다.
  if (!product.sizeChart && product.reviews.length < MIN_REVIEWS_WITHOUT_CHART) {
    const diagnostics = collectDiagnostics(root, pageUrl, extVersion)
    return {
      status: 'no-data',
      name: product.name,
      // 상품 페이지로 보이지 않으면(구조화된 상품 정보도, 읽을 사이즈표도 없음) 먼저 그 점을 알려요. 상품 페이지가 맞는데 못 읽은 경우를 위해 직접 입력 양식은 그대로 둡니다.
      notProductPage: !isProductPage(root),
      message: isProductPage(root)
        ? '이 페이지에서 사이즈표와 충분한 리뷰를 찾지 못해 추천하지 않아요. 사이즈표가 이미지로 올라간 경우일 수 있어요. 사이즈표나 리뷰를 펼친 뒤 다시 눌러보세요.'
        : `${NOT_PRODUCT_MESSAGE} 상품 상세 페이지가 맞다면 사이즈표가 이미지로 올라간 경우일 수 있어요. 사이즈표를 펼친 뒤 다시 누르거나 아래에서 직접 입력해주세요.`,
      details: diagnosticLines(diagnostics),
      diagnostics,
      notes: product.notes,
    }
  }

  const result = generateFitComment(profile, product)
  // 사이즈표의 표시 이름('1 (M)')이 있으면 그 이름으로 보여줍니다.
  const disp = (x) => product.sizeChart?.display?.[String(x).replace(/\s/g, '').toUpperCase()] || x
  const view = (r) => reviewView(r, disp)
  const evidence = result.evidence ? describeEvidence(result.evidence, result.confidence) : null
  return {
    status: 'ok',
    name: product.name,
    categoryLabel: CATEGORY_LABEL[product.category] || '',
    recommendedSize: result.recommendedSize,
    recommendedLabel: result.recommendedLabel,
    reviewsLoaded: product.reviews.length,
    reviewTotalOnPage: product.reviewTotalOnPage ?? null,
    sizeChartMissing: !product.sizeChart,
    diagnostics: collectDiagnostics(root, pageUrl, extVersion),
    reviewViews: {
      matched: (result.matched || []).slice(0, MAX_SHOWN.matched).map(view),
      others: (result.otherReviews || []).slice(0, MAX_SHOWN.others).map(view),
      me: { gender: profile.gender === 'male' || profile.gender === 'female' ? profile.gender : null, height: profile.height, weight: profile.weight },
      matchedTotal: (result.matched || []).length,
      othersTotal: (result.otherReviews || []).length,
    },
    exportData: exportData(product, pageUrl, result),
    compareView: compareView(product, profile, result),
    chartView: product.sizeChart?.view ? { ...product.sizeChart.view, recommended: result.recommendedSize ?? null } : null,
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
