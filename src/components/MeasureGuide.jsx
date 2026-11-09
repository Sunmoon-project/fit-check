// 줄자로 치수 재는 법: 그림에서 부위를 고르면 어디를 어떻게 재는지 선이 그려지며 알려줘요.
import { useState } from 'react'

// 둘레는 앞쪽(실선)·뒤쪽(점선) 반 바퀴로 그려요.
const ring = (cx, cy, rx, ry = 6) => ({
  front: `M${cx - rx} ${cy} A${rx} ${ry} 0 0 0 ${cx + rx} ${cy}`,
  back: `M${cx - rx} ${cy} A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}`,
  dots: [[cx - rx, cy], [cx + rx, cy]],
})

export const GUIDE = [
  {
    key: 'shoulder', label: '어깨너비',
    how: '등 뒤에서 한쪽 어깨 끝 뼈부터 반대쪽 끝까지 직선으로 재요.',
    tip: '팔을 들면 움푹 들어가는 곳이 어깨 끝이에요. 다른 사람이 재 주면 정확해요.',
    draw: { line: 'M56 84 L144 84', dots: [[56, 84], [144, 84]] },
  },
  {
    key: 'chest', label: '가슴둘레',
    how: '겨드랑이 바로 아래, 가슴에서 가장 두꺼운 곳을 바닥과 수평으로 한 바퀴 재요.',
    tip: '숨을 편하게 내쉰 상태에서, 줄자와 몸 사이에 손가락 하나 들어갈 정도로요.',
    draw: ring(100, 120, 40),
  },
  {
    key: 'waist', label: '허리둘레',
    how: '갈비뼈 아래와 골반 위 사이, 가장 잘록한 곳을 한 바퀴 재요.',
    tip: '배에 힘을 주지 말고요. 바지는 이보다 조금 아래(배꼽 아래)에 걸려서 표기 사이즈와 다를 수 있어요.',
    draw: ring(100, 165, 29),
  },
  {
    key: 'hip', label: '엉덩이둘레',
    how: '발을 모으고 서서, 엉덩이에서 가장 튀어나온 곳을 수평으로 한 바퀴 재요.',
    tip: '거울로 옆모습을 보면서 줄자가 뒤로 처지지 않게 해 주세요.',
    draw: ring(100, 207, 35),
  },
  {
    key: 'thigh', label: '허벅지둘레',
    how: '가랑이 바로 아래, 허벅지에서 가장 굵은 곳을 한 바퀴 재요.',
    tip: '힘을 빼고 똑바로 선 채로 재야 해요.',
    draw: ring(84, 252, 15, 4),
  },
  {
    key: 'arm', label: '팔길이',
    how: '팔을 자연스럽게 내리고, 어깨 끝에서 팔꿈치를 지나 손목뼈까지 재요.',
    tip: '팔꿈치를 살짝 굽히면 소매가 짧아지는 것까지 생각할 수 있어요.',
    draw: { line: 'M50 82 L37 160 L28 232', dots: [[50, 82], [28, 232]] },
  },
  {
    key: 'inseam', label: '다리길이', extra: true,
    how: '가랑이부터 발 안쪽 복사뼈 아래 바닥까지, 다리 안쪽 선을 따라 재요.',
    tip: '신발을 벗고 재요. 바지 사이즈표의 기장(총장)과 비교할 때 써요. 앱 추천 계산에는 아직 쓰지 않아요.',
    draw: { line: 'M95 242 L91 390', dots: [[95, 242], [91, 390]] },
  },
]

function Figure({ part }) {
  const d = part.draw
  return (
    <svg className="mg-fig" viewBox="0 0 200 410" role="img" aria-label={`${part.label} 재는 위치`}>
      <g className="mg-body">
        <circle cx="100" cy="38" r="21" />
        <rect x="91" y="56" width="18" height="18" rx="4" />
        <path d="M86 72 Q62 74 56 86 L64 112 Q66 140 72 165 Q64 185 66 205 L74 300 L78 392 L94 392 L97 300 L100 238 L103 300 L106 392 L122 392 L126 300 L134 205 Q136 185 128 165 Q134 140 136 112 L144 86 Q138 74 114 72 Z" />
        <path className="mg-arm" d="M60 90 L47 160 L39 232 M140 90 L153 160 L161 232" />
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
export default function MeasureGuide({ start = 'shoulder' }) {
  const [key, setKey] = useState(start)
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
          <h3>{part.label}{part.extra && <span className="muted small"> · 참고용</span>}</h3>
          <p>{part.how}</p>
          <p className="muted small">{part.tip}</p>
        </div>
        <ul className="mg-tips muted small">
          <li>얇은 옷이나 속옷 차림으로, 줄자는 팽팽하되 조이지 않게 재요.</li>
          <li>줄자가 없으면 끈으로 잰 뒤 자로 길이를 재도 돼요.</li>
          <li>잘 모르겠는 부위는 비워 두세요. 비슷한 체형 후기로 추정해요.</li>
        </ul>
      </div>
    </div>
  )
}
