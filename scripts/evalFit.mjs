// 성공 기준 지표 측정 CLI (의존성 없음). 사용법: node scripts/evalFit.mjs --help
import fs from 'node:fs'
import { runEvalCli } from './lib/evalCli.mjs'

const { code, lines } = runEvalCli(process.argv.slice(2), { readFile: (p) => fs.readFileSync(p, 'utf8') })
console.log(lines.join('\n'))
process.exit(code)
