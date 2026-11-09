// 체형 매칭 + 핏 예측 로직 (규칙 기반)
// 1) 사이즈표 실측 ↔ 내 신체 치수(직접 입력 또는 추정)의 여유분(ease)으로 부위별 판정
// 2) 나와 키·몸무게가 비슷한 사람의 후기 투표
// 두 근거를 합쳐 사이즈를 추천합니다. 결과는 참고용이에요.
import { PART_LABEL, CATEGORY_PARTS } from '../data/measurements.js'
import { estimateBody } from './bodyEstimate.js'
import { detectReviewOutliers } from './reviewOutliers.js'
import { resolveLearned, learningStatus, brandKeyOf } from './learnedModel.js'
import { classifyBrandRegion, regionInputOf, regionLine } from './brandRegion.js'
import { sizeSystemHint } from './sizeSystems.js'

// ---------- 신발 허용 구간 (휴리스틱) ----------
// d = 신발 사이즈(mm) - 발길이(mm). 브랜드/라스트마다 달라서 정확한 값이 아니라 일반적인 착용감을 바탕으로 한 기준이에요.
// -5 <= d < 0 애매, 0 <= d <= 5 딱 맞음, 5 < d <= 10 여유, 그 밖(d < -5 또는 d > 10)은 부적합.
// 발 270이면 265 애매, 270/275 딱 맞음, 280 여유, 260 이하 / 285 이상 부적합.
// 신발 판정은 이 상수와 classifyShoeEase 한 곳만 쓰고, 옷장·추천·사이즈 비교가 모두 같은 기준을 써요.
export const SHOE_WINDOW = Object.freeze({ minEase: -5, fitMaxEase: 5, maxEase: 10 })
export const SHOE_VERDICTS = [
  { key: 'unfit', label: '부적합', lengthLabel: '부적합', side: 'small' },
  { key: 'iffy', label: '애매', lengthLabel: '애매' },
  { key: 'fit', label: '딱 맞음', lengthLabel: '딱 맞음' },
  { key: 'roomy', label: '여유', lengthLabel: '여유' },
  { key: 'unfit', label: '부적합', lengthLabel: '부적합', side: 'large' },
]

/** ease(mm) → 신발 판정. level: 너무 작음 부적합 0, 애매 1, 딱 맞음 2, 여유 3, 너무 큼 부적합 4 */
export function classifyShoeEase(ease) {
  const w = SHOE_WINDOW
  const i = ease < w.minEase ? 0 : ease < 0 ? 1 : ease <= w.fitMaxEase ? 2 : ease <= w.maxEase ? 3 : 4
  return { ...SHOE_VERDICTS[i], level: i }
}

// ---------- 여유분 기준 ----------
// ease = 옷 치수 - 신체 치수. 둘레 항목은 옷 단면×2 기준 (cm).
// shoulder~thigh는 프로토타입(AI 옷장)의 기준을 그대로 씁니다.
// arm, footLength(mm), 기장 항목은 일반적인 착용감을 바탕으로 정한 휴리스틱이에요.
export const EASE_RULES = {
  shoulder: { tight: -1.5, snug: 0.5, regular: 3.5, relaxed: 7 },
  chest: { tight: 0, snug: 6, regular: 14, relaxed: 24 },
  waist: { tight: -1, snug: 3, regular: 10, relaxed: 18 },
  hip: { tight: 0, snug: 4, regular: 12, relaxed: 20 },
  thigh: { tight: 0, snug: 3, regular: 9, relaxed: 16 },
  // 휴리스틱: 소매는 손목뼈 근처(+0~2.5cm)가 보통
  arm: { tight: -3, snug: -1, regular: 2.5, relaxed: 5 },
  // 휴리스틱(mm): 신발은 SHOE_WINDOW 한 곳에서 파생해요 (아래 classifyShoeEase 참고).
  footLength: { tight: SHOE_WINDOW.minEase, snug: 0, regular: SHOE_WINDOW.fitMaxEase, relaxed: SHOE_WINDOW.maxEase },
  // 휴리스틱: 기장은 키로 추정한 표준 기장과의 차이
  topLength: { tight: -6, snug: -3, regular: 3, relaxed: 7 },
  outerLength: { tight: -6, snug: -3, regular: 4, relaxed: 9 },
  inseam: { tight: -6, snug: -3, regular: 3, relaxed: 7 },
  dressLength: { tight: -8, snug: -4, regular: 5, relaxed: 10 },
}

