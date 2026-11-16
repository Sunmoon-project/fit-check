// npm run eval:fit 의 명령줄 처리. 파일 읽기는 io.readFile로 받아서 테스트에서 가짜를 넣을 수 있어요.
import {
  EVAL, USAGE, NO_DATA_MESSAGE, DEMO_NOTE, parseEvalInput, evaluateReviews, evaluateSamples, formatReport, makeDemoDataset,
} from './fitEval.mjs'

function parseArgs(argv) {
  const o = { file: null, demo: false, help: false, folds: EVAL.folds, seed: EVAL.seed, by: 'review', margin: EVAL.highMargin, errors: [] }
  const num = (name, raw, min) => {
    const v = Number(raw)
    if (!Number.isFinite(v) || v < min) o.errors.push(`${name} 값이 올바르지 않아요: ${raw}`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--demo') o.demo = true
    else if (a === '--help' || a === '-h') o.help = true
    else if (a === '--file') o.file = argv[++i] ?? null
    else if (a === '--folds') o.folds = Math.floor(num('--folds', argv[++i], 2))
    else if (a === '--seed') o.seed = Math.floor(num('--seed', argv[++i], 0))
    else if (a === '--margin') o.margin = num('--margin', argv[++i], 0)
    else if (a === '--by') {
      o.by = argv[++i]
      if (o.by !== 'review' && o.by !== 'product') o.errors.push(`--by 는 review 또는 product 여야 해요: ${o.by}`)
    } else o.errors.push(`알 수 없는 옵션: ${a}`)
  }
  return o
}

/**
 * @returns {{ code: number, lines: string[] }} code 0이면 정상(데이터가 없어 측정하지 않은 경우 포함), 1이면 입력 오류
 */
export function runEvalCli(argv, io = {}) {
  const o = parseArgs(argv)
  if (o.errors.length) return { code: 1, lines: [...o.errors, '', ...USAGE] }
  if (o.help) return { code: 0, lines: USAGE }
  const opts = { folds: o.folds, seed: o.seed, groupBy: o.by, highMargin: o.margin }

  if (o.demo) {
    const data = makeDemoDataset(o.seed)
    const result = evaluateReviews(data.products, opts)
    return { code: 0, lines: formatReport(result, { demo: true, source: `${DEMO_NOTE} (--demo, 시드 ${o.seed})` }) }
  }
  if (!o.file) {
    return { code: 0, lines: [NO_DATA_MESSAGE, '', ...USAGE] }
  }
  let obj
  try {
    obj = JSON.parse(io.readFile(o.file))
  } catch (e) {
    return { code: 1, lines: [`평가 데이터를 읽지 못했어요(${o.file}): ${e.message}`] }
  }
  // 합성 데이터를 실제 데이터처럼 보이지 않게: 파일이 synthetic 표시를 갖고 있으면 데모와 같은 문구를 달아요.
  const demo = !!obj?.synthetic
  const input = parseEvalInput(obj)
  if (input.error) return { code: 1, lines: [input.error] }
  const result = input.mode === 'reviews' ? evaluateReviews(input.products, opts) : evaluateSamples(input.samples, opts)
  if (result.label.n === 0) {
    return { code: 0, lines: ['평가할 수 있는 후기(또는 샘플)가 없어 측정하지 않았어요.', '', ...USAGE] }
  }
  return { code: 0, lines: formatReport(result, { demo, source: o.file }) }
}
