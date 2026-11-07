import { shoeWardrobeFields } from './shoeFit.js'

// 옷장 순수 로직 (저장은 storage.js). 프로토타입의 "내 옷장 속 비슷한 옷과 비교"를 옮겼어요.

// 비교 항목: 상의류(상의·아우터·원피스)와 하의는 따로 비교합니다. 단위는 cm(둘레는 단면×2).
const COMPARE_KEYS = {
  upper: [['shoulder', '어깨'], ['chest', '가슴'], ['topLength', '총장'], ['outerLength', '총장'], ['dressLength', '총장'], ['arm', '소매']],
  bottom: [['waist', '허리'], ['hip', '엉덩이'], ['thigh', '허벅지'], ['inseam', '총장']],
  shoes: [['footLength', '발길이']],
}

export function categoryGroup(category) {
  if (category === 'bottom') return 'bottom'
  if (category === 'shoes') return 'shoes'
  return 'upper'
}

function measuresFor(sizeChart, size) {
  const m = sizeChart?.measures || {}
  const key = Object.keys(m).find((k) => String(k).toUpperCase() === String(size).toUpperCase())
  return key == null ? null : m[key]
}

// 옷장에 저장할 항목. 이미지(data URL)는 용량이 커서 하나만 둡니다.
// 신발은 판정이 비면 이유를 verdictStatus/verdictNote로 남겨요 (US/UK/EU는 mm로 환산, S/M/L·FREE는 '판정 없음(사이즈 체계 미지원)').
// 신발이 아니거나 판정이 있으면 예전 항목과 같은 모양이라 저장 형식은 그대로 호환돼요.
export function makeWardrobeItem({ product, size, verdicts = [], image = null, imageKind = null, profile = null, now = Date.now() }) {
  let measures = size ? measuresFor(product.sizeChart, size) : null
  let shoe = null
  if (product.category === 'shoes') {
    shoe = shoeWardrobeFields({ product, size, verdicts, profile })
    verdicts = shoe.verdicts
    if (shoe.measures && typeof measures?.footLength !== 'number') measures = { ...(measures || {}), ...shoe.measures }
  }
  return {
    id: `w${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    savedAt: now,
    product: {
      name: product.name,
      mall: product.mall,
      category: product.category,
      image: product.image || null,
      emoji: product.emoji || null,
      url: product.url,
    },
    size,
    measures,
    verdicts: verdicts.map((v) => ({ part: v.part, label: v.label, verdict: v.verdict, key: v.key, ease: v.ease })),
    image,
    imageKind, // 'ai' | 'preview' | null
    ...(shoe?.status || shoe?.note ? { verdictStatus: shoe.status, verdictNote: shoe.note } : {}),
  }
}

// target: { id?, category, measures } → 같은 그룹에서 치수 차이가 가장 작은 옷과 부위별 차이
export function findSimilar(target, wardrobe = []) {
  if (!target?.measures) return null
  const group = categoryGroup(target.category || target.product?.category)
  const keys = COMPARE_KEYS[group]
  let best = null
  for (const w of wardrobe) {
    if (w.id === target.id || !w.measures || categoryGroup(w.product?.category) !== group) continue
    const diffs = []
    for (const [k, label] of keys) {
      const a = target.measures[k]
      const b = w.measures[k]
      if (typeof a === 'number' && typeof b === 'number') diffs.push({ part: k, label, diff: Math.round((a - b) * 10) / 10 })
    }
    if (!diffs.length) continue
    const score = diffs.reduce((s, d) => s + Math.abs(d.diff), 0) / diffs.length
    if (!best || score < best.score) best = { item: w, diffs, score }
  }
  return best
}

// "가슴 +4cm 큼" 같은 짧은 설명
export function describeDiff(d) {
  if (Math.abs(d.diff) < 1) return `${d.label} 비슷`
  const unit = d.part === 'footLength' ? 'mm' : 'cm'
  const sign = d.diff > 0 ? '+' : ''
  const word = d.part === 'topLength' || d.part === 'inseam' || d.part === 'outerLength' || d.part === 'dressLength' || d.part === 'arm'
    ? (d.diff > 0 ? '김' : '짧음')
    : (d.diff > 0 ? '큼' : '작음')
  return `${d.label} ${sign}${d.diff}${unit} ${word}`
}
