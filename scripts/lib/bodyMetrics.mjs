// 체형 추정 검증용 순수 함수 (의존성 없음)
// estimateBody 결과(추정)와 실측값을 비교해 오차 지표를 계산합니다.
// 길이는 cm로 맞추고, 발길이(footLength)만 estimateBody와 같이 mm로 다룹니다.

export const PARTS = ['shoulder', 'chest', 'waist', 'hip', 'thigh', 'arm', 'footLength']

// 기본 컬럼 매핑: 내부 필드 -> 원본 파일에서 찾아볼 컬럼 이름 후보.
// 사이즈코리아 실제 컬럼명은 확인하지 못했어요. 파일과 다르면 --map 매핑 JSON으로 덮어쓰세요.
export const DEFAULT_MAPPING = {
  gender: ['gender', 'sex', '성별'],
  height: ['height', '키', '신장'],
  weight: ['weight', '몸무게', '체중'],
  shoulder: ['shoulder', '어깨너비', '어깨'],
  chest: ['chest', '가슴둘레', '가슴'],
  waist: ['waist', '허리둘레', '허리'],
  hip: ['hip', '엉덩이둘레', '엉덩이'],
  thigh: ['thigh', '허벅지둘레', '허벅지'],
  arm: ['arm', '팔길이', '팔'],
  footLength: ['footLength', 'foot', '발길이', '발'],
}

const FEMALE = new Set(['female', 'f', 'woman', 'w', '여', '여자', '여성', '2'])
const MALE = new Set(['male', 'm', 'man', '남', '남자', '남성', '1'])

export function normalizeGender(raw) {
  if (raw == null) return null
  const s = String(raw).trim().toLowerCase()
  if (FEMALE.has(s)) return 'female'
  if (MALE.has(s)) return 'male'
  return null
}

// 매핑 값은 문자열 또는 문자열 배열. 사용자 매핑이 기본 후보보다 먼저 쓰여요.
export function mergeMapping(custom = {}) {
  const out = {}
  for (const k of Object.keys(DEFAULT_MAPPING)) {
    const user = custom[k] == null ? [] : [].concat(custom[k])
    out[k] = [...user, ...DEFAULT_MAPPING[k]]
  }
  return out
}

function toNumber(raw) {
  if (raw == null || raw === '') return null
  const n = Number(String(raw).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

const pickCol = (row, names) => {
  for (const n of names) if (row[n] != null && row[n] !== '') return row[n]
  return undefined
}

// 따옴표를 처리하는 간단한 CSV 파서. 첫 줄을 헤더로 보고 객체 배열을 돌려줘요.
export function parseCsv(text) {
  const src = String(text).replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x !== '')) rows.push(row)
  if (rows.length === 0) return []
  const header = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

// CSV 또는 JSON(배열 / JSON lines) 텍스트 -> 원본 행 배열
export function parseRows(text, format) {
  const t = String(text).trim()
  const fmt = format || (t.startsWith('[') ? 'json' : t.startsWith('{') ? 'jsonl' : 'csv')
  if (fmt === 'csv') return parseCsv(text)
  if (fmt === 'json') {
    const arr = JSON.parse(t)
    return Array.isArray(arr) ? arr : []
  }
  return t.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l))
}

// 원본 행 -> { gender, height, weight, actual:{부위:값} } 또는 { excluded: 사유 }
// unit: 'cm' | 'mm' (원본 길이 단위, 키·부위 모두 적용. 몸무게는 항상 kg)
export function normalizeBodyRow(row, mapping, unit = 'cm') {
  if (!row || typeof row !== 'object') return { excluded: '객체가 아닌 행' }
  const factor = unit === 'mm' ? 0.1 : 1
  const gender = normalizeGender(pickCol(row, mapping.gender))
  if (!gender) return { excluded: '성별 없음/해석 불가' }
  const h = toNumber(pickCol(row, mapping.height))
  const w = toNumber(pickCol(row, mapping.weight))
  if (h == null || w == null) return { excluded: '키·몸무게 없음/해석 불가' }
  const height = h * factor
  if (height < 120 || height > 220 || w < 30 || w > 200) return { excluded: '키·몸무게 범위 밖' }
  const actual = {}
  for (const p of PARTS) {
    const v = toNumber(pickCol(row, mapping[p]))
    if (v == null || v <= 0) continue
    actual[p] = p === 'footLength' ? v * factor * 10 : v * factor // 발길이는 mm
  }
  if (Object.keys(actual).length === 0) return { excluded: '실측 부위 값 없음' }
  return { gender, height, weight: w, actual }
}

