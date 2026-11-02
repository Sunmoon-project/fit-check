// 체형 매칭 + 핏 예측 로직 (규칙 기반)
// 1) 사이즈표 실측 ↔ 내 신체 치수(직접 입력 또는 추정)의 여유분(ease)으로 부위별 판정
// 2) 나와 키·몸무게가 비슷한 사람의 후기 투표
// 두 근거를 합쳐 사이즈를 추천합니다. 결과는 참고용이에요.
import { PART_LABEL, CATEGORY_PARTS } from '../data/measurements.js'
import { estimateBody } from './bodyEstimate.js'

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
  // 휴리스틱(mm): 신발 안쪽 길이는 발길이보다 5~12mm 여유가 보통
  footLength: { tight: 0, snug: 5, regular: 12, relaxed: 20 },
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
export function classifyEase(part, ease, offset = 0) {
  const r = EASE_RULES[part]
  if (!r) return null
  if (ease < r.tight + offset) return { ...VERDICTS[0], level: 0 }
  if (ease < r.snug + offset) return { ...VERDICTS[1], level: 1 }
  if (ease < r.regular + offset) return { ...VERDICTS[2], level: 2 }
  if (ease < r.relaxed + offset) return { ...VERDICTS[3], level: 3 }
  return { ...VERDICTS[4], level: 4 }
}

