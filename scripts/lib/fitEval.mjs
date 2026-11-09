// 성공 기준 지표 측정 (순수 함수). npm run eval:fit 이 이 파일을 써요. 네트워크·파일 접근 없음.
//
// 사용자가 정한 성공 기준:
//  (1) '확신 높음' 판정의 적중률 90~95% 이상, (2) 적용 범위(전체 중 확신 높음을 준 비율)를 함께 공개,
//  (3) 추천 사이즈 ±1 사이즈 적중률 90% 이상, 그리고 '항상 정사이즈(맞음)라고 답하는 기준선'과 비교.
//
// 방법: 후기를 시드 고정 k-fold로 나눠 한 묶음씩 떼어 두고, 떼어 둔 후기를 뺀 나머지로 학습값 묶음(learnedModel)을 만든 뒤,
// 떼어 둔 후기 작성자의 체형(키·몸무게·성별)과 구매 사이즈로 핏 라벨(small/true/large)을 예측해 실제 라벨과 비교해요.
//
// 아래 숫자(확신 높음의 여유 기준, 표본 부족 기준 등)는 설계상의 판단이고, 어떤 실제 데이터로 정해진 값이 아니에요.
// 이 파일은 지표를 계산할 뿐이에요. 실제 정확도를 측정했다는 뜻이 아니에요(측정 결과는 입력 데이터가 실제일 때만 의미가 있어요).
import { EASE_RULES, bodyValuesForProfile, recommendSize } from '../../src/lib/fitEngine.js'
import { trainModel, resolveLearned, brandKeyOf } from '../../src/lib/learnedModel.js'
import { toSamples } from '../../src/lib/learnSamples.js'
import { regionKeyOf } from '../../src/lib/brandRegion.js'
import { confusionMatrix, accuracy, precisionRecall, LABELS } from './fitMetrics.mjs'

export const EVAL = Object.freeze({
  folds: 5,
  seed: 20240601,
  highMargin: 2, // 확신 높음: 모든 비교 부위가 판정 경계에서 이만큼(cm) 이상 떨어져 있을 때
  minParts: 2, // 확신 높음: 비교할 수 있는 부위가 이 개수 이상일 때
  minTotal: 50, // 평가한 후기가 이보다 적으면 판정 보류
  minHigh: 30, // 확신 높음 판정이 이보다 적으면 90% 판정 보류
  minSize: 30, // ±1 평가 건수가 이보다 적으면 판정 보류
  minSizes: 4, // 사이즈가 이보다 적은 상품은 ±1이 거의 항상 맞아서 ±1 평가에서 뺌
  targetHigh: 0.9,
  stretchHigh: 0.95,
  targetSize: 0.9,
  minSupport: 10, // 라벨별 실제 건수가 이보다 적으면 그 라벨의 precision/recall에 경고
})

export const DEMO_NOTE = '합성 데이터, 실제 정확도 아님'

const COMPARE_PARTS = ['shoulder', 'chest', 'waist', 'hip', 'thigh', 'arm'] // 둘레·너비 부위(기장과 신발 제외)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const normKey = (s) => String(s ?? '').replace(/\s/g, '').toUpperCase()
const tokenOf = (k) => (k.match(/^\d{1,2}\(([^)]+)\)$/) || [])[1] || null
const FITS = ['small', 'true', 'large']
const EVAL_CATEGORIES = ['top', 'bottom', 'outer', 'dress']

// ---------- 통계 ----------
/** Wilson 신뢰구간(기본 95%). n이 0이면 null. */
export function wilson(k, n, z = 1.96) {
  if (!(n > 0)) return null
  const p = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) }
}

/** 비율 한 칸: { k, n, rate, ci } */
export function ratio(k, n) {
  return { k, n, rate: n > 0 ? k / n : null, ci: wilson(k, n) }
}

// ---------- 시드 고정 난수·분할 ----------
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 단위 n개를 k개 묶음(fold)에 나눠요. 같은 시드면 같은 결과, 단위 하나는 정확히 한 묶음에만 들어가요. */
export function assignFolds(n, k, seed = EVAL.seed) {
  const rnd = mulberry32(seed)
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const folds = new Array(n)
  order.forEach((unit, rank) => { folds[unit] = rank % k })
  return folds
}

