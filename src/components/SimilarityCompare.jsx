import { useEffect, useMemo, useRef, useState } from 'react'
import { compareBody, countUpValue } from '../lib/similarityBreakdown.js'

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

function Bar({ label, unit, m }) {
  return (
    <div className="cmp-bar">
      <div className="cmp-bar-label">
        <span>{label} 나 {m.me}{unit}</span>
        <span>후기 {m.review}{unit}</span>
      </div>
      <div className="cmp-track" role="img" aria-label={`${label} 비교: 나 ${m.me}${unit}, 후기 ${m.review}${unit}, 차이 ${m.diff}${unit}`}>
        <div className="cmp-fill" style={{ width: `${Math.round(m.fill * 100)}%` }} />
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
    <div className="card">
      <div className="section-head">
        <h3>체형 비교</h3>
        <button type="button" className="btn text" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? '접기' : '내 체형과 비교하기'}
        </button>
      </div>
      {open && (
        <>
          <p className="muted small">
            내 체형: {profile.height}cm {profile.weight}kg{GENDER_TEXT[profile.gender] ? ` · ${GENDER_TEXT[profile.gender]}` : ''}
          </p>
          <ul className={`cmp-list ${gradual}`}>
            {rows.map(({ r, c }, i) => {
              const gt = c.gender.state === 'same' ? '성별 같음' : c.gender.state === 'diff' ? '성별 다름' : '성별 확인 불가'
              return (
                <li key={r.id ?? i} className="cmp-item">
                  <div className="cmp-top">
                    <strong>{r.nick || '구매자'}</strong>
                    <span className="cmp-pct" aria-hidden="true">{shown[i] ?? targets[i]}%</span>
                    <span className="sr-only">체형 유사도 {targets[i]}%</span>
                  </div>
                  <span className={`cmp-chip ${c.gender.state === 'diff' ? 'diff' : ''}`}>
                    {r.gender ? `${gt} (${GENDER_TEXT[r.gender]})` : gt}
                  </span>
                  <Bar label="키" unit="cm" m={c.height} />
                  <Bar label="몸무게" unit="kg" m={c.weight} />
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
