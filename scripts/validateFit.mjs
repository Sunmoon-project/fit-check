// 핏 데이터셋 검증 CLI (의존성 없음)
// 사용: node scripts/validateFit.mjs <데이터.json> [--out 결과.json] [--threshold 55]
//       FIT_DATASET_PATH=<경로> node scripts/validateFit.mjs
//       node scripts/validateFit.mjs --demo   (합성 샘플로 파이프라인만 확인)
import fs from 'node:fs'
import path from 'node:path'
import { bodySimilarity } from '../src/lib/fitEngine.js'
import { normalizeLines, evaluate, LABELS } from './lib/fitMetrics.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const valueArgs = new Set([opt('--out'), opt('--threshold')].filter(Boolean))
const positional = args.filter((a) => !a.startsWith('--') && !valueArgs.has(a))

const DEMO = flag('--demo')
const threshold = Number(opt('--threshold') ?? 55)

const USAGE = `핏 데이터셋 검증 스크립트

사용법
  node scripts/validateFit.mjs <데이터 파일> [--out 결과.json] [--threshold 55]
  FIT_DATASET_PATH=<데이터 파일> npm run validate:fit
  npm run validate:fit -- --demo     합성 샘플로 동작만 확인(실제 정확도 아님)

데이터 파일은 직접 내려받아 주세요(이 저장소에는 원본 데이터를 넣지 않아요).
권장 위치: data/ 또는 .cache/ (둘 다 git에 올라가지 않아요).
형식: JSON lines(한 줄에 후기 하나). 필드 fit, size, item_id, height, weight.
내려받기 전에 데이터셋의 이용 조건(라이선스)을 직접 확인하세요.`

// 합성 샘플: 파이프라인 동작 확인용. 실제 데이터가 아니에요.
function demoText() {
  let seed = 7
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const lines = []
  for (let item = 1; item <= 6; item++) {
    for (let k = 0; k < 40; k++) {
      const hIn = 60 + Math.floor(rnd() * 12) // 5'0" ~ 5'11"
      const lbs = 110 + Math.floor(rnd() * 70)
      const size = String([4, 8, 12][Math.floor(rnd() * 3)])
      const r = rnd()
      const fit = r < 0.2 ? 'small' : r < 0.85 ? 'fit' : 'large'
      lines.push(JSON.stringify({ item_id: `demo${item}`, size, fit, height: `${Math.floor(hIn / 12)}' ${hIn % 12}"`, weight: `${lbs}lbs` }))
    }
  }
  lines.push('깨진 줄', JSON.stringify({ item_id: 'x', size: '4', fit: 'unknown', height: '5\' 5"', weight: '130lbs' }))
  return lines.join('\n')
}

const pct = (v) => (v == null ? '-' : `${(v * 100).toFixed(1)}%`)

function printReport(res, norm, source) {
  const out = []
  out.push(`데이터: ${source}`)
  out.push(`읽은 행 ${norm.total}개 / 사용 ${res.samples}개 / 제외 ${norm.total - res.samples}개`)
  for (const [why, n] of Object.entries(norm.excluded)) out.push(`  - 제외 사유: ${why} ${n}개`)
  out.push('')
  out.push(`핏 라벨 분포: small ${res.labelDistribution.small}, true ${res.labelDistribution.true}, large ${res.labelDistribution.large}`)
  out.push(`비교 기준(항상 '${res.baselineLabel}'로 답함) 정확도: ${pct(res.baselineAccuracy)}`)
  out.push('')
  out.push(`[이웃 투표] 같은 상품·같은 사이즈에서 bodySimilarity ${res.threshold} 이상인 다른 사람들의 가중 다수결`)
  out.push(`예측 가능 ${res.answered}개 (커버리지 ${pct(res.coverage)}), 예측 불가 ${res.samples - res.answered}개 (이웃 없음 또는 득표 동률, 그중 동률 ${res.ties}개)`)
  out.push(`정확도(예측 가능한 행 기준): ${pct(res.accuracy)}`)
  out.push('라벨별            precision   recall   표본')
  for (const l of LABELS) {
    const p = res.perLabel[l]
    out.push(`  ${l.padEnd(6)}        ${pct(p.precision).padStart(8)}  ${pct(p.recall).padStart(7)}  ${String(p.support).padStart(5)}`)
  }
  out.push('혼동행렬 (행=실제, 열=예측)')
  out.push(`            ${LABELS.map((l) => l.padStart(7)).join('')}`)
  for (const a of LABELS) out.push(`  ${a.padEnd(8)}  ${LABELS.map((p) => String(res.matrix[a][p]).padStart(7)).join('')}`)
  out.push('')
  out.push('사이즈별 라벨 분포')
  for (const [s, d] of Object.entries(res.bySize).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    out.push(`  ${s.padEnd(5)} small ${d.small}, true ${d.true}, large ${d.large}`)
  }
  const bucket = (title, list, unit) => {
    out.push(title)
    for (const b of list) {
      const range = b.from == null ? `< ${b.to}` : b.to == null ? `>= ${b.from}` : `${b.from}~${b.to}`
      out.push(`  ${(range + unit).padEnd(12)} 표본 ${String(b.n).padStart(4)}  정사이즈 비율 ${pct(b.rate)}`)
    }
  }
  bucket('키 구간별 정사이즈 비율', res.heightBuckets, 'cm')
  bucket('몸무게 구간별 정사이즈 비율', res.weightBuckets, 'kg')
  out.push('')
  out.push('참고: 이 데이터에는 상품 실측 사이즈표가 없을 가능성이 커서 EASE_RULES(여유분 기준)는 여기서 검증하지 않아요.')
  console.log(out.join('\n'))
}

function main() {
  if (flag('--help') || flag('-h')) {
    console.log(USAGE)
    return 0
  }
  if (!Number.isFinite(threshold)) {
    console.error('--threshold 는 숫자여야 해요.')
    return 1
  }
  let text
  let source
  if (DEMO) {
    text = demoText()
    source = '합성 데이터(--demo)'
    console.log('⚠ 합성 데이터, 실제 정확도 아님. 아래 수치는 파이프라인이 도는지 확인하는 용도예요.\n')
  } else {
    const file = positional[0] || process.env.FIT_DATASET_PATH
    if (!file) {
      console.log(USAGE)
      return 1
    }
    const abs = path.resolve(file)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      console.log(`데이터 파일을 찾을 수 없어요: ${abs}\n\n${USAGE}`)
      return 1
    }
    text = fs.readFileSync(abs, 'utf8')
    source = abs
  }
  const norm = normalizeLines(text)
  if (norm.rows.length === 0) {
    console.log('사용할 수 있는 행이 하나도 없어요. 파일 형식(JSON lines)과 필드 이름을 확인하세요.')
    for (const [why, n] of Object.entries(norm.excluded)) console.log(`  - 제외 사유: ${why} ${n}개`)
    return 1
  }
  const res = evaluate(norm.rows, bodySimilarity, threshold)
  printReport(res, norm, source)
  if (DEMO) console.log('\n⚠ 합성 데이터, 실제 정확도 아님.')
  const outPath = opt('--out')
  if (outPath) {
    const abs = path.resolve(outPath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, JSON.stringify({ synthetic: DEMO, source, excluded: norm.excluded, total: norm.total, result: res }, null, 2))
    console.log(`\n결과 JSON 저장: ${abs}`)
  }
  return 0
}

process.exitCode = main()
