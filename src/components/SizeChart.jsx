// 상품 사이즈표 (핏 판정이 대조하는 원본 데이터)
export default function SizeChart({ chart, recommendedSize, selectedSize }) {
  if (!chart) {
    return (
      <div className="card">
        <div className="section-head">
          <h3>사이즈표</h3>
        </div>
        <p className="muted small">이 페이지에서 사이즈표를 찾지 못했어요.</p>
      </div>
    )
  }
  return (
    <div className="card">
      <div className="section-head">
        <h3>사이즈표</h3>
        <span className="muted small">단위 {chart.unit}</span>
      </div>
      <div className="table-scroll">
        <table className="size-table">
          <thead>
            <tr>
              {chart.headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((row) => {
              const label = String(row[0]).toUpperCase()
              const isReco = label === recommendedSize
              return (
                <tr key={row[0]} className={`${isReco ? 'reco-row' : ''} ${label === selectedSize ? 'selected-row' : ''}`}>
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
    </div>
  )
}
