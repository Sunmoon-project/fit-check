import { VERDICTS } from '../lib/fitEngine.js'

// 사이즈 탭 + 부위별 핏 판정 막대 (내 치수 vs 옷 치수, 여유분)
export default function MeasureMatch({ perSize, selectedSize, recommendedSize, measured, onSelect }) {
  if (!perSize.length) {
    return (
      <div className="card tone-measure">
        <div className="section-head">
          <h3>부위별 핏</h3>
        </div>
        <p className="muted small">사이즈표 실측이 없어 부위별 판정을 할 수 없어요.</p>
      </div>
    )
  }
  const current = perSize.find((p) => p.size === selectedSize) || perSize[0]

  return (
    <div className="card tone-measure">
      <div className="section-head">
        <h3>부위별 핏</h3>
        <span className="count-badge">적합도 {current.score}점</span>
      </div>

      <div className="size-tabs" role="tablist" aria-label="사이즈 선택">
        {perSize.map((p) => (
          <button
            key={p.size}
            type="button"
            role="tab"
            aria-selected={p.size === current.size}
            className={`size-tab ${p.size === current.size ? 'active' : ''}`}
            onClick={() => onSelect(p.size)}
          >
            {p.size}
            {p.size === recommendedSize && <span className="tab-badge">추천</span>}
          </button>
        ))}
      </div>

      <ul className="verdict-list">
        {current.verdicts.map((v) => (
          <li key={v.part} className="verdict-row">
            <div className="verdict-top">
              <strong>{v.label}</strong>
              <span className="muted small">
                내 {v.body}{v.unit}{!v.isLength && !measured.has(v.part) ? '(추정)' : ''} · 옷 {v.garment}{v.unit} · 여유 {v.ease > 0 ? '+' : ''}{v.ease}{v.unit}
              </span>
              <span className={`verdict-label v-${v.key}`}>{v.verdict}</span>
            </div>
            <div className="verdict-track" aria-hidden>
              {VERDICTS.map((d, i) => (
                <span key={d.key} className={`seg ${i === v.level ? `on v-bg-${d.key}` : ''}`} />
              ))}
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small disclaimer">
        둘레는 단면×2, 기장은 키로 계산한 표준 기장과 비교했어요. 막대는 왼쪽부터 작을 수 있음 · 타이트 · 적당 · 넉넉 · 매우 넉넉이에요.
      </p>
    </div>
  )
}
