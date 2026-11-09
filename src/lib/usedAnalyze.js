// 중고 판매글 분석: 후기가 없다는 전제로 "작음 / 맞음 / 큼"을 보수적으로 알려줘요.
//
// 근거 우선순위 (위에서부터 쓸 수 있는 첫 번째를 써요)
//   1. 판매글에 적힌 실측 (단면이면 ×2, 비현실적인 값은 버림)
//   2. 사이즈표 모음 DB에서 찾은 같은/비슷한 상품의 사이즈표 (점수가 기준 이상일 때만, 근사값으로 표시)
//   3. 브랜드 지역 + 사이즈 표기 기본값 (가장 약한 근거, 근사/추정으로 표시)
// 확신도는 '낮음'이나 '보통'까지만 줘요(높음 없음). 정확도를 측정한 값이 아니에요.
//
// 이 파일은 네트워크·저장소를 쓰지 않아요. DB 검색 결과는 호출하는 쪽이 넘겨줘요(findChartMatches로 만들 수 있어요).
import { bodyValuesForProfile, partVerdicts, recommendSize, classifyShoeEase, CONFIDENCE_LABEL } from './fitEngine.js'
import { CATEGORY_LABEL } from '../data/measurements.js'
import { classifyBrandRegion, regionLine, REGION_HYPOTHESIS_NOTE } from './brandRegion.js'
import { representativeMeasure, SIZE_SYSTEM_FLAG } from './sizeSystems.js'
import { parseListingText, listingText, PART_WORD } from './usedListing.js'

export const USED_DB_MIN_SCORE = 60 // 사이즈표 DB 일치로 인정하는 최소 점수 (설계상의 판단)
export const USED_MAX_CONFIDENCE = 'medium'
export const USED_VERDICT_LABEL = Object.freeze({ small: '작음', fit: '맞음', large: '큼' })
export const USED_NO_REVIEW_NOTE = '중고 판매글에는 후기가 없어서 후기 없이 계산했어요.'
export const USED_DISCLAIMER = '참고용이에요. 확신도는 정확도를 측정한 값이 아니고, 판매글 글자와 사이즈 표기가 맞게 쓰였다는 전제예요.'
export const USED_PRIORITY_TEXT = '근거 우선순위: ① 판매글 실측 → ② 사이즈표 DB의 비슷한 상품(근사) → ③ 브랜드 지역·사이즈 표기 기본값(근사/추정)'
export const USED_APPROX_FLAG = '근사/추정'

const CORE_PARTS = ['shoulder', 'chest', 'waist', 'hip', 'thigh']
const PART_LABEL_KO = { shoulder: '어깨', chest: '가슴', arm: '소매', waist: '허리', hip: '엉덩이', thigh: '허벅지', topLength: '총장', outerLength: '총장', dressLength: '총장', inseam: '총장', rise: '밑위' }
const norm = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase()
const tokenOf = (k) => (k.match(/^\d{1,2}\(([^)]+)\)$/) || [])[1] || null
const signed = (v) => `${v > 0 ? '+' : ''}${v}`

/** 부위별 판정 → 작음/맞음/큼. 핵심 부위(어깨·가슴·허리·엉덩이·허벅지)가 없으면 null. 선호 핏이 슬림이면 타이트를 허용하고, 여유면 넉넉함을 허용해요. */
export function usedVerdictFrom(verdicts, preferredFit = 'regular') {
  const core = (verdicts || []).filter((v) => CORE_PARTS.includes(v.part))
  if (!core.length) return null
  const levels = core.map((v) => v.level)
  const min = Math.min(...levels)
  const max = Math.max(...levels)
  const avg = levels.reduce((a, b) => a + b, 0) / levels.length
  if (min === 0 || (min === 1 && preferredFit !== 'slim')) return 'small'
  if ((max >= 4 && preferredFit !== 'relaxed') || (avg >= 3.5 && preferredFit === 'slim')) return 'large'
  return 'fit'
}

