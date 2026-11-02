import { useState } from 'react'
import { SAMPLE_URLS, PRODUCTS, findProductByUrl } from '../data/mockData.js'
import { CATEGORY_LABEL } from '../data/measurements.js'

// 다른 쇼핑몰 상품 링크를 붙여넣으면 서버(/api/product)가 페이지를 읽어 상품·사이즈표·리뷰를 가져옵니다.
// 데모 상품은 서버 없이 바로 열려요.
export default function UrlInput({ onProduct }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function load(input) {
    const raw = (input || '').trim()
    if (!raw) {
      setError('상품 페이지 주소를 붙여넣어 주세요.')
      return
    }
    setError('')
    const mock = findProductByUrl(raw)
    if (mock) {
      onProduct({ ...mock, source: 'demo', notes: mock.notes || [] })
      return
    }
    const target = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    try {
      new URL(target)
    } catch {
      setError('주소 형식이 올바르지 않아요.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.product) {
        setError(data?.message || '상품 정보를 가져오지 못했어요. 개발 서버(npm run dev)에서 실행 중인지 확인해주세요.')
        return
      }
      onProduct({ ...data.product, notes: data.product.notes || [] })
    } catch {
      setError('서버에 연결하지 못했어요. 네트워크 상태를 확인해주세요.')
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    load(url)
  }

  return (
    <section className="product-step">
      <h2 className="q-title">어떤 옷이 궁금하세요?</h2>
      <p className="muted">
        다른 쇼핑몰의 상품 링크를 붙여넣으면 그 페이지의 사이즈표와 리뷰를 모아 내 체형에 맞는 사이즈를 알려드려요.
      </p>

      <form onSubmit={handleSubmit} className="url-form">
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https:// 상품 페이지 주소"
          aria-label="상품 링크"
          disabled={loading}
        />
        <button type="submit" className="btn primary" disabled={loading}>
          {loading ? '불러오는 중…' : '가져오기'}
        </button>
      </form>
      {loading && <p className="muted small">페이지를 읽고 있어요. 사이트에 따라 몇 초 걸릴 수 있어요.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted small">
        리뷰를 화면에서 따로 불러오는 사이트는 리뷰나 사이즈표를 못 읽을 수 있어요. 그래도 읽은 정보로 최대한 추천해드려요.
      </p>

      <div className="samples">
        <h3 className="section-title">데모 상품으로 체험하기</h3>
        <div className="sample-list">
          {SAMPLE_URLS.map((u) => {
            const p = PRODUCTS[u]
            return (
              <button
                key={u}
                type="button"
                className="sample-card"
                disabled={loading}
                onClick={() => {
                  setUrl(u)
                  load(u)
                }}
              >
                <span className="sample-emoji" aria-hidden>{p.emoji}</span>
                <span className="sample-meta">
                  <span className="muted small">{p.mall} · {CATEGORY_LABEL[p.category]}</span>
                  <strong>{p.name}</strong>
                  <span className="small">{p.price}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
