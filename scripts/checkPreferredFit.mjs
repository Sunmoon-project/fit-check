// 선호 핏 × 체형 × 사이즈표 시나리오 점검: `node scripts/checkPreferredFit.mjs`
// 같은 사람이라면 슬림 ≤ 레귤러 ≤ 오버핏, 같은 선호라면 몸이 클수록 같거나 큰 사이즈가 나와야 해요.
// 사이즈표는 실제 쇼핑몰 반팔티·셔츠·슬랙스 실측 형식을 흉내 낸 가짜 표예요 (실제 상품 값 아님).
import assert from 'node:assert/strict'
import { generateFitComment, bodyValuesForProfile } from '../src/lib/fitEngine.js'

const TEE = { unit: 'cm', rows: [['S'], ['M'], ['L'], ['XL'], ['XXL']], measures: {
  S: { shoulder: 44, chest: 104, topLength: 68 },
  M: { shoulder: 46, chest: 110, topLength: 70 },
  L: { shoulder: 48, chest: 116, topLength: 72 },
  XL: { shoulder: 50, chest: 122, topLength: 74 },
  XXL: { shoulder: 52, chest: 128, topLength: 76 } } } // 반팔 소매길이(20cm대)는 파서가 팔길이로 쓰지 않아요
const SHIRT = { unit: 'cm', rows: [['95'], ['100'], ['105'], ['110']], measures: {
  95: { shoulder: 43, chest: 104, topLength: 74, arm: 61 },
  100: { shoulder: 45, chest: 110, topLength: 76, arm: 62 },
  105: { shoulder: 47, chest: 116, topLength: 78, arm: 63 },
  110: { shoulder: 49, chest: 122, topLength: 80, arm: 64 } } }
const SLACKS = { unit: 'cm', rows: [['28'], ['30'], ['32'], ['34'], ['36']], measures: {
  28: { waist: 72, hip: 96, thigh: 58, inseam: 98 },
  30: { waist: 77, hip: 100, thigh: 60, inseam: 99 },
  32: { waist: 82, hip: 104, thigh: 62, inseam: 100 },
  34: { waist: 87, hip: 108, thigh: 64, inseam: 101 },
  36: { waist: 92, hip: 112, thigh: 66, inseam: 102 } } }
const PRODUCTS = [['반팔티', 'top', TEE], ['셔츠', 'top', SHIRT], ['슬랙스', 'bottom', SLACKS]]
const BODIES = [['male', 165, 55], ['male', 172, 65], ['male', 178, 75], ['male', 185, 90], ['female', 160, 50], ['female', 168, 60]]
const FITS = ['slim', 'regular', 'relaxed']

const sizeIdx = (chart, s) => chart.rows.map((r) => String(r[0])).indexOf(String(s))
const profileOf = ([gender, height, weight], preferredFit, measurements = {}) => ({ gender, height, weight, preferredFit, shape: { shoulder: 'normal', belly: 'none', lower: 'normal' }, usual: { top: '', bottom: '' }, measurements })

const rows = []
let problems = 0
for (const [name, category, chart] of PRODUCTS) {
  const product = { name, category, sizeChart: chart, reviews: [], url: `demo://${name}` }
  const byBody = []
  for (const body of BODIES) {
    const picks = FITS.map((f) => {
      const r = generateFitComment(profileOf(body, f), product)
      const v = r.perSize.find((p) => p.size === r.recommendedSize)?.verdicts || []
      return { fit: f, size: r.recommendedSize, verdicts: v.map((x) => `${x.label} ${x.verdict}(${x.ease > 0 ? '+' : ''}${x.ease})`).join(', ') }
    })
    const idx = picks.map((p) => sizeIdx(chart, p.size))
    // 1) 같은 사람: 슬림 ≤ 레귤러 ≤ 오버핏
    if (!(idx[0] <= idx[1] && idx[1] <= idx[2])) { problems++; console.log(`✗ ${name} ${body.join('/')}: 선호 핏 순서가 거꾸로 (${picks.map((p) => p.size).join(' / ')})`) }
    // 2) 추천 사이즈에 '작을 수 있음'(둘레)이 남아 있지 않아야 해요 (표에서 가장 큰 사이즈인데도 작은 경우는 예외)
    const chosen = generateFitComment(profileOf(body, 'regular'), product)
    const tight = chosen.perSize.find((p) => p.size === chosen.recommendedSize)?.verdicts.filter((v) => v.level === 0 && !v.isLength) || []
    if (tight.length && sizeIdx(chart, chosen.recommendedSize) < chart.rows.length - 1) { problems++; console.log(`✗ ${name} ${body.join('/')} 레귤러: ${chosen.recommendedSize}가 ${tight.map((v) => v.label).join(',')} 작을 수 있음`) }
    byBody.push({ body, idx })
    rows.push([name, body.join('/'), ...picks.map((p) => p.size)])
    if (process.argv.includes('-v')) for (const p of picks) console.log(`   ${name} ${body.join('/')} ${p.fit}: ${p.size} — ${p.verdicts}`)
  }
  // 3) 같은 성별·같은 선호: 몸이 클수록 같거나 큰 사이즈
  for (const g of ['male', 'female']) {
    const list = byBody.filter((b) => b.body[0] === g)
    for (let f = 0; f < FITS.length; f++) for (let i = 1; i < list.length; i++) {
      if (list[i].idx[f] < list[i - 1].idx[f]) { problems++; console.log(`✗ ${name} ${FITS[f]}: ${list[i].body.join('/')}가 ${list[i - 1].body.join('/')}보다 작은 사이즈`) }
    }
  }
}

// 5) 하의 오버핏이어도 허리가 '넉넉' 이상이면 안 돼요 (표에서 가장 작은 사이즈인데도 큰 경우는 예외)
for (const body of BODIES) {
  const r = generateFitComment(profileOf(body, 'relaxed'), { name: '슬랙스', category: 'bottom', sizeChart: SLACKS, reviews: [], url: 'demo://s' })
  const w = r.perSize.find((x) => x.size === r.recommendedSize)?.verdicts.find((v) => v.part === 'waist')
  if (w && w.level >= 3 && sizeIdx(SLACKS, r.recommendedSize) > 0) { problems++; console.log(`✗ 슬랙스 ${body.join('/')} 오버핏: ${r.recommendedSize} 허리 ${w.verdict}(+${w.ease})`) }
}

// 4) 직접 잰 가슴둘레가 크면 같은 키·몸무게라도 큰 사이즈로 가야 해요
const base = profileOf(['male', 175, 70], 'regular')
const p = { name: '반팔티', category: 'top', sizeChart: TEE, reviews: [], url: 'demo://t' }
const est = bodyValuesForProfile(base).values.chest
const small = generateFitComment(profileOf(['male', 175, 70], 'regular', { chest: est - 8 }), p).recommendedSize
const big = generateFitComment(profileOf(['male', 175, 70], 'regular', { chest: est + 10 }), p).recommendedSize
if (!(sizeIdx(TEE, small) <= sizeIdx(TEE, big) && small !== big)) { problems++; console.log(`✗ 직접 잰 가슴둘레 반영 안 됨: ${est - 8}cm→${small}, ${est + 10}cm→${big}`) }
rows.push(['반팔티(가슴 실측)', `가슴 ${est - 8} / ${est + 10}`, small, '', big])

console.table(rows.map(([상품, 체형, 슬림, 레귤러, 오버핏]) => ({ 상품, 체형, 슬림, 레귤러, 오버핏 })))
console.log(problems ? `문제 ${problems}건` : '모든 시나리오 통과')
assert.equal(problems, 0)
