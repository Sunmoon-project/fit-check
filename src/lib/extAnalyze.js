// 확장에서 쓰는 분석 한 번: 페이지 DOM + 프로필 → 화면에 보여줄 값.
// 추천은 웹 앱과 같은 generateFitComment를 그대로 씁니다.
import { parsePage, splitSentences, isProductPage, SENTENCE_LIMIT } from './pageParser.js'
import { collectDiagnostics, diagnosticLines } from './diagnose.js'
import { generateFitComment, describeEvidence, bodyValuesForProfile, CONFIDENCE_LABEL, FIT_LABEL } from './fitEngine.js'
import { compareSizes, compactCompare } from './sizeCompare.js'
import { summarizeSizeChart } from './sizeSummary.js'
import { targetGenderNotice } from './targetGender.js'
import { shoeViewFor, shoeComment, feelSizeText } from './shoeFit.js'
import { resolveLearned, brandKeyOf } from './learnedModel.js'
import { classifyBrandRegion, regionInputOf, regionLine } from './brandRegion.js'
import { toSamples } from './learnSamples.js'
import { chartRecordFromProduct } from './sizeChartDb.js'
import { usedSiteOf, readListing, listingText } from './usedListing.js'
import { analyzeUsedListing } from './usedAnalyze.js'
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
    // 이상치로 제외된 후기는 지우지 않고 '제외됨(사유)'로 보여줘요. 라벨 이상치는 가중치만 줄였다는 표시.
    excluded: r.excluded ? { text: String(r.excluded.text || ''), reasons: [...(r.excluded.reasons || [])] } : null,
    labelReduced: r.labelReduced === true,
    shoe: shoeReviewView(r),
  }
}

