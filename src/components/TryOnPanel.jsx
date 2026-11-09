import { useEffect, useMemo, useRef, useState } from 'react'
import { loadPhoto, savePhoto } from '../lib/storage.js'
import { fileToDataUrl, removeBackground, composePreview } from '../lib/imageTools.js'
import { CATEGORY_LABEL } from '../data/measurements.js'
import { NO_SERVER, NO_SERVER_TEXT } from '../lib/runtime.js'
import { shoeWardrobeFields, SHOE_UNSUPPORTED_NOTE } from '../lib/shoeFit.js'
import { anchorLayout } from '../lib/photoBody.js'

// 카테고리별 기본 위치 (사진 대비 %). 정면 전신 사진 기준의 대략값이에요.
const BASE_LAYOUT = {
  top: { top: 17, width: 50 },
  outer: { top: 16, width: 56 },
  dress: { top: 17, width: 52 },
  bottom: { top: 45, width: 42 },
}

const NO_STATUS_TEXT = 'AI 합성 서버에 연결하지 못했어요.'
// 무료 모델 두 가지 (서버 server/hfTryOn.js의 TRYON_MODELS와 같아요).
// IDM-VTON: 상반신만 인식(상의·아우터), 토큰 없이 동작 확인. Leffa: 상의·하의·원피스, 토큰 없는 요청을 거절할 때가 있어 실험적이에요.
const AI_MODELS = [
  { id: 'idm', label: 'IDM-VTON', note: '상의·아우터', space: null, categories: ['top', 'outer'] },
  { id: 'leffa', label: 'Leffa (실험적)', note: '상의·하의·원피스', space: 'franciszzj/Leffa', categories: ['top', 'outer', 'bottom', 'dress'] },
]
const UPPER_ONLY_NOTE = 'IDM-VTON은 상반신만 인식해서 하의·원피스는 합성하지 못해요. Leffa(실험적)를 고르거나 위 미리보기를 참고해주세요.'

// AI 결과와 원래 사진을 손잡이로 나눠 비교해요 (왼쪽 = 원래 사진).
function BeforeAfter({ before, after }) {
  const [pos, setPos] = useState(50)
  return (
    <div className="ba" style={{ '--pos': `${pos}%` }}>
      <img src={after} alt="AI 합성 결과" referrerPolicy="no-referrer" />
      <img className="ba-before" src={before} alt="원래 사진" />
      <span className="ba-line" aria-hidden />
      <input type="range" min="0" max="100" value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="원래 사진과 합성 결과 비교" />
    </div>
  )
}

// 선택한 사이즈의 여유분(판정 단계 0~4)이 클수록 옷을 조금 더 크게 그려 헐렁한 느낌을 줍니다.
function easeScale(verdicts) {
  const levels = verdicts.filter((v) => !v.isLength).map((v) => v.level)
  if (!levels.length) return 1
  const mean = levels.reduce((a, b) => a + b, 0) / levels.length
  return 1 + (mean - 2) * 0.05
}

// anchors(사진에서 찾은 어깨·골반 위치)가 있으면 그 위치에 맞춰 얹고, 없으면 카테고리별 대략 위치를 써요.
function previewLayout(category, verdicts, scalePct, offsetPct, anchors = null) {
  const fit = anchors && category !== 'dress' ? anchorLayout(anchors, category, easeScale(verdicts) * (scalePct / 100)) : null
  if (fit) return { ...fit, topPct: fit.topPct + offsetPct, anchored: true }
  const base = BASE_LAYOUT[category] || BASE_LAYOUT.top
  const widthPct = base.width * easeScale(verdicts) * (scalePct / 100)
  return { widthPct, leftPct: 50 - widthPct / 2, topPct: base.top + offsetPct }
}

