// 신발 전용 사이즈 비교 (순수 함수). 확장과 웹이 함께 써요.
// 옵션 'NNN (NNN-NNN)' 읽기, 리뷰 '만족도' 문구 읽기, 발길이·발볼 기준 추천, 구매 사이즈별 리뷰 집계.
// 추천 규칙은 일반적인 착용감을 바탕으로 한 휴리스틱이고, 정확도를 측정한 값이 아니에요.
import { EASE_RULES, SHOE_WINDOW, SHOE_VERDICTS, FIT_PREF_LABEL, classifyEase, classifyShoeEase, bodyValuesForProfile } from './fitEngine.js'

export const FOOT_WIDTH_LABEL = { narrow: '좁은 편', normal: '보통', wide: '넓은 편' }
export const FOOT_WIDTHS = Object.keys(FOOT_WIDTH_LABEL)
export const SHOE_HEURISTIC_NOTE = '신발 추천은 일반적인 착용감을 바탕으로 한 휴리스틱이에요. 브랜드·라스트마다 달라서 참고용으로만 봐주세요.'
const MIN_REVIEWS_FOR_BUMP = 3

const OPTION_RE = /^(2[2-9]\d|3[01]\d)(?:\s*\(\s*(2[2-9]\d|3[01]\d)\s*-\s*(2[2-9]\d|3[01]\d)\s*\)|(?:\s*(?:mm|㎜))?(?![\d.]))/i

/** '250 (250-255)' 또는 '250' → { label, mm, lo, hi }. 읽을 수 없으면 null. 라벨은 원문 그대로 둬요. */
export function parseShoeOption(text) {
  const t = String(text ?? '').trim()
  const m = t.match(OPTION_RE)
  if (!m) return null
  const mm = Number(m[1])
  const lo = m[2] ? Number(m[2]) : mm
  const hi = m[3] ? Number(m[3]) : mm
  if (hi < lo) return null
  return { label: m[2] ? `${m[1]} (${m[2]}-${m[3]})` : m[1], mm, lo, hi }
}

/** 옵션 글 목록 → 중복 없는 { label, mm, lo, hi } 목록 (mm 오름차순) */
export function parseShoeOptions(labels) {
  const seen = new Set()
  const out = []
  for (const l of labels || []) {
    const o = parseShoeOption(l)
    if (!o || seen.has(o.mm)) continue
    seen.add(o.mm)
    out.push(o)
  }
  return out.sort((a, b) => a.mm - b.mm)
}

// ---------- 리뷰 '만족도' 문구 ----------
// 예: '사이즈 정사이즈 · 발볼 넓이 적당함 · 착용감 아주 편함 · 발목·종아리 둘레 조금 넉넉 · 착용 편리성 아주 편함'
const SIZE_STEP = [
  [/반\s*사이즈|반\s*치수/, 0.5],
  [/한\s*사이즈|한\s*치수|1\s*사이즈/, 1],
]
function feelSize(value) {
  const v = String(value)
  if (/정\s*사이즈|딱\s*맞|정사이즈/.test(v)) return { size: 'true', step: 0 }
  // 부정형('작지도 크지도 않음', '작지 않아요', '크지 않음')은 정사이즈로 읽어요.
  if (/(작|크)지\s*(도|는)?\s*(않|없)|(작|크)지도\s*(크|작)지도/.test(v)) return { size: 'true', step: 0 }
  const dir = /작/.test(v) ? 'small' : /크|큼|커/.test(v) ? 'large' : null
  if (!dir) return null
  const step = (SIZE_STEP.find(([re]) => re.test(v)) || [null, 0])[1]
  return { size: dir, step }
}
function feelWidth(value) {
  const v = String(value).replace(/넓이/g, '')
  if (/좁/.test(v)) return 'narrow'
  if (/넓/.test(v)) return 'wide'
  if (/적당|보통|딱|알맞/.test(v)) return 'normal'
  return null
}

/**
 * 만족도 문구를 항목별로 나눠요. 읽지 못한 항목은 null.
 * @returns {{ size: 'true'|'small'|'large'|null, sizeStep: number, sizeText: string, width: 'narrow'|'normal'|'wide'|null, widthText: string, extras: {label:string, value:string}[] } | null}
 */
