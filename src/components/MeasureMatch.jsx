import { CATEGORY_MEASUREMENTS } from '../data/measurements.js'

// 상세 치수 대조 결과: 내 치수 vs 추천 사이즈 치수, 여유분 표시
export default function MeasureMatch({ product, profile, measureResult }) {
  if (!measureResult || !profile.measurements) return null

  const def = CATEGORY_MEASUREMENTS[product.category]
  const best = measureResult.perSize[0]
  const garment = product.sizeChart.measures[best.size]
  const labelMap = {}
  if (def) for (const f of def.fields) labelMap[f.key] = f

  const rows = Object.keys(garment)
    .map((key) => {
      const field = labelMap[key]
      if (!field) return null
      const mine = profile.measurements[key]
      if (mine == null) return null
      const g = garment[key]
      const ease = Math.round((g - mine) * 10) / 10
      let state = 'ok'
      if (best.tightFields.includes(key)) state = 'tight'
      else if (best.looseFields.includes(key)) state = 'loose'
      return { key, label: field.label, unit: field.unit, options: field.options, mine, g, ease, state }
    })
    .filter(Boolean)

  const stateText = { ok: '잘 맞음', tight: '타이트', loose: '여유' }

  return (
    <div className="card">
      <div className="section-head">
        <h3>실측 비교 · {best.size}</h3>
        <span className="count-badge">적합도 {best.score}%</span>
      </div>
      <table className="size-table measure-table">
        <thead>
          <tr>
            <th>항목</th>
            <th>내 치수</th>
            <th>{best.size}</th>
            <th>여유</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="ta-left">{r.label}</td>
              <td>{r.options ? r.options[r.mine - 1] : `${r.mine}${r.unit}`}</td>
              <td>{r.options ? r.options[r.g - 1] : `${r.g}${r.unit}`}</td>
              <td>
                <span className={`ease-tag ease-${r.state}`}>
                  {r.options
                    ? stateText[r.state]
                    : `${r.ease > 0 ? '+' : ''}${r.ease}${r.unit} · ${stateText[r.state]}`}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small disclaimer">
        옷 치수에서 내 치수를 뺀 값이에요. 값이 작을수록 타이트하게 맞아요.
      </p>
    </div>
  )
}
