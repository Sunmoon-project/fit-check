import { useEffect, useRef, useState } from 'react'
import { loadPhoto, savePhoto } from '../lib/storage.js'
import { fileToDataUrl, removeBackground, composePreview } from '../lib/imageTools.js'
import { CATEGORY_LABEL } from '../data/measurements.js'

// 카테고리별 기본 위치 (사진 대비 %). 정면 전신 사진 기준의 대략값이에요.
const BASE_LAYOUT = {
  top: { top: 17, width: 50 },
  outer: { top: 16, width: 56 },
  dress: { top: 17, width: 52 },
  bottom: { top: 45, width: 42 },
}

const NO_KEY_TEXT = 'AI 합성은 FAL_KEY를 .env에 설정하면 사용할 수 있어요 (fal.ai FASHN)'

// 선택한 사이즈의 여유분(판정 단계 0~4)이 클수록 옷을 조금 더 크게 그려 헐렁한 느낌을 줍니다.
function easeScale(verdicts) {
  const levels = verdicts.filter((v) => !v.isLength).map((v) => v.level)
  if (!levels.length) return 1
  const mean = levels.reduce((a, b) => a + b, 0) / levels.length
  return 1 + (mean - 2) * 0.05
}

function previewLayout(category, verdicts, scalePct, offsetPct) {
  const base = BASE_LAYOUT[category] || BASE_LAYOUT.top
  const widthPct = base.width * easeScale(verdicts) * (scalePct / 100)
  return { widthPct, leftPct: 50 - widthPct / 2, topPct: base.top + offsetPct }
}

export default function TryOnPanel({ product, verdicts, selectedSize, captureRef }) {
  const canProductImage = Boolean(product.image)
  const [photo, setPhoto] = useState(() => loadPhoto())
  const [photoNote, setPhotoNote] = useState('')
  const [source, setSource] = useState(canProductImage ? 'product' : 'upload')
  const [uploaded, setUploaded] = useState(null)
  const [tolerance, setTolerance] = useState(34)
  const [garment, setGarment] = useState(null) // { dataUrl, removed, reason }
  const [scalePct, setScalePct] = useState(100)
  const [offsetPct, setOffsetPct] = useState(0)
  const [error, setError] = useState('')
  const [aiAvailable, setAiAvailable] = useState(null) // null=확인 중
  const [ai, setAi] = useState({ loading: false, image: null, model: '', error: '' })
  const [elapsed, setElapsed] = useState(0)
  const personInput = useRef(null)
  const garmentInput = useRef(null)

  const garmentSrc = source === 'product' ? product.image : uploaded
  const layout = previewLayout(product.category, verdicts, scalePct, offsetPct)

  // 서버에 AI 합성 키가 있는지 확인
  useEffect(() => {
    let alive = true
    fetch('/api/status')
      .then((r) => r.json())
      .then((d) => alive && setAiAvailable(Boolean(d.tryon)))
      .catch(() => alive && setAiAvailable(false))
    return () => { alive = false }
  }, [])

  // 옷 이미지 배경 제거 (모서리 flood fill)
  useEffect(() => {
    if (!garmentSrc) { setGarment(null); return }
    let alive = true
    removeBackground(garmentSrc, tolerance).then((g) => alive && setGarment(g))
    return () => { alive = false }
  }, [garmentSrc, tolerance])

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
  })

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
    setAi({ loading: true, image: null, model: '', error: '' })
    try {
      const r = await fetch('/api/tryon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personImage: photo, garmentImage, category: product.category }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (data.error === 'NO_KEY') setAiAvailable(false)
        return setAi({ loading: false, image: null, model: '', error: data.message || 'AI 합성에 실패했어요.' })
      }
      setAi({ loading: false, image: data.image, model: data.model || '', error: '' })
    } catch {
      setAi({ loading: false, image: null, model: '', error: '서버에 연결하지 못했어요.' })
    }
  }

  if (product.category === 'shoes') {
    return (
      <div className="card">
        <div className="section-head"><h3>사진 합성</h3></div>
        <p className="muted small">신발은 사진 합성(미리보기·AI 합성)을 지원하지 않아요. 사이즈 추천과 리뷰를 참고해주세요.</p>
      </div>
    )
  }

  const chips = verdicts.filter((v) => !v.isLength || v.level !== 2)

  return (
    <div className="card tryon">
      <div className="section-head">
        <h3>사진 합성 <span className="muted small">{CATEGORY_LABEL[product.category]} · {selectedSize || '-'}</span></h3>
        <span className="tag-rough">대략적인 미리보기</span>
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
        <button
          type="button"
          className="btn primary block"
          disabled={!aiAvailable || ai.loading}
          onClick={runAi}
        >
          {ai.loading ? `AI 합성 중… ${elapsed}초` : 'AI로 합성하기'}
        </button>
        {aiAvailable === false && <p className="muted small">{NO_KEY_TEXT}</p>}
        {ai.loading && <p className="muted small">보통 10~60초 걸려요. 창을 닫지 말아주세요.</p>}
        {ai.error && <p className="error">{ai.error}</p>}
        {ai.image && (
          <figure className="ai-result">
            <img src={ai.image} alt="AI 합성 결과" referrerPolicy="no-referrer" />
            <figcaption className="muted small">{ai.model} 합성 결과 · 실제 핏과 다를 수 있어요</figcaption>
          </figure>
        )}
      </div>

      <p className="muted small disclaimer">
        미리보기는 옷 이미지를 사진 위에 얹은 대략적인 모습이에요. 선택한 사이즈가 넉넉할수록 조금 크게 그려요. 원단·재단 차이는 반영되지 않아요.
      </p>
    </div>
  )
}