export function parseShoeFeel(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  // '발목·종아리 둘레'의 가운뎃점은 구분자가 아니에요.
  const items = raw.replace(/발목\s*[·ㆍ]\s*종아리/g, '발목/종아리').split(/\s*[·ㆍ•]\s*/).map((s) => s.trim()).filter(Boolean)
  const out = { size: null, sizeStep: 0, sizeText: '', width: null, widthText: '', extras: [] }
  for (const it of items) {
    const sp = it.search(/\s/)
    const label = sp < 0 ? it : it.slice(0, sp)
    const value = sp < 0 ? '' : it.slice(sp + 1).trim()
    if (label === '사이즈' && out.size == null) {
      const f = feelSize(value)
      if (f) Object.assign(out, { size: f.size, sizeStep: f.step, sizeText: value })
      continue
    }
    if (label === '발볼' && out.width == null) {
      const w = feelWidth(value)
      if (w) Object.assign(out, { width: w, widthText: value.replace(/^넓이\s*/, '') })
      continue
    }
    const x = it.match(EXTRA_LABEL_RE)
    const lbl = (x ? x[1] : label).replace('발목/종아리', '발목·종아리')
    const val = x ? it.slice(x[1].length).trim() : value
    out.extras.push({ label: lbl, value: val })
  }
  return out.size || out.width || out.extras.length ? out : null
}

// 라벨이 두 단어 이상인 항목
const EXTRA_LABEL_RE = /^(발목\/종아리 둘레|착용 편리성|발등 높이|발등 둘레)(?:\s|$)/
const SIZE_FEEL_LABEL = { true: '정사이즈', small: '작아요', large: '커요' }
export function feelSizeText(f) {
  if (!f?.size) return ''
  if (f.size === 'true') return '정사이즈'
  return `${f.sizeStep === 0.5 ? '반 사이즈 ' : f.sizeStep === 1 ? '한 사이즈 ' : ''}${SIZE_FEEL_LABEL[f.size]}`
}

// ---------- 리뷰 집계 ----------
const WIDTH_SHORT = { narrow: '좁음', normal: '적당', wide: '넓음' }

/** 리뷰 목록([{ size, view:{shoeFeel} }]) → 구매 사이즈(mm)별 집계 */
export function aggregateShoeReviews(reviews) {
  const by = new Map()
  for (const r of reviews || []) {
    const mm = Number(String(r?.size ?? '').match(/\d{3}/)?.[0])
    if (!Number.isFinite(mm)) continue
    // 만족도 문구가 없으면 일반 핏 평가(작아요/정사이즈/커요)를 체감으로 써요.
    const f = r.view?.shoeFeel || (r.fit ? { size: r.fit, sizeStep: 0 } : null)
    const a = by.get(mm) || { mm, count: 0, felt: 0, size: { true: 0, small: 0, large: 0 }, width: { narrow: 0, normal: 0, wide: 0 } }
    a.count += 1
    if (f?.size) {
      a.size[f.size] += 1
      a.felt += 1
    }
    if (f?.width) a.width[f.width] += 1
    by.set(mm, a)
  }
  return [...by.values()].sort((a, b) => a.mm - b.mm)
}

/** '250 구매 리뷰 8건 중 정사이즈 6 · 작아요 1 · 커요 1, 발볼 적당 5 · 좁음 2' */
export function reviewAggregateLine(a) {
  const parts = []
  const s = ['true', 'small', 'large'].filter((k) => a.size[k] > 0).map((k) => `${SIZE_FEEL_LABEL[k]} ${a.size[k]}`)
  if (s.length) parts.push(s.join(' · '))
  const w = ['narrow', 'normal', 'wide'].filter((k) => a.width[k] > 0).sort((x, y) => a.width[y] - a.width[x]).map((k) => `${WIDTH_SHORT[k]} ${a.width[k]}`)
  if (w.length) parts.push(`발볼 ${w.join(' · ')}`)
  return `${a.mm} 구매 리뷰 ${a.count}건${parts.length ? ` 중 ${parts.join(', ')}` : ''}`
}