// 기장 항목의 표준값 = 키 × 비율 (휴리스틱)
const LENGTH_RATIO = { topLength: 0.39, outerLength: 0.41, inseam: 0.58, dressLength: 0.68 }
const LENGTH_PARTS = Object.keys(LENGTH_RATIO)

export const VERDICTS = [
  { key: 'tooTight', label: '작을 수 있음', lengthLabel: '짧을 수 있음' },
  { key: 'tight', label: '타이트', lengthLabel: '짧은 편' },
  { key: 'regular', label: '적당', lengthLabel: '적당' },
  { key: 'relaxed', label: '넉넉', lengthLabel: '긴 편' },
  { key: 'oversize', label: '매우 넉넉', lengthLabel: '매우 긺' },
]

const PART_NAME = { ...PART_LABEL, topLength: '총장', outerLength: '총장', inseam: '총장', dressLength: '총장' }

export const FIT_PREF_LABEL = { slim: '슬림', regular: '레귤러', relaxed: '여유' }

const round1 = (v) => Math.round(v * 10) / 10
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

// 신체 치수(추정 + 직접 입력) + 기장 표준값
export function bodyValuesForProfile(profile) {
  const { values, measured } = estimateBody(profile)
  const out = { ...values }
  for (const [k, r] of Object.entries(LENGTH_RATIO)) out[k] = round1(profile.height * r)
  return { values: out, measured }
}

// 보정 오프셋만큼 기준을 평행이동해서 판정
// rule을 주면(학습값으로 보정된 기준) EASE_RULES 대신 그 기준을 써요. 없으면 기존 동작 그대로예요.
export function classifyEase(part, ease, offset = 0, rule = null) {
  const r = rule || EASE_RULES[part]
  if (!r) return null
  if (part === 'footLength') return classifyShoeEase(ease - offset)
  if (ease < r.tight + offset) return { ...VERDICTS[0], level: 0 }
  if (ease < r.snug + offset) return { ...VERDICTS[1], level: 1 }
  if (ease < r.regular + offset) return { ...VERDICTS[2], level: 2 }
  if (ease < r.relaxed + offset) return { ...VERDICTS[3], level: 3 }
  return { ...VERDICTS[4], level: 4 }
}

// 한 사이즈의 부위별 판정
// 반환: [{ part, label, body, garment, ease, verdict, level, key, unit, isLength }]
// 학습값(resolveLearned 결과)이 있으면 부위별 기준과 브랜드 오프셋(cm)을 더해 써요. 신발(mm)에는 브랜드 오프셋을 쓰지 않아요.
const ruleOf = (part, learned) => learned?.rules?.[part] || EASE_RULES[part]
const offsetOf = (part, calibration, learned) => (calibration[part]?.offset || 0) + (part === 'footLength' ? 0 : learned?.offset || 0)

export function partVerdicts(bodyValues, measuresForSize, category, calibration = {}, learned = null) {
  if (!measuresForSize) return []
  const order = [...new Set([...(CATEGORY_PARTS[category] || []), ...Object.keys(measuresForSize)])]
  const out = []
  for (const part of order) {
    const garment = measuresForSize[part]
    const body = bodyValues[part]
    if (!EASE_RULES[part] || !isNum(garment) || !isNum(body)) continue
    const ease = round1(garment - body)
    const v = classifyEase(part, ease, offsetOf(part, calibration, learned), learned?.rules?.[part] || null)
    const isLength = LENGTH_PARTS.includes(part)
    out.push({
      part,
      label: PART_NAME[part] || part,
      body,
      garment,
      ease,
      verdict: isLength ? v.lengthLabel : v.label,
      level: v.level,
      key: v.key,
      unit: part === 'footLength' ? 'mm' : 'cm',
      isLength,
    })
  }
  return out
}

// 선호 핏에 따른 목표 여유분
function targetEase(rule, preferredFit) {
  if (preferredFit === 'slim') return rule.snug + (rule.regular - rule.snug) * 0.25
  if (preferredFit === 'relaxed') return (rule.regular + rule.relaxed) / 2
  return (rule.snug + rule.regular) / 2
}

// 사이즈표의 사이즈 순서 (행 순서 우선)
function chartSizes(sizeChart) {
  if (!sizeChart) return []
  const fromRows = (sizeChart.rows || []).map((r) => String(r[0]).toUpperCase())
  const fromMeasures = Object.keys(sizeChart.measures || {}).map((s) => String(s).toUpperCase())
  return [...new Set([...fromRows, ...fromMeasures])]
}

