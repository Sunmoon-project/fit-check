import { useState } from 'react'
import { calibrationSummary } from '../lib/fitEngine.js'

const RESULTS = [
  ['small', '작았음'],
  ['true', '딱 맞음'],
  ['large', '컸음'],
]

// 착용 기록: 산 사이즈가 어땠는지 남기면 다음 추천부터 부위별 기준을 내 몸에 맞게 보정합니다.
export default function FeedbackForm({ product, perSize, defaultSize, existing, calibration, feedbackCount, onSave }) {
  const sizes = perSize.map((p) => p.size)
  const [size, setSize] = useState(existing?.size || defaultSize || sizes[0] || '')
  const [result, setResult] = useState(existing?.result || '')
  const [returned, setReturned] = useState(Boolean(existing?.returned))
  const [saved, setSaved] = useState(false)

  if (sizes.length === 0) return null

  function submit(e) {
    e.preventDefault()
    if (!result) return
    const verdicts = perSize.find((p) => p.size === size)?.verdicts || []
    onSave({
      url: product.url,
      productName: product.name,
      category: product.category,
      size,
      result,
      returned,
      parts: Object.fromEntries(verdicts.map((v) => [v.part, v.ease])),
      savedAt: Date.now(),
    })
    setSaved(true)
  }

  const summary = calibrationSummary(calibration, feedbackCount)

  return (
    <form className="card feedback" onSubmit={submit}>
      <div className="section-head">
        <h3>입어보니 어땠나요?</h3>
        {existing && <span className="count-badge">기록 있음</span>}
      </div>
      <p className="muted small">이미 산 옷이라면 기록을 남겨주세요. 다음 추천부터 내 몸에 맞게 기준을 보정해요.</p>

      <div className="q-group">
        <strong>구매한 사이즈</strong>
        <div className="chip-row">
          {sizes.map((s) => (
            <button key={s} type="button" className={`chip small ${s === size ? 'active' : ''}`} onClick={() => { setSize(s); setSaved(false) }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="q-group">
        <strong>착용감</strong>
        <div className="chip-row">
          {RESULTS.map(([k, label]) => (
            <button key={k} type="button" className={`chip ${k === result ? 'active' : ''}`} onClick={() => { setResult(k); setSaved(false) }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="check">
        <input type="checkbox" checked={returned} onChange={(e) => { setReturned(e.target.checked); setSaved(false) }} />
        반품했어요
      </label>

      <button type="submit" className="btn primary block" disabled={!result}>
        기록 저장
      </button>
      {saved && <p className="ok-text small" role="status">저장했어요. 이제부터 추천에 이 기록이 반영돼요.</p>}
      {summary && <p className="calib-info small">🎯 {summary}</p>}
    </form>
  )
}