// ---------- 사이즈표 발볼 열 ----------
// 사이즈표의 발볼(mm / E·2E·3E·4E / 좁음·보통·넓음)을 같은 표 안의 중간값과 견줘 '좁은 편/보통/넓은 편'으로 바꿔요.
// 브랜드마다 재는 방식이 달라서 절대값이 아닌 표 안에서의 상대 비교이고, 휴리스틱이에요.
const WIDTH_MM_GAP = 3
const WIDTH_LEVEL_GAP = 1
const LEVEL_NAME = { '-1': 'D', 0: 'E', 1: '2E', 2: '3E', 3: '4E' }
function median(nums) {
  const a = [...nums].sort((x, y) => x - y)
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}
/** 사이즈표 → { [mm]: { value, kind:'mm'|'level' } } (mm 사이즈 이름만). 발볼 열이 없으면 빈 객체. */
export function chartWidthsByMm(sizeChart) {
  const out = {}
  const put = (label, value, kind) => {
    const o = parseShoeOption(label)
    if (o && !out[o.mm]) out[o.mm] = { value, kind }
  }
  for (const [label, m] of Object.entries(sizeChart?.measures || {})) {
    if (Number.isFinite(m?.footWidth)) put(label, m.footWidth, 'mm')
  }
  for (const [label, v] of Object.entries(sizeChart?.widthLevels || {})) {
    if (Number.isFinite(v)) put(label, v, 'level')
  }
  return out
}
/** 옵션별 상대 발볼. 같은 종류 값이 2개 이상일 때만 만들어요. */
function relativeWidths(opts, widths) {
  const have = opts.filter((o) => widths?.[o.mm])
  const kind = ['mm', 'level'].find((k) => have.filter((o) => widths[o.mm].kind === k).length >= 2)
  if (!kind) return null
  const used = have.filter((o) => widths[o.mm].kind === kind)
  const med = median(used.map((o) => widths[o.mm].value))
  const gap = kind === 'mm' ? WIDTH_MM_GAP : WIDTH_LEVEL_GAP
  const byMm = {}
  for (const o of used) {
    const v = widths[o.mm].value
    byMm[o.mm] = { value: v, text: kind === 'mm' ? `${v}mm` : (LEVEL_NAME[v] ?? String(v)), rel: v - med <= -gap ? 'narrow' : v - med >= gap ? 'wide' : 'normal' }
  }
  return { kind, median: med, medianText: kind === 'mm' ? `${med}mm` : (LEVEL_NAME[med] ?? String(med)), byMm }
}
const REL_LABEL = { narrow: '표 중간값보다 좁은 편', normal: '표 중간값 수준', wide: '표 중간값보다 넓은 편' }

// ---------- 추천 ----------
// 선호 핏 목표 여유(mm, 휴리스틱): 슬림 0 / 레귤러 2 / 여유 8. 허용 구간(SHOE_WINDOW) 안에서만 골라요.
const TARGET_EASE = { slim: 0, regular: 2, relaxed: 8 }
function targetEase(pref) {
  return TARGET_EASE[pref] ?? TARGET_EASE.regular
}

/**
 * 옵션 하나의 판정. 범위 옵션 [lo,hi]가 허용 구간 [foot-5, foot+10]과 겹치면 허용해요 (휴리스틱).
 * 대표값은 lo이고, lo가 구간 아래인데 범위가 겹치면 max(lo, foot-5)로 판정해요 (애매).
 * 범위 전체가 구간 밖이면 부적합이고, 표시 여유는 lo - foot 이에요.
 */
export function shoeOptionVerdict(o, foot) {
  const lowEdge = foot + SHOE_WINDOW.minEase
  const highEdge = foot + SHOE_WINDOW.maxEase
  const lo = Number.isFinite(o.lo) ? o.lo : o.mm
  const hi = Number.isFinite(o.hi) ? o.hi : o.mm
  const overlaps = hi >= lowEdge && lo <= highEdge
  const eff = overlaps ? Math.max(lo, lowEdge) : lo
  const ease = Math.round((eff - foot) * 10) / 10
  const v = classifyShoeEase(ease)
  return { ease, verdict: v, fit: v.level >= 1 && v.level <= 3, unfit: v.level === 0 ? 'small' : v.level === 4 ? 'large' : null }
}