// ---------- 예측 ----------
/**
 * 부위별 여유분(e) → 핏 라벨 예측과 확신 여부.
 * 부위별로 학습값(없으면 EASE_RULES)의 snug·relaxed 경계(+브랜드/지역 오프셋)와 비교해요.
 *  - 한 부위라도 snug 미만이면 small, 모든 부위가 relaxed 이상이면 large, 아니면 true
 *  - margin = 판정을 뒤집으려면 필요한 여유분(cm). small은 가장 작은 부위가 snug에서 떨어진 정도,
 *    large는 가장 작은 부위가 relaxed를 넘은 정도, true는 모든 부위가 [snug, relaxed) 안쪽으로 경계에서 떨어진 정도
 *  - high(확신 높음) = 비교 부위가 minParts개 이상이고 margin ≥ highMargin
 */
export function predictFromEase(e, learned = null, opts = {}) {
  const highMargin = opts.highMargin ?? EVAL.highMargin
  const off = learned?.offset || 0
  const parts = COMPARE_PARTS.filter((p) => isNum(e?.[p]))
  if (parts.length === 0) return { label: null, margin: null, high: false, parts: 0 }
  const rows = parts.map((p) => {
    const rule = learned?.rules?.[p] || EASE_RULES[p]
    return { ease: e[p], snug: rule.snug + off, relaxed: rule.relaxed + off }
  })
  const smalls = rows.filter((r) => r.ease < r.snug)
  let label
  let margin
  if (smalls.length) {
    label = 'small'
    margin = Math.max(...smalls.map((r) => r.snug - r.ease))
  } else if (rows.every((r) => r.ease >= r.relaxed)) {
    label = 'large'
    margin = Math.min(...rows.map((r) => r.ease - r.relaxed))
  } else {
    label = 'true'
    margin = Math.min(...rows.map((r) => Math.min(r.ease - r.snug, r.relaxed - r.ease)))
  }
  return { label, margin, high: parts.length >= (opts.minParts ?? EVAL.minParts) && margin >= highMargin, parts: parts.length }
}

// ---------- 사이즈 순서·±1 ----------
/** 사이즈표의 사이즈 순서(행 순서 우선, fitEngine.chartSizes와 같은 규칙). */
export function sizeOrderOf(sizeChart) {
  if (!sizeChart) return []
  const fromRows = (sizeChart.rows || []).map((r) => String(r[0]).toUpperCase())
  const fromMeasures = Object.keys(sizeChart.measures || {}).map((s) => String(s).toUpperCase())
  return [...new Set([...fromRows, ...fromMeasures])]
}

/** 이름이 사이즈 순서 안에서 몇 번째인지(없으면 -1). '1(M)' 같은 표기도 'M'으로 찾아요. */
export function sizeIndex(order, name) {
  if (name == null) return -1
  const k = normKey(name)
  const i = order.findIndex((s) => normKey(s) === k)
  return i >= 0 ? i : order.findIndex((s) => tokenOf(normKey(s)) === k)
}

/** 추천 사이즈가 정답 사이즈의 ±tolerance칸 안에 있는지. 둘 중 하나라도 순서에 없으면 null(평가 불가). */
export function withinSizes(order, predicted, actual, tolerance = 1) {
  const a = sizeIndex(order, predicted)
  const b = sizeIndex(order, actual)
  if (a < 0 || b < 0) return null
  return Math.abs(a - b) <= tolerance
}

function chartKeyFor(measures, size) {
  const k = normKey(size)
  return Object.keys(measures).find((c) => normKey(c) === k) ?? Object.keys(measures).find((c) => tokenOf(normKey(c)) === k) ?? null
}

// ---------- 입력 해석 ----------
/** 평가할 수 있는 후기인지(라벨·사이즈·키·몸무게·성별이 있고 사이즈표에서 그 사이즈 실측을 찾을 수 있음). */
export function eligibleReview(product, r) {
  if (!product || !EVAL_CATEGORIES.includes(product.category) || !product.sizeChart?.measures) return false
  if (!r || !FITS.includes(r.fit) || r.size == null || !isNum(r.height) || !isNum(r.weight)) return false
  if (r.gender !== 'male' && r.gender !== 'female') return false
  const key = chartKeyFor(product.sizeChart.measures, r.size)
  return key != null && !!product.sizeChart.measures[key]
}