// 신발 리뷰의 구매 옵션·체감·발볼 (신발 리뷰가 아니면 null)
function shoeReviewView(r) {
  const f = r.view?.shoeFeel
  if (!f) return null
  return {
    option: r.view.option || '',
    sizeFeel: f.size ? feelSizeText(f) : null,
    width: f.width ? { narrow: '좁음', normal: '적당', wide: '넓음' }[f.width] : null,
    extras: (f.extras || []).slice(0, 6).map((e) => ({ label: e.label, value: e.value })),
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
function compareView(product, profile, result, learned = null) {
  if (!product.sizeChart) return { view: null, failed: false }
  try {
    const values = result.bodyValues || bodyValuesForProfile(profile).values
    const cmp = compareSizes({ chart: product.sizeChart, bodyValues: values, measured: result.measured, category: product.category, learned, reviewParts: result.reviewParts })
    return { view: cmp.sizes.length ? { ...compactCompare(cmp), recommended: result.recommendedSize ?? null } : null, failed: false }
  } catch {
    return { view: null, failed: true }
  }
}

// 번개장터·후르츠패밀리 같은 중고 판매글: 후기가 없다는 전제로 판매글 글(실측·사이즈 표기)과 사이즈표 DB(opts.usedChartMatches)로 판정해요.
// 진단 리포트에는 건수만 담아요. 이 사이트들의 실제 페이지는 확인하지 못했어요(일반 규칙으로 읽어요).
function analyzeUsedPage(root, pageUrl, profile, extVersion, opts, site) {
  const listing = readListing(root)
  const empty = !listing.title && !listing.bodyText && !listing.description
  if (empty) {
    return {
      status: 'no-data',
      usedSite: true,
      message: '이 중고 판매글에서 제목이나 설명을 읽지 못했어요. 페이지가 다 열린 뒤 다시 눌러보거나, 핏체크 웹 앱의 중고 상품 분석에 판매글을 붙여넣어 주세요.',
      diagnostics: collectDiagnostics(root, pageUrl, extVersion, { used: { basis: 'none', siteKnown: true } }),
    }
  }
  const out = analyzeUsedListing({ ...listing, text: listingText(listing) }, profile, { chartMatches: opts.usedChartMatches || [], pageUrl, site })
  out.diagnostics = collectDiagnostics(root, pageUrl, extVersion, { used: { ...out.counts, basis: out.basis, siteKnown: true } })
  return out
}

export function analyzePage(root, pageUrl, profile, extVersion = '', opts = {}) {
  const usedSite = usedSiteOf(pageUrl)
  if (usedSite) return analyzeUsedPage(root, pageUrl, profile, extVersion, opts, usedSite)
  const product = parsePage(root, pageUrl, opts)
  if (!product) return { status: 'no-product', message: NOT_PRODUCT_MESSAGE }

  // 사이즈표도 없고 참고할 리뷰도 거의 없으면 추천하지 않고 솔직하게 알립니다.
  // 신발은 사이즈표 없이 옵션 범위(예: '250 (250-255)')와 발길이만으로도 비교할 수 있어 이 조건을 통과시켜요.
  const canCompareShoe = product.category === 'shoes' && !!shoeViewFor(product, profile)
  if (!product.sizeChart && product.reviews.length < MIN_REVIEWS_WITHOUT_CHART && !canCompareShoe) {
    const diagnostics = collectDiagnostics(root, pageUrl, extVersion, { categoryOverride: opts.categoryOverride })
    return {
      status: 'no-data',
      name: product.name,
      categoryNotice: product.categoryNotice || null,
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

  // 학습값 묶음(opts.learned)은 선택이에요. 없으면 기존 동작 그대로입니다. 브랜드 키는 상품 주소의 알려진 쇼핑몰 도메인에서 가져와요.
  const learnBrand = brandKeyOf({ ...product, url: product.url || pageUrl })
  if (learnBrand) product.learnBrand = learnBrand
  product.regionUrl = pageUrl // 브랜드 지역 판단의 도메인 근거 (product.url이 없을 때만 쓰여요)
  const result = generateFitComment(profile, product, {}, opts.learned || null)
  const regionKey = result.regionInfo && result.regionInfo.region !== 'unknown' ? result.regionInfo.region : null
  const learned = opts.learned ? resolveLearned(opts.learned, product.category, learnBrand, regionKey) : null
  const shoe = canCompareShoe ? shoeViewFor(product, profile) : null
  const cmpView = shoe ? { view: null, failed: false } : compareView(product, profile, result, learned)
  // 사이즈표의 표시 이름('1 (M)')이 있으면 그 이름으로 보여줍니다.
  const disp = (x) => product.sizeChart?.display?.[String(x).replace(/\s/g, '').toUpperCase()] || x
  const view = (r) => reviewView(r, disp)
  const shoeText = shoe ? shoeComment(shoe) : null
  const evidence = result.evidence ? describeEvidence(result.evidence, result.confidence) : null
  return {
    status: 'ok',
    name: product.name,
    categoryLabel: CATEGORY_LABEL[product.category] || '',
    category: product.category,
    categoryConfidence: product.categoryConfidence,
    categoryEvidence: product.categoryEvidence,
    categoryCandidates: (product.categoryCandidates || []).map((c) => ({ key: c, label: CATEGORY_LABEL[c] || c })),
    categoryOverridden: product.categoryOverridden === true,
    categoryNotice: product.categoryNotice || null,
    recommendedSize: shoe ? (shoe.recommended ? String(shoe.recommended.mm) : null) : result.recommendedSize,
    recommendedLabel: shoe ? (shoe.recommended ? shoe.recommended.label : null) : result.recommendedLabel,
    reviewsLoaded: product.reviews.length,
    reviewTotalOnPage: product.reviewTotalOnPage ?? null,
    sizeChartMissing: !product.sizeChart,
    diagnostics: collectDiagnostics(root, pageUrl, extVersion, { compareFailed: cmpView.failed, categoryOverride: opts.categoryOverride }),
    reviewViews: {
      matched: (result.matched || []).slice(0, MAX_SHOWN.matched).map(view),
      others: (result.otherReviews || []).slice(0, MAX_SHOWN.others).map(view),
      isShoes: !!shoe,
      me: { gender: profile.gender === 'male' || profile.gender === 'female' ? profile.gender : null, height: profile.height, weight: profile.weight },
      matchedTotal: (result.matched || []).length,
      othersTotal: (result.otherReviews || []).length,
      excluded: (result.excludedReviews || []).slice(0, MAX_SHOWN.others).map(view),
      excludedTotal: (result.excludedReviews || []).length,
    },
    exportData: exportData(product, pageUrl, result),
    // 학습값 사용 상태({ used, total, categorySamples, text })와, 요청했을 때만 이 상품 후기에서 만든 학습 샘플(개인 식별 정보 없음)
    learning: result.learning || null,
    // 사이즈표를 읽은 경우에만 사이즈표 모음에 저장할 입력(후기·체형 없음). 요청했을 때만 만들어요.
    chartRecord: opts.collectSamples ? chartRecordFromProduct(product, { pageUrl }) : null,
    learnSamples: opts.collectSamples ? toSamples(product, { pageUrl }) : [],
    compareView: cmpView.view,
    shoeView: shoe,
    // 상품 대상 성별이 프로필 성별과 다를 때만 { gender, text, mismatch } (옷에도 같은 함수)
    targetGender: shoe ? shoe.targetGender : targetGenderNotice(product.targetGender, profile.gender),
    sizeSummary: shoe ? null : summarizeSizeChart({ sizes: cmpView.view?.sizes, recommended: result.recommendedSize, category: product.category }),
    chartView: product.sizeChart?.view ? { ...product.sizeChart.view, recommended: result.recommendedSize ?? null } : null,
    // 신발은 확신도도 신발 결과(발길이 직접 입력 여부, 허용 사이즈 유무)로 정해요.
    confidence: shoeText ? shoeText.confidence : result.confidence,
    confidenceLabel: shoeText ? shoeText.confidenceLabel : CONFIDENCE_LABEL[result.confidence],
    // 신발은 옷용 문구('무난해요', '슬림 핏 기준')를 쓰지 않고 신발 판정에서 만든 글을 써요.
    summary: shoeText ? shoeText.summary : evidence?.summary || '',
    reasons: shoeText ? shoeText.reasons : evidence?.reasons || [],
    // 자세한 근거 줄(후기 건수·제외, 학습값·샘플 수, 브랜드/지역 보정, 부위별 여유분). 신발은 지역 줄만 있어요.
    details: shoeText ? [regionLine(result.regionInfo)].filter(Boolean) : evidence?.details || [],
    regionInfo: result.regionInfo ? { region: result.regionInfo.region, label: result.regionInfo.label, confidence: result.regionInfo.confidence, line: regionLine(result.regionInfo) } : null,
    sizeSystem: result.sizeSystem || null,
    headline: shoeText ? shoeText.headline : result.headline,
    body: shoeText ? shoeText.body : result.body,
    note: shoeText ? shoeText.note : result.note,
    notes: product.notes,
  }
}
