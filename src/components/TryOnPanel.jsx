import { useEffect, useRef, useState } from 'react'
import { loadPhoto, savePhoto } from '../lib/storage.js'
import { fileToDataUrl } from '../lib/imageTools.js'
import { CATEGORY_LABEL } from '../data/measurements.js'
import { NO_SERVER } from '../lib/runtime.js'
import { shoeWardrobeFields, SHOE_UNSUPPORTED_NOTE } from '../lib/shoeFit.js'

// 공개 IDM-VTON 모델은 상반신만 인식해서 상의·아우터만 입혀요 (server/hfTryOn.js의 TRYON_CATEGORIES와 같아요).
const TRYON_CATEGORIES = ['top', 'outer']

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

// 가상 피팅: 내 전신 사진 + 옷 이미지를 Hugging Face IDM-VTON(무료 Space)에 보내 사진 속 사람이 실제로 옷을 입은 모습을 받아요.
// photo·onPhotoChange를 주면 사진을 바깥(가상 피팅 탭)과 함께 써요. 안 주면 이 카드가 혼자 관리해요.
export default function TryOnPanel({ product, profile, verdicts, selectedSize, captureRef, onResult, photo: photoProp, onPhotoChange }) {
  const canProductImage = /^https:\/\//i.test(product.image || '')
  const [ownPhoto, setOwnPhoto] = useState(() => (onPhotoChange ? null : loadPhoto()))
  const photo = onPhotoChange ? photoProp || null : ownPhoto
  const setPhoto = (v) => (onPhotoChange ? onPhotoChange(v) : setOwnPhoto(v))
  const [photoNote, setPhotoNote] = useState('')
  const [source, setSource] = useState(canProductImage ? 'product' : 'upload')
  const [uploaded, setUploaded] = useState(null)
  const [error, setError] = useState('')
  const [aiAvailable, setAiAvailable] = useState(null) // null=확인 중
  const [ai, setAi] = useState({ loading: false, image: null, error: '' })
  const [elapsed, setElapsed] = useState(0)
  const personInput = useRef(null)
  const garmentInput = useRef(null)
  const garmentImage = source === 'upload' ? uploaded : canProductImage ? product.image : null
  const supported = TRYON_CATEGORIES.includes(product.category)

  // 서버에서 가상 피팅을 쓸 수 있는지만 확인해요 (사진은 보내지 않아요)
  useEffect(() => {
    let alive = true
    if (NO_SERVER) {
      setAiAvailable(false)
      return () => { alive = false }
    }
    fetch('/api/status')
      .then((r) => r.json())
      .then((d) => alive && setAiAvailable(Boolean(d.tryon)))
      .catch(() => alive && setAiAvailable(false))
    return () => { alive = false }
  }, [])

  // 진행 시간 표시
  useEffect(() => {
    if (!ai.loading) return
    setElapsed(0)
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [ai.loading])

  // 옷장에 담을 때 쓸 이미지: 가상 피팅 결과
  useEffect(() => {
    if (!captureRef) return
    captureRef.current = async () => (ai.image ? { image: ai.image, kind: 'ai' } : { image: null, kind: null })
  }, [captureRef, ai.image])

  async function handlePerson(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    try {
      const url = await fileToDataUrl(file, 1024)
      setPhoto(url)
      setAi({ loading: false, image: null, error: '' })
      setPhotoNote(savePhoto(url) ? '' : '저장 공간이 부족해 이 사진은 이번에만 써요.')
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
      setAi({ loading: false, image: null, error: '' })
    } catch (err) {
      setError(err.message)
    }
  }

  function clearPhoto() {
    setPhoto(null)
    savePhoto(null)
    setPhotoNote('')
    setAi({ loading: false, image: null, error: '' })
  }

  async function runTryOn() {
    if (!photo) return setAi((a) => ({ ...a, error: '먼저 내 전신 사진을 올려 주세요.' }))
    if (!garmentImage) return setAi((a) => ({ ...a, error: '옷 사진을 올려 주세요.' }))
    setAi({ loading: true, image: null, error: '' })
    try {
      const r = await fetch('/api/tryon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personImage: photo, garmentImage, category: product.category, garmentName: product.name, model: 'idm' }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) return setAi({ loading: false, image: null, error: data.message || '가상 피팅에 실패했어요. 잠시 후 다시 시도해 주세요.' })
      setAi({ loading: false, image: data.image, error: '' })
      onResult?.({ image: data.image, kind: 'ai' })
    } catch {
      setAi({ loading: false, image: null, error: '연결하지 못했어요. 인터넷 연결을 확인해 주세요.' })
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
  const ready = photo && garmentImage && supported && aiAvailable !== false

  return (
    <div className="card tryon tone-tryon">
      <div className="section-head">
        <h3>가상 피팅 <span className="muted small">{CATEGORY_LABEL[product.category]} · {selectedSize || '-'}</span></h3>
      </div>

      <div className="tryon-controls">
        <div className="tryon-row">
          <span className="tryon-label">내 사진</span>
          <button type="button" className="chip small" onClick={() => personInput.current?.click()} disabled={ai.loading}>
            {photo ? '사진 바꾸기' : '전신 사진 올리기'}
          </button>
          {photo && !ai.loading && <button type="button" className="btn text" onClick={clearPhoto}>지우기</button>}
          <input ref={personInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handlePerson} />
        </div>
        <div className="tryon-row">
          <span className="tryon-label">옷 사진</span>
          <div className="chip-row">
            <button type="button" className={`chip small ${source === 'product' ? 'active' : ''}`} disabled={!canProductImage || ai.loading} onClick={() => { setSource('product'); setAi({ loading: false, image: null, error: '' }) }}>상품 사진</button>
            <button type="button" className={`chip small ${source === 'upload' ? 'active' : ''}`} disabled={ai.loading} onClick={() => (uploaded ? setSource('upload') : garmentInput.current?.click())}>직접 올리기</button>
            {source === 'upload' && uploaded && !ai.loading && (
              <button type="button" className="btn text" onClick={() => garmentInput.current?.click()}>다른 사진</button>
            )}
          </div>
          <input ref={garmentInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleGarment} />
        </div>
      </div>

      {photoNote && <p className="muted small">{photoNote}</p>}
      {error && <p className="error">{error}</p>}

      <div className="tryon-body">
        <div className={`tryon-stage ${ai.loading ? 'is-loading' : ''}`}>
          {ai.image ? (
            photo ? <BeforeAfter before={photo} after={ai.image} /> : <img className="tryon-person" src={ai.image} alt="가상 피팅 결과" />
          ) : photo ? (
            <>
              <img className="tryon-person" src={photo} alt="내 사진" />
              {garmentImage && <img className="tryon-garment-thumb" src={garmentImage} alt="입힐 옷" referrerPolicy="no-referrer" />}
              {ai.loading && (
                <div className="tryon-wait" role="status">
                  <span className="tryon-spinner" aria-hidden />
                  <strong>옷을 입혀 보는 중… {elapsed}초</strong>
                  <span>보통 30초~1분 걸려요</span>
                </div>
              )}
            </>
          ) : (
            <button type="button" className="tryon-empty" onClick={() => personInput.current?.click()}>
              정면 전신 사진을 올리면<br />이 옷을 입은 모습을 만들어 드려요
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

      {!supported ? (
        <p className="muted small">가상 피팅은 상의·아우터만 할 수 있어요.</p>
      ) : (
        <>
          <button type="button" className="btn primary block tryon-run" disabled={!ready || ai.loading} onClick={runTryOn}>
            {ai.loading ? '입혀 보는 중…' : ai.image ? '다시 입혀 보기' : '입어 보기'}
          </button>
          {ai.error && <p className="error">{ai.error}</p>}
          {aiAvailable === false && <p className="muted small">지금은 가상 피팅을 쓸 수 없어요. 잠시 후 다시 시도해 주세요.</p>}
          {ai.image && <p className="muted small">가운데 손잡이를 밀면 원래 사진과 비교할 수 있어요. 실제 핏과는 다를 수 있어요.</p>}
          {!ai.image && aiAvailable !== false && <p className="muted small">입어 보기를 누르면 내 사진과 옷 사진이 외부 AI 서비스(Hugging Face)로 전송돼요.</p>}
        </>
      )}
    </div>
  )
}
