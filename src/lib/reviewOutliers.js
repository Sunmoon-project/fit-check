// 후기 이상치 거르기: 웹 앱과 확장이 같은 함수를 씁니다. 후기를 지우지 않고 '제외됨(사유)'로 표시하게 나눠 줘요.
// 아래 기준값은 설계상의 판단이고, 실제 후기로 정확도를 재서 정한 값이 아니에요.
//
// 1) 불가능한 값: 키·몸무게·BMI가 범위 밖
// 2) 모순: 한 후기에 '작아요'와 '커요'가 같이 있음 / 구매 사이즈가 상품 사이즈표·옵션에 없음
// 3) 통계 이상치: 같은 사이즈를 산 후기들의 부위별 여유분(사이즈표 실측 - 작성자 추정 몸 치수)이 중앙값 ± 3×MAD 밖
// 4) 라벨 이상치: 비슷한 체형·같은 사이즈 후기 다수와 핏 평가가 반대면 제외하지 않고 가중치만 줄임
// 표본이 5건 미만이면 3)과 4)는 건너뛰어요. 1)과 2)는 표본 수와 상관없이 적용해요.
import { estimateBody } from './bodyEstimate.js'

export const OUTLIER = Object.freeze({
  height: Object.freeze([140, 210]),
  weight: Object.freeze([35, 150]),
  bmi: Object.freeze([14, 40]),
  minSample: 5, // 이보다 적으면 통계·라벨 필터를 쓰지 않음
  madK: 3, // 중앙값에서 MAD의 몇 배까지 허용할지
  madFloor: 1, // MAD가 0이거나 너무 작을 때 쓰는 최소 MAD(cm). 이 값 × madK 보다 벗어나야 이상치
  labelMinNeighbors: 3, // 비슷한 체형·같은 사이즈 후기가 이만큼은 있어야 라벨을 비교
  labelMajority: 0.7, // 이웃 중 이 비율 이상이 같은 평가여야 '다수'
  labelWeight: 0.4, // 라벨 이상치 후기의 가중치
})

export const REASON_KEYS = ['height', 'weight', 'bmi', 'contradiction', 'unknownSize', 'statistical']
export const REASON_LABEL = {
  height: '키가 범위 밖',
  weight: '몸무게가 범위 밖',
  bmi: 'BMI가 범위 밖',
  contradiction: '작아요·커요 동시 언급',
  unknownSize: '구매 사이즈가 상품에 없음',
  statistical: '같은 사이즈 후기와 체형 차이가 큼',
}
export const LABEL_REDUCED_TEXT = '가중치 낮춤(비슷한 체형 다수와 반대 평가)'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const normKey = (s) => String(s ?? '').replace(/\s/g, '').toUpperCase()
const tokenOf = (k) => (k.match(/^\d{1,2}\(([^)]+)\)$/) || [])[1] || null
const ALIAS = { F: 'FREE', 프리: 'FREE', ONESIZE: 'FREE', OS: 'FREE', XXL: '2XL', XXXL: '3XL' }
const alias = (k) => ALIAS[k] || k

// ---------- 모순 ----------
// 사이즈 전체에 대한 말(작아요/커요)만 좁게 봐요. '안 작아요'는 반대 뜻이라 빼고, 부위 말('어깨가 넉넉')은 보지 않아요.
const SMALL_RE = /(?<!안\s?)(?:작아요|작아서|작네요|작습니다|작게 ?나|작은 ?편)/
const LARGE_RE = /(?<!안\s?)(?:커요|커서|크네요|큽니다|크게 ?나|큰 ?편)/

function reviewText(r) {
  return String(r?.text ?? r?.view?.body ?? '')
}

export function hasContradiction(r) {
  const t = reviewText(r)
  return SMALL_RE.test(t) && LARGE_RE.test(t)
}

