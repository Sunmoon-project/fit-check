// 핏 데이터셋 검증용 순수 함수 (의존성 없음)
// 정규화: 키 ft/in -> cm, 몸무게 lbs -> kg, 핏 라벨 small/fit/large -> small/true/large

export const LABELS = ['small', 'true', 'large']

const IN_CM = 2.54
const LB_KG = 0.45359237

// "5' 8\"" , "5ft 8in", "172cm", 172 -> cm. 해석 못 하면 null.
export function parseHeightCm(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 10) / 10 : null
  const s = String(raw).trim().toLowerCase()
  const cm = s.match(/^(\d+(?:\.\d+)?)\s*cm$/)
  if (cm) return Math.round(Number(cm[1]) * 10) / 10
  const ftIn = s.match(/^(\d+)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inches)?)?$/)
  if (ftIn) {
    const total = Number(ftIn[1]) * 12 + Number(ftIn[2] || 0)
    return Math.round(total * IN_CM * 10) / 10
  }
  const plain = Number(s)
  return Number.isFinite(plain) && plain > 0 ? Math.round(plain * 10) / 10 : null
}

// "137lbs", "60kg" -> kg. 단위 없는 값은 kg로 봄.
export function parseWeightKg(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 10) / 10 : null
  const s = String(raw).trim().toLowerCase()
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(lbs?|pounds?|kg|kgs)?$/)
  if (!m) return null
  const n = Number(m[1])
  if (!(n > 0)) return null
  const isLb = Boolean(m[2]) && (m[2].startsWith('lb') || m[2].startsWith('pound'))
  return Math.round((isLb ? n * LB_KG : n) * 10) / 10
}

export function normalizeFit(raw) {
  if (raw == null) return null
  const s = String(raw).trim().toLowerCase()
  if (s === 'small') return 'small'
  if (s === 'fit' || s === 'true' || s === 'true to size') return 'true'
  if (s === 'large') return 'large'
  return null
}

const pick = (row, keys) => {
  for (const k of keys) if (row[k] != null && row[k] !== '') return row[k]
  return undefined
}

// 원본 행 -> { item, size, fit, height, weight } 또는 { excluded: 사유 }
export function normalizeRow(row) {
  if (!row || typeof row !== 'object') return { excluded: '객체가 아닌 행' }
  const fit = normalizeFit(pick(row, ['fit']))
  if (!fit) return { excluded: '핏 라벨 없음/해석 불가' }
  const sizeRaw = pick(row, ['size'])
  if (sizeRaw == null) return { excluded: '사이즈 없음' }
  const itemRaw = pick(row, ['item_id', 'item'])
  if (itemRaw == null) return { excluded: '상품 id 없음' }
  const height = parseHeightCm(pick(row, ['height']))
  if (height == null) return { excluded: '키 없음/해석 불가' }
  const weight = parseWeightKg(pick(row, ['weight']))
  if (weight == null) return { excluded: '몸무게 없음/해석 불가' }
  if (height < 120 || height > 220 || weight < 30 || weight > 200) return { excluded: '키·몸무게 범위 밖' }
  return { item: String(itemRaw), size: String(sizeRaw).toUpperCase(), fit, height, weight }
}

// JSON lines 텍스트 -> 정규화 결과. 빈 줄은 무시, 깨진 줄은 제외 사유로 집계.
export function normalizeLines(text) {
  const rows = []
  const excluded = {}
  let total = 0
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue
    total += 1
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      excluded['JSON 해석 실패'] = (excluded['JSON 해석 실패'] || 0) + 1
      continue
    }
    const r = normalizeRow(obj)
    if (r.excluded) excluded[r.excluded] = (excluded[r.excluded] || 0) + 1
    else rows.push(r)
  }
  return { rows, excluded, total }
}

export function confusionMatrix(pairs) {
  const m = { small: { small: 0, true: 0, large: 0 }, true: { small: 0, true: 0, large: 0 }, large: { small: 0, true: 0, large: 0 } }
  for (const { actual, predicted } of pairs) m[actual][predicted] += 1
  return m // m[실제][예측]
}

export function accuracy(matrix) {
  let ok = 0
  let n = 0
  for (const a of LABELS) for (const p of LABELS) {
    n += matrix[a][p]
    if (a === p) ok += matrix[a][p]
  }
  return n === 0 ? null : ok / n
}