/**
 * JSON 객체 → 평가 입력. 후기 모음({ products: [...] })이면 mode 'reviews', 학습 샘플 내보내기({ samples: [...] } 또는 배열)이면 'samples'.
 * @returns {{ mode: 'reviews', products: object[] } | { mode: 'samples', samples: object[] } | { error: string }}
 */
export function parseEvalInput(obj) {
  if (obj && Array.isArray(obj.products)) return { mode: 'reviews', products: obj.products }
  const list = Array.isArray(obj) ? obj : Array.isArray(obj?.samples) ? obj.samples : null
  if (list) {
    const samples = list.filter((s) => s && FITS.includes(s.label) && s.e && typeof s.e === 'object' && typeof s.cat === 'string')
    return { mode: 'samples', samples, skipped: list.length - samples.length }
  }
  return { error: '평가 데이터 모양을 알 수 없어요. { "products": [...] } (후기 단위) 또는 학습 샘플 내보내기 파일({ "samples": [...] })이어야 해요. docs/평가_핏정확도.md를 보세요.' }
}

// ---------- 지표 ----------
export function summarizeLabels(records) {
  const n = records.length
  const matrix = confusionMatrix(records.map((r) => ({ actual: r.actual, predicted: r.predicted })))
  const hit = (r) => r.actual === r.predicted
  const high = records.filter((r) => r.high)
  const priorHigh = records.filter((r) => r.priorHigh)
  const alwaysTrue = (list) => list.filter((r) => r.actual === 'true').length
  return {
    n,
    accuracy: ratio(records.filter(hit).length, n),
    matrix,
    precisionRecall: precisionRecall(matrix),
    high: ratio(high.filter(hit).length, high.length),
    coverage: ratio(high.length, n),
    // '항상 정사이즈(맞음)'라고 답하는 기준선: 전체, 그리고 같은 확신 높음 부분집합에서
    baselineAll: ratio(alwaysTrue(records), n),
    baselineHigh: ratio(alwaysTrue(high), high.length),
    // 학습값 없이 현재 규칙(EASE_RULES)만 쓴 결과
    prior: {
      accuracy: ratio(records.filter((r) => r.actual === r.priorPredicted).length, n),
      high: ratio(priorHigh.filter((r) => r.actual === r.priorPredicted).length, priorHigh.length),
      coverage: ratio(priorHigh.length, n),
    },
    learnedApplied: ratio(records.filter((r) => r.learnedApplied).length, n),
  }
}

export function summarizeSizes(records) {
  const n = records.length
  const count = (f) => records.filter(f).length
  return {
    n,
    within1: ratio(count((r) => r.hit), n),
    exact: ratio(count((r) => r.exact), n),
    priorWithin1: ratio(count((r) => r.priorHit), n),
    // 기준선: 사이즈표의 가운데 사이즈를 항상 추천
    baselineWithin1: ratio(count((r) => r.baselineHit), n),
  }
}

// ---------- 평가 실행 ----------
function foldUnits(items, groupBy, folds, seed) {
  // review: 후기 하나가 단위, product: 상품 하나가 단위(같은 상품의 후기는 한 묶음에 같이 들어가요)
  if (groupBy === 'product') {
    const ids = [...new Set(items.map((it) => it.pi))]
    const f = assignFolds(ids.length, folds, seed)
    const byProduct = new Map(ids.map((id, i) => [id, f[i]]))
    return items.map((it) => byProduct.get(it.pi))
  }
  return assignFolds(items.length, folds, seed)
}

/**
 * 후기 단위 평가: 떼어 둔 후기를 뺀 나머지로 학습값을 만들고, 떼어 둔 후기의 체형·구매 사이즈로 예측해 비교해요.
 * @param {object[]} products { category, brand?, url?, sizeChart: { measures }, reviews: [{ size, fit, height, weight, gender }] }
 * @param {{ folds?: number, seed?: number, groupBy?: 'review'|'product', highMargin?: number }} opts
 */