function partLine(v, measured) {
  const u = v.unit
  const est = measured.has(v.part) ? '' : '(추정)'
  return `${v.label}: 옷 ${v.garment}${u} − 내 ${v.body}${u}${est} = ${signed(v.ease)}${u} → ${v.verdict}`
}

const flat = (parts) => Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, p.cm]))
const measureText = (key, p) => `${PART_LABEL_KO[key] || PART_WORD[key] || key} ${p.raw}${p.kind === 'section' ? '(단면→둘레 ' + p.cm + ')' : ''}`

// ---------- 1순위: 판매글 실측 ----------
function fromListing(parsed, ctx) {
  const { values, measured, pref } = ctx
  const candidates = {}
  if (parsed.namedSizes.length) for (const n of parsed.namedSizes) candidates[n] = parsed.measuresBySize[n]
  else if (parsed.measuresBySize.default) candidates[parsed.sizes[0]?.label || '판매 사이즈'] = parsed.measuresBySize.default
  const labels = Object.keys(candidates)
  if (!labels.length || parsed.category === 'shoes') return null
  const per = []
  for (const size of labels) {
    const verdicts = partVerdicts(values, flat(candidates[size]), parsed.category)
    const verdict = usedVerdictFrom(verdicts, pref)
    if (verdict) per.push({ size, parts: candidates[size], verdicts, verdict })
  }
  if (!per.length) return null
  let primary = null
  let pickNote = ''
  if (per.length === 1) primary = per[0]
  else {
    const listed = parsed.sizes.map((s) => norm(s.label))
    primary = per.find((p) => listed[0] && norm(p.size) === listed[0]) || null
    if (!primary) {
      const rec = recommendSize(values, { measures: Object.fromEntries(per.map((p) => [norm(p.size), flat(p.parts)])) }, parsed.category, pref)
      primary = per.find((p) => norm(p.size) === rec?.bestSize) || per[0]
      pickNote = '판매글에 사이즈가 여러 개 적혀 있고 판매 사이즈를 알 수 없어, 내 체형에 가장 가까운 사이즈를 골랐어요.'
    }
  }
  const parts = Object.entries(primary.parts)
  const coreParts = parts.filter(([k]) => CORE_PARTS.includes(k))
  const solid = coreParts.filter(([, p]) => !p.inferred).length
  const confidence = coreParts.length >= 2 && solid >= 2 ? 'medium' : 'low'
  const lines = [
    `판매글에서 읽은 실측: ${parts.map(([k, p]) => measureText(k, p)).join(' · ')}`,
    ...primary.verdicts.map((v) => partLine(v, measured)),
  ]
  if (parts.some(([, p]) => p.inferred)) lines.push('단면/둘레 표기가 없는 값은 숫자 크기로 짐작했어요. 틀릴 수 있어요.')
  if (pickNote) lines.push(pickNote)
  const perSize = per.length > 1 ? per.map((p) => ({ size: p.size, verdict: p.verdict, label: USED_VERDICT_LABEL[p.verdict] })) : []
  return { basis: 'listing', basisLabel: '판매글 실측', approx: false, size: primary.size, verdict: primary.verdict, verdicts: primary.verdicts, perSize, confidence, lines }
}

