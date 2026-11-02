import { CONFIDENCE_LABEL } from '../lib/fitEngine.js'

// 핏 코멘트 (후기 종합 + 치수 대조 결과)
export default function FitComment({ result }) {
  const conf = CONFIDENCE_LABEL[result.confidence]

  return (
    <div className="card fit-comment">
      <div className="fit-head">
        <span className="eyebrow">핏 분석 결과</span>
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
