import { useState } from 'react'
import { SAMPLE_URLS, PRODUCTS } from '../data/mockData.js'

// 기능 외: "어느 쇼핑몰이든 링크 하나로" 차별점을 보여주는 진입 화면
export default function UrlInput({ onSubmit }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    const result = onSubmit(url)
    if (!result) {
      setError('아직 지원하지 않는 주소예요. 아래 상품으로 먼저 체험해 보세요.')
    } else {
      setError('')
    }
  }

  return (
    <section className="card hero">
      <h2 className="step-title">상품 링크로 내 사이즈 찾기</h2>
      <p className="muted">
        어느 쇼핑몰이든 상품 주소만 붙여넣으면 돼요. 내 체형에 맞는 사이즈를 찾아드립니다.
      </p>

      <form onSubmit={handleSubmit} className="url-form">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="상품 페이지 주소 붙여넣기"
          aria-label="상품 링크"
        />
        <button type="submit" className="btn primary">
          사이즈 찾기
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="samples">
        <span className="muted small">바로 체험하기</span>
        <div className="sample-list">
          {SAMPLE_URLS.map((u) => {
            const p = PRODUCTS[u]
            return (
              <button
                key={u}
                type="button"
                className="sample-chip"
                onClick={() => {
                  setUrl(u)
                  setError('')
                  onSubmit(u)
                }}
              >
                <span className="sample-emoji" aria-hidden>{p.emoji}</span>
                <span className="sample-meta">
                  <strong>{p.name}</strong>
                  <span className="muted small">{p.mall}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
