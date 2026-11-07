// 신발 전용 사이즈 비교: 사이즈(옵션)별 여유 mm와 판정, 구매 리뷰 집계, 추천 이유.
// 신발 후기에는 키·몸무게가 없는 경우가 많아서 체형 비교 대신 발 정보(발길이·발볼)로 비교해요.
export default function ShoeCompare({ view: sv, selectedSize, onSelect }) {
  if (!sv) return null
  return (
    <div className="card tone-measure shoe-compare">
      <div className="section-head">
        <h3>신발 사이즈 비교</h3>
        <span className="count-badge">발 정보 비교</span>
      </div>
      <p className="small">
        {sv.footLength
          ? `내 발길이 ${sv.footLength}mm${sv.footLengthEstimated ? ' (키로 추정)' : ''} · 발볼 ${sv.footWidthLabel || '입력 안 함'}`
          : '발길이를 알 수 없어요'}
      </p>
      {sv.noFit && <p className="shoe-nofit" role="alert">{sv.noFit.message}</p>}
      {sv.windowText && <p className="muted small shoe-window">{sv.windowText}</p>}
      <ul className="verdict-list">
        {sv.rows.map((row) => (
          <li key={row.mm} className={`verdict-row ${row.unfit ? 'row-unfit' : ''}`}>
            <div className="verdict-top">
              <button
                type="button"
                className={`size-tab ${(selectedSize ? String(selectedSize) === String(row.mm) : row.recommended) ? 'active' : ''}`}
                onClick={() => onSelect?.(String(row.mm))}
              >
                {row.label}
                {row.recommended && <span className="tab-badge">추천</span>}
              </button>
              <span className="muted small">
                {row.rangeText}
                {row.widthText && ` · ${row.widthText}`}
                {row.ease != null && ` · 여유 ${row.ease > 0 ? '+' : ''}${row.ease}mm`}
              </span>
              {row.verdict && <span className={`verdict-label v-${row.verdictKey}`}>{row.verdict}</span>}
            </div>
            {row.reviewLine && <p className="muted small">{row.reviewLine}</p>}
          </li>
        ))}
      </ul>
      {sv.reasons.map((t) => <p key={t} className="small">{t}</p>)}
      {sv.widthLine && <p className="small shoe-width-line">{sv.widthLine}</p>}
      {sv.notes.map((t) => <p key={t} className="muted small">{t}</p>)}
      <p className="muted small disclaimer">{sv.heuristicNote}</p>
    </div>
  )
}