const normKey = (s) => String(s ?? '').replace(/\s/g, '').toUpperCase()
const tokenOf = (k) => (k.match(/^\d{1,2}\(([^)]+)\)$/) || [])[1] || null

// 후기에 적힌 'M'을 사이즈표의 '1(M)'로 잇는 등, 사이즈 이름을 표/옵션에 있는 이름으로 맞춰요. 못 맞추면 그대로.
function canonicalSize(size, keys) {
  if (size == null) return size
  const k = normKey(size)
  if (keys.includes(k)) return k
  const hit = keys.find((c) => tokenOf(c) === k)
  return hit || size
}

// 화면에 보여줄 이름: 사이즈표의 display → 구매 옵션 원문 → 키 그대로 ('1(M)' → '1 (M)')
function makeDisplay(product) {
  const map = product.sizeChart?.display || {}
  const opts = product.optionLabels || []
  return (size) => {
    if (size == null) return size
    const k = normKey(size)
    if (map[k]) return map[k]
    const o = opts.find((x) => normKey(x) === k || tokenOf(normKey(x)) === k)
    return o || k
  }
}

function measuresOf(sizeChart, size) {
  const m = sizeChart?.measures || {}
  const key = Object.keys(m).find((k) => String(k).toUpperCase() === size)
  return key == null ? null : m[key]
}

// 사이즈별 점수(0~100). 목표 여유분에서 멀수록 감점, 작을 수 있는 부위는 크게 감점.
export function recommendSize(bodyValues, sizeChart, category, preferredFit = 'regular', calibration = {}, learned = null) {
  if (!sizeChart?.measures) return null
  const perSize = []
  for (const size of chartSizes(sizeChart)) {
    const verdicts = partVerdicts(bodyValues, measuresOf(sizeChart, size), category, calibration, learned)
    if (verdicts.length === 0) continue
    let sum = 0
    let wsum = 0
    for (const v of verdicts) {
      const rule = ruleOf(v.part, learned)
      const off = offsetOf(v.part, calibration, learned)
      const span = rule.relaxed - rule.tight
      let p = (Math.abs(v.ease - (targetEase(rule, preferredFit) + off)) / span) * 100
      if (v.level === 0) p += 40
      const w = v.isLength ? 0.5 : 1
      sum += p * w
      wsum += w
    }
    const score = Math.max(0, Math.min(100, Math.round(100 - sum / wsum)))
    perSize.push({ size, score, verdicts })
  }
  if (perSize.length === 0) return null
  const best = perSize.reduce((a, b) => (b.score > a.score ? b : a))
  return { bestSize: best.size, best, perSize }
}

// ---------- 후기 매칭 ----------
// 체형 유사도 기준. 아래 숫자는 설계상의 판단이고, 실제 후기 데이터로 정확도를 재서 정한 값이 아니에요.
// 웹 앱, 확장, 테스트가 모두 이 한 곳의 값을 씁니다.
export const BODY_SIM = Object.freeze({
  heightWeight: 0.8, // 키 1cm 차이당 거리
  weightWeight: 1.6, // 몸무게 1kg 차이당 거리 (체형 핏에는 몸무게 영향이 더 커요)
  slope: 2.5, // 거리 1당 깎는 점수
  threshold: 65, // 이 점수 이상이면 비슷한 체형 후기
  unknownGenderPenalty: 10, // 후기 성별을 못 읽었을 때 깎는 점수
})

// 두 체형(키/몸무게) 사이의 유사도(0~100). 키·몸무게가 없는 후기는 null.
// 내 성별과 후기 성별이 둘 다 알려져 있고 다르면 0, 후기 성별을 못 읽었으면 감점해요.
// 내 프로필에 성별이 없으면 성별은 따지지 않아요.
export function bodySimilarity(profile, review) {
  if (!isNum(review.height) || !isNum(review.weight)) return null
  const mine = profile.gender === 'male' || profile.gender === 'female' ? profile.gender : null
  const theirs = review.gender === 'male' || review.gender === 'female' ? review.gender : null
  if (mine && theirs && mine !== theirs) return 0
  const dh = Math.abs(profile.height - review.height)
  const dw = Math.abs(profile.weight - review.weight)
  const distance = dh * BODY_SIM.heightWeight + dw * BODY_SIM.weightWeight
  const penalty = mine && !theirs ? BODY_SIM.unknownGenderPenalty : 0
  return Math.max(0, Math.round(100 - distance * BODY_SIM.slope - penalty))
}

