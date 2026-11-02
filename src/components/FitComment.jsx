import { CONFIDENCE_LABEL } from '../lib/fitEngine.js'

// 추천 사이즈 카드 (후기 투표 + 실측 비교 종합)
export default function FitComment({ result }) {
  const conf = CONFIDENCE_LABEL[result.confidence]

  return (
    <div className="card reco-card">
      <div className="fit-head">
        <span className="eyebrow">내 체형 추천</span>
        <span className="conf-badge" style={{ color: conf.color }}>
          <span className="conf-dot" style={{ background: conf.color }} />
          {conf.text}
        </span>
      </div>

      {result.recommendedSize && (
        <div className="reco-size">
          <strong className="size-big">{result.recommendedSize}</strong>
          <span className="muted small">추천 사이즈</span>
        </div>
      )}

      <h3 className="fit-headline">{result.headline}</h3>
      <p className="fit-body">{result.body}</p>
      <p className="muted small disclaimer">{result.note}</p>
    </div>
  )
}
