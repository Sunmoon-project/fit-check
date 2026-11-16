// 사진·웹캠으로 체형 추정: 브라우저 안에서 MediaPipe Pose로 관절·윤곽을 찾고(사진은 보내지 않음), 내 키로 cm를 계산해요.
// 결과는 확인 후 '내 정보에 반영'을 눌러야 profile.photoBody로 저장되고, 그때부터 사이즈 추천과 합성 미리보기에 쓰여요.
import { useEffect, useRef, useState } from 'react'
import { estimateBody } from '../lib/bodyEstimate.js'
import { measureFromPose } from '../lib/photoBody.js'
import { detectPose, loadImage } from '../lib/poseRuntime.js'
import { PART_LABEL } from '../data/measurements.js'

const PARTS = ['shoulder', 'chest', 'waist', 'hip']
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]]
const COUNTDOWN = 5

// 웹캠: 5초 뒤 자동으로 찍어요 (뒤로 물러나 전신이 나오게). 끄면 카메라를 바로 놓아줘요.
function Webcam({ onShot, onClose }) {
  const videoRef = useRef(null)
  const [err, setErr] = useState('')
  const [left, setLeft] = useState(null)
  useEffect(() => {
    let stream = null
    let alive = true
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false })
      .then((s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop())
        stream = s
        if (videoRef.current) videoRef.current.srcObject = s
      })
      .catch(() => setErr('카메라를 쓸 수 없어요. 브라우저의 카메라 권한을 확인해 주세요.'))
    if (!navigator.mediaDevices) setErr('이 브라우저는 카메라를 지원하지 않아요.')
    return () => {
      alive = false
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])
  useEffect(() => {
    if (left == null) return
    if (left === 0) {
      const v = videoRef.current
      const c = document.createElement('canvas')
      const scale = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight))
      c.width = Math.round(v.videoWidth * scale)
      c.height = Math.round(v.videoHeight * scale)
      const g = c.getContext('2d')
      g.translate(c.width, 0) // 화면처럼 좌우 반전된 모습으로 저장
      g.scale(-1, 1)
      g.drawImage(v, 0, 0, c.width, c.height)
      onShot(c.toDataURL('image/jpeg', 0.9))
      return
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [left, onShot])
  return (
    <div className="bs-cam" role="dialog" aria-modal="true" aria-label="웹캠으로 찍기">
      <div className="bs-cam-stage">
        <video ref={videoRef} autoPlay playsInline muted />
        <span className="bs-guide" aria-hidden />
        {left != null && left > 0 && <span key={left} className="bs-count">{left}</span>}
      </div>
      {err ? <p className="error">{err}</p> : <p className="small bs-cam-tip">발끝까지 보이게 2~3m 물러나서, 몸에 붙는 옷을 입고 팔을 살짝 벌린 채 정면으로 서 주세요.</p>}
      <div className="bs-cam-actions">
        <button type="button" className="btn ghost" onClick={onClose}>취소</button>
        <button type="button" className="btn primary" disabled={!!err || left != null} onClick={() => setLeft(COUNTDOWN)}>{COUNTDOWN}초 뒤 찍기</button>
      </div>
    </div>
  )
}

