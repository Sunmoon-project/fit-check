// 줄자로 치수 재는 법: 그림에서 부위를 고르면 어디를 어떻게 재는지 선이 그려지며 알려줘요.
import { useState } from 'react'
import { GUIDE, FIGURE, GUIDE_TIPS } from '../data/measureGuide.js'

function Figure({ part }) {
  const d = part.draw
  return (
    <svg className="mg-fig" viewBox="0 0 200 410" role="img" aria-label={`${part.label} 재는 위치`}>
      <g className="mg-body">
        <circle cx={FIGURE.head[0]} cy={FIGURE.head[1]} r={FIGURE.head[2]} />
        <rect x={FIGURE.neck[0]} y={FIGURE.neck[1]} width={FIGURE.neck[2]} height={FIGURE.neck[3]} rx="4" />
        <path d={FIGURE.body} />
        <path className="mg-arm" d={FIGURE.arms} />
      </g>
      <g className="mg-mark" key={part.key}>
        {d.back && <path className="mg-back" d={d.back} />}
        <path pathLength={1} d={d.front || d.line} />
        {d.dots.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3.2" />)}
      </g>
    </svg>
  )
}

/** start: 처음 보여줄 부위 key */
/** part를 주면 그 부위를 보여줘요(입력 칸에 커서를 두면 바뀜). */
export default function MeasureGuide({ start = 'shoulder', part: focus }) {
  const [picked, setKey] = useState(start)
  const key = focus || picked
  const part = GUIDE.find((g) => g.key === key) || GUIDE[0]
  return (
    <div className="measure-guide">
      <Figure part={part} />
      <div className="mg-side">
        <div className="chip-row" role="tablist" aria-label="잴 부위">
          {GUIDE.map((g) => (
            <button key={g.key} type="button" role="tab" aria-selected={g.key === key} className={`chip small ${g.key === key ? 'active' : ''}`} onClick={() => setKey(g.key)}>
              {g.label}
            </button>
          ))}
        </div>
        <div className="mg-text" key={part.key} role="tabpanel">
          <h3>{part.label}</h3>
          <p>{part.how}</p>
          <p className="muted small">{part.tip}</p>
        </div>
        <ul className="mg-tips muted small">
          {GUIDE_TIPS.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </div>
    </div>
  )
}