export function evaluateReviews(products, opts = {}) {
  const folds = Math.max(2, Math.floor(opts.folds ?? EVAL.folds))
  const seed = opts.seed ?? EVAL.seed
  const groupBy = opts.groupBy === 'product' ? 'product' : 'review'
  const list = Array.isArray(products) ? products : []
  const items = []
  list.forEach((p, pi) => (p?.reviews || []).forEach((r, ri) => { if (eligibleReview(p, r)) items.push({ pi, ri }) }))
  const foldOf = foldUnits(items, groupBy, folds, seed)

  const labelRecords = []
  const sizeRecords = []
  const foldInfo = []
  let skippedSmallCharts = 0
  for (let f = 0; f < folds; f++) {
    const held = items.filter((_, i) => foldOf[i] === f)
    if (held.length === 0) continue
    const heldKeys = new Set(held.map((it) => `${it.pi}:${it.ri}`))
    const heldProducts = new Set(groupBy === 'product' ? held.map((it) => it.pi) : [])
    // 떼어 둔 후기를 뺀 나머지로 학습(상품 단위 분할이면 그 상품의 후기를 전부 뺌)
    const trainProducts = list.map((p, pi) => ({
      ...p,
      reviews: heldProducts.has(pi) ? [] : (p?.reviews || []).filter((_, ri) => !heldKeys.has(`${pi}:${ri}`)),
    }))
    const samples = trainProducts.flatMap((p) => toSamples(p, { now: 0, pageUrl: p.url || '' }))
    const model = trainModel(samples, EASE_RULES, 0)
    foldInfo.push({ fold: f, test: [...heldKeys], trainSamples: samples.length })

    for (const it of held) {
      const p = list[it.pi]
      const r = p.reviews[it.ri]
      const url = p.url || ''
      const learned = resolveLearned(model, p.category, brandKeyOf({ ...p, url }), regionKeyOf(p, url))
      const body = bodyValuesForProfile({ gender: r.gender, height: r.height, weight: r.weight }).values
      const measures = p.sizeChart.measures[chartKeyFor(p.sizeChart.measures, r.size)]
      const e = {}
      for (const part of COMPARE_PARTS) if (isNum(measures[part]) && isNum(body[part])) e[part] = Math.round((measures[part] - body[part]) * 2) / 2
      const withLearned = predictFromEase(e, learned, opts)
      if (withLearned.label == null) continue
      const prior = predictFromEase(e, null, opts)
      labelRecords.push({
        actual: r.fit,
        predicted: withLearned.label,
        high: withLearned.high,
        margin: withLearned.margin,
        priorPredicted: prior.label,
        priorHigh: prior.high,
        learnedApplied: !!learned?.applied,
      })

      // 추천 사이즈 ±1: '맞음' 후기의 구매 사이즈를 정답으로 봐요. 사이즈가 너무 적은 상품은 ±1이 거의 항상 맞아서 뺍니다.
      if (r.fit !== 'true') continue
      const order = sizeOrderOf(p.sizeChart)
      if (order.length < EVAL.minSizes) { skippedSmallCharts += 1; continue }
      const recLearned = recommendSize(body, p.sizeChart, p.category, 'regular', {}, learned)
      const recPrior = recommendSize(body, p.sizeChart, p.category, 'regular', {}, null)
      const hit = withinSizes(order, recLearned?.bestSize, r.size)
      if (hit == null) continue
      sizeRecords.push({
        hit,
        exact: withinSizes(order, recLearned.bestSize, r.size, 0),
        priorHit: withinSizes(order, recPrior?.bestSize, r.size) === true,
        baselineHit: withinSizes(order, order[Math.floor((order.length - 1) / 2)], r.size) === true,
      })
    }
  }
  const productCount = new Set(items.map((it) => it.pi)).size
  return {
    mode: 'reviews',
    params: { folds, seed, groupBy, highMargin: opts.highMargin ?? EVAL.highMargin },
    products: productCount,
    eligible: items.length,
    ineligible: list.reduce((n, p) => n + (p?.reviews?.length || 0), 0) - items.length,
    folds: foldInfo,
    label: summarizeLabels(labelRecords),
    size: sizeRecords.length ? summarizeSizes(sizeRecords) : { n: 0, reason: '평가할 수 있는 ‘맞음’ 후기가 없어요(또는 사이즈가 적은 상품만 있어요).' },
    skippedSmallCharts,
  }
}

