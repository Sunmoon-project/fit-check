// 상품 사이즈표 (AI 핏 코멘트가 대조하는 원본 데이터)
export default function SizeChart({ chart, recommendedSize }) {
  return (
    <div className="card">
      <div className="section-head">
        <h3>사이즈표</h3>
        <span className="muted small">단위 {chart.unit}</span>
      </div>
      <table className="size-table">
        <thead>
          <tr>
            {chart.headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((row) => {
            const isReco = row[0] === recommendedSize
            return (
              <tr key={row[0]} className={isReco ? 'reco-row' : ''}>
                {row.map((cell, i) => (
                  <td key={i}>
                    {cell}
                    {i === 0 && isReco && <span className="reco-dot">추천</span>}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