// photo·onPhotoChange를 주면 사진을 바깥(가상 피팅 탭)과 함께 써요 (웹캠으로 찍은 사진, 체형 추정과 공유). 안 주면 예전처럼 혼자 관리해요.
export default function TryOnPanel({ product, profile, verdicts, selectedSize, captureRef, onResult, photo: photoProp, onPhotoChange, anchors = null }) {
  const canProductImage = Boolean(product.image)
  const [ownPhoto, setOwnPhoto] = useState(() => (onPhotoChange ? null : loadPhoto()))
  const photo = onPhotoChange ? photoProp || null : ownPhoto
  const setPhoto = (v) => (onPhotoChange ? onPhotoChange(v) : setOwnPhoto(v))
  const [photoNote, setPhotoNote] = useState('')
  const [source, setSource] = useState(canProductImage ? 'product' : 'upload')
  const [uploaded, setUploaded] = useState(null)
  const [tolerance, setTolerance] = useState(34) // 슬라이더 즉시 값 (UI 반영용)
  const [appliedTolerance, setAppliedTolerance] = useState(34) // 디바운스된 값 (배경 제거 실행용)
  const [garment, setGarment] = useState(null) // { dataUrl, removed, reason }
  const [scalePct, setScalePct] = useState(100)
  const [offsetPct, setOffsetPct] = useState(0)
  const [error, setError] = useState('')
  const [aiAvailable, setAiAvailable] = useState(null) // null=확인 중
  const [aiStatus, setAiStatus] = useState({ provider: '', space: '' })
  const [ai, setAi] = useState({ loading: false, image: null, model: '', error: '', cached: false })
  const [modelId, setModelId] = useState('idm')
  const aiModel = AI_MODELS.find((m) => m.id === modelId) || AI_MODELS[0]
  const [elapsed, setElapsed] = useState(0)
  const personInput = useRef(null)
  const garmentInput = useRef(null)

  const garmentSrc = source === 'product' ? product.image : uploaded
  const layout = useMemo(
    () => previewLayout(product.category, verdicts, scalePct, offsetPct, anchors),
    [product.category, verdicts, scalePct, offsetPct, anchors],
  )

  // 서버의 AI 합성 사용 여부와 Space 확인
  useEffect(() => {
    let alive = true
    if (NO_SERVER) {
      setAiAvailable(false)
      return () => { alive = false }
    }
    fetch('/api/status')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setAiAvailable(Boolean(d.tryon))
        setAiStatus({ provider: d.provider || '', space: d.space || '' })
      })
      .catch(() => alive && setAiAvailable(false))
    return () => { alive = false }
  }, [])

  // tolerance 슬라이더는 입력마다 바뀌므로, 실제 배경 제거(무거운 flood fill)는 멈춘 뒤에만 돌도록 디바운스
  useEffect(() => {
    if (tolerance === appliedTolerance) return
    const t = setTimeout(() => setAppliedTolerance(tolerance), 200)
    return () => clearTimeout(t)
  }, [tolerance, appliedTolerance])

  // 옷 이미지 배경 제거 (모서리 flood fill). 디바운스된 appliedTolerance로만 실행
  useEffect(() => {
    if (!garmentSrc) { setGarment(null); return }
    let alive = true
    removeBackground(garmentSrc, appliedTolerance).then((g) => alive && setGarment(g))
    return () => { alive = false }
  }, [garmentSrc, appliedTolerance])

  // AI 합성 진행 시간 표시
  useEffect(() => {
    if (!ai.loading) return
    setElapsed(0)
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [ai.loading])

  // 옷장에 담을 때 쓸 이미지: AI 결과가 있으면 그것, 없으면 합성 미리보기
  useEffect(() => {
    if (!captureRef) return
    captureRef.current = async () => {
      if (ai.image) return { image: ai.image, kind: 'ai' }
      if (!photo || !garment?.removed) return { image: null, kind: null }
      try {
        return { image: await composePreview(photo, garment.dataUrl, layout), kind: 'preview' }
      } catch {
        return { image: null, kind: null }
      }
    }
  }, [captureRef, ai.image, photo, garment, layout])

  async function handlePerson(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    try {
      const url = await fileToDataUrl(file, 1024)
      setPhoto(url)
      setAi((a) => ({ ...a, image: null, error: '' }))
      setPhotoNote(savePhoto(url) ? '' : '저장 공간이 부족해 이 사진은 이번 세션에서만 사용해요.')
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleGarment(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    try {
      setUploaded(await fileToDataUrl(file, 1024))
      setSource('upload')
      setAi((a) => ({ ...a, image: null, error: '' }))
    } catch (err) {
      setError(err.message)
    }
  }

  function clearPhoto() {
    setPhoto(null)
    savePhoto(null)
    setPhotoNote('')
    setAi((a) => ({ ...a, image: null }))
  }

  async function runAi() {
    const garmentImage = source === 'upload' ? uploaded : /^https:\/\//i.test(product.image || '') ? product.image : null
    if (!photo) return setAi((a) => ({ ...a, error: '먼저 내 전신 사진을 올려주세요.' }))
    if (!garmentImage) return setAi((a) => ({ ...a, error: '옷 이미지를 직접 올려주세요.' }))
    setAi({ loading: true, image: null, model: '', error: '', cached: false })
    try {
      const r = await fetch('/api/tryon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personImage: photo, garmentImage, category: product.category, garmentName: product.name, model: aiModel.id }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        return setAi({ loading: false, image: null, model: '', error: data.message || 'AI 합성에 실패했어요.', cached: false })
      }
      setAi({ loading: false, image: data.image, model: data.model || '', error: '', cached: Boolean(data.cached) })
      onResult?.({ image: data.image, kind: 'ai' })
    } catch {
      setAi({ loading: false, image: null, model: '', error: '서버에 연결하지 못했어요.', cached: false })
    }
  }

  if (product.category === 'shoes') {
    // 사이즈 이름을 mm로 읽지 못하면 옷장·입어보기에 판정이 없다는 걸 알려줘요.
    const sf = shoeWardrobeFields({ product, size: selectedSize, verdicts, profile })
    return (
      <div className="card tone-tryon">
        <div className="section-head"><h3>사진 합성</h3></div>
        <p className="muted small">신발은 사진 합성(미리보기·AI 합성)을 지원하지 않아요. 사이즈 추천과 리뷰를 참고해주세요.</p>
        {sf.status === 'unsupported' && sf.note === SHOE_UNSUPPORTED_NOTE && <p className="small wd-unsupported">{sf.note}: 선택한 사이즈 ‘{selectedSize || '-'}’를 mm로 읽거나 환산하지 못해 내 발길이와 비교하지 않았어요. 옷장에는 이 표시와 함께 담겨요.</p>}
        {sf.status === 'unsupported' && sf.note !== SHOE_UNSUPPORTED_NOTE && <p className="small wd-unsupported">{sf.note}: 사이즈 ‘{selectedSize || '-'}’는 mm로 읽었지만 내 발길이를 몰라 비교하지 않았어요. 발길이를 입력하면 판정해요.</p>}
        {sf.status === 'converted' && <p className="muted small">{sf.note}</p>}
      </div>
    )
  }

  const chips = verdicts.filter((v) => !v.isLength || v.level !== 2)
  const aiCategoryOk = aiModel.categories.includes(product.category)

  return (
    <div className="card tryon tone-tryon">
      <div className="section-head">
        <h3>사진 합성 <span className="muted small">{CATEGORY_LABEL[product.category]} · {selectedSize || '-'}</span></h3>
        <span className="tag-rough">{layout.anchored ? '내 어깨·골반에 맞춘 미리보기' : '대략적인 미리보기'}</span>
      </div>

      <div className="tryon-controls">
        <div className="tryon-row">
          <span className="tryon-label">내 사진</span>
          <button type="button" className="chip small" onClick={() => personInput.current?.click()}>
            {photo ? '사진 바꾸기' : '전신 사진 올리기'}
          </button>
          {photo && <button type="button" className="btn text" onClick={clearPhoto}>지우기</button>}
          <input ref={personInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handlePerson} />
        </div>
        <div className="tryon-row">
          <span className="tryon-label">옷 이미지</span>
          <div className="chip-row">
            <button type="button" className={`chip small ${source === 'product' ? 'active' : ''}`} disabled={!canProductImage} onClick={() => setSource('product')}>상품 이미지</button>
            <button type="button" className={`chip small ${source === 'upload' ? 'active' : ''}`} onClick={() => (uploaded ? setSource('upload') : garmentInput.current?.click())}>직접 올리기</button>
            {source === 'upload' && uploaded && (
              <button type="button" className="btn text" onClick={() => garmentInput.current?.click()}>다른 사진</button>
            )}
          </div>
          <input ref={garmentInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleGarment} />
        </div>
      </div>

      {photoNote && <p className="muted small">{photoNote}</p>}
      {error && <p className="error">{error}</p>}
      {garment && !garment.removed && (
        <p className="muted small">이 상품 이미지는 쇼핑몰 설정 때문에 배경을 지울 수 없어 그대로 얹었어요. 옷 사진을 직접 올리면 배경을 지워서 보여드려요.</p>
      )}

      <div className="tryon-body">
        <div className="tryon-stage">
          {photo ? (
            <>
              <img className="tryon-person" src={photo} alt="내 사진" />
              {garment && (
                <img
                  className={`tryon-garment ${garment.removed ? '' : 'raw'}`}
                  src={garment.dataUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  style={{ left: `${layout.leftPct}%`, top: `${layout.topPct}%`, width: `${layout.widthPct}%` }}
                />
              )}
            </>
          ) : (
            <button type="button" className="tryon-empty" onClick={() => personInput.current?.click()}>
              정면 전신 사진을 올리면<br />옷을 얹어 대략적인 모습을 보여드려요
            </button>
          )}
        </div>

        <ul className="vchip-list" aria-label="부위별 핏">
          {chips.length === 0 && <li className="muted small">사이즈표가 없어 부위별 핏은 표시하지 않아요.</li>}
          {chips.map((v) => (
            <li key={v.part} className={`vchip v-${v.key}`}>{v.label} {v.verdict}</li>
          ))}
        </ul>
      </div>

      {photo && garment && (
        <div className="tryon-sliders">
          <label>크기 <input type="range" min="60" max="160" value={scalePct} onChange={(e) => setScalePct(Number(e.target.value))} /></label>
          <label>위아래 <input type="range" min="-25" max="25" value={offsetPct} onChange={(e) => setOffsetPct(Number(e.target.value))} /></label>
          {garment.removed && (
            <label>배경 지우기 <input type="range" min="10" max="80" value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} /></label>
          )}
        </div>
      )}

      <div className="ai-box">
        <div className="seg" role="radiogroup" aria-label="AI 합성 모델">
          {AI_MODELS.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={m.id === modelId} className={m.id === modelId ? 'on' : ''} disabled={ai.loading} onClick={() => setModelId(m.id)}>
              {m.label}<span>{m.note}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn primary block"
          disabled={!aiAvailable || !aiCategoryOk || ai.loading}
          onClick={runAi}
        >
          {ai.loading ? `AI 합성 중… ${elapsed}초` : 'AI로 합성하기'}
        </button>
        {aiAvailable === false && <p className="muted small">{NO_SERVER ? NO_SERVER_TEXT : NO_STATUS_TEXT}</p>}
        {aiAvailable && !aiCategoryOk && <p className="muted small">{UPPER_ONLY_NOTE}</p>}
        {aiAvailable && aiCategoryOk && (
          <p className="muted small">
            AI 합성을 누르면 내 전신 사진과 옷 이미지가 Hugging Face Space{(aiModel.space || aiStatus.space) ? ` (${aiModel.space || aiStatus.space})` : ''}로 전송돼요. 무료이고, 하루 GPU 사용량 제한이 있어요.
          </p>
        )}
        {ai.loading && <p className="muted small">무료 GPU 대기열을 거쳐서 보통 30초~2분 걸려요(최대 5분). 창을 닫지 말아주세요. 도중에 끊겨도 GPU 사용량은 쓰여요.</p>}
        {ai.error && <p className="error">{ai.error}</p>}
        {ai.image && (
          <figure className="ai-result">
            {photo ? <BeforeAfter before={photo} after={ai.image} /> : <img src={ai.image} alt="AI 합성 결과" referrerPolicy="no-referrer" />}
            <figcaption className="muted small">{ai.model} 합성 결과{ai.cached ? ' (저장된 결과)' : ''} · 실제 핏과 다를 수 있어요</figcaption>
          </figure>
        )}
      </div>

      <p className="muted small disclaimer">
        미리보기는 옷 이미지를 사진 위에 얹은 대략적인 모습이에요. 선택한 사이즈가 넉넉할수록 조금 크게 그려요. 원단·재단 차이는 반영되지 않아요.
      </p>
    </div>
  )
}
