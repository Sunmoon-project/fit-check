// MediaPipe Pose Landmarker를 처음 쓸 때만 불러와요 (무료, 브라우저 안에서 실행). 사진은 어디로도 보내지 않아요.
// 내려받는 것: JS·WASM(jsDelivr, 버전 고정)과 모델 파일(Google 저장소, 버전 고정) — 약 9MB, 브라우저가 캐시해요.
const VERSION = '0.10.14'
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'

let ready = null

async function create(delegate) {
  const vision = await import(/* @vite-ignore */ `${CDN}/vision_bundle.mjs`)
  const files = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`)
  return vision.PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'IMAGE',
    numPoses: 1,
    outputSegmentationMasks: true,
  })
}

export function loadPose() {
  if (!ready) {
    // GPU가 안 되는 환경이면 CPU로 다시 시도해요. 실패하면 다음에 다시 불러올 수 있게 비워 둬요.
    ready = create('GPU').catch(() => create('CPU')).catch((e) => {
      ready = null
      throw e
    })
  }
  return ready
}

/** img: 다 읽힌 HTMLImageElement → { landmarks, width, height, mask, maskW, maskH } */
export async function detectPose(img) {
  const lm = await loadPose()
  const r = lm.detect(img)
  const m = r.segmentationMasks?.[0] || null
  const out = {
    landmarks: r.landmarks?.[0] || null,
    width: img.naturalWidth,
    height: img.naturalHeight,
    mask: m ? m.getAsFloat32Array().slice() : null,
    maskW: m?.width || 0,
    maskH: m?.height || 0,
  }
  m?.close?.()
  return out
}

/** data URI → 다 읽힌 이미지 */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('사진을 읽지 못했어요.'))
    img.src = src
  })
}