// 한 사이즈의 부위별 판정
// 반환: [{ part, label, body, garment, ease, verdict, level, key, unit, isLength }]
export function partVerdicts(bodyValues, measuresForSize, category, calibration = {}) {
  if (!measuresForSize) return []
  const order = [...new Set([...(CATEGORY_PARTS[category] || []), ...Object.keys(measuresForSize)])]
  const out = []
  for (const part of order) {
    const garment = measuresForSize[part]
    const body = bodyValues[part]
    if (!EASE_RULES[part] || !isNum(garment) || !isNum(body)) continue
    const ease = round1(garment - body)
    const v = classifyEase(part, ease, calibration[part]?.offset || 0)
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

function measuresOf(sizeChart, size) {
  const m = sizeChart?.measures || {}
  const key = Object.keys(m).find((k) => String(k).toUpperCase() === size)
  return key == null ? null : m[key]
}

// 사이즈별 점수(0~100). 목표 여유분에서 멀수록 감점, 작을 수 있는 부위는 크게 감점.
export function recommendSize(bodyValues, sizeChart, category, preferredFit = 'regular', calibration = {}) {
  if (!sizeChart?.measures) return null
  const perSize = []
  for (const size of chartSizes(sizeChart)) {
    const verdicts = partVerdicts(bodyValues, measuresOf(sizeChart, size), category, calibration)
    if (verdicts.length === 0) continue
    let sum = 0
    let wsum = 0
    for (const v of verdicts) {
      const rule = EASE_RULES[v.part]
      const off = calibration[v.part]?.offset || 0
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
// 두 체형(키/몸무게) 사이의 유사도(0~100). 키·몸무게가 없는 후기는 null.
export function bodySimilarity(profile, review) {
  if (!isNum(review.height) || !isNum(review.weight)) return null
  const dh = Math.abs(profile.height - review.height)
  const dw = Math.abs(profile.weight - review.weight)
  // 체형 핏에는 몸무게 영향이 더 커서 가중치를 더 줍니다.
  const distance = dh * 0.6 + dw * 1.0
  return Math.max(0, Math.round(100 - distance * 2.2))
}

// 비슷한 체형 후기(matched)와 나머지 후기(others)로 나눕니다.
export function splitReviews(profile, reviews = [], threshold = 55) {
  const matched = []
  const others = []
  for (const r of reviews) {
    const similarity = bodySimilarity(profile, r)
    if (similarity != null && similarity >= threshold) matched.push({ ...r, similarity })
    else others.push({ ...r, similarity })
  }
  matched.sort((a, b) => b.similarity - a.similarity)
  return { matched, others }
}

export function matchReviews(profile, reviews, threshold = 55) {
  return splitReviews(profile, reviews, threshold).matched
}

// 비슷한 체형 후기의 핏 투표를 사이즈별로 집계 (사이즈·핏을 모르는 후기는 제외)
export function aggregateFit(matched) {
  const bySize = {}
  for (const r of matched) {
    if (r.size == null || !r.fit) continue
    const size = String(r.size).toUpperCase()
    if (!bySize[size]) bySize[size] = { small: 0, true: 0, large: 0, count: 0, weight: 0 }
    const w = (r.similarity ?? 50) / 100
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
export function generateFitComment(profile, product, calibration = {}) {
  const { values, measured } = bodyValuesForProfile(profile)
  const preferredFit = profile.preferredFit || 'regular'
  const measureResult = recommendSize(values, product.sizeChart, product.category, preferredFit, calibration)
  const { matched, others } = splitReviews(profile, product.reviews || [])
  const sizeList = chartSizes(product.sizeChart)
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
      (reviewPick.adjust || `비슷한 체형은 ${reviewPick.size}를 가장 많이 골랐어요.`)
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
      body.push(reviewSentence, `사이즈표 실측으로 보면 ${fitName} 핏 기준 ${measureSize}가 가장 잘 맞아요.`)
    } else if (reviewPick.votes >= 3 && topSim >= 75 && !reviewSizeTooSmall) {
      recommendedSize = reviewPick.size
      confidence = 'medium'
      body.push(reviewSentence, `다만 사이즈표 실측만 보면 ${measureSize}가 ${fitName} 핏에 더 가까워요.`)
    } else {
      recommendedSize = measureSize
      confidence = measureResult.best.score >= 70 ? 'medium' : 'low'
      body.push(`사이즈표 실측으로 보면 ${fitName} 핏 기준 ${measureSize}가 가장 잘 맞아요.`, reviewSentence)
    }
  } else if (measureSize) {
    recommendedSize = measureSize
    const compared = measureResult.best.verdicts.filter((v) => !v.isLength)
    const allMeasured = compared.length > 0 && compared.every((v) => measured.has(v.part))
    confidence = measureResult.best.score >= 70 ? (allMeasured ? 'high' : 'medium') : 'low'
    body.push(`사이즈표 실측으로 보면 ${fitName} 핏 기준 ${measureSize}가 가장 잘 맞아요.`)
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
    if (usualKey && (sizeList.length === 0 || sizeList.includes(usualKey))) {
      recommendedSize = usualKey
      headline = `평소 사이즈 ${usualKey}를 기준으로 보세요`
      body.push('이 페이지에서는 실측 사이즈표와 체형 정보가 있는 후기를 찾지 못해, 평소 입는 사이즈를 기준으로 안내해요.')
    } else {
      body.push('비교할 사이즈표와 비슷한 체형의 후기가 부족해요. 상품 상세의 사이즈표를 확인하고 평소 사이즈로 골라보세요.')
    }
  }

  if (recommendedSize && headline === '아직 추천이 어려워요') {
    headline = confidence === 'high' ? `${recommendedSize} 사이즈를 추천해요` : `${recommendedSize} 사이즈가 무난해요`
  }

  const perSize = measureResult?.perSize || []
  const verdicts = perSize.find((p) => p.size === recommendedSize)?.verdicts || []
  if (verdicts.length) body.push(`${recommendedSize} 기준: ${describeVerdicts(verdicts)}`)
  if (verdicts.some((v) => !v.isLength && !measured.has(v.part))) {
    notes.push('직접 잰 치수가 없는 부위는 키·몸무게·체형으로 추정했어요(±3~5cm).')
  }
  if (calibrated) notes.push('내 착용 기록으로 판정 기준을 보정했어요.')
  notes.push('후기와 사이즈표를 종합한 참고용 추천이에요. 소재와 신축성에 따라 다를 수 있어요.')

  return {
    headline,
    body: body.filter(Boolean).join(' '),
    note: notes.join(' '),
    confidence,
    recommendedSize,
    tendency: reviewPick?.tendency ?? null,
    matched,
    otherReviews: others,
    perSize,
    verdicts,
    measured,
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
  high: { text: '추천 정확도 높음', color: '#2f7a53' },
  medium: { text: '추천 정확도 보통', color: '#c27a1e' },
  low: { text: '참고용', color: '#8a877f' },
}

export const FIT_LABEL = {
  small: '작아요',
  true: '잘 맞아요',
  large: '커요',
}
