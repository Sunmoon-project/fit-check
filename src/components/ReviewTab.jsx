import { useEffect, useRef, useState } from 'react'

const TABS = [
  { id: 'text', label: '리뷰 원문' },
  { id: 'photo', label: '사진 모아보기' },
]

const isHttps = (u) => /^https:\/\//i.test(u || '')

// 사진 확대 보기: 닫기 버튼·바깥 클릭·Esc로 닫고, 여러 장이면 이전/다음 버튼·좌우 화살표·좌우로 밀기·아래 썸네일로 넘겨요.
// caps가 있으면 사진마다 작성자 체형을 함께 보여줘요. https 주소만 열어요.
function Zoom({ urls, caps, start, onClose }) {
  const [i, setI] = useState(start)
  const [dir, setDir] = useState(0)
  const closeRef = useRef(null)
  const stripRef = useRef(null)
  const sx = useRef(null)
  const n = urls.length
  useEffect(() => { closeRef.current?.focus() }, [])
  useEffect(() => {
    stripRef.current?.children[i]?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [i])
  const go = (d) => { setDir(d); setI((x) => (x + d + n) % n) }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowLeft' && n > 1) { e.preventDefault(); go(-1) }
    else if (e.key === 'ArrowRight' && n > 1) { e.preventDefault(); go(1) }
  }
  return (
    <div className="rt-zoom" role="dialog" aria-modal="true" aria-label="사진 확대" onKeyDown={onKey} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <img
        key={i}
        className={dir < 0 ? 'from-left' : dir > 0 ? 'from-right' : ''}
        src={urls[i]}
        alt="확대한 리뷰 사진"
        referrerPolicy="no-referrer"
        draggable={false}
        onPointerDown={(e) => { sx.current = e.clientX }}
        onPointerUp={(e) => {
          if (sx.current == null || n < 2) return
          const dx = e.clientX - sx.current
          sx.current = null
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1)
        }}
      />
      <div className="rt-zcap">
        {caps?.[i] && <span>{caps[i]}</span>}
        {n > 1 && <span className="rt-zc">{i + 1} / {n}</span>}
      </div>
      <button ref={closeRef} type="button" className="rt-zbtn rt-zx" aria-label="닫기" onClick={onClose}>✕</button>
      {n > 1 && (
        <>
          <button type="button" className="rt-zbtn rt-zp" aria-label="이전 사진" onClick={() => go(-1)}>‹</button>
          <button type="button" className="rt-zbtn rt-zn" aria-label="다음 사진" onClick={() => go(1)}>›</button>
          <div className="rt-zstrip" ref={stripRef}>
            {urls.map((u, k) => (
              <button key={`${k}-${u}`} type="button" className={`rt-zt ${k === i ? 'on' : ''}`} aria-label={`${k + 1}번째 사진`} aria-current={k === i} onClick={() => { setDir(k > i ? 1 : -1); setI(k) }}>
                <img src={u} alt="" loading="lazy" referrerPolicy="no-referrer" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const capOf = (r) => [r.nick || '구매자', r.height != null && r.weight != null ? `${r.height}cm ${r.weight}kg` : null, r.size].filter(Boolean).join(' · ')

// 옷장에 저장된 리뷰(닉네임·원문·사진 주소)를 탭으로 보여줘요. 글은 React 기본 이스케이프로만 그리고, 사진은 http/https 주소만 들어와요.
export default function ReviewTab({ reviews, onClear }) {
  const [tab, setTab] = useState('text')
  const [zoom, setZoom] = useState(null)
  const openerRef = useRef(null)
  if (!reviews?.length) return null
  const withPhotos = reviews.filter((r) => r.photos?.length)
  // 사진 모아보기: https 사진만 한 줄로 모아 격자로 보여주고, 확대하면 전체를 넘겨 봐요 (리뷰당 5장까지).
  const allPhotos = withPhotos.flatMap((r) => r.photos.filter(isHttps).slice(0, 5).map((url) => ({ url, cap: capOf(r) })))

  function closeZoom() {
    setZoom(null)
    openerRef.current?.focus()
  }

  // 작은 사진 하나: https면 눌러서 확대할 수 있어요 (키보드는 Enter/Space).
  function photo(urls, k, cap = '') {
    const u = urls[k]
    if (!isHttps(u)) return <img key={`${k}-${u}`} src={u} alt="리뷰 사진" loading="lazy" referrerPolicy="no-referrer" />
    const https = urls.filter(isHttps)
    return (
      <button
        key={`${k}-${u}`}
        type="button"
        className="rt-photo"
        aria-label="리뷰 사진 확대"
        onClick={(e) => { openerRef.current = e.currentTarget; setZoom({ urls: https, caps: https.map(() => cap), start: https.indexOf(u) }) }}
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
                    {r.photos.map((u, k) => photo(r.photos, k, capOf(r)))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : allPhotos.length === 0 ? (
          <p className="muted small">저장된 리뷰에 사진이 없어요.</p>
        ) : (
          <div className="rt-gallery">
            {allPhotos.map((p, k) => (
              <figure key={`${k}-${p.url}`} className="rt-fig" style={{ animationDelay: `${Math.min(k, 12) * 30}ms` }}>
                <button
                  type="button"
                  className="rt-photo"
                  aria-label="리뷰 사진 확대"
                  onClick={(e) => { openerRef.current = e.currentTarget; setZoom({ urls: allPhotos.map((x) => x.url), caps: allPhotos.map((x) => x.cap), start: k }) }}
                >
                  <img src={p.url} alt="리뷰 사진" loading="lazy" referrerPolicy="no-referrer" />
                </button>
                <figcaption>{p.cap}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
      {zoom && <Zoom urls={zoom.urls} caps={zoom.caps} start={zoom.start} onClose={closeZoom} />}
      <p className="muted small">닉네임·리뷰 원문·사진 주소는 이 브라우저에만 저장돼요. 사진은 쇼핑몰 주소에서 불러와요.</p>
      {onClear && <button type="button" className="btn text danger" onClick={onClear}>리뷰만 지우기</button>}
    </div>
  )
}
