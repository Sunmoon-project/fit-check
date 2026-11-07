// 신발 전용 사이즈 비교 (순수 함수). 확장과 웹이 함께 써요.
// 옵션 'NNN (NNN-NNN)' 읽기, 리뷰 '만족도' 문구 읽기, 발길이·발볼 기준 추천, 구매 사이즈별 리뷰 집계.
// 추천 규칙은 일반적인 착용감을 바탕으로 한 휴리스틱이고, 정확도를 측정한 값이 아니에요.
import { EASE_RULES, VERDICTS, classifyEase, bodyValuesForProfile } from './fitEngine.js'

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

// ---------- 추천 ----------
function targetEase(pref) {
  const r = EASE_RULES.footLength
  if (pref === 'slim') return r.snug
  if (pref === 'relaxed') return r.regular
  return (r.snug + r.regular) / 2
}

/**
 * @param {{ options: {label,mm,lo,hi}[], footLength: number|null, footLengthEstimated?: boolean, footWidth?: string, preferredFit?: string, reviews?: object[] }} input
 */
export function recommendShoe({ options, footLength, footLengthEstimated = false, footWidth = '', preferredFit = 'regular', reviews = [] }) {
  const opts = (options || []).filter((o) => Number.isFinite(o?.mm)).sort((a, b) => a.mm - b.mm)
  const aggs = aggregateShoeReviews(reviews)
  const aggOf = (mm) => aggs.find((a) => a.mm === mm) || null
  const hasFoot = Number.isFinite(footLength) && footLength > 0
  const width = FOOT_WIDTHS.includes(footWidth) ? footWidth : ''
  const rows = opts.map((o) => {
    const ease = hasFoot ? Math.round((o.mm - footLength) * 10) / 10 : null
    const verdict = ease == null ? null : classifyEase('footLength', ease)
    const agg = aggOf(o.mm)
    return {
      label: o.label,
      mm: o.mm,
      lo: o.lo,
      hi: o.hi,
      rangeText: o.hi > o.lo ? `${o.lo}~${o.hi}mm` : `${o.mm}mm`,
      ease,
      verdict: verdict?.label || null,
      verdictKey: verdict?.key || null,
      level: verdict?.level ?? null,
      reviewCount: agg?.count || 0,
      reviewLine: agg ? reviewAggregateLine(agg) : '',
      recommended: false,
    }
  })
  const reasons = []
  const notes = []
  let recommended = null
  if (rows.length && hasFoot) {
    const target = targetEase(preferredFit)
    let idx = 0
    rows.forEach((r, i) => {
      const d = Math.abs(r.ease - target)
      const best = Math.abs(rows[idx].ease - target)
      if (d < best || (d === best && r.ease >= 0)) idx = i
    })
    reasons.push(`내 발길이 ${footLength}mm${footLengthEstimated ? '(키로 추정한 값)' : ''} 기준으로 여유 ${Math.round(rows[idx].ease)}mm인 ${rows[idx].label}이(가) 가장 가까워요.`)
    let bumped = false
    if (width === 'wide' && idx < rows.length - 1) {
      idx += 1
      bumped = true
      reasons.push(`발볼이 넓은 편이라 한 단계 큰 ${rows[idx].label}을(를) 골랐어요.`)
    }
    // 같은 사이즈를 산 리뷰가 충분하고 '작아요'가 절반 이상이면 한 단계 위, '커요'가 절반 이상이면 한 단계 아래를 권해요.
    const agg = aggOf(rows[idx].mm)
    if (agg && agg.felt >= MIN_REVIEWS_FOR_BUMP) {
      const smallMany = agg.size.small / agg.felt >= 0.5
      const largeMany = agg.size.large / agg.felt >= 0.5
      if (smallMany && !bumped && idx < rows.length - 1) {
        idx += 1
        reasons.push(`${rows[idx - 1].mm} 구매 리뷰 ${agg.felt}건 중 ${agg.size.small}건이 작다고 해서 한 단계 큰 ${rows[idx].label}을(를) 권해요.`)
      } else if (largeMany && idx > 0) {
        idx -= 1
        reasons.push(`${rows[idx + 1].mm} 구매 리뷰 ${agg.felt}건 중 ${agg.size.large}건이 크다고 해서 한 단계 작은 ${rows[idx].label}을(를) 권해요.`)
      } else if (smallMany && bumped) {
        notes.push(`${rows[idx].mm} 구매 리뷰에서 작다는 의견이 많지만, 발볼 때문에 이미 한 단계 큰 사이즈로 골랐어요.`)
      } else if (smallMany) {
        notes.push(`${rows[idx].mm} 구매 리뷰에서 작다는 의견이 많아요. 한 단계 큰 사이즈가 없어 그대로 두었어요.`)
      }
    }
    rows[idx].recommended = true
    recommended = rows[idx]
  } else if (!hasFoot) {
    notes.push('발길이를 알 수 없어 추천하지 않았어요. 확장 아이콘의 ‘직접 잰 치수’에 발길이(mm)를 입력하면 사이즈별 여유를 계산해요.')
  }
  if (hasFoot && footLengthEstimated) notes.push('발길이를 입력하지 않아 키로 추정했어요. 직접 입력하면 더 정확해요.')
  if (!width && hasFoot) notes.push('발볼을 입력하면(좁은 편·보통·넓은 편) 넓은 발에 맞춰 사이즈를 조정해요.')
  return {
    rows,
    recommended,
    footLength: hasFoot ? footLength : null,
    footLengthEstimated: hasFoot && footLengthEstimated,
    footWidth: width,
    footWidthLabel: width ? FOOT_WIDTH_LABEL[width] : '',
    reasons,
    notes,
    reviewLines: aggs.map(reviewAggregateLine),
    reviewTotal: aggs.reduce((s, a) => s + a.count, 0),
    verdictLabels: VERDICTS.map((v) => v.label),
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
  })
}

/** 엔진 결과를 신발 추천으로 통일해요 (추천 카드·선택 기본값·옷장·입어보기가 같은 사이즈를 가리킴). 신발 추천이 없으면 그대로 돌려줘요. */
export function withShoeRecommendation(result, shoe) {
  const rec = shoe?.recommended
  if (!rec) return result
  return { ...result, recommendedSize: String(rec.mm), headline: `${rec.label} 사이즈를 추천해요`, body: shoe.reasons.join(' ') || result.body }
}
