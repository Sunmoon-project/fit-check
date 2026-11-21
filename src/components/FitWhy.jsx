import { useMemo, useState } from 'react'
import { fitRationale } from '../lib/fitEngine.js'

// 사이즈 추천 근거: 선호 핏 목표 vs 실제 여유분(부위별 표), 옆 사이즈 비교, 그리고 내 몸 윤곽 위에 옷 윤곽을 겹친 실루엣 그림.
// 그림은 사이즈표 실측과 내 치수로 그린 도식이에요 (둘레는 펼친 폭 = 둘레÷2로 그려요). 실제 사진이 아니에요.
const STATUS_TEXT = { good: '원하는 핏', tighter: '더 붙음', looser: '더 남음' }
const sign = (n) => `${n > 0 ? '+' : ''}${n}`

export default function FitWhy({ result, profile, calibration, labelOf = (s) => s, category }) {
  const perSize = result.perSize || []
  const [shown, setShown] = useState(result.recommendedSize)
  const preferredFit = profile?.preferredFit || 'regular'
  const why = useMemo(
    () => fitRationale({ perSize, size: result.recommendedSize, preferredFit, calibration, label: labelOf }),
    [perSize, result.recommendedSize, preferredFit, calibration, labelOf],
  )
  const view = useMemo(
    () => (shown === result.recommendedSize ? why : fitRationale({ perSize, size: shown, preferredFit, calibration, label: labelOf })),
    [why, perSize, shown, result.recommendedSize, preferredFit, calibration, labelOf],
  )
  if (!why || category === 'shoes') return null

  return (
    <div className="card fit-why tone-reco">
      <div className="section-head">
        <h3>왜 {why.label} 사이즈인가요?</h3>
        <span className="count-badge">{why.fitName} 기준</span>
      </div>
      {why.lines.map((t) => <p key={t} className="fit-why-line">{t}</p>)}

      <div className="table-scroll">
        <table className="fit-why-table">
          <thead>
            <tr><th>부위</th><th>내 몸</th><th>옷 {why.label}</th><th>여유</th><th>목표</th><th>결과</th></tr>
          </thead>
          <tbody>
            {why.parts.map((p) => (
              <tr key={p.part}>
                <th scope="row">{p.label}</th>
                <td>{p.body}{p.isLength ? <small> 표준</small> : ''}</td>
                <td>{p.garment}</td>
                <td className={`v-${p.key}`}>{sign(p.ease)}</td>
                <td>{sign(p.target)}</td>
                <td><span className={`fw-status ${p.status}`}>{STATUS_TEXT[p.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">단위 cm. 여유 = 옷 − 내 몸, 목표 = {why.fitName}으로 입을 때 알맞은 여유예요. 기장은 키로 계산한 표준 기장과 비교했어요.</p>

      {why.neighbors.length > 0 && (
        <ul className="fit-why-near">
          {why.neighbors.map((n) => (
            <li key={n.size}>
              <strong>{n.dir === 'smaller' ? '한 치수 작은' : '한 치수 큰'} {n.label}</strong>
              <span>{n.text}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="fit-why-figure">
        <div className="size-tabs" role="tablist" aria-label="실루엣으로 볼 사이즈">
          {perSize.map((p) => (
            <button key={p.size} type="button" role="tab" aria-selected={p.size === shown} className={`size-tab ${p.size === shown ? 'active' : ''}`} onClick={() => setShown(p.size)}>
              {labelOf(p.size)}
              {p.size === result.recommendedSize && <span className="tab-badge">추천</span>}
            </button>
          ))}
        </div>
        {view && <Silhouette parts={view.parts} body={result.bodyValues || {}} height={profile?.height} category={category} label={view.label} />}
        <p className="muted small">점선은 내 몸, 색칠한 부분은 {view?.label} 옷이에요. 사이즈표 실측으로 그린 그림이라 원단·디자인 차이는 반영되지 않아요.</p>
      </div>
    </div>
  )
}

// 앞모습 도식. 상의는 어깨·가슴·기장·소매, 하의는 허리·엉덩이·허벅지·기장을 그려요.
function Silhouette({ parts, body, height, category, label }) {
  const by = Object.fromEntries(parts.map((p) => [p.part, p]))
  const bottom = category === 'bottom'
  const k = 3 // 1cm = 3px
  const notes = parts.filter((p) => !p.isLength || p.status !== 'good').map((p) => `${p.label} ${sign(p.ease)}cm`)
  const aria = `${label} 실루엣: ${notes.join(', ')}`
  return (
    <svg className="fit-sil" viewBox="-150 -24 300 330" role="img" aria-label={aria}>
      {bottom ? <Pants by={by} body={body} height={height} k={k} /> : <Top by={by} body={body} height={height} k={k} category={category} />}
    </svg>
  )
}

const num = (...v) => v.find((x) => typeof x === 'number' && Number.isFinite(x))

function Top({ by, body, height, k, category }) {
  const lengthPart = by.topLength || by.outerLength || by.dressLength
  const bShoulder = num(by.shoulder?.body, body.shoulder, 44)
  const bChest = num(by.chest?.body, body.chest, 96)
  const bWaist = num(body.waist, bChest - 12)
  const bLen = num(lengthPart?.body, (height || 172) * 0.39)
  const gShoulder = num(by.shoulder?.garment, bShoulder + 2)
  const gChest = num(by.chest?.garment, bChest + 10)
  const gLen = num(lengthPart?.garment, bLen)
  const long = typeof by.arm?.garment === 'number'
  const sleeve = long ? by.arm.garment : 20
  const s = (cm) => cm * k
  // 몸: 어깨선 y=10, 가슴 y=10+22, 허리 y=10+bLen*0.75
  const bx = s(bShoulder / 2), cx = s(bChest / 4), wx = s(bWaist / 4)
  const bodyPath = `M ${-s(7)} 0 L ${-bx} ${s(3)} L ${-cx} ${s(22)} L ${-wx} ${s(bLen * 0.78)} L ${-cx * 0.98} ${s(bLen + 6)} L ${cx * 0.98} ${s(bLen + 6)} L ${wx} ${s(bLen * 0.78)} L ${cx} ${s(22)} L ${bx} ${s(3)} L ${s(7)} 0`
  // 옷
  const gx = s(gShoulder / 2), gcx = s(gChest / 4), drop = s(1.5)
  const sleeveEnd = (dir) => {
    // 소매: 어깨 끝에서 몸 옆으로 내려오게 (긴소매는 거의 수직, 반팔은 조금 벌어져요). 각도는 수직에서 잰 라디안.
    const ang = long ? 0.28 : 0.75
    return [dir * (gx + Math.sin(ang) * s(sleeve)), drop + Math.cos(ang) * s(sleeve)]
  }
  const [lx, ly] = sleeveEnd(-1)
  const [rx, ry] = sleeveEnd(1)
  const cuff = s(long ? 6 : 8)
  const garment = [
    `M ${-s(8)} ${-s(0.5)}`,
    `L ${-gx} ${drop}`,
    `L ${lx} ${ly}`,
    `L ${lx + cuff} ${ly + cuff * 0.25}`,
    `L ${-gcx} ${Math.min(s(22), ly)}`,
    `L ${-gcx} ${s(gLen)}`,
    `L ${gcx} ${s(gLen)}`,
    `L ${gcx} ${Math.min(s(22), ry)}`,
    `L ${rx - cuff} ${ry + cuff * 0.25}`,
    `L ${rx} ${ry}`,
    `L ${gx} ${drop}`,
    `L ${s(8)} ${-s(0.5)}`,
    `Q 0 ${s(category === 'outer' ? 10 : 5)} ${-s(8)} ${-s(0.5)} Z`,
  ].join(' ')
  return (
    <g>
      <path className="sil-garment" d={garment} />
      <path className="sil-body" d={bodyPath} />
      <ellipse className="sil-body" cx="0" cy={-s(5)} rx={s(5)} ry={s(5.5)} />
      <Dim y={drop - 6} x1={-gx} x2={gx} text={by.shoulder ? `어깨 ${sign(by.shoulder.ease)}` : ''} />
      <Dim y={s(22)} x1={-gcx} x2={gcx} text={by.chest ? `가슴 ${sign(by.chest.ease)}` : ''} />
      {lengthPart && <text className="sil-note" x={gcx + 6} y={s(gLen) - 2}>{`기장 ${sign(lengthPart.ease)}`}</text>}
    </g>
  )
}

function Pants({ by, body, height, k }) {
  const s = (cm) => cm * k
  const bWaist = num(by.waist?.body, body.waist, 80)
  const bHip = num(by.hip?.body, body.hip, 96)
  const bThigh = num(by.thigh?.body, body.thigh, 56)
  const bLen = num(by.inseam?.body, (height || 172) * 0.58)
  const gWaist = num(by.waist?.garment, bWaist + 6)
  const gHip = num(by.hip?.garment, bHip + 8)
  const gThigh = num(by.thigh?.garment, bThigh + 6)
  const gLen = num(by.inseam?.garment, bLen)
  // 그림 높이를 맞추려고 기장은 0.8배로 줄여 그려요
  const L = (cm) => s(cm) * 0.8
  const crotch = s(26)
  // 앞모습 윤곽: 허리 → 엉덩이 → 바깥 밑단 → 안쪽 밑단 → 가랑이 → (반대쪽 대칭). 다리 폭은 허벅지 단면(둘레÷2).
  const outline = (waist, hip, thigh, len, hemRatio) => {
    const W = s(waist / 4), H = s(hip / 4)
    const leg = Math.min(s(thigh / 2) * 0.9, H - 2)
    const inner = Math.max(H - leg, 2) // 가랑이 높이에서 다리 안쪽 선
    const outHem = H - leg * (1 - hemRatio) * 0.35
    const inHem = outHem - leg * hemRatio
    const half = [[W, 0], [H, s(18)], [H, crotch], [outHem, L(len)], [inHem, L(len)], [inner, crotch + 4]]
    const pts = [...half, [0, crotch - 2], ...half.slice().reverse().map(([x, y]) => [-x, y])]
    return 'M ' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ') + ' Z'
  }
  const garment = outline(gWaist, gHip, gThigh, gLen, 0.72)
  const bodyPath = outline(bWaist, bHip, bThigh, bLen, 0.5)
  const gW = s(gWaist / 4)
  return (
    <g>
      <path className="sil-garment" d={garment} />
      <path className="sil-body" d={bodyPath} />
      <Dim y={-6} x1={-gW} x2={gW} text={by.waist ? `허리 ${sign(by.waist.ease)}` : ''} />
      <Dim y={s(18)} x1={-s(gHip / 4)} x2={s(gHip / 4)} text={by.hip ? `엉덩이 ${sign(by.hip.ease)}` : ''} />
      {by.thigh && <text className="sil-note" x={s(gHip / 4) + 6} y={s(34)}>{`허벅지 ${sign(by.thigh.ease)}`}</text>}
      {by.inseam && <text className="sil-note" x={s(gHip / 4) + 6} y={L(gLen) - 2}>{`기장 ${sign(by.inseam.ease)}`}</text>}
    </g>
  )
}

function Dim({ y, x1, x2, text }) {
  if (!text) return null
  return (
    <g className="sil-dim">
      <line x1={x1} x2={x2} y1={y} y2={y} />
      <text x={x2 + 6} y={y + 4}>{text}</text>
    </g>
  )
}
