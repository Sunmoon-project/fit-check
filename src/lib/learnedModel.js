// 학습값 묶음(model params): 후기 학습 샘플로 만든 "카테고리별 여유분 기준 보정"과 "브랜드별 cm 오프셋".
// 순수 함수만 있어요. 브라우저(localStorage / chrome.storage.local)에서 만든 묶음이든, 나중에 서버가 만든 묶음이든
// 같은 모양이면 같은 코드(resolveLearned)로 읽어 판정에 써요. 이번 단계에서 서버 업로드는 구현하지 않아요.
//
// 아래 숫자(표본 수 기준, 섞는 세기, 한계)는 설계상의 판단이고, 실제 후기로 정확도를 재서 정한 값이 아니에요.
// 학습값이 판정을 실제로 더 정확하게 만든다는 검증은 아직 없어요.
//
// 모델 모양:
// { schemaVersion, trainedDay, sampleCount,
//   categories: { [category]: { n, rules: { [part]: { tight, snug, regular, relaxed, n } } } },
//   brands: { [category]: { [brand]: { offset, n } } } }
import { toDomain } from './contribution.js'

export const LEARN_SCHEMA_VERSION = 1

export const LEARN = Object.freeze({
  minGroup: 3, // 라벨(small/true/large) 한 묶음이 이 건수 미만이면 그 경계는 추정하지 않고 prior 유지
  priorStrength: 20, // 표본(가중치 합)이 이만큼이면 학습값과 prior를 절반씩 섞어요. 0건이면 prior 100%
  maxShift: 5, // 기준 하나를 prior에서 최대 이만큼(cm)만 옮겨요
  brandMin: 3, // 브랜드 표본이 이 건수 미만이면 오프셋 0
  brandStrength: 10, // 브랜드 표본이 이만큼이면 관측값의 절반만 반영(축소 추정, shrinkage)
  maxBrandOffset: 4, // 브랜드 오프셋 한계(cm)
  maxSamples: 500, // 저장하는 샘플 수 상한
  maxBytes: 200000, // 저장 용량 상한(JSON 글자 수 기준)
})

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const round1 = (v) => Math.round(v * 10) / 10
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const LABELS = ['small', 'true', 'large']
const BRAND_MAX_LEN = 40

/** 브랜드 키: product.learnBrand → product.brand → 알려진 쇼핑몰 도메인(없으면 null). 소문자·공백 제거. */
export function brandKeyOf(product) {
  const raw = product?.learnBrand ?? product?.brand ?? (product?.url ? toDomain(product.url) : null)
  if (typeof raw !== 'string') return null
  const k = raw.trim().toLowerCase().replace(/\s+/g, '').slice(0, BRAND_MAX_LEN)
  return k || null
}

export function emptyModel() {
  return { schemaVersion: LEARN_SCHEMA_VERSION, trainedDay: 0, sampleCount: 0, categories: {}, brands: {} }
}

/** 스키마 버전이 다르거나 모양이 틀리면 null (호출한 쪽이 폐기하고 샘플에서 다시 만들어요). */
export function validateModel(m) {
  if (!m || typeof m !== 'object' || m.schemaVersion !== LEARN_SCHEMA_VERSION) return null
  if (!m.categories || typeof m.categories !== 'object' || !m.brands || typeof m.brands !== 'object') return null
  if (!isNum(m.sampleCount)) return null
  return m
}

// ---------- 견고 통계 ----------
function weightedMedian(items) {
  const s = items.filter((x) => isNum(x.v) && x.w > 0).sort((a, b) => a.v - b.v)
  if (!s.length) return null
  const total = s.reduce((n, x) => n + x.w, 0)
  let acc = 0
  for (const x of s) {
    acc += x.w
    if (acc >= total / 2) return x.v
  }
  return s[s.length - 1].v
}
const wsum = (items) => items.reduce((n, x) => n + x.w, 0)

/**
 * 샘플 → 학습값 묶음.
 * 라벨별(small/true/large) 여유분의 가중 중앙값 사이의 중간점을 경계 추정치로 써요(이상치에 덜 흔들려요).
 *   snug 경계 ≈ (small 중앙값 + true 중앙값) / 2,  relaxed 경계 ≈ (true 중앙값 + large 중앙값) / 2
 * 추정치는 prior(EASE_RULES)와 표본 수에 따라 섞어요: 비중 = n / (n + priorStrength). 표본 0이면 prior 그대로.
 * @param {object[]} samples { cat, brand, label, w, e: {part: ease} }
 * @param {object} prior EASE_RULES (부위별 { tight, snug, regular, relaxed })
 */