// ---------- 사이즈 이름 ----------
function sizeKnownIn(size, allowed) {
  const k = normKey(size)
  if (!k) return true
  const a = alias(k)
  for (const c of allowed) {
    if (c === k || alias(c) === a) return true
    if (tokenOf(c) === k || alias(tokenOf(c) || '') === a) return true
    // 신발 옵션 '250(250-255)'은 250 또는 범위 안의 mm
    const m = c.match(/^(\d{3})(?:\((\d{3})-(\d{3})\))?$/)
    if (m && /^\d{3}$/.test(k)) {
      if (m[1] === k) return true
      if (m[2] && Number(k) >= Number(m[2]) && Number(k) <= Number(m[3])) return true
    }
  }
  return false
}

// ---------- 통계 ----------
const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  const n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}
const STAT_PARTS = ['shoulder', 'chest', 'waist', 'hip', 'thigh', 'arm']

function measuresFor(sizeChart, key) {
  const m = sizeChart?.measures || {}
  const hit = Object.keys(m).find((k) => normKey(k) === key)
  return hit == null ? null : m[hit]
}

/**
 * 같은 사이즈 후기들의 부위별 여유분 분포에서 벗어난 후기 인덱스를 돌려줘요.
 * 여유분 = 사이즈표 실측 - 작성자 추정 몸 치수. 성별을 모르면 추정이 어긋나서 이 검사에서는 뺍니다.
 */
function statisticalOutliers(items, sizeChart) {
  const flagged = new Set()
  let applied = false
  const groups = new Map()
  for (const it of items) {
    const g = groups.get(it.sizeKey) || []
    g.push(it)
    groups.set(it.sizeKey, g)
  }
  for (const [sizeKey, group] of groups) {
    if (group.length < OUTLIER.minSample) continue
    const measures = measuresFor(sizeChart, sizeKey)
    if (!measures) continue
    applied = true
    const bodies = group.map((it) => estimateBody({ gender: it.r.gender, height: it.r.height, weight: it.r.weight }).values)
    for (const part of STAT_PARTS) {
      if (!isNum(measures[part])) continue
      const eases = bodies.map((b) => measures[part] - b[part])
      const med = median(eases)
      const mad = median(eases.map((e) => Math.abs(e - med)))
      const tol = OUTLIER.madK * Math.max(mad, OUTLIER.madFloor)
      eases.forEach((e, i) => {
        if (Math.abs(e - med) > tol) flagged.add(group[i].index)
      })
    }
  }
  return { flagged, applied }
}

const OPPOSITE = { small: 'large', large: 'small' }

/** 같은 사이즈를 산 비슷한 체형 후기 다수와 핏 평가가 반대인 후기 인덱스 */
function labelOutliers(items, similarity, threshold) {
  const flagged = new Set()
  const bySize = new Map()
  for (const it of items) {
    if (!it.r.fit) continue
    const g = bySize.get(it.sizeKey) || []
    g.push(it)
    bySize.set(it.sizeKey, g)
  }
  for (const group of bySize.values()) {
    if (group.length < OUTLIER.minSample) continue
    for (const it of group) {
      const opp = OPPOSITE[it.r.fit]
      if (!opp) continue
      const profile = { gender: it.r.gender, height: it.r.height, weight: it.r.weight }
      const near = group.filter((o) => {
        if (o === it) return false
        const s = similarity(profile, o.r)
        return s != null && s > 0 && s >= threshold
      })
      if (near.length < OUTLIER.labelMinNeighbors) continue
      const share = near.filter((o) => o.r.fit === opp).length / near.length
      if (share >= OUTLIER.labelMajority) flagged.add(it.index)
    }
  }
  return flagged
}

/**
 * 후기 목록을 { kept, excluded, ... }로 나눕니다. 원본 후기는 바꾸지 않고 복사해서 표시를 붙여요.
 * @param {object[]} reviews { height, weight, gender, size, fit, text }
 * @param {{ sizeChart?: object, optionLabels?: string[], category?: string, similarity: (profile, review) => number|null, threshold: number }} ctx
 *   similarity/threshold는 fitEngine의 bodySimilarity·BODY_SIM.threshold를 넘겨 주세요(같은 파일끼리 서로 불러오지 않기 위해 받아요).
 */
