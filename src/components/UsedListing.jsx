import { useState } from 'react'
import { analyzeUsedListing, findChartMatches, usedSearchQuery } from '../lib/usedAnalyze.js'
import { USED_SITES, USED_SITES_NOTE } from '../lib/usedListing.js'
import { IMAGE_SEARCH_DISABLED_TEXT, IMAGE_SEARCH_NOTICE } from '../lib/imageSearch.js'
import { LABEL_OCR_DISABLED_TEXT } from '../lib/labelOcr.js'

// 중고 상품 분석: 번개장터·후르츠패밀리 같은 중고 판매글을 붙여넣으면 후기 없이 작음/맞음/큼을 알려줘요.
// 판매글 글은 이 브라우저 안에서만 분석하고 저장하지 않아요. 사진 역검색은 서버가 켜져 있을 때만 쓸 수 있고,
// 사용자가 동의 체크 후 '사진으로 찾기'를 눌렀을 때만 사진 주소 한 장이 외부 검색 서비스로 전송돼요(분석하기 버튼으로는 호출하지 않아요).
// 라벨 글자 인식은 아직 연결되지 않았어요.
// db: createSizeChartDb() 결과(search), imageSearcher: createImageSearcher() 결과. initialResult는 화면 테스트용이에요.
export default function UsedListing({ profile, db, imageSearcher, onBack, initialResult = null, initialPhoto = null }) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState('')
  const [result, setResult] = useState(initialResult)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const photoEnabled = !!imageSearcher?.enabled
  const [consent, setConsent] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoResult, setPhotoResult] = useState(initialPhoto) // { status, candidates, pages, message }
  const firstUrl = photos.split(/\s+/).find((u) => /^https:\/\//i.test(u)) || ''

  // 사용자가 '사진으로 찾기'를 눌렀을 때만 호출해요. 동의 체크가 없으면 호출하지 않아요.
  async function findByPhoto() {
    if (!photoEnabled || !consent || !firstUrl) return
    setPhotoBusy(true)
    try {
      setPhotoResult(await imageSearcher.search([firstUrl]))
    } finally {
      setPhotoBusy(false)
    }
  }

  async function analyze(e) {
    e.preventDefault()
    if (!title.trim() && !text.trim()) {
      setMsg('판매글 제목이나 본문을 붙여넣어 주세요.')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const urls = photos.split(/\s+/).filter(Boolean)
      const listing = { title: title.trim(), text: [title.trim(), text.trim()].filter(Boolean).join('\n'), photos: urls.filter((u) => /^https:\/\//i.test(u)).slice(0, 5) }
      const candidates = photoResult?.status === 'ok' ? photoResult.candidates : [] // 이미 찾은 후보만 써요(여기서 새로 호출하지 않아요)
      const matches = db ? await findChartMatches(db, usedSearchQuery(listing), candidates) : []
      setResult(analyzeUsedListing(listing, profile, { chartMatches: matches }))
    } catch {
      setMsg('분석 중 문제가 생겼어요. 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card used-listing" aria-labelledby="used-title">
      <div className="section-head">
        <h2 id="used-title">중고 상품 분석</h2>
        <button type="button" className="btn text" onClick={onBack}>돌아가기</button>
      </div>
      <p className="muted small">
        {USED_SITES.map((s) => s.name).join('·')} 같은 중고 판매글의 제목과 본문을 붙여넣으면, 후기 없이 판매글에 적힌 실측과 사이즈 표기로 내 체형에 맞을지 알려드려요.
      </p>
      <p className="muted small">{USED_SITES_NOTE}</p>
      <form onSubmit={analyze} className="used-form">
        <input type="text" aria-label="판매글 제목" placeholder="판매글 제목 (예: [L] 나이키 후드티)" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        <textarea aria-label="판매글 본문" rows={7} placeholder={'판매글 본문을 붙여넣으세요.\n예) 가슴단면 55 총장 70 어깨 47 소매 60'} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
        <div className="used-photo">
          <h3 className="section-title">사진으로 같은 상품 찾기 (사진 역검색)</h3>
          <textarea aria-label="사진 주소" rows={2} placeholder="https:// 사진 주소 (줄마다 하나)" value={photos} onChange={(e) => setPhotos(e.target.value)} disabled={busy || !photoEnabled} />
          {!photoEnabled && <p className="muted small">{IMAGE_SEARCH_DISABLED_TEXT}</p>}
          {!photoEnabled && <p className="muted small">서버 설정(IMAGE_SEARCH_PROVIDER, IMAGE_SEARCH_API_KEY)이 있고 웹 서버로 열었을 때 켜져요. 아직 실제 검색 서비스로 확인하지 못한 기능이에요.</p>}
          <label className="used-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy || photoBusy || !photoEnabled} />
            <span>{IMAGE_SEARCH_NOTICE} 동의하고 사진 한 장으로 검색할게요.</span>
          </label>
          <button type="button" className="btn" onClick={findByPhoto} disabled={busy || photoBusy || !photoEnabled || !consent || !firstUrl}>{photoBusy ? '찾는 중…' : '사진으로 찾기'}</button>
          {photoResult && <PhotoResult result={photoResult} />}
          <p className="muted small">{LABEL_OCR_DISABLED_TEXT}</p>
        </div>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? '분석 중…' : '분석하기'}</button>
      </form>
      {msg && <p className="error" role="alert">{msg}</p>}
      {result && <UsedResult result={result} />}
    </section>
  )
}

function PhotoResult({ result: r }) {
  if (r.status !== 'ok') return <p className="error" role="alert">{r.message || '사진 검색에 실패했어요.'}</p>
  return (
    <div className="used-photo-result" role="region" aria-label="사진 역검색 결과">
      {r.candidates.length ? <p className="small">같은 상품 후보: {r.candidates.map((c) => [c.brand, c.model].filter(Boolean).join(' ')).join(' · ')}</p> : <p className="small">같은 상품 후보를 찾지 못했어요.</p>}
      <p className="muted small">후보는 추정이에요. 브랜드·모델명은 사이즈표 모음 검색과 지역 기본값에만 쓰여요.</p>
      {r.pages?.length > 0 && (
        <ul className="small">
          {r.pages.map((p, i) => <li key={i}><a href={p.url} target="_blank" rel="noopener noreferrer">{p.title}</a></li>)}
        </ul>
      )}
    </div>
  )
}

function UsedResult({ result: r }) {
  return (
    <div className="used-result" role="region" aria-label="중고 상품 분석 결과">
      <div className="row">
        <span className="eyebrow">{[r.site?.name, r.categoryLabel].filter(Boolean).join(' · ') || '중고 판매글'}</span>
        <span className="badge" style={{ color: r.confidenceLabel.color }}>{r.confidenceLabel.text}</span>
      </div>
      <div className="size">{r.verdictLabel || '판정 어려움'}</div>
      <p><strong>{r.headline}</strong></p>
      <p className="small">근거: {r.basisLabel}{r.approx ? ' (근사/추정)' : ''}</p>
      {r.perSize?.length > 0 && <p className="small">사이즈별: {r.perSize.map((p) => `${p.size} ${p.label}`).join(' · ')}</p>}
      <p className="muted small">{r.noReviewNote}</p>
      <p className="muted small">{r.disclaimer}</p>
      <h3 className="section-title">추천 이유</h3>
      <ul>{r.reasons.map((t, i) => <li key={i}>{t}</li>)}</ul>
      <h3 className="section-title">추천에 쓰인 근거 (자세히)</h3>
      <ul>{r.details.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  )
}
