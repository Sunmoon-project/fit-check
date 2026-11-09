// 확장 카드와 같은 그래프: 후기 핏 평가 분포 막대, 부위별 여유 게이지.
// 확장에서 온 옷장 항목(verdicts, reviews.fitLabel)과 웹 분석 결과(verdicts, reviews.fit)를 같은 모양으로 그려요.
import { FIT_LABEL } from '../lib/fitEngine.js'

const FIT_DIST = [['small', '작아요'], ['true', '정사이즈'], ['large', '커요']]
const LABEL_TO_FIT = Object.fromEntries(Object.entries(FIT_LABEL).map(([k, v]) => [v, k]))
// 판정 key → 0~4 칸 (옷: 작을 수 있음~매우 넉넉, 신발: 부적합~여유)
const LEVEL = { tooTight: 0, tight: 1, regular: 2, relaxed: 3, oversize: 4, unfit: 0, iffy: 1, fit: 2, roomy: 3 }

/** 옷장 항목의 판정(part·label·verdict·key·ease)에 미리보기·칩이 쓰는 level·isLength를 채워요. */
export const withLevels = (verdicts) => (verdicts || []).map((v) => ({ ...v, level: v.level ?? LEVEL[v.key] ?? 2, isLength: v.isLength ?? v.label === '총장' }))

const fitOf = (r) => (r.fit in { small: 1, true: 1, large: 1 } ? r.fit : LABEL_TO_FIT[r.fitLabel] || null)

/** 후기 핏 분포. 평가를 읽은 후기가 2건 미만이면 그리지 않아요. */
export function FitDistBar({ reviews, title = '후기 핏 평가' }) {
  const n = { small: 0, true: 0, large: 0 }
  for (const r of reviews || []) {
    const f = fitOf(r)
    if (f) n[f] += 1
  }
  const total = n.small + n.true + n.large
  if (total < 2) return null
  const pct = (k) => Math.round((n[k] / total) * 100)
  return (
    <div className="fv-dist">
      <div className="fv-head"><strong>{title}</strong><span className="muted small">{total}건</span></div>
      <div className="fv-bar" role="img" aria-label={FIT_DIST.map(([k, l]) => `${l} ${pct(k)}%`).join(', ')}>
        {FIT_DIST.map(([k]) => (n[k] ? <i key={k} className={`fv-${k}`} style={{ width: `${(n[k] / total) * 100}%` }} /> : null))}
      </div>
      <div className="fv-legend">
        {FIT_DIST.map(([k, l]) => (
          <span key={k}><i className={`fv-${k}`} />{l} <b>{pct(k)}%</b></span>
        ))}
      </div>
    </div>
  )
}

/** 부위별 여유 게이지: 판정 글자 + 5칸 막대 + 여유 cm. */
export function EaseGauge({ verdicts }) {
  const rows = (verdicts || []).filter((v) => v && v.label && v.verdict)
  if (!rows.length) return null
  return (
    <ul className="fv-gauge">
      {rows.map((v) => {
        const level = LEVEL[v.key]
        const unit = v.part === 'footLength' ? 'mm' : 'cm'
        return (
          <li key={v.part || v.label}>
            <span className="fv-part">{v.label}</span>
            <span className="fv-seg" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i === level ? `on l${i}` : ''} />)}
            </span>
            <span className={`fv-verdict v-${v.key}`}>{v.verdict}</span>
            {typeof v.ease === 'number' && <span className="fv-ease">{v.ease > 0 ? '+' : ''}{v.ease}{unit}</span>}
          </li>
        )
      })}
    </ul>
  )
}
