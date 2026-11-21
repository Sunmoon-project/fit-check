import { useState } from 'react'
import { findProductByUrl } from '../data/mockData.js'
import { Thumb, VerdictLine } from './Wardrobe.jsx'
import { CATEGORY_LABEL } from '../data/measurements.js'
import { NO_SERVER, apiUrl } from '../lib/runtime.js'

// 다른 쇼핑몰 상품 링크를 붙여넣으면 서버(/api/product)가 페이지를 읽어 상품·사이즈표·리뷰를 가져옵니다.
// 아래 '최근 담은 옷'은 옷장에 담은 옷 중 최근 것이고, 누르면 그 상품을 다시 분석해요.
export default function UrlInput({ onProduct, recent = [] }) {
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
    if (NO_SERVER) {
      setError('지금은 상품 링크를 읽을 수 없어요. 잠시 후 다시 시도해 주세요.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(apiUrl('/api/product'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.product) {
        setError(data?.message || '상품 정보를 가져오지 못했어요. 주소가 상품 페이지가 맞는지 확인해 주세요.')
        return
      }
      onProduct({ ...data.product, notes: data.product.notes || [] })
    } catch {
      setError('연결하지 못했어요. 인터넷 연결을 확인해 주세요.')
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
        사고 싶은 옷의 상품 페이지 주소를 붙여넣으면, 그 페이지의 사이즈표와 후기를 읽어 내 체형에 맞는 사이즈를 알려드려요.
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
          {loading ? '읽는 중…' : '사이즈 확인하기'}
        </button>
      </form>
      {loading && <p className="muted small">페이지를 읽고 있어요. 사이트에 따라 몇 초 걸릴 수 있어요.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted small">
        주소는 쇼핑몰 상품 페이지에서 ‘공유’ → ‘링크 복사’로 가져올 수 있어요. 사이트에 따라 후기나 사이즈표를 다 읽지 못할 수 있지만, 읽은 정보로 최대한 추천해드려요.
      </p>

      <div className="recent">
        <h3 className="section-title">최근 담은 옷</h3>
        {recent.length === 0 ? (
          <p className="recent-empty muted small">아직 담은 옷이 없어요. 사이즈를 확인한 뒤 ‘옷장에 담기’를 누르면 여기에 모여요.</p>
        ) : (
          <div className="recent-list">
            {recent.map((w) => (
              <button key={w.id} type="button" className="recent-item" disabled={loading} onClick={() => { setUrl(w.product.url || ''); load(w.product.url) }}>
                <span className="recent-thumb"><Thumb item={w} /></span>
                <span className="recent-meta">
                  <strong>{w.product.name}</strong>
                  <span className="muted small">{[w.product.mall, CATEGORY_LABEL[w.product.category], w.size].filter(Boolean).join(' · ')}</span>
                  <VerdictLine verdicts={w.verdicts} item={w} />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