/**
 * 학습 샘플 평가(여유분 기반): 샘플에는 키·몸무게·사이즈 이름이 없어서 라벨 예측만 평가하고 ±1 사이즈는 평가할 수 없어요.
 * @param {object[]} samples { cat, brand, region?, label, w, e: { 부위: 여유분 } }
 */
export function evaluateSamples(samples, opts = {}) {
  const folds = Math.max(2, Math.floor(opts.folds ?? EVAL.folds))
  const seed = opts.seed ?? EVAL.seed
  const list = (Array.isArray(samples) ? samples : []).filter((s) => s && FITS.includes(s.label) && s.e && typeof s.cat === 'string')
  const foldOf = assignFolds(list.length, folds, seed)
  const records = []
  const foldInfo = []
  for (let f = 0; f < folds; f++) {
    const heldIdx = list.map((_, i) => i).filter((i) => foldOf[i] === f)
    if (heldIdx.length === 0) continue
    const heldSet = new Set(heldIdx)
    const train = list.filter((_, i) => !heldSet.has(i)).map((s) => ({ ...s, w: isNum(s.w) && s.w > 0 ? s.w : 1 }))
    const model = trainModel(train, EASE_RULES, 0)
    foldInfo.push({ fold: f, test: heldIdx.map(String), trainSamples: train.length })
    for (const i of heldIdx) {
      const s = list[i]
      const learned = resolveLearned(model, s.cat, s.brand || null, s.region || null)
      const withLearned = predictFromEase(s.e, learned, opts)
      if (withLearned.label == null) continue
      const prior = predictFromEase(s.e, null, opts)
      records.push({
        actual: s.label,
        predicted: withLearned.label,
        high: withLearned.high,
        margin: withLearned.margin,
        priorPredicted: prior.label,
        priorHigh: prior.high,
        learnedApplied: !!learned?.applied,
      })
    }
  }
  return {
    mode: 'samples',
    params: { folds, seed, groupBy: 'review', highMargin: opts.highMargin ?? EVAL.highMargin },
    eligible: list.length,
    folds: foldInfo,
    label: summarizeLabels(records),
    size: { n: 0, reason: '학습 샘플에는 키·몸무게·구매 사이즈 이름이 없어서 추천 사이즈 ±1 적중률은 평가할 수 없어요.' },
    skippedSmallCharts: 0,
  }
}

// ---------- 판정 ----------
/**
 * 목표(확신 높음 ≥90%, ±1 ≥90%, 기준선 초과) 판정. 표본이 부족하면 해당 항목과 전체를 '판정 보류'로 둬요.
 * 점추정만 비교하고, 신뢰구간 하한이 목표 아래이면 그 사실을 함께 적어요.
 * @returns {{ status: 'met'|'unmet'|'hold', checks: {id, state: 'pass'|'fail'|'hold', text: string}[], warnings: string[] }}
 */