export function normalizeBodyRows(rawRows, mapping, unit = 'cm') {
  const rows = []
  const excluded = {}
  for (const raw of rawRows) {
    const r = normalizeBodyRow(raw, mapping, unit)
    if (r.excluded) excluded[r.excluded] = (excluded[r.excluded] || 0) + 1
    else rows.push(r)
  }
  return { rows, excluded, total: rawRows.length }
}

// errors: (추정 - 실측) 배열. 비어 있으면 null.
export function errorStats(errors) {
  const n = errors.length
  if (n === 0) return null
  let sumAbs = 0
  let sumSq = 0
  let sum = 0
  let in3 = 0
  let in5 = 0
  for (const e of errors) {
    const a = Math.abs(e)
    sumAbs += a
    sumSq += e * e
    sum += e
    if (a <= 3) in3 += 1
    if (a <= 5) in5 += 1
  }
  return { n, mae: sumAbs / n, rmse: Math.sqrt(sumSq / n), bias: sum / n, within3: in3 / n, within5: in5 / n }
}

// 발길이는 mm 단위라, 오차는 모든 부위를 cm로 통일해 계산합니다(±3·±5cm 기준 비교용).
const toCm = (part, v) => (part === 'footLength' ? v / 10 : v)

// rows -> { 성별: { 부위: stats } }. estimate 는 estimateBody 를 주입.
export function evaluateBody(rows, estimate) {
  const errs = { female: {}, male: {} }
  for (const r of rows) {
    const est = estimate({ gender: r.gender, height: r.height, weight: r.weight }).values
    for (const [p, actual] of Object.entries(r.actual)) {
      if (est[p] == null) continue
      ;(errs[r.gender][p] ||= []).push(toCm(p, est[p]) - toCm(p, actual))
    }
  }
  const out = {}
  for (const g of Object.keys(errs)) {
    out[g] = {}
    for (const p of PARTS) if (errs[g][p]) out[g][p] = errorStats(errs[g][p])
  }
  return out
}

// 3x3 정규방정식을 가우스 소거법으로 풉니다. 특이하면 null.
function solve3(A, b) {
  const m = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < 3; c++) {
    let piv = c
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r
    if (Math.abs(m[piv][c]) < 1e-9) return null
    ;[m[c], m[piv]] = [m[piv], m[c]]
    for (let r = 0; r < 3; r++) {
      if (r === c) continue
      const f = m[r][c] / m[c][c]
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]]
}

// 값 ≈ a*키 + b*몸무게 + c 최소제곱 회귀. 표본이 4개 미만이거나 특이하면 null.
// 제안만 하는 용도예요. 반환 값의 단위는 입력 단위(cm, 발길이는 mm)를 그대로 따라요.
export function fitLinear(samples) {
  if (samples.length < 4) return null
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const b = [0, 0, 0]
  for (const { height, weight, value } of samples) {
    const x = [height, weight, 1]
    for (let i = 0; i < 3; i++) {
      b[i] += x[i] * value
      for (let j = 0; j < 3; j++) A[i][j] += x[i] * x[j]
    }
  }
  const sol = solve3(A, b)
  return sol ? { height: sol[0], weight: sol[1], intercept: sol[2], n: samples.length } : null
}

export function suggestCoefficients(rows) {
  const out = { female: {}, male: {} }
  for (const g of Object.keys(out)) {
    for (const p of PARTS) {
      const samples = rows
        .filter((r) => r.gender === g && r.actual[p] != null)
        .map((r) => ({ height: r.height, weight: r.weight, value: r.actual[p] }))
      const fit = fitLinear(samples)
      if (fit) out[g][p] = fit
    }
  }
  return out
}
