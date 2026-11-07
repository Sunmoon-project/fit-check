import { summarizeSizeChart } from '../lib/sizeSummary.js'

// 사이즈표 요약: 사이즈 목록, 추천 사이즈 핵심 실측, 위·아래 사이즈 차이, 한 줄 판정. 짧게만 보여줘요.
export default function SizeSummary({ compare, recommendedSize, category }) {
  const sm = summarizeSizeChart({ sizes: compare?.sizes, recommended: recommendedSize, category })
  const near = [sm.neighbors.lowerDiff, sm.neighbors.upperDiff].filter(Boolean)
  return (
    <div className="card tone-chart size-summary">
      <div className="section-head">
        <h3>사이즈표 요약</h3>
      </div>
      {sm.status !== 'ok' ? (
        <p className="muted small">{sm.message} 아래 사이즈표를 확인해 주세요.</p>
      ) : (
        <>
          <div className="ss-chips">
            {sm.sizes.map((t) => (
              <span key={t} className={t === sm.recommended ? 'ss-chip on' : 'ss-chip'}>{t === sm.recommended ? `${t} 추천` : t}</span>
            ))}
          </div>
          {sm.keyParts.length > 0 && (
            <p className="small">{sm.recommended} 실측 {sm.keyParts.map((k) => `${k.label} ${k.value}${k.unit}`).join(' · ')}</p>
          )}
          {near.length > 0 && <p className="muted small">{near.join(' / ')}</p>}
          {sm.verdictLine && <p className="small">{sm.verdictLine}</p>}
        </>
      )}
    </div>
  )
}