export default function BodyScan({ profile, photo, onPhoto, onProfile, onAnchors }) {
  const [state, setState] = useState({ status: 'idle', msg: '' }) // idle | loading | done | error
  const [scan, setScan] = useState(null) // { result, landmarks, photo }
  const [cam, setCam] = useState(false)
  const formula = profile ? estimateBody({ ...profile, photoBody: null, measurements: {} }).values : {}

  // 사진이 바뀌면 이전 결과는 맞지 않으니 지워요.
  useEffect(() => {
    if (scan && scan.photo !== photo) {
      setScan(null)
      onAnchors?.(null)
      setState({ status: 'idle', msg: '' })
    }
  }, [photo]) // eslint-disable-line react-hooks/exhaustive-deps

  async function run(src) {
    if (!src) return
    setState({ status: 'loading', msg: '체형 분석 모델을 불러오는 중이에요 (처음 한 번 약 9MB)…' })
    try {
      const img = await loadImage(src)
      setState({ status: 'loading', msg: '관절과 윤곽을 찾는 중이에요…' })
      const pose = await detectPose(img)
      const result = measureFromPose({ ...pose, heightCm: Number(profile?.height), formula })
      if (!result.ok) {
        setScan(null)
        onAnchors?.(null)
        return setState({ status: 'error', msg: result.reason })
      }
      setScan({ result, landmarks: pose.landmarks, photo: src })
      onAnchors?.(result.anchors)
      setState({ status: 'done', msg: '' })
    } catch {
      setState({ status: 'error', msg: '체형 분석 모델을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.' })
    }
  }

  function apply() {
    onProfile?.({ ...profile, photoBody: { ...scan.result.values, at: Date.now() } })
    setState({ status: 'done', msg: '내 정보에 반영했어요. 이제 사이즈 추천에 (사진 추정) 값으로 쓰여요.' })
  }

  function clear() {
    const { photoBody, ...rest } = profile
    onProfile?.(rest)
    setState({ status: scan ? 'done' : 'idle', msg: '사진 추정값을 지웠어요. 다시 키·몸무게 공식으로 추정해요.' })
  }

  const r = scan?.result
  return (
    <div className="card bodyscan">
      <div className="section-head">
        <h3>사진·캠으로 체형 추정</h3>
        {profile?.photoBody && <span className="tag-rough">반영됨</span>}
      </div>
      <p className="muted small">정면 전신 사진에서 어깨너비와 가슴·허리·엉덩이 둘레를 대략 재요. 사진은 이 브라우저 안에서만 분석하고 어디로도 보내지 않아요.</p>
      <div className="bs-actions">
        <button type="button" className="btn" disabled={!photo || state.status === 'loading'} onClick={() => run(photo)}>
          {photo ? '올린 사진으로 추정' : '아래에서 전신 사진을 먼저 올려 주세요'}
        </button>
        <button type="button" className="btn ghost" disabled={state.status === 'loading'} onClick={() => setCam(true)}>캠으로 찍기</button>
        {profile?.photoBody && <button type="button" className="btn text danger" onClick={clear}>사진 추정 지우기</button>}
      </div>
      {state.msg && <p className={`small ${state.status === 'error' ? 'error' : 'muted'} ${state.status === 'loading' ? 'bs-loading' : ''}`} role="status">{state.msg}</p>}

      {r && (
        <div className="bs-result">
          <div className="bs-photo">
            <img src={scan.photo} alt="체형을 추정한 사진" />
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
              {BONES.map(([a, b]) => (
                <line key={`${a}-${b}`} pathLength={1} x1={scan.landmarks[a].x} y1={scan.landmarks[a].y} x2={scan.landmarks[b].x} y2={scan.landmarks[b].y} />
              ))}
              <line className="bs-sh" pathLength={1} x1={r.anchors.shoulderL.x} y1={r.anchors.shoulderL.y} x2={r.anchors.shoulderR.x} y2={r.anchors.shoulderR.y} />
            </svg>
          </div>
          <div>
            <table className="bs-table">
              <thead><tr><th>부위</th><th>사진에서 잰 값</th><th>키·몸무게 공식</th><th>반영할 값</th></tr></thead>
              <tbody>
                {PARTS.map((k) => (
                  <tr key={k}>
                    <th>{PART_LABEL[k]}</th>
                    <td>{r.raw[k] != null ? `${r.raw[k]}cm` : '-'}</td>
                    <td>{formula[k] != null ? `${formula[k]}cm` : '-'}</td>
                    <td><b>{r.values[k] != null ? `${r.values[k]}cm` : '-'}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.warnings.map((w) => <p key={w} className="small bs-warn">{w}</p>)}
            <p className="muted small">사진 값과 공식 값을 6:4로 섞고 공식 값의 ±12% 안으로 묶었어요. 옷 두께·자세·렌즈에 따라 ±3~6cm 오차가 날 수 있어요. 직접 잰 치수가 있으면 그 값이 우선해요.</p>
            <button type="button" className="btn primary block" onClick={apply}>내 정보에 반영</button>
          </div>
        </div>
      )}

      {cam && (
        <Webcam
          onClose={() => setCam(false)}
          onShot={(url) => {
            setCam(false)
            onPhoto?.(url)
            run(url)
          }}
        />
      )}
    </div>
  )
}
