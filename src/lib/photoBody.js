// 정면 전신 사진의 관절 위치(MediaPipe Pose, 33점)와 사람 윤곽(분할 마스크)으로 체형을 대략 추정해요 (순수 함수).
// - 축척: 내 키(cm) ÷ 사진 속 키(px). 사진 속 키는 눈~발뒤꿈치 길이를 성인 평균 비율로 나눠 구해요.
// - 어깨너비: 두 어깨 관절 사이 거리 × SHOULDER_K (관절은 어깨 끝보다 안쪽이라 넓혀요).
// - 가슴·허리·엉덩이: 그 높이의 윤곽 너비를 앞뒤 두께 비율을 가정한 타원 둘레로 바꿔요.
// - 결과는 키·몸무게 공식값과 섞고 공식값의 ±MAX_DEV 안으로 묶어요. 옷 두께·자세·렌즈 왜곡 때문에 오차가 커서 '사진 추정'으로만 써요.
// 상수는 앱의 공식 추정값과 평균 체형에서 맞도록 정한 휴리스틱이고, 실제 줄자 측정으로 검증하지 않았어요.

const L = { nose: 0, eyeL: 2, eyeR: 5, shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16, hipL: 23, hipR: 24, ankL: 27, ankR: 28, heelL: 29, heelR: 30 }
const EYE_RATIO = 0.935 // 눈높이 ≈ 키의 93.5%
const ANKLE_RATIO = 0.045 // 발목 높이 ≈ 키의 4.5%
const SHOULDER_K = 1.27
const DEPTH = { chest: 0.72, waist: 0.75, hip: 0.8 } // 앞뒤 두께 ÷ 좌우 너비 (가정)
// 가슴 단면은 타원보다 각져 있어 타원 둘레가 실제보다 8% 안팎 작게 나와요 (평균 체형 폭·두께로 비교한 값).
const GIRTH_K = { chest: 1.08, waist: 1, hip: 1 }
const BAND = { chest: 0.33, waist: 0.62, hip: 1.08 } // 어깨선(0)~골반 관절선(1) 사이 상대 높이
const ARM_W = 0.055 // 팔 두께 ≈ 키의 5.5% (팔 중심선에서 몸통 쪽으로 이만큼의 절반을 빼요)
const PHOTO_WEIGHT = 0.6
const MAX_DEV = 0.12
const MIN_VIS = 0.5

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const half = (v) => Math.round(v * 2) / 2
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// 타원 둘레 (라마누잔 근사)
export function ellipseCircumference(width, depthRatio) {
  const a = width / 2
  const b = (width * depthRatio) / 2
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
}

// 마스크 한 줄에서 cx를 포함하는 연속 구간의 너비(px). cx가 사람 밖이면 null.
export function rowWidth(mask, mw, mh, y, cx, threshold = 0.5) {
  const row = Math.round(y)
  const x0 = Math.round(cx)
  if (row < 0 || row >= mh || x0 < 0 || x0 >= mw) return null
  const at = (x) => mask[row * mw + x] >= threshold
  if (!at(x0)) return null
  let l = x0
  let r = x0
  while (l > 0 && at(l - 1)) l--
  while (r < mw - 1 && at(r + 1)) r++
  return r - l + 1
}

// 어깨→팔꿈치→손목 선에서 높이 y의 팔 중심 x. 그 높이에 팔이 없거나 관절이 안 보이면 null.
function armXAt(pts, y) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (!a || !b) return null
    if (a.y === b.y || y < Math.min(a.y, b.y) || y > Math.max(a.y, b.y)) continue
    return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)
  }
  return null
}

/**
 * landmarks: [{x,y,visibility}] 정규화 좌표(0~1) 33개, width/height: 사진 크기(px)
 * mask: Float32Array(maskW*maskH, 0~1) 또는 null, heightCm: 내 키, formula: 키·몸무게 공식 추정값 { shoulder, chest, waist, hip }
 * @returns {{ ok: true, values, raw, anchors, warnings } | { ok: false, reason }}
 */