// 후기 이상치 거르기: 웹·확장·진단이 모두 이 함수를 써요. 제외된 후기는 지우지 않고 excluded에 표시와 함께 담아요.
export function screenReviews(reviews, product = {}) {
  return detectReviewOutliers(reviews, {
    sizeChart: product.sizeChart,
    optionLabels: [...(product.optionLabels || []), ...(product.shoeOptionLabels || [])],
    category: product.category,
    similarity: bodySimilarity,
    threshold: BODY_SIM.threshold,
  })
}

// 비슷한 체형 후기(matched)와 나머지 후기(others)로 나눕니다.
export function splitReviews(profile, reviews = [], threshold = BODY_SIM.threshold) {
  const matched = []
  const others = []
  for (const r of reviews) {
    const similarity = bodySimilarity(profile, r)
    if (similarity != null && similarity > 0 && similarity >= threshold) matched.push({ ...r, similarity })
    else others.push({ ...r, similarity })
  }
  matched.sort((a, b) => b.similarity - a.similarity)
  return { matched, others }
}

export function matchReviews(profile, reviews, threshold = BODY_SIM.threshold) {
  return splitReviews(profile, reviews, threshold).matched
}

// 비슷한 체형 후기의 핏 투표를 사이즈별로 집계 (사이즈·핏을 모르는 후기는 제외)
export function aggregateFit(matched) {
  const bySize = {}
  for (const r of matched) {
    if (r.size == null || !r.fit) continue
    const size = String(r.size).toUpperCase()
    if (!bySize[size]) bySize[size] = { small: 0, true: 0, large: 0, count: 0, weight: 0 }
    // 라벨 이상치(비슷한 체형 다수와 반대 평가)는 제외하지 않고 가중치만 줄여요.
    const w = ((r.similarity ?? 50) / 100) * (r.labelWeight ?? 1)
    bySize[size][r.fit] += w
    bySize[size].count += 1
    bySize[size].weight += w
  }
  return bySize
}

// 후기 투표로 사이즈 고르기
function pickFromReviews(matched, sizeList) {
  const bySize = aggregateFit(matched)
  const entries = Object.entries(bySize).sort((a, b) => b[1].weight - a[1].weight)
  if (entries.length === 0) return null
  const [baseSize, stat] = entries[0]
  const total = stat.small + stat.true + stat.large || 1

  let tendency = 'true'
  if (stat.small > stat.true && stat.small >= stat.large) tendency = 'small'
  else if (stat.large > stat.true && stat.large >= stat.small) tendency = 'large'

  const idx = sizeList.indexOf(baseSize)
  let size = baseSize
  let adjust = ''
  if (tendency === 'small' && idx >= 0 && idx < sizeList.length - 1) {
    size = sizeList[idx + 1]
    adjust = `${baseSize}가 작다는 후기가 많아 한 치수 큰 ${size}를 추천해요.`
  } else if (tendency === 'large' && idx > 0) {
    size = sizeList[idx - 1]
    adjust = `${baseSize}가 크다는 후기가 있어, 딱 맞게 입으려면 ${size}도 좋아요.`
  }
  const pct = Math.round((Math.max(stat.small, stat.true, stat.large) / total) * 100)
  const votes = entries.reduce((n, [, s]) => n + s.count, 0)
  return { size, baseSize, tendency, pct, adjust, votes }
}

const TENDENCY_TEXT = { small: '작게 나온다고', large: '크게 나온다고', true: '정사이즈라고' }

function usualSizeFor(profile, category) {
  const u = profile.usual || {}
  if (category === 'bottom') return u.bottom
  if (category === 'shoes') return u.shoes
  return u.top
}

function describeVerdicts(verdicts) {
  if (!verdicts.length) return ''
  return verdicts.map((v) => `${v.label} ${v.verdict}`).join(', ') + '.'
}

