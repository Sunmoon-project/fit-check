// 가상 피팅 탭: 옷장에 담긴 옷(확장에서 보낸 옷 포함)이나 지금 보던 옷, 직접 올린 옷 사진을 내 사진과 합성해요.
// 합성 자체는 TryOnPanel(미리보기 + 무료 Hugging Face 모델)이 하고, 여기서는 옷 고르기와 옷장 사진 저장만 맡아요.
import { useMemo, useRef, useState } from 'react'
import { CATEGORY_LABEL } from '../data/measurements.js'
import TryOnPanel from './TryOnPanel.jsx'
import { EaseGauge, withLevels } from './FitVisuals.jsx'

const UPLOAD_CATS = ['top', 'outer', 'bottom', 'dress']

export default function TryOnStudio({ wardrobe = [], profile, current = null, onSaveImage, onBack }) {
  // 고를 수 있는 옷: 지금 보던 옷(있으면) → 옷장(신발 제외) → 직접 올리기
  const options = useMemo(() => {
    const list = []
    if (current) list.push({ key: 'current', product: current.product, size: current.size, verdicts: withLevels(current.verdicts), itemId: null, badge: '보던 옷' })
    for (const w of wardrobe) {
      if (w.product?.category === 'shoes') continue
      list.push({ key: w.id, product: w.product, size: w.size, verdicts: withLevels(w.verdicts), itemId: w.id, image: w.image })
    }
    return list
  }, [wardrobe, current])
  const [pick, setPick] = useState(() => options[0]?.key || 'upload')
  const [uploadCat, setUploadCat] = useState('top')
  const [saved, setSaved] = useState('')
  const [hasResult, setHasResult] = useState(false)
  const captureRef = useRef(null)

  const chosen = options.find((o) => o.key === pick) || null
  const product = chosen
    ? { ...chosen.product, image: chosen.product.image || null }
    : { name: '직접 올린 옷', category: uploadCat, image: null, mall: '' }

  function choose(key) {
    setPick(key)
    setSaved('')
    setHasResult(false)
  }

  async function save() {
    const shot = (await captureRef.current?.()) || { image: null, kind: null }
    if (!shot.image) return setSaved('저장할 합성 이미지가 없어요. 먼저 사진을 올리고 합성해 주세요.')
    const res = onSaveImage?.(chosen.itemId, shot)
    setSaved(res?.failed ? '저장 공간이 부족해 저장하지 못했어요.' : '옷장 사진으로 저장했어요.')
  }

  return (
    <section className="studio">
      <div className="section-head">
        <h2 className="q-title small-title">가상 피팅</h2>
        <button type="button" className="btn text" onClick={onBack}>← 돌아가기</button>
      </div>
      <p className="muted small">내 전신 사진에 옷을 입혀 봐요. 옷장에 담은 옷(확장 프로그램에서 보낸 옷 포함)을 고르거나 옷 사진을 직접 올리세요.</p>

      <div className="studio-picker" role="listbox" aria-label="입어볼 옷">
        {options.map((o) => (
          <button key={o.key} type="button" role="option" aria-selected={pick === o.key} className={`studio-opt ${pick === o.key ? 'on' : ''}`} onClick={() => choose(o.key)}>
            <span className="studio-img">
              {o.image || o.product.image ? <img src={o.image || o.product.image} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden>{o.product.emoji || '👕'}</span>}
              {o.badge && <em>{o.badge}</em>}
            </span>
            <span className="studio-name">{o.product.name}</span>
            <span className="muted small">{CATEGORY_LABEL[o.product.category]} · {o.size || '-'}</span>
          </button>
        ))}
        <button type="button" role="option" aria-selected={pick === 'upload'} className={`studio-opt ${pick === 'upload' ? 'on' : ''}`} onClick={() => choose('upload')}>
          <span className="studio-img studio-add" aria-hidden>＋</span>
          <span className="studio-name">옷 사진 직접 올리기</span>
          <span className="muted small">아무 옷이나</span>
        </button>
      </div>

      {pick === 'upload' && (
        <div className="seg studio-cats" role="radiogroup" aria-label="옷 종류">
          {UPLOAD_CATS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={uploadCat === c} className={uploadCat === c ? 'on' : ''} onClick={() => setUploadCat(c)}>{CATEGORY_LABEL[c]}</button>
          ))}
        </div>
      )}

      {chosen?.verdicts?.length > 0 && (
        <div className="card studio-fit">
          <div className="section-head"><h3>{chosen.size} 사이즈 핏</h3></div>
          <EaseGauge verdicts={chosen.verdicts} />
        </div>
      )}

      <TryOnPanel
        key={`${pick}-${pick === 'upload' ? uploadCat : ''}`}
        product={product}
        profile={profile}
        selectedSize={chosen?.size || null}
        verdicts={chosen?.verdicts || []}
        captureRef={captureRef}
        onResult={() => setHasResult(true)}
      />

      {chosen?.itemId && (
        <div className="save-row">
          <button type="button" className="btn ghost block" onClick={save}>
            {hasResult ? 'AI 결과를 옷장 사진으로 저장' : '지금 미리보기를 옷장 사진으로 저장'}
          </button>
          {saved && <p className="muted small" role="status">{saved}</p>}
        </div>
      )}
    </section>
  )
}
