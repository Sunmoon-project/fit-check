import { useMemo, useRef, useState } from 'react'
import { CATEGORY_LABEL } from '../data/measurements.js'
import { findSimilar, describeDiff } from '../lib/wardrobe.js'
import { parseImportText, LIMITS } from '../lib/wardrobeImport.js'
import { trimNote } from '../lib/storage.js'
import ReviewTab from './ReviewTab.jsx'

const MAX_COMPARE = 4

function Thumb({ item }) {
  const src = item.image || item.product.image
  if (!src) return <span className="wd-emoji" aria-hidden>{item.product.emoji || '👕'}</span>
  return <img src={src} alt="" referrerPolicy="no-referrer" />
}

function VerdictLine({ verdicts }) {
  if (!verdicts?.length) return <span className="muted small">부위별 판정 없음</span>
  return (
    <span className="wd-verdicts">
      {verdicts.map((v) => <span key={v.part} className={`v-${v.key}`}>{v.label} {v.verdict}</span>)}
    </span>
  )
}

// 결과 화면용: 지금 보는 옷과 내 옷장 속 가장 비슷한 옷의 부위별 치수 차이
export function SimilarInWardrobe({ target, wardrobe }) {
  const cmp = findSimilar(target, wardrobe.filter((w) => w.product.url !== target.product.url))
  if (!cmp) return null
  return (
    <div className="card similar-card">
      <div className="section-head"><h3>내 옷장 속 비슷한 옷</h3></div>
      <div className="similar-body">
        <div className="wd-thumb small"><Thumb item={cmp.item} /></div>
        <div>
          <strong>{cmp.item.product.name}</strong>
          <span className="muted small"> · {cmp.item.size}</span>
          <p className="small">이 옷({target.size})은 {cmp.diffs.map(describeDiff).join(' · ')}</p>
          <VerdictLine verdicts={cmp.item.verdicts} />
        </div>
      </div>
    </div>
  )
}