export function detectReviewOutliers(reviews, ctx) {
  const list = Array.isArray(reviews) ? reviews : []
  const { sizeChart, optionLabels = [], category, similarity, threshold } = ctx
  const allowed = [
    ...(sizeChart?.rows || []).map((r) => normKey(r?.[0])),
    ...Object.keys(sizeChart?.measures || {}).map(normKey),
    ...optionLabels.map(normKey),
  ].filter(Boolean)

  const reasons = list.map(() => [])
  list.forEach((r, i) => {
    const R = reasons[i]
    const h = isNum(r.height) ? r.height : null
    const w = isNum(r.weight) ? r.weight : null
    if (h != null && (h < OUTLIER.height[0] || h > OUTLIER.height[1])) R.push('height')
    if (w != null && (w < OUTLIER.weight[0] || w > OUTLIER.weight[1])) R.push('weight')
    if (h != null && w != null && R.length === 0) {
      const bmi = w / ((h / 100) * (h / 100))
      if (bmi < OUTLIER.bmi[0] || bmi > OUTLIER.bmi[1]) R.push('bmi')
    }
    if (hasContradiction(r)) R.push('contradiction')
    if (r.size != null && allowed.length > 0 && !sizeKnownIn(r.size, allowed)) R.push('unknownSize')
  })

  // 통계·라벨 검사 대상: 위에서 걸리지 않았고, 키·몸무게와 사이즈표에 있는 구매 사이즈를 읽은 후기
  const candidates = []
  list.forEach((r, index) => {
    if (reasons[index].length || !isNum(r.height) || !isNum(r.weight) || r.size == null) return
    candidates.push({ r, index, sizeKey: alias(normKey(r.size)) })
  })
  let statApplied = false
  if (category !== 'shoes' && sizeChart?.measures) {
    // 사이즈표의 이름과 같은 이름으로 모아요(별칭 포함). 성별을 아는 후기만 추정에 써요.
    const chartKeys = new Map(Object.keys(sizeChart.measures).map((k) => [alias(normKey(k)), normKey(k)]))
    const items = candidates
      .filter((c) => (c.r.gender === 'male' || c.r.gender === 'female') && chartKeys.has(c.sizeKey))
      .map((c) => ({ ...c, sizeKey: chartKeys.get(c.sizeKey) }))
    const stat = statisticalOutliers(items, sizeChart)
    statApplied = stat.applied
    for (const i of stat.flagged) reasons[i].push('statistical')
  }

  const labelFlags = labelOutliers(
    candidates.filter((c) => !reasons[c.index].length),
    similarity,
    threshold,
  )

  const counts = Object.fromEntries(REASON_KEYS.map((k) => [k, 0]))
  const kept = []
  const excluded = []
  list.forEach((r, i) => {
    const R = reasons[i]
    if (R.length) {
      counts[R[0]] += 1 // 사유별 수는 첫 사유 하나로만 세어서 합이 제외 수와 같아요
      excluded.push({ ...r, excluded: { reasons: R, text: `제외됨(${R.map((k) => REASON_LABEL[k]).join(', ')})` } })
    } else if (labelFlags.has(i)) {
      kept.push({ ...r, labelReduced: true, labelWeight: OUTLIER.labelWeight })
    } else kept.push(r)
  })
  return {
    kept,
    excluded,
    counts,
    total: list.length,
    excludedTotal: excluded.length,
    labelReduced: labelFlags.size,
    // 같은 사이즈 후기가 5건 이상인 묶음이 있어 통계 필터를 실제로 돌렸는지
    statApplied,
    sampleEnough: list.length >= OUTLIER.minSample,
  }
}

/** 진단 리포트용 한 줄(건수만). 후기 글·값은 담지 않아요. */
export function outlierLine(o) {
  if (!o) return ''
  const parts = REASON_KEYS.map((k) => `${REASON_LABEL[k]} ${o.counts?.[k] ?? 0}`).join(', ')
  return `후기 이상치: 제외 ${o.excludedTotal}건(${parts}), 가중치 낮춤 ${o.labelReduced}건, 통계 필터 ${o.statApplied ? '사용' : '생략(같은 사이즈 후기 5건 미만)'}`
}
