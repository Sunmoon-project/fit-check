// 사이즈표 요약: 읽어 온 사이즈표(compareSizes/compactCompare 결과의 sizes)를 짧게 줄여요.
// 사이즈 목록, 추천 사이즈의 핵심 실측, 위·아래 사이즈와의 차이, 한 줄 판정만 만들고 문자열·숫자만 돌려줘서 확장 카드에도 그대로 써요.
// 사이즈 이름은 사이즈표 원문 그대로 쓰고, 순수 함수라 DOM이 필요 없어요.

export const NO_CHART_MESSAGE = '사이즈표를 읽지 못했어요.'
const MAX_PARTS = 4
const MAX_DIFFS = 3

// 카테고리별로 먼저 보여줄 부위 (행 라벨 기준)
const KEY_PART_PATTERNS = {
  top: [/^어깨/, /^가슴/, /^(소매|팔길이)$/, /^총장$/],
  outer: [/^어깨/, /^가슴/, /^(소매|팔길이)$/, /^총장$/],
  dress: [/^어깨/, /^가슴/, /^허리/, /^총장$/],
  bottom: [/^허리/, /^허벅지/, /^밑위$/, /^총장$/],
  shoes: [/^발길이/, /^발볼/],
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const round1 = (v) => Math.round(v * 10) / 10
const signed = (n) => `${n > 0 ? '+' : ''}${round1(n)}`

function pickRows(rows, category) {
  const pats = KEY_PART_PATTERNS[category]
  if (!pats) return rows.slice(0, MAX_PARTS)
  const out = []
  for (const re of pats) {
    const row = rows.find((r) => re.test(String(r.label)) && !out.includes(r))
    if (row) out.push(row)
  }
  return out.length ? out.slice(0, MAX_PARTS) : rows.slice(0, MAX_PARTS)
}

function diffText(base, other, parts) {
  const items = []
  for (const row of parts) {
    const o = other.rows.find((r) => r.label === row.label)
    if (!o || !isNum(o.garment) || !isNum(row.garment)) continue
    const d = round1(row.garment - o.garment)
    if (d === 0) continue
    items.push(`${row.label} ${signed(d)}${row.unit}`)
    if (items.length >= MAX_DIFFS) break
  }
  return items.length ? `${other.label}보다 ${items.join(', ')}` : null
}

/**
 * @param {{ sizes?: Array<{size,label,rows}>, recommended?: string|null, category?: string }} input
 * @returns {{ status:'ok'|'none', message:string, sizes:string[], recommended:string|null,
 *   keyParts:Array<{label,value,unit}>, neighbors:{lowerDiff:string|null, upperDiff:string|null}, verdictLine:string|null }}
 */
export function summarizeSizeChart({ sizes, recommended = null, category } = {}) {
  const list = Array.isArray(sizes) ? sizes.filter((s) => s && Array.isArray(s.rows) && s.rows.length) : []
  if (!list.length) {
    return { status: 'none', message: NO_CHART_MESSAGE, sizes: [], recommended: null, keyParts: [], neighbors: { lowerDiff: null, upperDiff: null }, verdictLine: null }
  }
  const labelOf = (s) => String(s.label || s.size)
  const idx = recommended == null ? -1 : list.findIndex((s) => String(s.size).toUpperCase() === String(recommended).toUpperCase())
  const base = idx >= 0 ? list[idx] : null
  const out = {
    status: 'ok', message: '', sizes: list.map(labelOf), recommended: base ? labelOf(base) : null,
    keyParts: [], neighbors: { lowerDiff: null, upperDiff: null }, verdictLine: null,
  }
  if (!base) return out
  const parts = pickRows(base.rows.filter((r) => isNum(r.garment)), category)
  out.keyParts = parts.map((r) => ({ label: r.label, value: r.garment, unit: r.unit }))
  const named = (s) => ({ label: labelOf(s), rows: s.rows })
  if (idx > 0) out.neighbors.lowerDiff = diffText(base, named(list[idx - 1]), parts)
  if (idx < list.length - 1) out.neighbors.upperDiff = diffText(base, named(list[idx + 1]), parts)
  const judged = base.rows.filter((r) => r.verdict && r.body != null).slice(0, MAX_DIFFS + 1)
  out.verdictLine = judged.length ? judged.map((r) => `${r.label} ${r.verdict}`).join(' · ') : null
  return out
}
