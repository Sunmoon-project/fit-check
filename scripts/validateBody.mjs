// 체형 추정(estimateBody) 검증 CLI (의존성 없음)
// 사용: node scripts/validateBody.mjs <데이터.csv|json> [--map 매핑.json] [--unit cm|mm] [--fit] [--out 결과.json]
//       BODY_DATASET_PATH=<경로> node scripts/validateBody.mjs
//       node scripts/validateBody.mjs --demo   (합성 샘플로 파이프라인만 확인)
import fs from 'node:fs'
import path from 'node:path'
import { estimateBody } from '../src/lib/bodyEstimate.js'
import { PARTS, mergeMapping, parseRows, normalizeBodyRows, evaluateBody, suggestCoefficients } from './lib/bodyMetrics.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const valueArgs = new Set([opt('--out'), opt('--map'), opt('--unit')].filter(Boolean))
const positional = args.filter((a) => !a.startsWith('--') && !valueArgs.has(a))

const DEMO = flag('--demo')
const unit = opt('--unit') ?? 'cm'

const USAGE = `체형 추정 검증 스크립트

사용법
  node scripts/validateBody.mjs <데이터 파일> [--map 매핑.json] [--unit cm|mm] [--fit] [--out 결과.json]
  BODY_DATASET_PATH=<데이터 파일> npm run validate:body
  npm run validate:body -- --demo     합성 샘플로 동작만 확인(실제 정확도 아님)

데이터 파일은 직접 내려받아 주세요(이 저장소에는 원본 데이터를 넣지 않아요).
권장 위치: data/ 또는 .cache/ (둘 다 git에 올라가지 않아요).
형식: CSV(첫 줄 헤더), JSON 배열, JSON lines. 사람 한 명이 한 행.
필요한 값: 성별, 키, 몸무게, 그리고 어깨너비·가슴·허리·엉덩이·허벅지 둘레·팔길이·발길이 중 가진 것.
컬럼 이름이 다르면 --map 으로 매핑 JSON을 주세요. 예: {"height":"신장_cm","waist":["허리둘레_mm"]}
--unit mm 이면 키와 모든 길이 컬럼을 mm로 읽어요(몸무게는 항상 kg).
--fit 은 최소제곱 회귀 계수를 제안만 출력해요(bodyEstimate.js는 바꾸지 않아요).
내려받기 전에 데이터의 이용 조건(라이선스)을 직접 확인하세요.`

// 합성 샘플: 파이프라인 동작 확인용. 실제 데이터가 아니에요.
function demoCsv() {
  let seed = 11
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 2
  const lines = ['gender,height,weight,shoulder,chest,waist,hip,thigh,arm,footLength']
  for (let i = 0; i < 200; i++) {
    const female = i % 2 === 0
    const h = (female ? 160 : 173) + gauss() * 4
    const w = (female ? 55 : 70) + gauss() * 6
    const est = estimateBody({ gender: female ? 'female' : 'male', height: h, weight: w }).values
    const noise = (s) => (gauss() * s).toFixed(1)
    lines.push([
      female ? 'female' : 'male', h.toFixed(1), w.toFixed(1),
      (est.shoulder + Number(noise(2))).toFixed(1), (est.chest + Number(noise(3))).toFixed(1),
      (est.waist + Number(noise(4))).toFixed(1), (est.hip + Number(noise(3))).toFixed(1),
      (est.thigh + Number(noise(3))).toFixed(1), (est.arm + Number(noise(2))).toFixed(1),
      ((est.footLength + Number(noise(8))) / 10).toFixed(1), // 원본은 cm, 정규화에서 mm로 바꿈
    ].join(','))
  }
  lines.push('깨진,행')
  return lines.join('\n')
}

const f1 = (v) => (v == null ? '-' : v.toFixed(2))
const pct = (v) => (v == null ? '-' : `${(v * 100).toFixed(1)}%`)
const GENDER = { female: '여성', male: '남성' }
const PART_KO = { shoulder: '어깨너비', chest: '가슴둘레', waist: '허리둘레', hip: '엉덩이둘레', thigh: '허벅지둘레', arm: '팔길이', footLength: '발길이' }

