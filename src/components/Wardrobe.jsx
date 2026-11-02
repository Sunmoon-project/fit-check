import { useState } from 'react'
import { CATEGORY_LABEL } from '../data/measurements.js'
import { findSimilar, describeDiff } from '../lib/wardrobe.js'

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

export default function Wardrobe({ items, onDelete, onBack }) {
  const [selected, setSelected] = useState([])
  const compared = items.filter((w) => selected.includes(w.id))

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

      {items.length === 0 ? (
        <div className="card">
          <p className="muted">아직 담은 옷이 없어요. 결과 화면에서 ‘옷장에 담기’를 누르면 사이즈·핏 판정과 합성 이미지가 여기에 저장돼요.</p>
        </div>
      ) : (
        <>
          <p className="muted small">최대 {MAX_COMPARE}벌을 골라 나란히 비교할 수 있어요. 이 브라우저에만 저장돼요.</p>
          <ul className="wd-grid">
            {items.map((w) => {
              const peer = findSimilar(w, items)
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
