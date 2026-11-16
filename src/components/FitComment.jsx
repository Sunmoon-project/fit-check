import { CONFIDENCE_LABEL, describeEvidence } from '../lib/fitEngine.js'
import { regionLine } from '../lib/brandRegion.js'

// 추천 사이즈 카드 (후기 투표 + 실측 비교 종합)
export default function FitComment({ result }) {
  const isShoes = result.isShoes === true
  // 신발은 옷용 근거 문구 대신 신발 판정에서 만든 근거 한 줄과 이유를 써요.
  const conf = result.confidenceLabel || CONFIDENCE_LABEL[result.confidence]
  const evidence = isShoes
    ? { summary: result.shoeSummary, reasons: result.shoeReasons || [], details: result.regionInfo ? [regionLine(result.regionInfo)] : [] }
    : result.evidence ? describeEvidence(result.evidence, result.confidence) : null

  const sizeHint = result.sizeSystem || null
  return (
    <div className="card reco-card tone-reco">
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
      {isShoes && !result.recommendedSize && <p className="muted small">추천할 사이즈가 없어요. 아래 사이즈별 판정은 참고로만 봐주세요.</p>}
      {result.note && <p className="muted small disclaimer">{result.note}</p>}

      {sizeHint && (
        <div className="info-box size-system-hint" role="note">
          <p className="small"><strong>{sizeHint.title}</strong></p>
          <ul>{sizeHint.lines.map((l) => <li key={l} className="small">{l}</li>)}</ul>
          <p className="muted small">{sizeHint.note}</p>
        </div>
      )}

      {evidence && (
        <details className="evidence">
          <summary className="evidence-summary">{evidence.summary}</summary>
          {evidence.reasons.length > 0 && (
            <ul className="evidence-why" aria-label={isShoes ? '추천 이유' : '확신도가 더 높지 않은 이유'}>
              {evidence.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
          {evidence.details?.length > 0 && (
            <ul className="evidence-details" aria-label="추천에 쓰인 근거">
              {evidence.details.map((d) => <li key={d} className="small">{d}</li>)}
            </ul>
          )}
        </details>
      )}
    </div>
  )
}