// ---------- 2순위: 사이즈표 DB ----------
function fromChartDb(parsed, matches, ctx) {
  const { values, measured, pref } = ctx
  const top = (matches || []).find((m) => m.score >= USED_DB_MIN_SCORE && m.entry?.sizeChart?.measures && (!m.entry.category || parsed.categoryConfidence === 'low' || m.entry.category === parsed.category))
  if (!top) return { miss: matches?.length ? `비슷한 상품 ${matches.length}개를 찾았지만 점수가 기준(${USED_DB_MIN_SCORE}점) 아래라 쓰지 않았어요` : '비슷한 상품을 찾지 못했어요' }
  const chart = top.entry.sizeChart
  const cat = top.entry.category || parsed.category
  const keys = Object.keys(chart.measures)
  const wanted = parsed.sizes.map((s) => norm(s.label))
  const key = keys.find((k) => wanted.includes(norm(k)) || wanted.includes(tokenOf(norm(k))))
  const head = `사이즈표 DB(${USED_APPROX_FLAG}): 점수 ${top.score}점 · ${top.reasons.join(', ')}`
  const where = [top.entry.brand, top.entry.model].filter(Boolean).join(' ')
  const lines = [head, `일치한 상품: ${where || '(이름 없음)'}${top.viaPhoto ? ' (사진 검색 후보로 찾음)' : ''}`]
  const confidenceBase = top.score >= 90 ? 'medium' : 'low'
  if (key) {
    const verdicts = partVerdicts(values, chart.measures[key], cat)
    const verdict = usedVerdictFrom(verdicts, pref)
    if (verdict) return { basis: 'chart-db', basisLabel: '사이즈표 DB(근사)', approx: true, size: key, verdict, verdicts, perSize: [], confidence: confidenceBase, lines: [...lines, ...verdicts.map((v) => partLine(v, measured))] }
  }
  const rec = recommendSize(values, chart, cat, pref)
  if (rec) return { basis: 'chart-db', basisLabel: '사이즈표 DB(근사)', approx: true, size: null, verdict: null, verdicts: [], perSize: [], confidence: 'low', recommended: rec.bestSize, lines: [...lines, `판매 사이즈를 판매글에서 읽지 못했어요. 이 사이즈표 기준으로는 ${rec.bestSize}가 내 체형에 가장 가까워요.`] }
  return { miss: `${head.replace('사이즈표 DB(근사): ', '')} — 하지만 이 사이즈표로 비교할 수 있는 부위가 없었어요` }
}

// ---------- 3순위: 지역 + 사이즈 표기 기본값 ----------
function fromDefault(parsed, ctx, region) {
  const { values, measured, profile } = ctx
  const gender = parsed.gender === 'male' || parsed.gender === 'female' ? parsed.gender : profile.gender === 'male' || profile.gender === 'female' ? profile.gender : null
  const genderNote = !parsed.gender && gender ? '판매글에 대상 성별이 없어 내 성별 기준으로 봤어요.' : ''
  for (const s of parsed.sizes) {
    // 95/100/105 같은 국내 호칭은 미국·유럽·일본 브랜드에는 맞지 않을 수 있어 지역이 그렇게 추정되면 쓰지 않아요.
    if ((parsed.category === 'top' || parsed.category === 'outer') && ['us', 'eu', 'jp'].includes(region.region) && /^\d{2,3}$/.test(s.label)) continue
    const rep = representativeMeasure({ category: parsed.category, gender, label: s.label })
    if (!rep) continue
    let verdict = null
    let line = ''
    if (rep.measures.footLength != null) {
      const ease = rep.measures.footLength - values.footLength
      const lv = classifyShoeEase(ease)
      verdict = lv.level <= 1 ? 'small' : lv.level === 4 ? 'large' : 'fit'
      line = `발 길이: 사이즈 ${rep.measures.footLength}mm − 내 ${values.footLength}mm${measured.has('footLength') ? '' : '(추정)'} = ${signed(ease)}mm → ${lv.label}`
    } else if (rep.measures.chest != null) {
      const ease = Math.round((rep.measures.chest - values.chest) * 10) / 10
      verdict = ease < -3 ? 'small' : ease > 14 ? 'large' : 'fit'
      line = `가슴: 호칭 ${rep.measures.chest}cm − 내 ${values.chest}cm${measured.has('chest') ? '' : '(추정)'} = ${signed(ease)}cm (호칭은 몸 치수라 옷은 보통 10cm쯤 더 커요)`
    } else if (rep.measures.waist != null) {
      const ease = Math.round((rep.measures.waist - values.waist) * 10) / 10
      verdict = ease < -3 ? 'small' : ease > 8 ? 'large' : 'fit'
      line = `허리: 호칭 ${rep.measures.waist}cm − 내 ${values.waist}cm${measured.has('waist') ? '' : '(추정)'} = ${signed(ease)}cm`
    }
    if (!verdict) continue
    return {
      basis: 'default',
      basisLabel: `기본값(${USED_APPROX_FLAG})`,
      approx: true,
      size: s.label,
      verdict,
      verdicts: [],
      perSize: [],
      confidence: 'low',
      lines: [`사이즈 표기 참고값(${SIZE_SYSTEM_FLAG}): ${rep.text}`, line, ...(genderNote ? [genderNote] : [])],
    }
  }
  return null
}