// AI 핏 코멘트: 후기 투표 + 실측 비교를 합친 추천
// model: 학습값 묶음(learnedModel.js). 없거나 버전이 다르면 기존 동작 그대로예요. 출처가 브라우저든 서버든 같은 코드로 읽어요.
export function generateFitComment(profile, product, calibration = {}, model = null) {
  // 브랜드 지역(추정): 같은 지역 브랜드들로 모은 학습 오프셋을 고를 때만 판정에 영향을 줘요. 근거가 없으면 unknown이고 보정은 0이에요.
  const regionInfo = classifyBrandRegion(regionInputOf(product))
  const regionKey = regionInfo.region === 'unknown' ? null : regionInfo.region
  const learned = model ? resolveLearned(model, product.category, brandKeyOf(product), regionKey) : null
  const { values, measured } = bodyValuesForProfile(profile)
  const preferredFit = profile.preferredFit || 'regular'
  const measureResult = recommendSize(values, product.sizeChart, product.category, preferredFit, calibration, learned)
  const sizeList = chartSizes(product.sizeChart)
  const optionKeys = (product.optionLabels || []).map(normKey)
  // 추천은 사이즈표의 이름, 표가 없으면 구매 옵션의 이름 안에서만 해요.
  const allowedKeys = sizeList.length ? sizeList : optionKeys
  const screened = screenReviews(product.reviews || [], product)
  const reviewList = screened.kept.map((r) => (r.size ? { ...r, size: canonicalSize(r.size, allowedKeys) } : r))
  const { matched, others } = splitReviews(profile, reviewList)
  const disp = makeDisplay(product)
  const reviewPick = pickFromReviews(matched, sizeList)
  const topSim = matched[0]?.similarity ?? 0
  const measureSize = measureResult?.bestSize ?? null
  const calibrated = Object.keys(calibration).length > 0

  let recommendedSize = null
  let confidence = 'low'
  let headline = '아직 추천이 어려워요'
  const body = []
  const notes = []

  const reviewSentence = reviewPick
    ? `나와 비슷한 체형의 후기 ${reviewPick.votes}건 중 ${reviewPick.pct}%가 ${TENDENCY_TEXT[reviewPick.tendency]} 느꼈어요. ` +
      (reviewPick.adjust || `비슷한 체형은 ${disp(reviewPick.size)}를 가장 많이 골랐어요.`)
    : ''
  const fitName = FIT_PREF_LABEL[preferredFit]

  // 후기가 고른 사이즈가 실측상 "작을 수 있음"인 부위가 있으면 후기만 믿지 않습니다.
  const reviewSizeTooSmall = measureResult?.perSize
    .find((p) => p.size === reviewPick?.size)
    ?.verdicts.some((v) => v.level === 0 && !v.isLength)

  if (measureSize && reviewPick) {
    if (reviewPick.size === measureSize || reviewPick.baseSize === measureSize) {
      recommendedSize = measureSize
      confidence = reviewPick.votes >= 2 && reviewPick.size === measureSize ? 'high' : 'medium'
      body.push(reviewSentence, `사이즈표 실측으로 보면 ${fitName} 핏 기준 ${disp(measureSize)}가 가장 잘 맞아요.`)
    } else if (reviewPick.votes >= 3 && topSim >= 75 && !reviewSizeTooSmall) {
      recommendedSize = reviewPick.size
      confidence = 'medium'
      body.push(reviewSentence, `다만 사이즈표 실측만 보면 ${disp(measureSize)}가 ${fitName} 핏에 더 가까워요.`)
    } else {
      recommendedSize = measureSize
      confidence = measureResult.best.score >= 70 ? 'medium' : 'low'
      body.push(`사이즈표 실측으로 보면 ${fitName} 핏 기준 ${disp(measureSize)}가 가장 잘 맞아요.`, reviewSentence)
    }
  } else if (measureSize) {
    recommendedSize = measureSize
    const compared = measureResult.best.verdicts.filter((v) => !v.isLength)
    const allMeasured = compared.length > 0 && compared.every((v) => measured.has(v.part))
    confidence = measureResult.best.score >= 70 ? (allMeasured ? 'high' : 'medium') : 'low'
    body.push(`사이즈표 실측으로 보면 ${fitName} 핏 기준 ${disp(measureSize)}가 가장 잘 맞아요.`)
    if (matched.length === 0) notes.push('비슷한 체형의 후기가 없어 실측 비교로만 판단했어요.')
  } else if (reviewPick) {
    recommendedSize = reviewPick.size
    if (reviewPick.votes >= 3 && topSim >= 75) confidence = 'high'
    else if (reviewPick.votes >= 2 && topSim >= 65) confidence = 'medium'
    body.push(reviewSentence)
    notes.push('사이즈표 실측이 없어 후기 위주로 판단했어요.')
  } else {
    const usual = usualSizeFor(profile, product.category)
    const usualKey = usual != null ? String(usual).toUpperCase() : null
    const usualHit = usualKey ? canonicalSize(usualKey, allowedKeys) : null
    if (usualKey && (allowedKeys.length === 0 || allowedKeys.includes(normKey(usualHit)))) {
      recommendedSize = allowedKeys.length ? normKey(usualHit) : usualKey
      headline = `평소 사이즈 ${disp(recommendedSize)}를 기준으로 보세요`
      body.push('이 페이지에서는 실측 사이즈표와 체형 정보가 있는 후기를 찾지 못해, 평소 입는 사이즈를 기준으로 안내해요.')
    } else {
      body.push('비교할 사이즈표와 비슷한 체형의 후기가 부족해요. 상품 상세의 사이즈표를 확인하고 평소 사이즈로 골라보세요.')
    }
  }

  // 마지막 확인: 추천 사이즈가 사이즈표(없으면 구매 옵션)에 실제로 있는 이름이 아니면 추천하지 않아요.
  if (recommendedSize && allowedKeys.length && !allowedKeys.includes(normKey(recommendedSize))) {
    recommendedSize = null
    confidence = 'low'
    headline = '아직 추천이 어려워요'
    body.length = 0
    body.push('후기에서 나온 사이즈가 이 상품의 사이즈표·구매 옵션에 없어 추천하지 않아요. 상품 상세의 사이즈표를 확인해 주세요.')
  }

  if (recommendedSize && headline === '아직 추천이 어려워요') {
    headline = confidence === 'high' ? `${disp(recommendedSize)} 사이즈를 추천해요` : `${disp(recommendedSize)} 사이즈가 무난해요`
  }

  const perSize = measureResult?.perSize || []
  const verdicts = perSize.find((p) => p.size === recommendedSize)?.verdicts || []
  if (verdicts.length) body.push(`${disp(recommendedSize)} 기준: ${describeVerdicts(verdicts)}`)
  if (verdicts.some((v) => !v.isLength && !measured.has(v.part))) {
    notes.push('직접 잰 치수가 없는 부위는 키·몸무게·체형으로 추정했어요(±3~5cm).')
  }
  if (calibrated) notes.push('내 착용 기록으로 판정 기준을 보정했어요.')
  const learning = model ? learningStatus(model, product.category, brandKeyOf(product), regionKey) : null
  if (learning?.used) notes.push('이 브라우저에 모은 후기로 기준을 조금 옮겼어요(정확도를 잰 값은 아니에요).')
  notes.push('후기와 사이즈표를 종합한 참고용 추천이에요. 소재와 신축성에 따라 다를 수 있어요.')

  const compared = verdicts.filter((v) => !v.isLength)
  const evidence = {
    reviewTotal: (product.reviews || []).length,
    reviewMatched: matched.length,
    reviewExcluded: screened.excludedTotal,
    reviewVotes: reviewPick?.votes ?? 0,
    sizeChart: measureResult != null,
    measuredParts: compared.filter((v) => measured.has(v.part)).length,
    estimatedParts: compared.filter((v) => !measured.has(v.part)).length,
    calibrated,
    // 자세한 근거 줄(describeEvidence)에 쓰는 값. 모두 이 분석에서 센 값이고 정확도를 잰 값은 아니에요.
    learnedState: !model ? 'none' : learning?.used ? 'used' : learning ? 'collecting' : 'none',
    learnedCategorySamples: learned?.categorySamples ?? 0,
    learnedTotalSamples: learned?.total ?? 0,
    offsetSource: learned?.offsetSource ?? null,
    offsetValue: learned?.offset ?? 0,
    brandSamples: learned?.brandSamples ?? 0,
    regionSamples: learned?.regionSamples ?? 0,
    regionLine: regionLine(regionInfo),
    partEase: compared.map((v) => ({ label: v.label, ease: v.ease, verdict: v.verdict, measured: measured.has(v.part) })),
    ...('reviewTotalOnPage' in product ? { reviewTotalOnPage: product.reviewTotalOnPage ?? null } : {}),
  }

  return {
    headline,
    body: body.filter(Boolean).join(' '),
    note: notes.join(' '),
    confidence,
    evidence,
    recommendedSize,
    recommendedLabel: recommendedSize == null ? null : disp(recommendedSize),
    tendency: reviewPick?.tendency ?? null,
    matched,
    otherReviews: others,
    excludedReviews: screened.excluded,
    outliers: { excluded: screened.excludedTotal, counts: screened.counts, labelReduced: screened.labelReduced, statApplied: screened.statApplied },
    perSize,
    verdicts,
    measured,
    regionInfo,
    // 사이즈표를 못 읽었을 때만: 사이즈 표기의 뜻(근사/출처 확인 필요). 추천 계산에는 쓰지 않아요.
    sizeSystem: product.sizeChart ? null : sizeSystemHint({ category: product.category, gender: product.targetGender?.gender === 'male' ? 'male' : null, optionLabels: product.optionLabels || [] }),
    ...(learning ? { learning } : {}),
  }
}

