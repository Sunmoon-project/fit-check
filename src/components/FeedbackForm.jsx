import { useState, useEffect } from 'react'
import { calibrationSummary } from '../lib/fitEngine.js'
import { toContribution, contributionKey, toDomain } from '../lib/contribution.js'
import { loadConsent, purgeStaleConsent, saveConsent, enqueueContribution } from '../lib/storage.js'
import { CONSENT_VERSION, CONSENT_LABEL, CONSENT_SUMMARY, CONSENT_STATUS_NOTE } from '../data/consent.js'

const RESULTS = [
  ['small', '작았음'],
  ['true', '딱 맞음'],
  ['large', '컸음'],
]

// 착용 기록: 산 사이즈가 어땠는지 남기면 다음 추천부터 부위별 기준을 내 몸에 맞게 보정합니다.
export default function FeedbackForm({ product, perSize, defaultSize, existing, calibration, feedbackCount, profile, onSave }) {
  const sizes = perSize.map((p) => p.size)
  const [size, setSize] = useState(existing?.size || defaultSize || sizes[0] || '')
  const [result, setResult] = useState(existing?.result || '')
  const [returned, setReturned] = useState(Boolean(existing?.returned))
  const [saved, setSaved] = useState(false)
  // 기본은 해제. 사용자가 직접 체크한 경우에만 켜져요.
  const [consent, setConsent] = useState(() => loadConsent(CONSENT_VERSION))
  // 동의 문구 버전이 바뀐 경우 이전 대기열을 지워요(읽기 경로가 아니라 마운트 때).
  useEffect(() => {
    purgeStaleConsent(CONSENT_VERSION)
  }, [])

  if (sizes.length === 0) return null

  function submit(e) {
    e.preventDefault()
    if (!result) return
    const verdicts = perSize.find((p) => p.size === size)?.verdicts || []
    const item = {
      url: product.url,
      productName: product.name,
      category: product.category,
      size,
      result,
      returned,
      parts: Object.fromEntries(verdicts.map((v) => [v.part, v.ease])),
      savedAt: Date.now(),
    }
    onSave(item)
    // 동의한 경우에만 익명 레코드를 이 브라우저 대기열에 둡니다(서버 전송 없음).
    if (consent) enqueueContribution(toContribution(item, profile, true), contributionKey(item), CONSENT_VERSION)
    setSaved(true)
  }

  function changeConsent(v) {
    setConsent(v)
    saveConsent(v, CONSENT_VERSION) // 해제하면 대기열도 함께 지워져요
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

      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => changeConsent(e.target.checked)} />
        {CONSENT_LABEL}
      </label>
      <details className="muted small">
        <summary>어떤 정보가 쓰이나요?</summary>
        <ul>
          {CONSENT_SUMMARY.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </details>
      {consent && <p className="muted small" role="status">{CONSENT_STATUS_NOTE}</p>}
      {consent && !toDomain(product.url) && (
        <p className="muted small" role="status">이 쇼핑몰은 통계 기여 대상이 아니라서 기록은 내 기기에만 남고 기여 대기열에는 담기지 않아요.</p>
      )}

      <button type="submit" className="btn primary block" disabled={!result}>
        기록 저장
      </button>
      {saved && <p className="ok-text small" role="status">저장했어요. 이제부터 추천에 이 기록이 반영돼요.</p>}
      {summary && <p className="calib-info small">🎯 {summary}</p>}
    </form>
  )
}