// 확장에서 복사한 옷 정보를 붙여넣거나 파일로 가져옵니다. 서버를 거치지 않고, 검사를 통과한 것만 이 브라우저에 저장해요.
function ImportPanel({ onImport }) {
  const [text, setText] = useState('')
  const [msg, setMsg] = useState(null)
  const fileRef = useRef(null)

  function submit(raw) {
    const res = parseImportText(raw)
    if (!res.ok) {
      setMsg({ error: true, text: res.reason })
      return
    }
    const saved = onImport(res.item)
    if (saved?.failed) setMsg({ error: true, text: '저장 공간이 부족해서 저장하지 못했어요. 오래된 옷을 지운 뒤 다시 해주세요.' })
    else {
      setMsg({ error: false, text: `‘${res.item.product.name}’을 옷장에 담았어요. ${trimNote(saved)}`.trim() })
      setText('')
    }
  }

  function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > LIMITS.text) {
      setMsg({ error: true, text: '파일이 너무 커요. 확장에서 복사한 글이 맞는지 확인해주세요.' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => submit(String(reader.result || ''))
    reader.onerror = () => setMsg({ error: true, text: '파일을 읽지 못했어요.' })
    reader.readAsText(file)
  }

  return (
    <details className="card wd-import">
      <summary>확장에서 직접 가져오기 (자동으로 안 될 때)</summary>
      <p className="muted small">확장 카드의 ‘내 옷장으로 보내기’를 누르면 보통 이 페이지로 자동으로 들어와요. 자동 전달이 안 될 때만, 확장 카드의 ‘붙여넣기용으로 복사’를 누른 뒤 글을 붙여넣거나 저장한 .json 파일을 골라주세요.</p>
      <textarea
        className="wd-import-text"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="확장에서 복사한 글"
        placeholder='{"app":"fitcheck", ...}'
      />
      <div className="wd-actions">
        <button type="button" className="btn" onClick={() => submit(text)}>가져오기</button>
        <button type="button" className="btn text" onClick={() => fileRef.current?.click()}>파일 고르기</button>
        <input ref={fileRef} type="file" accept=".json,application/json,text/plain" hidden onChange={onFile} />
      </div>
      {msg && <p className={`small ${msg.error ? 'danger' : ''}`} role="status">{msg.text}</p>}
      <p className="muted small">닉네임·리뷰 원문·사진 주소는 이 브라우저에만 저장돼요. 서버로 보내지 않아요.</p>
    </details>
  )
}

export default function Wardrobe({ items, onDelete, onBack, onImport, onClearReviews }) {
  const [selected, setSelected] = useState([])
  const compared = items.filter((w) => selected.includes(w.id))

  // 각 항목의 비슷한 옷은 items가 바뀔 때만 한 번 계산 (매 렌더 O(N²) 재계산 방지)
  const peers = useMemo(() => {
    const map = {}
    for (const w of items) {
      map[w.id] = findSimilar(w, items.filter((o) => o.product.url !== w.product.url))
    }
    return map
  }, [items])

  function toggle(id) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_COMPARE ? s : [...s, id]))
  }

  function remove(id) {
    setSelected((s) => s.filter((x) => x !== id))
    onDelete(id)
  }

  return (
    <section className="wardrobe">
      <div className="section-head">
        <h2 className="q-title small-title">내 옷장</h2>
        <button type="button" className="btn text" onClick={onBack}>← 돌아가기</button>
      </div>

      {onImport && <ImportPanel onImport={onImport} />}

      {items.length === 0 ? (
        <div className="card">
          <p className="muted">아직 담은 옷이 없어요. 결과 화면에서 ‘옷장에 담기’를 누르면 사이즈·핏 판정과 합성 이미지가 여기에 저장돼요.</p>
        </div>
      ) : (
        <>
          <p className="muted small">최대 {MAX_COMPARE}벌을 골라 나란히 비교할 수 있어요. 이 브라우저에만 저장돼요.</p>
          <ul className="wd-grid">
            {items.map((w) => {
              const peer = peers[w.id]
              return (
                <li key={w.id} className={`wd-item ${selected.includes(w.id) ? 'selected' : ''}`}>
                  <button type="button" className="wd-thumb" onClick={() => toggle(w.id)} aria-pressed={selected.includes(w.id)}>
                    <Thumb item={w} />
                    {w.imageKind && <span className="wd-kind">{w.imageKind === 'ai' ? 'AI' : '미리보기'}</span>}
                  </button>
                  <div className="wd-info">
                    <strong className="wd-name">{w.product.name}</strong>
                    <span className="muted small">{w.product.mall} · {CATEGORY_LABEL[w.product.category]} · {w.size || '-'}</span>
                    <VerdictLine verdicts={w.verdicts} />
                    {peer && (
                      <span className="small wd-peer">‘{peer.item.product.name}’ 대비 {peer.diffs.map(describeDiff).join(' · ')}</span>
                    )}
                    <div className="wd-actions">
                      {w.product.url?.startsWith('http') && (
                        <a className="small source-link" href={w.product.url} target="_blank" rel="noopener noreferrer">상품 보기</a>
                      )}
                      <button type="button" className="btn text danger" onClick={() => remove(w.id)}>삭제</button>
                    </div>
                    {w.reviews?.length > 0 && (
                      <details className="wd-reviews">
                        <summary className="small">리뷰 {w.reviews.length}건</summary>
                        <ReviewTab reviews={w.reviews} onClear={onClearReviews ? () => onClearReviews(w.id) : null} />
                      </details>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="card">
            <div className="section-head"><h3>나란히 비교 <span className="muted small">{compared.length}/{MAX_COMPARE}</span></h3></div>
            {compared.length < 2 ? (
              <p className="muted small">위에서 사진을 눌러 2벌 이상 골라주세요.</p>
            ) : (
              <div className="compare-grid">
                {compared.map((w) => (
                  <figure key={w.id} className="compare-cell">
                    <div className="compare-img"><Thumb item={w} /></div>
                    <figcaption>
                      <strong className="small">{w.product.name}</strong>
                      <span className="muted small"> · {w.size || '-'}</span>
                      <VerdictLine verdicts={w.verdicts} />
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