// ---------- 착용 기록으로 개인화 보정 ----------
// feedback: { productName, category, size, result: 'small'|'true'|'large', returned, parts: { 부위: ease } }
// "작았음"인데 여유분이 기준보다 컸다면 이 사람은 더 큰 여유분이 필요하다는 뜻이라 기준을 올립니다.
const MAX_OFFSET = 6

export function computeCalibration(feedbackList = []) {
  const acc = {}
  for (const fb of feedbackList) {
    for (const [part, ease] of Object.entries(fb.parts || {})) {
      const rule = EASE_RULES[part]
      if (!rule || !isNum(ease)) continue
      let desired = null
      // 방향이 반대인 기록(이미 타이트 판정인데 작았음 등)은 기준을 느슨하게 만들지 않도록 0으로 둡니다.
      if (fb.result === 'small') desired = Math.max(0, ease - rule.snug)
      else if (fb.result === 'large') desired = Math.min(0, ease - rule.relaxed)
      else if (fb.result === 'true') desired = ease - (rule.snug + rule.regular) / 2
      if (desired == null) continue
      // 반품까지 했다면 더 확실한 신호라 가중치를 높입니다.
      const w = fb.returned ? 1.5 : 1
      if (!acc[part]) acc[part] = { sum: 0, w: 0, n: 0 }
      acc[part].sum += desired * w
      acc[part].w += w
      acc[part].n += 1
    }
  }
  const out = {}
  for (const [part, a] of Object.entries(acc)) {
    const v = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, a.sum / a.w))
    // 표본이 1건이면 절반만 반영
    const weight = Math.min(1, a.n / 2)
    out[part] = { offset: round1(v * weight), samples: a.n }
  }
  return out
}