const HEADLINE = {
  small: '내 체형에는 작을 가능성이 있어요',
  fit: '내 체형에 맞는 쪽이에요',
  large: '내 체형에는 클 가능성이 있어요',
}

/**
 * 판매글 분석. 후기는 쓰지 않아요.
 * @param {{ title?:string, text?:string, description?:string, bodyText?:string, price?:object, photos?:string[] }} listing readListing 결과 또는 { title, text }
 * @param {object} profile 사용자 체형 프로필
 * @param {{ chartMatches?:Array, pageUrl?:string, site?:{id:string,name:string}|null, category?:string }} [opts] chartMatches: findChartMatches 결과
 */
export function analyzeUsedListing(listing, profile, opts = {}) {
  const parsed = parseListingText(listing.text ?? listingText(listing), { title: listing.title, category: opts.category })
  const { values, measured } = bodyValuesForProfile(profile)
  const pref = profile.preferredFit || 'regular'
  const ctx = { values, measured, pref, profile }
  const region = classifyBrandRegion({
    brand: parsed.brand?.text || '',
    name: parsed.model || listing.title || '',
    optionLabels: parsed.sizes.map((s) => s.label),
    priceCurrency: listing.price?.currency || '',
    url: opts.pageUrl || '',
  })

  const priority = []
  let chosen = fromListing(parsed, ctx)
  const nMeasure = parsed.counts.measureCount
  priority.push({ id: 'listing', label: '판매글 실측', state: chosen ? 'used' : 'none', text: chosen ? `${nMeasure}개 읽어서 사용했어요` : nMeasure ? `${nMeasure}개 읽었지만 판정에 쓸 핵심 부위(어깨·가슴·허리 등)가 없어요` : '판매글에서 실측을 찾지 못했어요' })

  const db = fromChartDb(parsed, opts.chartMatches, ctx)
  if (!chosen && !db.miss) chosen = db
  priority.push({ id: 'chart-db', label: '사이즈표 DB(근사)', state: db.miss ? 'none' : chosen === db ? 'used' : 'skipped', text: db.miss ? db.miss : chosen === db ? '비슷한 상품의 사이즈표를 사용했어요' : '비슷한 상품을 찾았지만 판매글 실측을 우선했어요' })

  const def = chosen ? null : fromDefault(parsed, ctx, region)
  if (!chosen && def) chosen = def
  priority.push({ id: 'default', label: `지역·사이즈 표기 기본값(${USED_APPROX_FLAG})`, state: chosen === def && def ? 'used' : 'none', text: def ? '사이즈 표기의 뜻으로 가늠했어요' : chosen ? '앞선 근거가 있어 쓰지 않았어요' : '쓸 수 있는 사이즈 표기가 없어요' })

  const hasVerdict = !!chosen?.verdict
  const confidence = hasVerdict ? (USED_MAX_CONFIDENCE === 'medium' && chosen.confidence === 'medium' ? 'medium' : 'low') : 'low'
  const sizeText = chosen?.size ? `${chosen.size} 사이즈` : '판매 사이즈를 알 수 없는 상태'
  const reasons = []
  if (!hasVerdict) reasons.push('판매글에서 쓸 수 있는 실측이나 사이즈 표기를 찾지 못해 판정하지 않았어요.')
  else {
    reasons.push(`${chosen.basisLabel} 기준이에요.${chosen.approx ? ' 이 근거는 근사값이에요.' : ''}`)
    if (confidence === 'low') reasons.push('근거가 약해 확신도를 낮게 봤어요.')
  }
  reasons.push(USED_NO_REVIEW_NOTE)

  const details = [USED_PRIORITY_TEXT, ...priority.map((p, i) => `${['①', '②', '③'][i]} ${p.label}: ${p.text}`), ...(chosen?.lines || [])]
  if (parsed.counts.droppedCount) details.push(`비현실적이거나 단면/둘레를 알 수 없어 버린 값 ${parsed.counts.droppedCount}개`)
  details.push(regionLine(region))
  if (region.region !== 'unknown' || region.evidence.length) details.push(REGION_HYPOTHESIS_NOTE)

  return {
    status: 'used',
    site: opts.site || null,
    title: String(listing.title || '').slice(0, 200),
    brand: parsed.brand?.text || '',
    model: parsed.model,
    code: parsed.code,
    price: listing.price?.amount ? { amount: listing.price.amount, currency: listing.price.currency || 'KRW' } : null,
    photos: (listing.photos || []).slice(0, 5),
    category: parsed.category,
    categoryLabel: CATEGORY_LABEL[parsed.category] || '',
    sizes: parsed.sizes.map((s) => s.label),
    listingSize: chosen?.size || null,
    basis: chosen?.basis || 'none',
    basisLabel: chosen?.basisLabel || '근거 없음',
    approx: chosen?.approx === true,
    verdict: chosen?.verdict || null,
    verdictLabel: chosen?.verdict ? USED_VERDICT_LABEL[chosen.verdict] : null,
    perSize: chosen?.perSize || [],
    recommended: chosen?.recommended || null,
    confidence,
    confidenceLabel: CONFIDENCE_LABEL[confidence],
    headline: hasVerdict ? `${sizeText}: ${HEADLINE[chosen.verdict]}` : '판정할 근거가 부족해요',
    reasons,
    details,
    priority,
    parts: (chosen?.verdicts || []).map((v) => ({ part: v.part, label: v.label, garment: v.garment, body: v.body, unit: v.unit, ease: v.ease, verdict: v.verdict })),
    noReviewNote: USED_NO_REVIEW_NOTE,
    disclaimer: USED_DISCLAIMER,
    counts: { ...parsed.counts, photoCount: (listing.photos || []).length },
    regionInfo: { region: region.region, label: region.label, confidence: region.confidence },
  }
}

