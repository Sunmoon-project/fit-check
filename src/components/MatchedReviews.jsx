import { FIT_LABEL } from '../lib/fitEngine.js'

// 기능 ② 비슷한 체형 후기 필터
export default function MatchedReviews({ matched }) {
  return (
    <div className="card">
      <div className="section-head">
        <h3>비슷한 체형 후기</h3>
        <span className="count-badge">{matched.length}건</span>
      </div>

      {matched.length === 0 ? (
        <p className="muted small">아직 비슷한 체형의 후기가 없어요.</p>
      ) : (
        <ul className="review-list">
          {matched.map((r) => (
            <li key={r.id} className="review-item">
              <div className="review-top">
                <strong>{r.nick}</strong>
                <span className="muted small">{r.height}cm · {r.weight}kg · {r.size}</span>
                <span className={`fit-tag fit-${r.fit}`}>{FIT_LABEL[r.fit]}</span>
              </div>
              <p className="review-text">{r.text}</p>
              <div className="sim-bar" aria-label={`체형 유사도 ${r.similarity}%`}>
                <div className="sim-fill" style={{ width: `${r.similarity}%` }} />
              </div>
              <span className="sim-label">체형 유사도 {r.similarity}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