export function calibrationSummary(calibration, count) {
  const parts = Object.entries(calibration || {})
    .filter(([, c]) => c.offset !== 0)
    .map(([k, c]) => `${PART_NAME[k] || k} ${c.offset > 0 ? '+' : ''}${c.offset}${k === 'footLength' ? 'mm' : 'cm'}`)
  if (!count) return null
  return `착용 기록 ${count}건 반영` + (parts.length ? ` · 기준 보정: ${parts.join(' · ')}` : ' · 아직 보정할 차이가 없어요')
}

export const CONFIDENCE_LABEL = {
  high: { text: '확신도 높음', color: '#2f7a53' },
  medium: { text: '확신도 보통', color: '#c27a1e' },
  low: { text: '확신도 낮음(참고용)', color: '#8a877f' },
}

// 추천의 근거를 사람이 읽는 문장으로. 숫자는 모두 evidence에서만 가져옵니다.
// 확신도는 규칙 기반 구분이며 보정된 확률이 아닙니다.
export function describeEvidence(evidence, confidence) {
  const e = evidence || {}
  const word = CONFIDENCE_LABEL[confidence]?.text ?? CONFIDENCE_LABEL.low.text
  const parts = []
  if ('reviewTotalOnPage' in e) {
    // 확장: 페이지에 불러온 리뷰만 읽었다는 점을 숨기지 않아요.
    const scope = e.reviewTotalOnPage > e.reviewTotal ? `(전체 약 ${e.reviewTotalOnPage}건 중 일부)` : ''
    if (e.reviewTotal > 0) parts.push(`페이지에 불러온 리뷰 ${e.reviewTotal}건 기준${scope}, 비슷한 체형 ${e.reviewMatched}건`)
    else parts.push(e.reviewTotalOnPage > 0 ? `리뷰 없음(페이지에 불러온 리뷰 0건, 전체 약 ${e.reviewTotalOnPage}건)` : '리뷰 없음')
  } else if (e.reviewTotal > 0) parts.push(`리뷰 ${e.reviewTotal}건 중 비슷한 체형 ${e.reviewMatched}건`)
  else parts.push('리뷰 없음')
  if (e.reviewExcluded > 0) parts.push(`이상치로 보여 제외한 후기 ${e.reviewExcluded}건`)
  if (e.sizeChart) {
    parts.push(e.estimatedParts > 0 ? '사이즈표 비교(일부 부위는 추정)' : e.measuredParts > 0 ? '사이즈표 실측 비교' : '사이즈표 비교')
  } else parts.push('사이즈표 없음')
  parts.push(word)

  const reasons = []
  if (confidence !== 'high') {
    if (!e.reviewTotal) reasons.push('참고할 리뷰가 없어요.')
    else if (!e.reviewMatched) reasons.push(`리뷰 ${e.reviewTotal}건 중 비슷한 체형의 후기가 없어요.`)
    else if (e.reviewVotes < 2) reasons.push(`비슷한 체형 후기 ${e.reviewMatched}건 중 사이즈와 핏을 밝힌 후기가 ${e.reviewVotes}건뿐이에요.`)
    if (!e.sizeChart) reasons.push('사이즈표를 읽지 못해 실측 비교를 하지 못했어요.')
    else if (e.estimatedParts > 0) reasons.push(`직접 잰 치수가 없어 ${e.estimatedParts}개 부위는 추정값으로 비교했어요.`)
    if (!reasons.length) reasons.push('후기와 사이즈표의 결과가 완전히 일치하지는 않아요.')
  }
  return { summary: parts.join(' · '), reasons, details: evidenceDetails(e) }
}