export function precisionRecall(matrix) {
  const out = {}
  for (const l of LABELS) {
    const tp = matrix[l][l]
    const predicted = LABELS.reduce((s, a) => s + matrix[a][l], 0)
    const actual = LABELS.reduce((s, p) => s + matrix[l][p], 0)
    out[l] = { precision: predicted ? tp / predicted : null, recall: actual ? tp / actual : null, support: actual }
  }
  return out
}

export function labelDistribution(rows) {
  const d = { small: 0, true: 0, large: 0 }
  for (const r of rows) d[r.fit] += 1
  return d
}

export function majorityLabel(rows) {
  const d = labelDistribution(rows)
  return LABELS.reduce((best, l) => (d[l] > d[best] ? l : best), 'true')
}

// 사이즈별 라벨 분포
export function distributionBySize(rows) {
  const out = {}
  for (const r of rows) {
    out[r.size] ||= { small: 0, true: 0, large: 0 }
    out[r.size][r.fit] += 1
  }
  return out
}

// 키·몸무게 구간별 정사이즈 비율 (구간 경계는 인자)
export function trueRateByBucket(rows, key, edges) {
  const buckets = []
  for (let i = 0; i <= edges.length; i++) {
    buckets.push({ from: i === 0 ? null : edges[i - 1], to: i === edges.length ? null : edges[i], n: 0, true: 0 })
  }
  for (const r of rows) {
    let i = 0
    while (i < edges.length && r[key] >= edges[i]) i++
    buckets[i].n += 1
    if (r.fit === 'true') buckets[i].true += 1
  }
  return buckets.map((b) => ({ ...b, rate: b.n ? b.true / b.n : null }))
}

// 이웃 투표: 같은 상품·같은 사이즈의 다른 사람 중 bodySimilarity >= threshold 인 사람들의 가중 다수결.
// 자기 자신(같은 인덱스)은 제외(leave-one-out). 이웃이 없거나 최다 득표가 동률이면 predicted=null (예측 불가).
// similarityFn(profile, review) 는 fitEngine.bodySimilarity 를 주입.
export function neighborVotePredictions(rows, similarityFn, threshold = 65) {
  const groups = new Map()
  rows.forEach((r, i) => {
    const key = `${r.item}\u0000${r.size}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(i)
  })
  const results = []
  for (const idxs of groups.values()) {
    for (const i of idxs) {
      const me = rows[i]
      const votes = { small: 0, true: 0, large: 0 }
      let neighbors = 0
      for (const j of idxs) {
        if (j === i) continue
        const sim = similarityFn({ height: me.height, weight: me.weight }, rows[j])
        if (sim == null || sim < threshold) continue
        votes[rows[j].fit] += sim / 100
        neighbors += 1
      }
      let predicted = null
      let tie = false
      if (neighbors > 0) {
        const top = Math.max(votes.small, votes.true, votes.large)
        const leaders = LABELS.filter((l) => votes[l] === top)
        // 동률이면 특정 라벨(예: true)로 기울이지 않고 예측 불가로 둬요.
        if (leaders.length === 1) predicted = leaders[0]
        else tie = true
      }
      results.push({ index: i, actual: me.fit, predicted, neighbors, tie })
    }
  }
  return results
}

// 전체 평가 요약
export function evaluate(rows, similarityFn, threshold = 65) {
  const preds = neighborVotePredictions(rows, similarityFn, threshold)
  const answered = preds.filter((p) => p.predicted)
  const matrix = confusionMatrix(answered)
  const base = majorityLabel(rows)
  const baselineMatrix = confusionMatrix(rows.map((r) => ({ actual: r.fit, predicted: base })))
  return {
    samples: rows.length,
    answered: answered.length,
    ties: preds.filter((p) => p.tie).length,
    coverage: rows.length ? answered.length / rows.length : null,
    threshold,
    matrix,
    accuracy: accuracy(matrix),
    perLabel: precisionRecall(matrix),
    baselineLabel: base,
    baselineAccuracy: accuracy(baselineMatrix),
    labelDistribution: labelDistribution(rows),
    bySize: distributionBySize(rows),
    heightBuckets: trueRateByBucket(rows, 'height', [155, 160, 165, 170, 175]),
    weightBuckets: trueRateByBucket(rows, 'weight', [50, 55, 60, 65, 70, 80]),
  }
}