export function judge(result, opts = {}) {
  const th = { ...EVAL, ...opts }
  const L = result.label
  const S = result.size
  const warnings = []
  if (L.n < th.minTotal) warnings.push(`평가한 후기가 ${L.n}건으로 적어요(${th.minTotal}건 미만). 수치가 크게 흔들릴 수 있어요.`)
  for (const l of LABELS) {
    const sup = L.precisionRecall[l].support
    if (sup < th.minSupport) warnings.push(`실제 라벨 ‘${l}’이 ${sup}건뿐이라 이 라벨의 precision/recall은 믿기 어려워요.`)
  }
  if (L.n > 0 && L.baselineAll.rate >= 0.6) warnings.push(`‘항상 정사이즈’ 기준선 정확도가 ${pct(L.baselineAll.rate)}로 높아요. 라벨이 정사이즈에 쏠린 데이터라 정확도만으로는 판단하기 어려워요.`)

  const checks = []
  const lowerNote = (r, target) => (r.ci && r.ci.lo < target ? ` (신뢰구간 하한 ${pct(r.ci.lo)}은 목표 미만)` : '')

  // (1) 확신 높음 적중률
  if (L.high.n < th.minHigh) {
    checks.push({ id: 'high', state: 'hold', text: `‘확신 높음’ 적중률 ${th.targetHigh * 100}% 이상: 판정 보류 (확신 높음 판정이 ${L.high.n}건으로 ${th.minHigh}건 미만)` })
  } else {
    const ok = L.high.rate >= th.targetHigh
    const stretch = L.high.rate >= th.stretchHigh ? ' · 95% 이상도 넘음' : ' · 95%에는 못 미침'
    checks.push({ id: 'high', state: ok ? 'pass' : 'fail', text: `‘확신 높음’ 적중률 ${th.targetHigh * 100}% 이상: ${ok ? '충족' : '미달'} (${pct(L.high.rate)}, 적용 범위 ${pct(L.coverage.rate)}${ok ? stretch : ''})${ok ? lowerNote(L.high, th.targetHigh) : ''}` })
  }
  // (3) ±1 사이즈
  if (!S.within1) {
    checks.push({ id: 'size', state: 'hold', text: `추천 사이즈 ±1 적중률 ${th.targetSize * 100}% 이상: 판정 보류 (${S.reason})` })
  } else if (S.n < th.minSize) {
    checks.push({ id: 'size', state: 'hold', text: `추천 사이즈 ±1 적중률 ${th.targetSize * 100}% 이상: 판정 보류 (평가 ${S.n}건으로 ${th.minSize}건 미만)` })
  } else {
    const ok = S.within1.rate >= th.targetSize
    checks.push({ id: 'size', state: ok ? 'pass' : 'fail', text: `추천 사이즈 ±1 적중률 ${th.targetSize * 100}% 이상: ${ok ? '충족' : '미달'} (${pct(S.within1.rate)})${ok ? lowerNote(S.within1, th.targetSize) : ''}` })
  }
  // 기준선 초과: 전체 정확도와, 확신 높음 부분집합 적중률이 모두 ‘항상 정사이즈’보다 높아야 해요.
  if (L.n < th.minTotal || L.high.n < th.minHigh) {
    checks.push({ id: 'baseline', state: 'hold', text: '‘항상 정사이즈’ 기준선 초과: 판정 보류 (표본 부족)' })
  } else {
    const ok = L.accuracy.rate > L.baselineAll.rate && L.high.rate > L.baselineHigh.rate
    checks.push({
      id: 'baseline',
      state: ok ? 'pass' : 'fail',
      text: `‘항상 정사이즈’ 기준선 초과: ${ok ? '초과' : '못 넘음'} (전체 ${pct(L.accuracy.rate)} vs ${pct(L.baselineAll.rate)}, 확신 높음 ${pct(L.high.rate)} vs ${pct(L.baselineHigh.rate)})`,
    })
  }
  const status = checks.some((c) => c.state === 'fail') ? 'unmet' : checks.some((c) => c.state === 'hold') ? 'hold' : 'met'
  return { status, checks, warnings }
}

export const STATUS_TEXT = { met: '목표 달성', unmet: '목표 미달', hold: '판정 보류' }

// ---------- 출력 ----------
export const pct = (v) => (v == null ? '-' : `${(v * 100).toFixed(1)}%`)
const ci = (r) => (r?.ci ? `[95% 구간 ${pct(r.ci.lo)}~${pct(r.ci.hi)}]` : '')
const cell = (r) => `${pct(r.rate)} (${r.k}/${r.n}) ${ci(r)}`.trim()

