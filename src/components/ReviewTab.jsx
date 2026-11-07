import { useEffect, useRef, useState } from 'react'

const TABS = [
  { id: 'text', label: '리뷰 원문' },
  { id: 'photo', label: '사진 모아보기' },
]

const isHttps = (u) => /^https:\/\//i.test(u || '')

// 사진 확대 보기: 닫기 버튼·바깥 클릭·Esc로 닫고, 여러 장이면 이전/다음 버튼과 좌우 화살표로 넘겨요. https 주소만 열어요.
function Zoom({ urls, start, onClose }) {
  const [i, setI] = useState(start)
  const closeRef = useRef(null)
  const n = urls.length
  useEffect(() => { closeRef.current?.focus() }, [])
  const go = (d) => setI((x) => (x + d + n) % n)
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowLeft' && n > 1) { e.preventDefault(); go(-1) }
    else if (e.key === 'ArrowRight' && n > 1) { e.preventDefault(); go(1) }
  }
  return (
    <div className="rt-zoom" role="dialog" aria-modal="true" aria-label="사진 확대" onKeyDown={onKey} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <img src={urls[i]} alt="확대한 리뷰 사진" referrerPolicy="no-referrer" />
      <button ref={closeRef} type="button" className="rt-zbtn rt-zx" aria-label="닫기" onClick={onClose}>✕</button>
      {n > 1 && (
        <>
          <button type="button" className="rt-zbtn rt-zp" aria-label="이전 사진" onClick={() => go(-1)}>‹</button>
          <button type="button" className="rt-zbtn rt-zn" aria-label="다음 사진" onClick={() => go(1)}>›</button>
          <span className="rt-zc">{i + 1} / {n}</span>
        </>
      )}
    </div>
  )
}

// 옷장에 저장된 리뷰(닉네임·원문·사진 주소)를 탭으로 보여줘요. 글은 React 기본 이스케이프로만 그리고, 사진은 http/https 주소만 들어와요.
export default function ReviewTab({ reviews, onClear }) {
  const [tab, setTab] = useState('text')
  const [zoom, setZoom] = useState(null)
  const openerRef = useRef(null)
  if (!reviews?.length) return null
  const withPhotos = reviews.filter((r) => r.photos?.length)

  function closeZoom() {
    setZoom(null)
    openerRef.current?.focus()
  }

  // 작은 사진 하나: https면 눌러서 확대할 수 있어요 (키보드는 Enter/Space).
  function photo(urls, k) {
    const u = urls[k]
    if (!isHttps(u)) return <img key={`${k}-${u}`} src={u} alt="리뷰 사진" loading="lazy" referrerPolicy="no-referrer" />
    const https = urls.filter(isHttps)
    return (
      <button
        key={`${k}-${u}`}
        type="button"
        className="rt-photo"
        aria-label="리뷰 사진 확대"
        onClick={(e) => { openerRef.current = e.currentTarget; setZoom({ urls: https, start: https.indexOf(u) }) }}
      >
        <img src={u} alt="리뷰 사진" loading="lazy" referrerPolicy="no-referrer" />
      </button>
    )
  }

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
            aria-controls="rt-panel"
            tabIndex={tab === t.id ? 0 : -1}
            className={`rt-tab ${tab === t.id ? 'on' : ''}`}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="rt-panel" className="rt-panel" role="tabpanel" tabIndex={0} aria-labelledby={`rt-tab-${tab}`}>
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
                    {r.photos.map((u, k) => photo(r.photos, k))}
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
                {r.photos.map((u, k) => photo(r.photos, k))}
                <figcaption className="muted small">{[r.nick || '구매자', r.size].filter(Boolean).join(' · ')}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
      {zoom && <Zoom urls={zoom.urls} start={zoom.start} onClose={closeZoom} />}
      <p className="muted small">닉네임·리뷰 원문·사진 주소는 이 브라우저에만 저장돼요. 사진은 쇼핑몰 주소에서 불러와요.</p>
      {onClear && <button type="button" className="btn text danger" onClick={onClear}>리뷰만 지우기</button>}
    </div>
  )
}