/**
 * @param {{ options: {label,mm,lo,hi}[], footLength: number|null, footLengthEstimated?: boolean, footWidth?: string, preferredFit?: string, reviews?: object[], sizeWidths?: object|null }} input
 * sizeWidths: chartWidthsByMm 결과. 사이즈표에 발볼이 있으면 그 값으로만 발볼을 따지고, 없을 때만 '넓은 발이면 한 단계 위' 기본 규칙을 써요.
 * 추천은 허용 구간 안의 사이즈 중에서만 골라요. 발볼·리뷰 보정도 한 단계 옮긴 결과가 허용 사이즈일 때만 적용해요.
 */
export function recommendShoe({ options, footLength, footLengthEstimated = false, footWidth = '', preferredFit = 'regular', reviews = [], sizeWidths = null }) {
  const opts = (options || []).filter((o) => Number.isFinite(o?.mm)).sort((a, b) => a.mm - b.mm)
  const aggs = aggregateShoeReviews(reviews)
  const aggOf = (mm) => aggs.find((a) => a.mm === mm) || null
  const hasFoot = Number.isFinite(footLength) && footLength > 0
  const width = FOOT_WIDTHS.includes(footWidth) ? footWidth : ''
  const rel = relativeWidths(opts, sizeWidths)
  const rows = opts.map((o) => {
    const j = hasFoot ? shoeOptionVerdict(o, footLength) : null
    const verdict = j?.verdict || null
    const agg = aggOf(o.mm)
    return {
      label: o.label,
      mm: o.mm,
      lo: o.lo,
      hi: o.hi,
      rangeText: o.hi > o.lo ? `${o.lo}~${o.hi}mm` : `${o.mm}mm`,
      ease: j ? j.ease : null,
      verdict: verdict?.label || null,
      verdictKey: verdict?.key || null,
      level: verdict?.level ?? null,
      fit: j ? j.fit : false,
      unfit: j ? j.unfit : null,
      widthText: rel?.byMm[o.mm] ? `발볼 ${rel.byMm[o.mm].text}` : '',
      reviewCount: agg?.count || 0,
      reviewLine: agg ? reviewAggregateLine(agg) : '',
      recommended: false,
    }
  })
  const reasons = []
  const notes = []
  let recommended = null
  let noFit = null
  let widthLine = ''
  let widthBasis = rel ? 'chart' : null
  const win = hasFoot ? { min: footLength + SHOE_WINDOW.minEase, max: footLength + SHOE_WINDOW.maxEase } : null
  const winText = win ? `${win.min}~${win.max}mm` : ''
  const footText = hasFoot ? `${footLength}mm${footLengthEstimated ? '(키로 추정한 값)' : ''}` : ''
  if (rows.length && hasFoot) {
    reasons.push(`내 발길이 ${footText} 기준 허용 구간은 ${winText}예요. 이 구간 밖의 사이즈는 부적합으로 봐요. (휴리스틱)`)
    const allowed = rows.map((r, i) => i).filter((i) => rows[i].fit)
    if (allowed.length === 0) {
      // 맞는 사이즈가 하나도 없어요. 가장 가까운 사이즈와 차이만 알려요.
      const sorted = [...rows].sort((a, b) => Math.abs(a.ease) - Math.abs(b.ease) || a.mm - b.mm)
      const near = sorted[0]
      const allSmall = rows.every((r) => r.unfit === 'small')
      const allLarge = rows.every((r) => r.unfit === 'large')
      const diff = Math.round(Math.abs(near.ease) * 10) / 10
      const dir = near.ease < 0 ? 'small' : 'large'
      const dirText = dir === 'small' ? '작아요' : '커요'
      const which = allSmall ? '가장 큰 사이즈' : allLarge ? '가장 작은 사이즈' : '가장 가까운 사이즈'
      const message = `이 상품에는 내 발(${footLength}mm)에 맞는 사이즈가 없어요. ${which} ${near.mm}도 ${diff}mm ${dirText}.`
      noFit = { direction: allSmall ? 'small' : allLarge ? 'large' : 'mixed', size: near.mm, label: near.label, diff, side: dir, message, windowMin: win.min, windowMax: win.max }
    } else {
      const target = targetEase(preferredFit)
      // 목표 여유에 가장 가까운 허용 사이즈. 동률이면 더 큰 사이즈를 골라요 (발가락 공간이 남는 쪽).
      let idx = allowed[0]
      for (const i of allowed) {
        const d = Math.abs(rows[i].ease - target)
        const best = Math.abs(rows[idx].ease - target)
        if (d < best || (d === best && rows[i].ease >= rows[idx].ease)) idx = i
      }
      reasons.push(`선호 핏(${FIT_PREF_LABEL[preferredFit] || FIT_PREF_LABEL.regular})에서는 여유 ${target}mm 정도를 목표로 해서 ${rows[idx].label}이(가) 가장 알맞아요. (여유 ${rows[idx].ease > 0 ? '+' : ''}${rows[idx].ease}mm)`)
      const canMove = (to) => !!rows[to]?.fit
      let bumped = false // 발볼 때문에 한 단계 위로 옮김
      let lowered = false // 발볼 때문에 한 단계 아래로 옮김
      if (rel) {
        // 사이즈표 발볼 기준 (휴리스틱). 기본 '넓은 발' 규칙과 함께 쓰지 않아요.
        const here = rel.byMm[rows[idx].mm]
        const name = rows[idx].label
        if (!width) {
          widthLine = `사이즈표에 발볼이 있어요. 내 발볼을 입력하면(좁은 편·보통·넓은 편) 표의 발볼과 견줘 사이즈를 조정해요. (휴리스틱)`
        } else if (!here) {
          widthLine = `${name}의 발볼 값을 읽지 못해 발볼로는 사이즈를 바꾸지 않았어요. (사이즈표 발볼 기준, 휴리스틱)`
        } else if (width === 'wide' && here.rel === 'narrow' && idx < rows.length - 1 && !canMove(idx + 1)) {
          widthLine = `발볼이 넓은 편인데 ${name}의 사이즈표 발볼(${here.text})이 ${REL_LABEL.narrow}(${rel.medianText})이에요. 한 단계 큰 ${rows[idx + 1].label}은(는) 허용 구간(${winText}) 밖이라 올리지 않았어요. (사이즈표 발볼 기준, 휴리스틱)`
        } else if (width === 'wide' && here.rel === 'narrow' && idx < rows.length - 1) {
          idx += 1
          bumped = true
          widthLine = `발볼이 넓은 편인데 ${rows[idx - 1].label}의 사이즈표 발볼(${here.text})이 ${REL_LABEL.narrow}(${rel.medianText})이라 한 단계 큰 ${rows[idx].label}을(를) 골랐어요. (사이즈표 발볼 기준, 휴리스틱)`
        } else if (width === 'narrow' && here.rel === 'wide' && idx > 0 && canMove(idx - 1) && rows[idx - 1].ease >= EASE_RULES.footLength.snug) {
          idx -= 1
          lowered = true
          widthLine = `발볼이 좁은 편이고 ${rows[idx + 1].label}의 사이즈표 발볼(${here.text})이 ${REL_LABEL.wide}(${rel.medianText})이라 길이 여유를 지킬 수 있는 한 단계 작은 ${rows[idx].label}을(를) 골랐어요. (사이즈표 발볼 기준, 휴리스틱)`
        } else {
          widthLine = `${name}의 사이즈표 발볼은 ${here.text}로 ${REL_LABEL[here.rel]}이에요. 발볼이 ${FOOT_WIDTH_LABEL[width]}이라 발볼 때문에 사이즈를 바꾸지 않았어요. (사이즈표 발볼 기준, 휴리스틱)`
        }
      } else if (width === 'wide' && idx < rows.length - 1) {
        if (canMove(idx + 1)) {
          idx += 1
          bumped = true
          widthBasis = 'foot'
          reasons.push(`발볼이 넓은 편이라 한 단계 큰 ${rows[idx].label}을(를) 골랐어요.`)
        } else {
          notes.push(`발볼이 넓은 편이지만 한 단계 큰 ${rows[idx + 1].label}은(는) 허용 구간(${winText}) 밖이라 올리지 않았어요.`)
        }
      }
      // 같은 사이즈를 산 리뷰가 충분하고 '작아요'가 절반 이상이면 한 단계 위, '커요'가 절반 이상이면 한 단계 아래를 권해요.
      // 옮긴 결과가 허용 사이즈일 때만 옮기고, 막히면 이유를 notes에 남겨요.
      const agg = aggOf(rows[idx].mm)
      if (agg && agg.felt >= MIN_REVIEWS_FOR_BUMP) {
        const smallMany = agg.size.small / agg.felt >= 0.5
        const largeMany = agg.size.large / agg.felt >= 0.5
        if (smallMany && !bumped && !lowered && idx < rows.length - 1 && canMove(idx + 1)) {
          idx += 1
          reasons.push(`${rows[idx - 1].mm} 구매 리뷰 ${agg.felt}건 중 ${agg.size.small}건이 작다고 해서 한 단계 큰 ${rows[idx].label}을(를) 권해요.`)
        } else if (smallMany && !bumped && !lowered && idx < rows.length - 1) {
          notes.push(`${rows[idx].mm} 구매 리뷰에서 작다는 의견이 많지만, 한 단계 큰 ${rows[idx + 1].label}은(는) 허용 구간(${winText}) 밖이라 올리지 않았어요.`)
        } else if (largeMany && idx > 0 && !lowered && canMove(idx - 1)) {
          idx -= 1
          reasons.push(`${rows[idx + 1].mm} 구매 리뷰 ${agg.felt}건 중 ${agg.size.large}건이 크다고 해서 한 단계 작은 ${rows[idx].label}을(를) 권해요.`)
        } else if (largeMany && idx > 0 && !lowered) {
          notes.push(`${rows[idx].mm} 구매 리뷰에서 크다는 의견이 많지만, 한 단계 작은 ${rows[idx - 1].label}은(는) 허용 구간(${winText}) 밖이라 내리지 않았어요.`)
        } else if (largeMany && lowered) {
          notes.push(`${rows[idx].mm} 구매 리뷰에서 크다는 의견이 많지만, 발볼 때문에 이미 한 단계 작은 사이즈로 골랐어요.`)
        } else if (smallMany && bumped) {
          notes.push(`${rows[idx].mm} 구매 리뷰에서 작다는 의견이 많지만, 발볼 때문에 이미 한 단계 큰 사이즈로 골랐어요.`)
        } else if (smallMany && lowered) {
          notes.push(`${rows[idx].mm} 구매 리뷰에서 작다는 의견이 많지만, 발볼 때문에 한 단계 작은 사이즈로 골랐고 다시 올리지 않았어요.`)
        } else if (smallMany) {
          notes.push(`${rows[idx].mm} 구매 리뷰에서 작다는 의견이 많아요. 한 단계 큰 사이즈가 없어 그대로 두었어요.`)
        }
      }
      rows[idx].recommended = true
      recommended = rows[idx]
    }
  } else if (!hasFoot) {
    notes.push('발길이를 알 수 없어 추천하지 않았어요. 확장 아이콘의 ‘직접 잰 치수’에 발길이(mm)를 입력하면 사이즈별 여유를 계산해요.')
  }
  if (hasFoot && footLengthEstimated) notes.push('발길이를 입력하지 않아 키로 추정했어요. 직접 입력하면 더 정확해요.')
  if (!width && hasFoot && !rel && !noFit) notes.push('발볼을 입력하면(좁은 편·보통·넓은 편) 넓은 발에 맞춰 사이즈를 조정해요.')
  return {
    rows,
    recommended,
    noFit,
    window: win,
    windowText: hasFoot ? `내 발길이 ${footLength}mm 기준 허용 구간은 ${winText}예요. 이 구간 밖은 부적합이에요. (휴리스틱)` : '',
    footLength: hasFoot ? footLength : null,
    footLengthEstimated: hasFoot && footLengthEstimated,
    footWidth: width,
    footWidthLabel: width ? FOOT_WIDTH_LABEL[width] : '',
    reasons,
    widthLine,
    widthBasis: widthLine || widthBasis === 'foot' ? widthBasis : null,
    notes,
    reviewLines: aggs.map(reviewAggregateLine),
    reviewTotal: aggs.reduce((s, a) => s + a.count, 0),
    verdictLabels: SHOE_VERDICTS.map((v) => v.label).filter((l, i, a) => a.indexOf(l) === i),
    heuristicNote: SHOE_HEURISTIC_NOTE,
  }
}