export function measureFromPose({ landmarks, width, height, mask = null, maskW = 0, maskH = 0, heightCm, formula = {} }) {
  if (!Array.isArray(landmarks) || landmarks.length < 31) return { ok: false, reason: '사람을 찾지 못했어요. 정면 전신이 나온 밝은 사진으로 다시 해 주세요.' }
  if (!(heightCm >= 130 && heightCm <= 220) || !(width > 0 && height > 0)) return { ok: false, reason: '내 정보의 키를 먼저 입력해 주세요.' }
  const P = (i) => ({ x: landmarks[i].x * width, y: landmarks[i].y * height, v: landmarks[i].visibility ?? 1 })
  const need = [L.eyeL, L.eyeR, L.shL, L.shR, L.hipL, L.hipR, L.ankL, L.ankR]
  if (need.some((i) => !landmarks[i] || (landmarks[i].visibility ?? 1) < MIN_VIS)) {
    return { ok: false, reason: '머리부터 발끝까지 전신이 다 보이지 않아요. 몸 전체가 나오게 조금 멀리서 찍어 주세요.' }
  }
  const eye = mid(P(L.eyeL), P(L.eyeR))
  const heelsOk = [L.heelL, L.heelR].every((i) => landmarks[i] && (landmarks[i].visibility ?? 1) >= MIN_VIS)
  const foot = heelsOk ? Math.max(P(L.heelL).y, P(L.heelR).y) : Math.max(P(L.ankL).y, P(L.ankR).y)
  const statPx = (foot - eye.y) / (heelsOk ? EYE_RATIO : EYE_RATIO - ANKLE_RATIO)
  if (!(statPx > height * 0.3)) return { ok: false, reason: '사람이 너무 작게 나왔어요. 화면을 거의 채우도록 찍어 주세요.' }
  const cmPerPx = heightCm / statPx

  const shL = P(L.shL)
  const shR = P(L.shR)
  const hipC = mid(P(L.hipL), P(L.hipR))
  const shC = mid(shL, shR)
  const warnings = []
  const tilt = (Math.abs(Math.atan2(shR.y - shL.y, shR.x - shL.x)) * 180) / Math.PI
  if (Math.min(tilt, 180 - tilt) > 8) warnings.push('어깨가 기울어져 있어요. 똑바로 서서 찍으면 더 정확해요.')
  const shPx = dist(shL, shR)
  if (shPx < dist(P(L.hipL), P(L.hipR)) * 1.1) warnings.push('몸이 옆으로 돌아간 것 같아요. 정면을 보고 찍어 주세요.')

  const raw = { shoulder: shPx * cmPerPx * SHOULDER_K }
  if (mask && maskW > 0 && maskH > 0) {
    const sx = maskW / width
    const sy = maskH / height
    const torso = hipC.y - shC.y
    const seen = (i) => landmarks[i] && (landmarks[i].visibility ?? 1) >= MIN_VIS
    const arm = (s, e, w) => [P(s), seen(e) ? P(e) : null, seen(w) ? P(w) : null]
    const armL = arm(L.shL, L.elL, L.wrL)
    const armR = arm(L.shR, L.elR, L.wrR)
    const armHalf = (ARM_W * statPx) / 2
    for (const part of ['chest', 'waist', 'hip']) {
      // 얇은 띠 몇 줄을 재서 가슴은 가운데값, 허리는 가장 좁은 값, 엉덩이는 가장 넓은 값을 써요.
      const ws = []
      let cutMax = 0 // 팔 때문에 잘라낸 비율 중 가장 큰 값
      for (const d of [-0.03, -0.015, 0, 0.015, 0.03]) {
        const y = shC.y + torso * (BAND[part] + d)
        const cx = shC.x + (hipC.x - shC.x) * (BAND[part] + d)
        let w = rowWidth(mask, maskW, maskH, y * sy, cx * sx)
        if (!w) continue
        w /= sx
        // 팔이 몸통 옆에 붙어 있으면 윤곽에 팔까지 잡혀요: 두 팔 중심선 안쪽(팔 두께 절반씩 뺀 폭)까지만 몸통으로 봐요.
        const xl = armXAt(armL, y)
        const xr = armXAt(armR, y)
        if (xl != null && xr != null) {
          const inner = Math.abs(xr - xl) - 2 * armHalf
          if (inner < w) {
            cutMax = Math.max(cutMax, (w - inner) / w)
            w = inner
          }
        }
        if (w > 0) ws.push(w)
      }
      if (!ws.length) continue
      // 팔에 가려 몸통 윤곽의 20% 넘게 잘라냈다면 그 높이는 믿기 어려워 쓰지 않아요.
      if (cutMax > 0.2) {
        if (!warnings.some((w) => w.startsWith('팔'))) warnings.push('팔이 몸에 붙어 있어 일부 둘레를 재지 못했어요. 팔을 몸에서 살짝 떼고 찍어 주세요.')
        continue
      }
      ws.sort((a, b) => a - b)
      const wPx = part === 'waist' ? ws[0] : part === 'hip' ? ws[ws.length - 1] : ws[Math.floor(ws.length / 2)]
      // 팔이 몸통에 붙으면 너비가 크게 나와요: 어깨 관절 거리의 1.45배를 넘으면 그 부위는 쓰지 않아요.
      if (part !== 'hip' && wPx > shPx * 1.45) {
        if (!warnings.some((w) => w.startsWith('팔'))) warnings.push('팔이 몸에 붙어 있어 가슴·허리를 재지 못했어요. 팔을 몸에서 살짝 떼고 찍어 주세요.')
        continue
      }
      raw[part] = ellipseCircumference(wPx * cmPerPx, DEPTH[part]) * GIRTH_K[part]
    }
  } else {
    warnings.push('사람 윤곽을 얻지 못해 어깨너비만 쟀어요.')
  }

  // 허리가 가슴·엉덩이보다 넓게 나오면 헐렁한 옷이 잡힌 것으로 보고 허리는 쓰지 않아요.
  const wider = [raw.chest, raw.hip].filter(isNum)
  if (isNum(raw.waist) && wider.length && raw.waist > Math.max(...wider) * 1.05) {
    delete raw.waist
    warnings.push('허리가 가슴·엉덩이보다 넓게 나와 헐렁한 옷 때문으로 보고 허리는 빼었어요. 몸에 붙는 옷을 입고 찍으면 더 정확해요.')
  }

  const values = {}
  for (const [k, v] of Object.entries(raw)) {
    const f = formula[k]
    if (!isNum(v)) continue
    if (!isNum(f)) { values[k] = half(v); continue }
    const blended = PHOTO_WEIGHT * v + (1 - PHOTO_WEIGHT) * f
    values[k] = half(Math.min(f * (1 + MAX_DEV), Math.max(f * (1 - MAX_DEV), blended)))
  }
  const norm = (p) => ({ x: p.x / width, y: p.y / height })
  return {
    ok: true,
    values,
    raw: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, half(v)])),
    // 합성 미리보기가 옷을 얹을 위치 (사진 대비 0~1)
    anchors: { shoulderL: norm(shL), shoulderR: norm(shR), hipL: norm(P(L.hipL)), hipR: norm(P(L.hipR)), ankle: norm(mid(P(L.ankL), P(L.ankR))) },
    warnings,
  }
}

/** 미리보기 배치: 관절 위치로 옷 너비·위치를 정해요 (사진 대비 %). 관절이 없으면 null. */
export function anchorLayout(anchors, category, scale = 1) {
  if (!anchors) return null
  const sh = (anchors.shoulderR.x + anchors.shoulderL.x) / 2
  const shW = Math.abs(anchors.shoulderR.x - anchors.shoulderL.x)
  const hipY = (anchors.hipL.y + anchors.hipR.y) / 2
  const shY = (anchors.shoulderL.y + anchors.shoulderR.y) / 2
  if (category === 'bottom') {
    const w = Math.abs(anchors.hipR.x - anchors.hipL.x) * 2.1 * scale
    const cx = (anchors.hipL.x + anchors.hipR.x) / 2
    return { widthPct: w * 100, leftPct: (cx - w / 2) * 100, topPct: (hipY - (hipY - shY) * 0.15) * 100 }
  }
  const w = shW * (category === 'outer' ? 1.75 : 1.6) * scale
  return { widthPct: w * 100, leftPct: (sh - w / 2) * 100, topPct: (shY - (hipY - shY) * 0.12) * 100 }
}
