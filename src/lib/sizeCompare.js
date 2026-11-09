// 사이즈별·부위별 비교: 내 치수(직접 입력/추정) vs 옷 실측 vs 여유분 → 판정.
// 화면(웹 MeasureMatch, 확장 카드)이 같은 결과를 씁니다. 순수 함수라 DOM이 필요 없어요.
// 신체 비교 기준이 없는 부위(소매통·밑위·밑단·무릎·발볼·굽높이 등)는 추측하지 않고 실측만 보여줘요.
import { EASE_RULES, partVerdicts } from './fitEngine.js'
import { PART_LABEL, EXTRA_PART_LABEL, CATEGORY_PARTS } from '../data/measurements.js'

export const MEASURE_ONLY_LABEL = '실측만 표시(비교 기준 없음)'
export const NO_BODY_LABEL = '실측만 표시(내 치수 없음)'
// EASE_RULES 중 일반적인 착용감을 바탕으로 정한 휴리스틱 기준 (fitEngine.js 주석 참고)
export const HEURISTIC_PARTS = ['arm', 'footLength', 'topLength', 'outerLength', 'inseam', 'dressLength']
const LENGTH_PARTS = ['topLength', 'outerLength', 'inseam', 'dressLength']
const MM_PARTS = ['footLength', 'footWidth']

const round1 = (v) => Math.round(v * 10) / 10
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

export const partLabel = (part) => (LENGTH_PARTS.includes(part) ? '총장' : PART_LABEL[part] || EXTRA_PART_LABEL[part] || part)
export const partUnit = (part) => (MM_PARTS.includes(part) ? 'mm' : 'cm')

/**
 * chart: { rows, measures, display, category }  bodyValues: bodyValuesForProfile().values  measured: Set|Array(직접 잰 부위)
 * @returns {{ sizes: Array<{ size, label, rows: Array }>, measureOnlyParts: string[], hasComparable: boolean }}
 * row: { part, label, unit, garment, body, bodyKind('measured'|'review'|'estimated'|'standard'|null; review = 후기로 보정한 추정), ease, verdict, level, key, isLength, basis('rule'|'heuristic'|'none'), note }
 */
export function compareSizes({ chart, bodyValues = {}, measured = [], category, calibration = {}, learned = null, reviewParts = {}, photoParts = [] }) {
  if (!chart?.measures) return { sizes: [], measureOnlyParts: [], hasComparable: false }
  const cat = category || chart.category
  const mine = measured instanceof Set ? measured : new Set(measured)
  const labels = [...new Set([...(chart.rows || []).map((r) => String(r[0]).toUpperCase()), ...Object.keys(chart.measures).map((k) => k.toUpperCase())])]
  const sizes = []
  const onlyParts = new Set()
  let hasComparable = false
  for (const size of labels) {
    const key = Object.keys(chart.measures).find((k) => k.toUpperCase() === size)
    const m = key == null ? null : chart.measures[key]
    if (!m) continue
    const judged = new Map(partVerdicts(bodyValues, m, cat, calibration, learned).map((v) => [v.part, v]))
    const order = [...new Set([...(CATEGORY_PARTS[cat] || []).filter((p) => p in m), ...Object.keys(m)])]
    const rows = []
    for (const part of order) {
      const garment = m[part]
      if (!isNum(garment)) continue
      const v = judged.get(part)
      const isLength = LENGTH_PARTS.includes(part)
      const basis = !EASE_RULES[part] ? 'none' : HEURISTIC_PARTS.includes(part) ? 'heuristic' : 'rule'
      if (v) {
        rows.push({
          part, label: v.label, unit: v.unit, garment, body: v.body,
          bodyKind: part === 'inseam' && mine.has('leg') ? 'leg' : isLength ? 'standard' : mine.has(part) ? 'measured' : reviewParts?.[part] ? 'review' : photoParts.includes(part) ? 'photo' : 'estimated',
          ease: v.ease, verdict: v.verdict, level: v.level, key: v.key, isLength, basis, note: basis === 'heuristic' ? '휴리스틱 기준' : '',
        })
        hasComparable = true
      } else {
        if (basis === 'none') onlyParts.add(part)
        rows.push({
          part, label: partLabel(part), unit: partUnit(part), garment, body: null, bodyKind: null,
          ease: null, verdict: null, level: null, key: null, isLength, basis: 'none',
          note: basis === 'none' ? MEASURE_ONLY_LABEL : NO_BODY_LABEL,
        })
      }
    }
    if (rows.length) sizes.push({ size, label: chart.display?.[size] || size, rows })
  }
  return { sizes, measureOnlyParts: [...onlyParts], hasComparable }
}

/** 확장 카드용으로 줄인 값 (문자열·숫자만). 페이지 글은 담지 않아요. */
export function compactCompare(cmp) {
  return {
    sizes: cmp.sizes.map((s) => ({
      size: s.size,
      label: s.label,
      rows: s.rows.map((r) => ({
        label: r.label, unit: r.unit, garment: r.garment, body: r.body, bodyKind: r.bodyKind, ease: r.ease,
        verdict: r.verdict, level: r.level, key: r.key, isLength: r.isLength, note: r.note,
      })),
    })),
  }
}