function printReport(result, norm, source) {
  const out = []
  out.push(`데이터: ${source}`)
  out.push(`읽은 행 ${norm.total}개 / 사용 ${norm.rows.length}개 / 제외 ${norm.total - norm.rows.length}개`)
  for (const [why, n] of Object.entries(norm.excluded)) out.push(`  - 제외 사유: ${why} ${n}개`)
  out.push('')
  out.push('오차 = 추정 - 실측, 단위 cm(발길이도 cm로 환산해 비교). bias가 +이면 과대 추정이에요.')
  for (const g of ['female', 'male']) {
    out.push('')
    out.push(`[${GENDER[g]}]`)
    out.push('부위          표본     MAE    RMSE    bias   ±3cm 이내  ±5cm 이내')
    for (const p of PARTS) {
      const s = result[g][p]
      if (!s) { out.push(`  ${PART_KO[p].padEnd(8)}  (실측값 없음)`); continue }
      out.push(`  ${PART_KO[p].padEnd(8)} ${String(s.n).padStart(5)} ${f1(s.mae).padStart(7)} ${f1(s.rmse).padStart(7)} ${f1(s.bias).padStart(7)} ${pct(s.within3).padStart(10)} ${pct(s.within5).padStart(10)}`)
    }
  }
  out.push('')
  out.push("참고: 이 검증은 키·몸무게만 넣은 기본 추정이에요. 체형(SHAPE_ADJUST)·평소 사이즈 보정은 이 데이터로 검증할 수 없어요.")
  console.log(out.join('\n'))
}

function printFit(suggest) {
  const out = ['', '최소제곱 회귀 제안 (값 ≈ 키×a + 몸무게×b + c). 제안일 뿐이고 bodyEstimate.js는 바꾸지 않아요.']
  for (const g of ['female', 'male']) {
    out.push(`[${GENDER[g]}]`)
    for (const p of PARTS) {
      const s = suggest[g][p]
      if (!s) { out.push(`  ${PART_KO[p].padEnd(8)} (표본 부족)`); continue }
      out.push(`  ${PART_KO[p].padEnd(8)} a=${s.height.toFixed(3)} b=${s.weight.toFixed(3)} c=${s.intercept.toFixed(2)} (표본 ${s.n}${p === 'footLength' ? ', mm 단위' : ''})`)
    }
  }
  console.log(out.join('\n'))
}

function main() {
  if (flag('--help') || flag('-h')) {
    console.log(USAGE)
    return 0
  }
  if (unit !== 'cm' && unit !== 'mm') {
    console.error('--unit 은 cm 또는 mm 여야 해요.')
    return 1
  }
  let text
  let source
  let customMap = {}
  if (opt('--map')) {
    const mapPath = path.resolve(opt('--map'))
    try {
      customMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
    } catch (e) {
      console.error(`매핑 JSON을 읽지 못했어요: ${mapPath} (${e.message})`)
      return 1
    }
  }
  if (DEMO) {
    text = demoCsv()
    source = '합성 데이터(--demo)'
    console.log('⚠ 합성 데이터, 실제 정확도 아님. 아래 수치는 파이프라인이 도는지 확인하는 용도예요.\n')
  } else {
    const file = positional[0] || process.env.BODY_DATASET_PATH
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
  let raw
  try {
    raw = parseRows(text, DEMO ? 'csv' : undefined)
  } catch (e) {
    console.log(`파일을 해석하지 못했어요: ${e.message}\nCSV, JSON 배열, JSON lines 중 하나여야 해요.`)
    return 1
  }
  const norm = normalizeBodyRows(raw, mergeMapping(customMap), DEMO ? 'cm' : unit)
  if (norm.rows.length === 0) {
    console.log('사용할 수 있는 행이 하나도 없어요. 컬럼 이름(--map)과 단위(--unit)를 확인하세요.')
    for (const [why, n] of Object.entries(norm.excluded)) console.log(`  - 제외 사유: ${why} ${n}개`)
    return 1
  }
  const result = evaluateBody(norm.rows, estimateBody)
  printReport(result, norm, source)
  const suggest = flag('--fit') ? suggestCoefficients(norm.rows) : undefined
  if (suggest) printFit(suggest)
  if (DEMO) console.log('\n⚠ 합성 데이터, 실제 정확도 아님.')
  const outPath = opt('--out')
  if (outPath) {
    const abs = path.resolve(outPath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, JSON.stringify({ synthetic: DEMO, source, excluded: norm.excluded, total: norm.total, result, suggest }, null, 2))
    console.log(`\n결과 JSON 저장: ${abs}`)
  }
  return 0
}

process.exitCode = main()