// ---------- 사이즈표 DB 찾기 ----------

/** 파서 결과/판매글 → 사이즈표 DB 검색 입력. 단서(브랜드·모델·품번)가 하나도 없으면 null. */
export function usedSearchQuery(listing, opts = {}) {
  const p = parseListingText(listing.text ?? listingText(listing), { title: listing.title, category: opts.category })
  const q = { brand: p.brand?.key || p.brand?.text || '', model: p.model, code: p.code, category: p.category, gender: p.gender }
  return q.brand || q.model || q.code ? q : null
}

/**
 * 사이즈표 모음 DB(createSizeChartDb)에서 비슷한 상품을 찾아요. candidates는 사진 검색 후보([{brand,model,code}])로, 같은 방식으로 더 찾아 합쳐요.
 * 같은 항목은 높은 점수만 남겨요. 검색이 실패해도 빈 목록을 돌려줘요.
 */
export async function findChartMatches(db, query, candidates = []) {
  const found = new Map()
  const run = async (q, viaPhoto) => {
    try {
      for (const m of await db.search(q)) {
        const prev = found.get(m.entry.id)
        if (!prev || m.score > prev.score) found.set(m.entry.id, { ...m, viaPhoto })
      }
    } catch {
      /* 저장소 오류는 건너뛰어요 */
    }
  }
  if (query) await run(query, false)
  for (const c of candidates.slice(0, 5)) await run({ brand: c.brand, model: c.model, code: c.code, category: query?.category ?? null, gender: query?.gender ?? null }, true)
  return [...found.values()].sort((a, b) => b.score - a.score)
}