/** 보고서 줄 목록. demo면 맨 위와 맨 아래에 ‘합성 데이터, 실제 정확도 아님’을 반드시 넣어요. */
export function formatReport(result, { demo = false, source = '' } = {}) {
  const L = result.label
  const S = result.size
  const j = judge(result)
  const out = []
  const banner = `※ ${DEMO_NOTE} (합성 데이터로 파이프라인만 확인한 결과예요)`
  if (demo) out.push(banner, '')
  out.push('핏체크 성공 기준 지표 (npm run eval:fit)')
  if (source) out.push(`입력: ${source}`)
  const p = result.params
  out.push(`방법: 시드 ${p.seed} 고정 ${p.folds}-fold, ${p.groupBy === 'product' ? '상품 단위' : '후기 단위'}로 떼어 두고 나머지로 학습값을 만들어 예측 (확신 높음 = 비교 부위 ${EVAL.minParts}개 이상이고 모든 경계에서 ${p.highMargin}cm 이상 떨어짐)`)
  if (result.mode === 'reviews') out.push(`표본: 상품 ${result.products}개, 평가한 후기 ${L.n}건 (평가 못 하는 후기 ${result.ineligible}건 제외)`)
  else out.push(`표본: 학습 샘플 ${result.eligible}건 (여유분 기반 평가, 평가한 ${L.n}건)`)
  if (result.mode === 'samples') out.push('※ 한계: 학습 샘플은 키·몸무게·사이즈 이름이 없어서 부위별 여유분으로만 평가했고, 추천 사이즈 ±1은 평가하지 않았어요. 같은 상품의 후기가 학습과 평가에 섞여 있어 낙관적일 수 있어요.')
  out.push('')
  for (const w of j.warnings) out.push(`⚠ ${w}`)
  if (j.warnings.length) out.push('')

  out.push('[1] 핏 라벨 예측 (학습값 사용)')
  out.push(`  ‘확신 높음’ 적중률: ${L.high.n ? cell(L.high) : '-  (확신 높음 판정 0건)'}`)
  out.push(`  적용 범위(전체 중 확신 높음 비율): ${cell(L.coverage)}`)
  out.push(`  전체 정확도: ${cell(L.accuracy)}`)
  out.push(`  ‘항상 정사이즈’ 기준선: 전체 ${cell(L.baselineAll)} · 확신 높음 부분 ${L.baselineHigh.n ? cell(L.baselineHigh) : '-'}`)
  out.push(`  학습값 없는 현재 규칙: 전체 ${cell(L.prior.accuracy)} · 확신 높음 ${L.prior.high.n ? cell(L.prior.high) : '-'} · 범위 ${cell(L.prior.coverage)}`)
  out.push(`  학습값이 실제로 적용된 비율: ${cell(L.learnedApplied)}`)
  out.push('  혼동행렬 (행=실제, 열=예측)      small   true  large')
  for (const a of LABELS) out.push(`    ${a.padEnd(8)}${' '.repeat(18)}${LABELS.map((q) => String(L.matrix[a][q]).padStart(6)).join(' ')}`)
  for (const l of LABELS) {
    const pr = L.precisionRecall[l]
    out.push(`  ${l}: precision ${pct(pr.precision)} · recall ${pct(pr.recall)} (실제 ${pr.support}건)`)
  }
  out.push('')
  out.push('[2] 추천 사이즈 ±1 (‘맞음’ 후기의 구매 사이즈를 정답으로)')
  if (S.within1) {
    out.push(`  ±1 적중률: ${cell(S.within1)}`)
    out.push(`  정확히 같은 사이즈: ${cell(S.exact)}`)
    out.push(`  학습값 없는 현재 규칙 ±1: ${cell(S.priorWithin1)}`)
    out.push(`  기준선(사이즈표 가운데 사이즈 항상 추천) ±1: ${cell(S.baselineWithin1)}`)
    if (result.skippedSmallCharts) out.push(`  (사이즈가 ${EVAL.minSizes}개 미만인 상품의 ${result.skippedSmallCharts}건은 ±1이 거의 항상 맞아서 뺐어요)`)
  } else {
    out.push(`  평가 못 함: ${S.reason}`)
  }
  out.push('')
  out.push(`[3] 목표 판정: ${STATUS_TEXT[j.status]}${demo ? ' (합성 데이터 기준이며 실제 달성이 아님)' : ''}`)
  for (const c of j.checks) out.push(`  ${c.state === 'pass' ? '✓' : c.state === 'fail' ? '✗' : '–'} ${c.text}`)
  out.push('')
  out.push('※ 이 수치는 입력 데이터 안에서 잰 값이에요. 라벨 잡음·표본 수·편향(데이터가 어디서 왔는지) 때문에 실제 사용자의 정확도를 보증하지 않아요. 자세한 한계는 docs/평가_핏정확도.md를 보세요.')
  if (demo) out.push('', banner)
  return out
}

