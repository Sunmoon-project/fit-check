import { CONFIDENCE_LABEL, describeEvidence } from '../lib/fitEngine.js'

// 추천 사이즈 카드 (후기 투표 + 실측 비교 종합)
export default function FitComment({ result }) {
  const conf = CONFIDENCE_LABEL[result.confidence]
  const evidence = result.evidence ? describeEvidence(result.evidence, result.confidence) : null

  return (
    <div className="card reco-card">
      <div className="fit-head">
        <span className="eyebrow">내 체형 추천</span>
        <span className="conf-badge" style={{ color: conf.color }}>
          <span className="conf-dot" style={{ background: conf.color }} />
          {conf.text}
        </span>
      </div>

      {evidence && (
        <div className="evidence">
          <p className="evidence-summary">{evidence.summary}</p>
          {evidence.reasons.length > 0 && (
            <ul className="evidence-why" aria-label="확신도가 더 높지 않은 이유">
              {evidence.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
        </div>
      )}

      {result.recommendedSize && (
        <div className="reco-size">
          <strong className="size-big">{result.recommendedSize}</strong>
          <span className="muted small">추천 사이즈</span>
        </div>
      )}

      <h3 className="fit-headline">{result.headline}</h3>
      <p className="fit-body">{result.body}</p>
      <p className="muted small disclaimer">확신도는 후기·사이즈표 근거가 얼마나 있는지로 나눈 참고 단계예요. 정확도를 측정한 값이 아니에요.</p>
      <p className="muted small disclaimer">{result.note}</p>
    </div>
  )
}
