import { useState } from 'react'

const TABS = [
  { id: 'text', label: '리뷰 원문' },
  { id: 'photo', label: '사진 모아보기' },
]

// 옷장에 저장된 리뷰(닉네임·원문·사진 주소)를 탭으로 보여줘요. 글은 React 기본 이스케이프로만 그리고, 사진은 http/https 주소만 들어와요.
export default function ReviewTab({ reviews, onClear }) {
  const [tab, setTab] = useState('text')
  if (!reviews?.length) return null
  const withPhotos = reviews.filter((r) => r.photos?.length)

  function onKey(e, i) {
    const n = TABS.length
    const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }[e.key]
    if (next == null) return
    e.preventDefault()
    setTab(TABS[next].id)
    document.getElementById(`rt-tab-${TABS[next].id}`)?.focus()
  }

  return (
    <div className="rt">
      <div className="rt-tabs" role="tablist" aria-label="저장한 리뷰">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            id={`rt-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            className={`rt-tab ${tab === t.id ? 'on' : ''}`}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="rt-panel" role="tabpanel" aria-labelledby={`rt-tab-${tab}`}>
        {tab === 'text' ? (
          <ul className="rt-list">
            {reviews.map((r, i) => (
              <li key={i} className="rt-review">
                <div className="rt-meta small">
                  {r.nick && <strong>{r.nick}</strong>}
                  {r.height != null && r.weight != null && <span>{r.height}cm {r.weight}kg</span>}
                  {r.size && <span>구매 {r.size}</span>}
                  {r.fitLabel && <span>{r.fitLabel}</span>}
                  {r.similarity != null && <span>유사도 {r.similarity}</span>}
                </div>
                {r.text && <p className="rt-text">{r.text}</p>}
                {r.photos?.length > 0 && (
                  <div className="rt-thumbs">
                    {r.photos.map((u) => <img key={u} src={u} alt="리뷰 사진" loading="lazy" referrerPolicy="no-referrer" />)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : withPhotos.length === 0 ? (
          <p className="muted small">저장된 리뷰에 사진이 없어요.</p>
        ) : (
          <div className="rt-gallery">
            {withPhotos.map((r, i) => (
              <figure key={i} className="rt-fig">
                {r.photos.map((u) => <img key={u} src={u} alt="리뷰 사진" loading="lazy" referrerPolicy="no-referrer" />)}
                <figcaption className="muted small">{[r.nick || '구매자', r.size].filter(Boolean).join(' · ')}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
      <p className="muted small">닉네임·리뷰 원문·사진 주소는 이 브라우저에만 저장돼요. 사진은 쇼핑몰 주소에서 불러와요.</p>
      {onClear && <button type="button" className="btn text danger" onClick={onClear}>리뷰만 지우기</button>}
    </div>
  )
}