/** 상품(옵션 'NNN (NNN-NNN)' 또는 mm 사이즈표) + 프로필 → 신발 비교 값. 옵션을 못 읽으면 null. */
export function shoeViewFor(product, profile) {
  let options = parseShoeOptions(product?.shoeOptionLabels)
  if (options.length === 0) options = parseShoeOptions(Object.keys(product?.sizeChart?.measures || {}))
  if (options.length === 0) return null
  const { values, measured } = bodyValuesForProfile(profile)
  return recommendShoe({
    options,
    footLength: values.footLength,
    footLengthEstimated: !measured.has('footLength'),
    footWidth: profile.footWidth,
    preferredFit: profile.preferredFit,
    reviews: product.reviews,
    sizeWidths: chartWidthsByMm(product?.sizeChart),
  })
}

/** 신발 카드의 요약·추천 이유 글. 옷용 문구(generateFitComment)를 쓰지 않고 신발 판정에서 만들어요. */
export function shoeCardText(shoe) {
  if (shoe.noFit) {
    return { headline: '맞는 사이즈가 없어요', body: shoe.noFit.message, summary: shoe.noFit.message, reasons: [shoe.windowText].filter(Boolean) }
  }
  const rec = shoe.recommended
  if (!rec) return { headline: '추천할 수 없어요', body: shoe.notes[0] || '', summary: shoe.notes[0] || '발길이를 알 수 없어 추천하지 않았어요.', reasons: [] }
  return {
    headline: `${rec.label} 사이즈를 추천해요`,
    body: shoe.heuristicNote,
    summary: `${rec.label} 추천 · 내 발길이 ${shoe.footLength}mm 기준 ${rec.verdict}(여유 ${rec.ease > 0 ? '+' : ''}${rec.ease}mm)`,
    reasons: [...shoe.reasons, shoe.widthLine].filter(Boolean),
  }
}

