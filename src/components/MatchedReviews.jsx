import { useState } from 'react'
import { FIT_LABEL } from '../lib/fitEngine.js'

function ReviewItem({ r, showSimilarity }) {
  const spec = [r.height && `${r.height}cm`, r.weight && `${r.weight}kg`, r.size && `${r.size} 구매`].filter(Boolean).join(' · ')
  return (
    <li className="review-item">
      <div className="review-top">
        <strong>{r.nick}</strong>
        {spec && <span className="muted small">{spec}</span>}
        {r.fit && <span className={`fit-tag fit-${r.fit}`}>{FIT_LABEL[r.fit]}</span>}
      </div>
      <p className="review-text">{r.text}</p>
      {showSimilarity && (
        <>
          <div className="sim-bar" aria-label={`체형 유사도 ${r.similarity}%`}>
            <div className="sim-fill" style={{ width: `${r.similarity}%` }} />
          </div>
          <span className="sim-label">체형 유사도 {r.similarity}%</span>
        </>
      )}
    </li>
  )
}

// 비슷한 체형 후기 + 그 밖의 후기(체형 정보가 없거나 체형이 다른 후기)
export default function MatchedReviews({ matched, others }) {
  const [showOthers, setShowOthers] = useState(false)
  const total = matched.length + others.length

  return (
    <div className="card">
      <div className="section-head">
        <h3>비슷한 체형 후기</h3>
        <span className="count-badge">{matched.length}건 / 전체 {total}건</span>
      </div>

      {matched.length === 0 ? (
        <p className="muted small">
          {total === 0 ? '이 페이지에서 가져온 후기가 없어요.' : '키·몸무게가 비슷한 사람의 후기가 아직 없어요.'}
        </p>
      ) : (
        <ul className="review-list">
          {matched.map((r) => <ReviewItem key={r.id} r={r} showSimilarity />)}
        </ul>
      )}

      {others.length > 0 && (
        <div className="other-reviews">
          <button type="button" className="btn text" onClick={() => setShowOthers((v) => !v)}>
            {showOthers ? '다른 후기 접기' : `다른 후기 ${others.length}건 보기`}
          </button>
          {showOthers && (
            <ul className="review-list">
              {others.map((r) => <ReviewItem key={r.id} r={r} showSimilarity={false} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