export const USAGE = [
  '사용법: npm run eval:fit -- --file <평가데이터.json> [--folds 5] [--seed 20240601] [--by review|product] [--margin 2]',
  '        npm run eval:fit -- --demo            (합성 데이터로 파이프라인만 확인, 실제 정확도 아님)',
  '평가 데이터 모양(후기 단위 또는 학습 샘플 내보내기 파일)은 docs/평가_핏정확도.md에 있어요.',
]
export const NO_DATA_MESSAGE = '실제 데이터가 없어 측정하지 않았어요.'

// ---------- 합성 데이터 (--demo 전용, 실제 쇼핑몰 데이터가 아니에요) ----------
/**
 * 시드 고정 합성 후기 모음. 브랜드마다 ‘작게/크게 나오는 정도’를 숨겨 두고, 핏 라벨은 그 값과 개인 취향 잡음, 라벨 잡음으로 만들어요.
 * 파이프라인이 끝까지 도는지 확인하는 용도이고, 여기서 나온 수치는 실제 정확도와 무관해요.
 */
export function makeDemoDataset(seed = EVAL.seed, { products = 24, reviewsPer = 40, labelNoise = 0.06 } = {}) {
  const rnd = mulberry32(seed)
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd())
  const sizes = ['S', 'M', 'L', 'XL', 'XXL']
  const out = []
  for (let pi = 0; pi < products; pi++) {
    const shift = [-4, 0, 4][pi % 3] // 브랜드가 작게(-)/크게(+) 나오는 정도(숨은 값)
    const base = 100 + Math.round(rnd() * 8)
    const measures = {}
    sizes.forEach((s, i) => {
      measures[s] = { shoulder: 44 + i * 2 + Math.round(rnd()), chest: base + i * 6, arm: 60 + i * 1.5 }
    })
    const reviews = []
    for (let ri = 0; ri < reviewsPer; ri++) {
      const gender = rnd() < 0.55 ? 'male' : 'female'
      const height = Math.round((gender === 'male' ? 176 : 163) + gauss() * 6)
      const weight = Math.round(((gender === 'male' ? 23.5 : 21) + gauss() * 2.5) * (height / 100) ** 2)
      const body = bodyValuesForProfile({ gender, height, weight }).values
      let best = 0
      let bestGap = Infinity
      sizes.forEach((s, i) => {
        const gap = Math.abs(measures[s].chest - body.chest - 10)
        if (gap < bestGap) { best = i; bestGap = gap }
      })
      const idx = Math.max(0, Math.min(sizes.length - 1, best + Math.round(gauss() * 0.9)))
      const size = sizes[idx]
      // 사람마다 다른 취향(공통 잡음)에 부위별 잡음을 더한 ‘체감 여유분’으로 라벨을 만들어요(예측기의 부위 규칙과 같은 모양).
      const personal = gauss() * 1.5 - shift
      const felt = ['shoulder', 'chest', 'arm'].map((part) => ({ part, v: measures[size][part] - body[part] + personal + gauss() * 0.8 }))
      let fit = felt.some((x) => x.v < EASE_RULES[x.part].snug) ? 'small' : felt.every((x) => x.v >= EASE_RULES[x.part].relaxed - 3) ? 'large' : 'true'
      if (rnd() < labelNoise) fit = FITS[Math.floor(rnd() * 3)]
      reviews.push({ size, fit, height, weight, gender })
    }
    out.push({ id: `demo-${pi}`, category: 'top', brand: `demo-brand-${pi % 6}`, sizeChart: { measures }, reviews })
  }
  return { schemaVersion: 1, kind: 'fit-eval-reviews', synthetic: true, products: out }
}