const signed = (v) => `${v > 0 ? '+' : ''}${v}`

// 추천 사이즈 결과에 붙이는 자세한 근거 줄. 센 값(건수, 샘플 수, cm)만 보여주고, 정확도처럼 보이는 숫자는 만들지 않아요.
// evidence에 해당 값이 없으면(예전 모양, 신발 등) 그 줄은 건너뛰어요.
export function evidenceDetails(evidence) {
  const e = evidence || {}
  const lines = []
  if (isNum(e.reviewTotal)) {
    lines.push(
      e.reviewTotal > 0
        ? `후기 근거: 불러온 후기 ${e.reviewTotal}건 중 이상치 제외 ${e.reviewExcluded || 0}건, 비슷한 체형 ${e.reviewMatched}건, 그중 사이즈·핏을 밝힌 후기 ${e.reviewVotes}건`
        : '후기 근거: 쓸 수 있는 후기가 없어요',
    )
  }
  if (e.learnedState === 'used') lines.push(`학습값: 사용(이 종류 샘플 ${e.learnedCategorySamples}건, 이 브라우저에 모은 후기 기준)`)
  else if (e.learnedState === 'collecting') lines.push(`학습값: 모으는 중(전체 샘플 ${e.learnedTotalSamples}건, 이 종류는 아직 적용할 차이가 없어요)`)
  if (e.offsetSource === 'brand') lines.push(`브랜드 보정: ${signed(e.offsetValue)}cm (이 브랜드 샘플 ${e.brandSamples}건, 표본이 적을수록 0에 가깝게 줄여요)`)
  else if (e.offsetSource === 'region') lines.push(`지역 보정: ${signed(e.offsetValue)}cm (같은 지역 브랜드 샘플 ${e.regionSamples}건, 검증 전 가설이라 모은 후기에서 확인된 만큼만 반영해요)`)
  else if (e.learnedState === 'used' || e.learnedState === 'collecting') lines.push('브랜드·지역 보정: 없음(0cm, 모은 표본이 부족하거나 지역을 알 수 없어요)')
  if (e.regionLine) lines.push(e.regionLine)
  if (Array.isArray(e.partEase) && e.partEase.length) {
    lines.push(`부위별 여유분 판정: ${e.partEase.map((p) => `${p.label} ${signed(p.ease)}cm ${p.verdict}${p.measured ? '' : '(추정)'}`).join(', ')}`)
  }
  if (lines.length) lines.push('위 수치는 센 값이고 규칙 기반 판정이에요. 정확도를 측정한 값은 아니에요.')
  return lines
}

export const FIT_LABEL = {
  small: '작아요',
  true: '잘 맞아요',
  large: '커요',
}
