// 후기 → 학습 샘플 변환 (순수 함수). 웹 앱과 확장이 같은 함수를 써요.
//
// 샘플에 담는 것: 종류(category), 브랜드 키, 라벨(small/true/large), 가중치, 부위별 여유분(0.5cm 단위), 날짜(일 번호), 중복 방지 id.
// 담지 않는 것: 닉네임, 후기 본문, 사진 주소, 상품명, 상품 주소, 키·몸무게(구간으로도 안 남겨요), 성별, 사이즈 이름.
//
// 키·몸무게를 구간화하지 않고 아예 버리는 이유: contribution.js의 기여 레코드는 서버로 나가서 체형별 통계를 내야 해서
// 5cm·5kg 구간이 필요해요. 반면 학습 샘플은 이 브라우저 안에서 "여유분 → 라벨"만 필요해서 키·몸무게 자체가 필요 없어요.
// 여유분(옷 실측 - 추정 몸 치수)은 사이즈 이름 없이는 되돌려 키·몸무게를 알아내기 어려워서, 구간보다 더 적게 남기는 쪽을 골랐어요.
// 중복 방지 id는 (상품 주소·사이즈·키·몸무게·핏·본문 앞부분)의 해시라서 원문을 복원할 수 없어요.
import { bodyValuesForProfile, screenReviews, EASE_RULES } from './fitEngine.js'
import { brandKeyOf } from './learnedModel.js'

const FITS = ['small', 'true', 'large']
const LEARN_CATEGORIES = ['top', 'bottom', 'outer', 'dress'] // 사이즈표 실측으로 여유분을 구할 수 있는 종류. 신발은 제외
const MAX_PER_PRODUCT = 60

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const normKey = (s) => String(s ?? '').replace(/\s/g, '').toUpperCase()
const tokenOf = (k) => (k.match(/^\d{1,2}\(([^)]+)\)$/) || [])[1] || null

function hash(s) {
  let a = 5381
  let b = 52711
  for (let i = 0; i < s.length; i++) {
    a = ((a * 33) ^ s.charCodeAt(i)) >>> 0
    b = ((b * 31 + s.charCodeAt(i)) ^ (b >>> 7)) >>> 0
  }
  return a.toString(36) + b.toString(36)
}

function chartKeyFor(measures, size) {
  const k = normKey(size)
  return Object.keys(measures).find((c) => normKey(c) === k) ?? Object.keys(measures).find((c) => tokenOf(normKey(c)) === k) ?? null
}

/** 일 번호(1970-01-01부터 며칠째). 오래된 샘플부터 정리할 때만 써요. */
export const dayNumber = (now = Date.now()) => Math.floor(now / 86400000)

/**
 * 상품 하나의 후기에서 학습 샘플을 만들어요. 이상치로 제외된 후기는 쓰지 않고, 라벨 이상치는 가중치(labelWeight)를 반영해요.
 * @param {object} product { category, sizeChart, reviews, optionLabels, brand?, url? }
 * @param {{ now?: number, pageUrl?: string }} opts
 */
export function toSamples(product, opts = {}) {
  if (!product || !LEARN_CATEGORIES.includes(product.category) || !product.sizeChart?.measures) return []
  const url = opts.pageUrl || product.url || ''
  const brand = brandKeyOf({ ...product, url })
  const day = dayNumber(opts.now)
  const { kept } = screenReviews(product.reviews || [], product)
  const out = []
  for (const r of kept) {
    if (out.length >= MAX_PER_PRODUCT) break
    if (!FITS.includes(r.fit) || r.size == null || !isNum(r.height) || !isNum(r.weight)) continue
    if (r.gender !== 'male' && r.gender !== 'female') continue
    const key = chartKeyFor(product.sizeChart.measures, r.size)
    const measures = key == null ? null : product.sizeChart.measures[key]
    if (!measures) continue
    const body = bodyValuesForProfile({ gender: r.gender, height: r.height, weight: r.weight }).values
    const e = {}
    for (const part of Object.keys(EASE_RULES)) {
      if (part === 'footLength' || !isNum(measures[part]) || !isNum(body[part])) continue
      e[part] = Math.round((measures[part] - body[part]) * 2) / 2
    }
    if (Object.keys(e).length === 0) continue
    const text = String(r.text ?? r.view?.body ?? '').slice(0, 200)
    out.push({
      id: hash([url, product.category, normKey(r.size), r.height, r.weight, r.fit, text].join('\u0000')),
      cat: product.category,
      brand,
      label: r.fit,
      w: isNum(r.labelWeight) ? r.labelWeight : 1,
      e,
      d: day,
    })
  }
  return out
}

/** id로 중복을 걸러 합치고, 상한을 넘으면 오래된 것(날짜가 작은 것, 같으면 먼저 들어온 것)부터 버려요. */
export function mergeSamples(existing, incoming, max) {
  const seen = new Set()
  const merged = []
  for (const s of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!s || typeof s.id !== 'string' || seen.has(s.id)) continue
    seen.add(s.id)
    merged.push(s)
  }
  const overflow = Math.max(0, merged.length - max)
  if (overflow === 0) return { samples: merged, dropped: 0 }
  const order = merged.map((s, i) => ({ s, i })).sort((a, b) => (a.s.d ?? 0) - (b.s.d ?? 0) || a.i - b.i)
  const drop = new Set(order.slice(0, overflow).map((x) => x.i))
  return { samples: merged.filter((_, i) => !drop.has(i)), dropped: overflow }
}