export function trainModel(samples, prior, trainedDay = 0) {
  const list = (Array.isArray(samples) ? samples : []).filter((s) => s && LABELS.includes(s.label) && s.cat && s.e && isNum(s.w) && s.w > 0)
  const model = { ...emptyModel(), trainedDay, sampleCount: list.length }

  const byCat = new Map()
  for (const s of list) byCat.set(s.cat, [...(byCat.get(s.cat) || []), s])

  for (const [cat, rows] of byCat) {
    const rules = {}
    for (const part of Object.keys(prior)) {
      if (part === 'footLength') continue // 신발 mm 기준은 학습하지 않아요
      const g = { small: [], true: [], large: [] }
      for (const s of rows) if (isNum(s.e[part])) g[s.label].push({ v: s.e[part], w: s.w })
      const ok = (l) => g[l].length >= LEARN.minGroup
      const med = (l) => weightedMedian(g[l])
      const rule = prior[part]
      let ds = 0
      let dr = 0
      if (ok('small') && ok('true')) {
        const lambda = (wsum(g.small) + wsum(g.true)) / (wsum(g.small) + wsum(g.true) + LEARN.priorStrength)
        ds = clamp(lambda * ((med('small') + med('true')) / 2 - rule.snug), -LEARN.maxShift, LEARN.maxShift)
      }
      if (ok('true') && ok('large')) {
        const lambda = (wsum(g.true) + wsum(g.large)) / (wsum(g.true) + wsum(g.large) + LEARN.priorStrength)
        dr = clamp(lambda * ((med('true') + med('large')) / 2 - rule.relaxed), -LEARN.maxShift, LEARN.maxShift)
      }
      if (ds === 0 && dr === 0) continue
      const next = {
        tight: round1(rule.tight + ds),
        snug: round1(rule.snug + ds),
        regular: round1(rule.regular + (ds + dr) / 2),
        relaxed: round1(rule.relaxed + dr),
        n: g.small.length + g.true.length + g.large.length,
      }
      // 경계 순서가 뒤집히면 이 부위는 prior를 유지해요.
      if (next.tight < next.snug && next.snug < next.regular && next.regular < next.relaxed) rules[part] = next
    }
    model.categories[cat] = { n: rows.length, rules }

    // 브랜드 오프셋: 학습된 카테고리 기준 대비, 같은 여유분에서 라벨이 한쪽으로 쏠리는 정도(cm).
    // 'small'이면 기준 snug를 넘는 만큼, 'large'면 relaxed에 못 미치는 만큼, 'true'면 목표 여유 중앙과의 차이를 모아 가중 평균해요.
    const brands = {}
    const byBrand = new Map()
    for (const s of rows) if (s.brand) byBrand.set(s.brand, [...(byBrand.get(s.brand) || []), s])
    for (const [brand, bs] of byBrand) {
      if (bs.length < LEARN.brandMin) continue
      let sum = 0
      let w = 0
      for (const s of bs) {
        for (const [part, ease] of Object.entries(s.e)) {
          const r = rules[part] || prior[part]
          if (!r || part === 'footLength' || !isNum(ease)) continue
          let d = null
          if (s.label === 'small') d = Math.max(0, ease - r.snug)
          else if (s.label === 'large') d = Math.min(0, ease - r.relaxed)
          else d = ease - (r.snug + r.regular) / 2
          sum += d * s.w
          w += s.w
        }
      }
      if (w === 0) continue
      const raw = sum / w
      const shrink = bs.length / (bs.length + LEARN.brandStrength)
      const offset = round1(clamp(raw * shrink, -LEARN.maxBrandOffset, LEARN.maxBrandOffset))
      brands[brand] = { offset, n: bs.length }
    }
    if (Object.keys(brands).length) model.brands[cat] = brands
  }
  return model
}

/**
 * 판정에 쓸 모습으로 풀어요. 묶음이 없거나 버전이 다르면 null (= 기존 동작 그대로).
 * @returns {{ rules: object, offset: number, categorySamples: number, brandSamples: number, total: number, brand: string|null, applied: boolean }|null}
 */
export function resolveLearned(model, category, brand = null) {
  const m = validateModel(model)
  if (!m) return null
  const cat = m.categories[category]
  const b = brand ? m.brands[category]?.[brand] : null
  const rules = cat?.rules || {}
  const offset = b?.offset || 0
  return {
    rules,
    offset,
    categorySamples: cat?.n || 0,
    brandSamples: b?.n || 0,
    total: m.sampleCount,
    brand: brand || null,
    applied: Object.keys(rules).length > 0 || offset !== 0,
  }
}

/** 화면에 보일 상태 한 줄과 값. model이 없거나 샘플이 0건이면 null. */
export function learningStatus(model, category, brand = null) {
  const m = validateModel(model)
  if (!m || m.sampleCount <= 0) return null
  const r = resolveLearned(m, category, brand)
  const used = r.applied
  const text = used
    ? `학습값 사용 중(샘플 ${r.categorySamples}건)`
    : `학습값 모으는 중(전체 샘플 ${m.sampleCount}건, 이 종류는 아직 적용할 차이가 없어요)`
  return { used, total: m.sampleCount, categorySamples: r.categorySamples, brandSamples: r.brandSamples, text }
}

export const LEARNING_NOTE = '이 브라우저에 모은 후기로 판정 기준을 조금 옮긴 값이에요. 정확도를 잰 값은 아니에요.'
export const LEARNING_STORAGE_NOTE = '학습 샘플은 이 브라우저에만 저장돼요(서버로 보내지 않아요).'
