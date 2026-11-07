import { useEffect, useMemo, useRef, useState } from 'react'
import { compareBody, countUpValue, similarityTier, TIER_LABEL, diffText, buySizeText } from '../lib/similarityBreakdown.js'

const COUNT_MS = 900
const MAX_ROWS = 20
const GENDER_TEXT = { male: '남성', female: '여성' }

function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// 열려 있는 동안 한 번만 0에서 target까지 올라가는 숫자. 움직임 줄이기 설정이면 바로 최종 값이에요.
function useCountUp(targets, active) {
  const [shown, setShown] = useState(targets)
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    if (!active) return undefined
    if (prefersReducedMotion() || typeof window.requestAnimationFrame !== 'function') {
      setShown(targets)
      setGrown(true)
      return undefined
    }
    setShown(targets.map(() => 0))
    setGrown(false)
    let frame = null
    let start = null
    const tick = (now) => {
      if (start == null) {
        start = now
        setGrown(true)
      }
      const elapsed = now - start
      setShown(targets.map((t) => countUpValue(elapsed, COUNT_MS, t)))
      frame = elapsed < COUNT_MS ? window.requestAnimationFrame(tick) : null
    }
    frame = window.requestAnimationFrame(tick)
    return () => {
      if (frame != null) window.cancelAnimationFrame(frame)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, targets.join(',')])
  return { shown, grown }
}

// 후기 작성자의 키·몸무게만 보여줘요 (내 체형은 위쪽 큰 카드에 있어요).
function BodyPair({ c, size }) {
  const dt = diffText(c)
  return (
    <>
      <div className="cmp-pair">
        <div className="cmp-col"><span className="cmp-who">후기 체형</span><span className="cmp-val">{c.height.review}cm · {c.weight.review}kg</span><span className="cmp-buy">{buySizeText(size)}</span></div>
      </div>
      {dt && <p className="cmp-diff">{dt}</p>}
    </>
  )
}

// 비슷한 체형인지 퍼센트 막대 하나로 보여줘요 (구간별 색: 비슷함 초록 / 조금 달라요 주황 / 많이 달라요 회색).
function SimBar({ sim, shown }) {
  const tier = similarityTier(sim)
  return (
    <div className={`cmp-sim ${tier}`}>
      <div className="cmp-sim-label">
        <span className="cmp-tier">{TIER_LABEL[tier]}</span>
        <span className="cmp-pct" aria-hidden="true">{shown}%</span>
      </div>
      <div className="cmp-track" role="img" aria-label={`체형 유사도 ${sim}%: ${TIER_LABEL[tier]}`}>
        <div className="cmp-fill" style={{ width: `${Math.max(0, Math.min(100, Math.round(sim)))}%` }} />
      </div>
    </div>
  )
}

// 후기 작성자의 성별·키·몸무게를 내 값과 나란히 비교하고 체형 유사도를 보여줘요.
export default function SimilarityCompare({ profile, reviews }) {
  const [open, setOpen] = useState(false)
  const rows = useMemo(
    () => reviews.filter((r) => r.height != null && r.weight != null).slice(0, MAX_ROWS).map((r) => ({ r, c: compareBody(profile, r) })),
    [profile, reviews],
  )
  const targets = rows.map((x) => x.c.similarity ?? 0)
  const { shown, grown } = useCountUp(targets, open)
  const gradual = open && !grown ? 'is-start' : ''

  if (rows.length === 0) return null
  return (
    <div className="card tone-compare">
      <div className="section-head">
        <h3>체형 비교</h3>
        <button type="button" className="btn text" aria-expanded={open} aria-controls="sim-compare-panel" onClick={() => setOpen((v) => !v)}>
          {open ? '접기' : '내 체형과 비교하기'}
        </button>
      </div>
      {open && (
        <div id="sim-compare-panel">
          <div className="me-card">
            <span className="me-label">내 체형</span>
            <div className="me-values">
              <span className="me-item"><span className="me-num">{profile.height}</span><span className="me-unit">cm</span></span>
              <span className="me-item"><span className="me-num">{profile.weight}</span><span className="me-unit">kg</span></span>
            </div>
            {GENDER_TEXT[profile.gender] && <span className="me-gender">{GENDER_TEXT[profile.gender]}</span>}
          </div>
          <ul className={`cmp-list ${gradual}`}>
            {rows.map(({ r, c }, i) => {
              const gt = c.gender.state === 'same' ? '성별 같음' : c.gender.state === 'diff' ? '성별 다름' : '성별 확인 불가'
              return (
                <li key={r.id ?? i} className="cmp-item">
                  <div className="cmp-top">
                    <strong>{r.nick || '구매자'}</strong>
                    <span className="sr-only">체형 유사도 {targets[i]}%</span>
                  </div>
                  <span className={`cmp-chip ${c.gender.state === 'diff' ? 'diff' : ''}`}>
                    {r.gender ? `${gt} (${GENDER_TEXT[r.gender]})` : gt}
                  </span>
                  <BodyPair c={c} size={r.size} />
                  <SimBar sim={targets[i]} shown={shown[i] ?? targets[i]} />
                  {c.gender.state === 'diff' && <p className="muted small">성별이 달라 유사도는 0%예요. 막대는 키·몸무게만 비교한 거예요.</p>}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
