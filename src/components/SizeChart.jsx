import { EXTRA_PART_LABEL } from '../data/measurements.js'
import { MEASURE_ONLY_LABEL } from '../lib/sizeCompare.js'

// 상품 사이즈표 (핏 판정이 대조하는 원본 데이터). 줄을 누르면 그 사이즈로 부위별 비교가 바뀌어요.
export default function SizeChart({ chart, recommendedSize, selectedSize, compare, onSelect }) {
  if (!chart) {
    return (
      <div className="card tone-chart">
        <div className="section-head">
          <h3>사이즈표</h3>
        </div>
        <p className="muted small">이 페이지에서 사이즈표를 찾지 못했어요.</p>
      </div>
    )
  }
  const onlyLabels = (compare?.measureOnlyParts || []).map((p) => EXTRA_PART_LABEL[p] || p)
  return (
    <div className="card tone-chart">
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
                <tr
                  key={row[0]}
                  className={`${isReco ? 'reco-row' : ''} ${label === selectedSize ? 'selected-row' : ''}`}
                  onClick={onSelect ? () => onSelect(label) : undefined}
                >
                  {row.map((cell, i) => (
                    <td key={i}>
                      {i === 0 && onSelect ? (
                        <button type="button" className="row-select" aria-pressed={label === selectedSize} onClick={(e) => { e.stopPropagation(); onSelect(label) }}>
                          {cell}
                        </button>
                      ) : (
                        cell
                      )}
                      {i === 0 && isReco && <span className="reco-dot">추천</span>}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {onlyLabels.length > 0 && (
        <p className="muted small">
          {onlyLabels.join(', ')}: {MEASURE_ONLY_LABEL}
        </p>
      )}
    </div>
  )
}