/** 엔진 결과를 신발 추천으로 통일해요 (추천 카드·선택 기본값·옷장·입어보기가 같은 사이즈를 가리킴). 신발 추천이 없으면 그대로 돌려줘요. */
export function withShoeRecommendation(result, shoe) {
  if (shoe?.noFit) return { ...result, recommendedSize: null, recommendedLabel: null, headline: '맞는 사이즈가 없어요', body: [shoe.noFit.message, shoe.windowText].filter(Boolean).join(' ') }
  const rec = shoe?.recommended
  if (!rec) return result
  return { ...result, recommendedSize: String(rec.mm), headline: `${rec.label} 사이즈를 추천해요`, body: [...shoe.reasons, shoe.widthLine].filter(Boolean).join(' ') || result.body }
}

// ---- 사이즈 이름이 mm가 아닌 신발 (US/UK/EU, S/M/L, FREE) ----
export const SHOE_UNSUPPORTED_NOTE = '판정 없음(사이즈 체계 미지원)'
export const SHOE_NO_FOOT_NOTE = '판정 없음(발길이를 알 수 없음)'
export const SHOE_STATUSES = ['unsupported', 'converted']
const MM_MIN = 220
const MM_MAX = 310
const round5 = (v) => Math.round(v / 5) * 5

/** 프로필 성별, 없으면 상품 이름에서 남/여를 찾아요. 모르면 null. */
export function shoeGender(profileGender, productName) {
  if (profileGender === 'male' || profileGender === 'female') return profileGender
  const n = String(productName ?? '').toLowerCase()
  if (/여성|우먼|women|woman|wmns|ladies|걸즈/.test(n)) return 'female'
  if (/남성|맨즈|men's|mens|\bmen\b|\bman\b/.test(n)) return 'male'
  return null
}

/**
 * 'US 9' · 'UK 8.5' · 'EU 42' · '42' → 대략적인 mm. 일반적인 환산표를 쓴 휴리스틱이라 브랜드마다 달라요.
 * US/UK는 성별(남/여)을 알아야 하고, EU는 남녀 공통이에요. 환산할 수 없으면 null.
 * 이미 mm인 이름은 여기서 다루지 않아요 (parseShoeOption).
 */
export function shoeSizeToMm(name, { gender = null, productName = '' } = {}) {
  const t = String(name ?? '').trim().replace(/\s+/g, ' ')
  let m = t.match(/^(US|UK|EU)\s*([0-9]{1,2}(?:\.5)?)$/i) || t.match(/^([0-9]{1,2}(?:\.5)?)\s*(US|UK|EU)$/i)
  let sys
  let num
  if (m) {
    const a = m[1].toUpperCase()
    sys = /^\d/.test(a) ? m[2].toUpperCase() : a
    num = Number(/^\d/.test(a) ? m[1] : m[2])
  } else if ((m = t.match(/^(3[5-9]|4[0-8])(?:\.5)?$/))) {
    sys = 'EU' // 35~48 숫자만 있으면 유럽 사이즈로 봐요
    num = Number(t)
  } else return null
  let mm
  if (sys === 'EU') {
    mm = round5((20 / 3) * num - 10) // EU 40 ≈ 255mm
    if (num < 35 || num > 48) return null
  } else {
    const g = shoeGender(gender, productName)
    if (!g) return null
    // 남성 US 7 = 250mm, 여성 US 8 = 250mm (한 사이즈 10mm). UK는 남성 US-1, 여성 US-2.
    if (sys === 'US') mm = g === 'male' ? 250 + (num - 7) * 10 : 250 + (num - 8) * 10
    else mm = 250 + (num - 6) * 10 // UK는 남성(US-1)·여성(US-2) 모두 UK 6 = 250mm
  }
  if (!(mm >= MM_MIN && mm <= MM_MAX)) return null
  return { mm, system: sys, approx: true, text: `${t} → 약 ${mm}mm (${sys} 환산표 기준 휴리스틱)` }
}

/** 신발 사이즈 이름 → { mm, converted: boolean, text } | null. mm 이름은 그대로, US/UK/EU는 환산해요. */
export function resolveShoeSizeMm(size, opts = {}) {
  const direct = parseShoeOption(size)
  if (direct) return { mm: direct.mm, converted: false, text: '' }
  const c = shoeSizeToMm(size, opts)
  return c ? { mm: c.mm, converted: true, text: c.text } : null
}

/**
 * 신발 옷장 항목에 넣을 판정 묶음. 조용히 비지 않게 항상 이유를 같이 돌려줘요.
 * - 이미 판정이 있으면 그대로 (status null)
 * - mm로 읽거나 환산할 수 있고 발길이를 알면 발길이 판정을 만들어요 (환산이면 status 'converted')
 * - 나머지(S/M/L, FREE, 알 수 없는 이름)는 status 'unsupported'
 * 반환: { verdicts, measures, status, note }
 */
export function shoeWardrobeFields({ product, size, verdicts = [], profile = null }) {
  if (verdicts.length) return { verdicts, measures: null, status: null, note: '' }
  const r = size == null || size === '' ? null : resolveShoeSizeMm(size, { gender: profile?.gender, productName: product?.name })
  if (!r) return { verdicts: [], measures: null, status: 'unsupported', note: SHOE_UNSUPPORTED_NOTE }
  const foot = profile ? bodyValuesForProfile(profile).values.footLength : null
  const base = { measures: { footLength: r.mm }, status: r.converted ? 'converted' : null, note: r.text }
  if (!Number.isFinite(foot) || !(foot > 0)) return { ...base, verdicts: [], status: 'unsupported', note: SHOE_NO_FOOT_NOTE }
  // 옷장 판정도 추천과 같은 허용 구간(옵션 범위 포함)을 써요.
  const opt = parseShoeOption(size)
  const { ease } = shoeOptionVerdict(opt && !r.converted ? opt : { mm: r.mm, lo: r.mm, hi: r.mm }, foot)
  const v = classifyEase('footLength', ease)
  return { ...base, verdicts: [{ part: 'footLength', label: '발길이', verdict: v.label, key: v.key, ease }] }
}
