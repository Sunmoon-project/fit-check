import { VERDICTS } from '../lib/fitEngine.js'
import { MEASURE_ONLY_LABEL } from '../lib/sizeCompare.js'

const BODY_KIND_NOTE = { estimated: '(추정)', standard: '(표준)' }

// 사이즈 탭 + 부위별 비교: 내 치수 vs 옷 실측, 여유분, 판정 막대.
// compare(compareSizes 결과)가 있으면 신체 비교 기준이 없는 부위도 '실측만 표시'로 함께 보여줘요.
export default function MeasureMatch({ perSize, compare, selectedSize, recommendedSize, onSelect }) {
  const sizes = compare?.sizes?.length
    ? compare.sizes
    : perSize.map((p) => ({
        size: p.size,
        label: p.size,
        rows: p.verdicts.map((v) => ({ ...v, label: v.label, bodyKind: null, basis: 'rule', note: '' })),
      }))
  if (!sizes.length) {
    return (
      <div className="card tone-measure">
        <div className="section-head">
          <h3>부위별 핏</h3>
        </div>
        <p className="muted small">사이즈표 실측이 없어 부위별 판정을 할 수 없어요.</p>
      </div>
    )
  }
  const current = sizes.find((s) => s.size === selectedSize) || sizes[0]
  const score = perSize.find((p) => p.size === current.size)?.score
  const hasHeuristic = current.rows.some((r) => r.basis === 'heuristic')

  return (
    <div className="card tone-measure">
      <div className="section-head">
        <h3>부위별 핏</h3>
        {score != null && <span className="count-badge">적합도 {score}점</span>}
      </div>

      <div className="size-tabs" role="tablist" aria-label="사이즈 선택">
        {sizes.map((s) => (
          <button
            key={s.size}
            type="button"
            role="tab"
            aria-selected={s.size === current.size}
            className={`size-tab ${s.size === current.size ? 'active' : ''}`}
            onClick={() => onSelect(s.size)}
          >
            {s.label}
            {s.size === recommendedSize && <span className="tab-badge">추천</span>}
          </button>
        ))}
      </div>

      <ul className="verdict-list">
        {current.rows.map((v) =>
          v.verdict == null ? (
            <li key={v.part} className="verdict-row">
              <div className="verdict-top">
                <strong>{v.label}</strong>
                <span className="muted small">옷 실측 {v.garment}{v.unit}</span>
                <span className="muted small">{v.note || MEASURE_ONLY_LABEL}</span>
              </div>
            </li>
          ) : (
            <li key={v.part} className="verdict-row">
              <div className="verdict-top">
                <strong>{v.label}</strong>
                <span className="muted small">
                  내 {v.body}{v.unit}{BODY_KIND_NOTE[v.bodyKind] || ''} · 옷 {v.garment}{v.unit} · 여유 {v.ease > 0 ? '+' : ''}{v.ease}{v.unit}
                </span>
                <span className={`verdict-label v-${v.key}`}>{v.verdict}</span>
              </div>
              <div className="verdict-track" aria-hidden>
                {VERDICTS.map((d, i) => (
                  <span key={d.key} className={`seg ${i === v.level ? `on v-bg-${d.key}` : ''}`} />
                ))}
              </div>
            </li>
          ),
        )}
      </ul>
      <p className="muted small disclaimer">
        둘레는 단면×2, 기장은 키로 계산한 표준 기장과 비교했어요. 막대는 왼쪽부터 작을 수 있음 · 타이트 · 적당 · 넉넉 · 매우 넉넉이에요.
        {hasHeuristic && ' 소매·발길이·총장 기준은 일반적인 착용감을 바탕으로 한 휴리스틱이에요.'}
        {' '}‘{MEASURE_ONLY_LABEL}’은 내 몸과 비교할 기준이 없어 실측만 보여준다는 뜻이에요.
      </p>
    </div>
  )
}
