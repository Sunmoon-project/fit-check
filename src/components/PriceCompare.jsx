// 가격 비교 탭: 같은 옷의 쇼핑몰별 정가·판매가·쿠폰/혜택가를 모아 최대 할인가가 가장 싼 곳을 알려줘요.
// 가격은 (1) 붙여넣은 상품 주소를 서버(/api/product)가 읽은 값, (2) 확장에서 옷장으로 보낸 상품의 가격(본 시점)이에요.
// 카드·간편결제 할인, 적립금처럼 조건이 붙은 혜택은 빼고 비교해요.
import { useMemo, useState } from 'react'
import { priceEntryOf, comparePrices, rankPrices, isSameItem, searchLinks, won } from '../lib/priceInfo.js'
import { NO_SERVER } from '../lib/runtime.js'

const MAX_URLS = 6
const MALL_LABEL = { 'musinsa.com': '무신사', '29cm.co.kr': '29CM', 'wconcept.co.kr': 'W컨셉', 'arcteryx.co.kr': '아크테릭스' }
const mallName = (m) => MALL_LABEL[m] || m

function PriceRows({ rows }) {
  if (!rows.length) return null
  const cheap = rows.find((r) => r.cheapest)
  return (
    <>
      {cheap && <p className="pc-verdict"><b>{mallName(cheap.mall)}</b>가 가장 싸요 · {won(cheap.prices.best)}</p>}
      <ul className="pc-list">
        {rows.map((r) => (
          <li key={r.url} className={r.cheapest ? 'cheap' : ''}>
            <div className="pc-mall">
              <a href={r.url} target="_blank" rel="noopener noreferrer">{mallName(r.mall)}</a>
              {r.cheapest && <span className="pc-badge">최저</span>}
              <span className="muted small pc-name">{r.name}</span>
            </div>
            <div className="pc-price">
              <strong>{won(r.prices.best)}</strong>
              {r.prices.list && <del className="muted small">{won(r.prices.list)}</del>}
            </div>
            <div className="pc-detail muted small">
              {[r.prices.sale && `판매가 ${won(r.prices.sale)}`, r.prices.coupon && `쿠폰·혜택가 ${won(r.prices.coupon)}`, r.prices.first && `첫 구매가 ${won(r.prices.first)}`, r.diff > 0 && `최저보다 +${won(r.diff)}`].filter(Boolean).join(' · ')}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

export default function PriceCompare({ wardrobe = [], onBack }) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState([])
  const [errors, setErrors] = useState([])
  const [loading, setLoading] = useState(false)

  // 확장에서 보낸 옷장 항목 중 가격이 있는 것끼리 같은 상품으로 묶어요.
  const groups = useMemo(() => {
    const entries = wardrobe
      .filter((w) => w.prices?.best && w.product?.url)
      .map((w) => ({ ...priceEntryOf({ name: w.product.name, url: w.product.url, image: w.product.image }, w.prices, { now: w.priceSeenAt || w.savedAt }) }))
      .filter((e) => e.url)
    const used = new Set()
    const out = []
    for (const e of entries) {
      if (used.has(e.url)) continue
      const g = comparePrices(e, entries)
      g.forEach((x) => used.add(x.url))
      out.push(g)
    }
    return out
  }, [wardrobe])

  async function compare() {
    const urls = [...new Set(text.split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)))].slice(0, MAX_URLS)
    if (!urls.length) return setErrors(['상품 주소를 한 줄에 하나씩 붙여넣어 주세요.'])
    if (NO_SERVER) return setErrors(['파일로 연 화면에서는 주소를 읽을 수 없어요. npm run dev로 실행해 주세요.'])
    setLoading(true)
    setErrors([])
    const got = []
    const errs = []
    for (const url of urls) {
      try {
        const res = await fetch('/api/product', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
        const data = await res.json().catch(() => null)
        const e = data?.product?.prices ? priceEntryOf(data.product, data.product.prices, { pageUrl: url }) : null
        if (e) got.push(e)
        else errs.push(`${url.slice(0, 60)} — ${data?.message || '가격을 읽지 못했어요. 화면을 스크립트로 그리는 쇼핑몰(W컨셉 등)은 확장 프로그램으로 확인해 주세요.'}`)
      } catch {
        errs.push(`${url.slice(0, 60)} — 서버에 연결하지 못했어요.`)
      }
    }
    setLoading(false)
    setErrors(errs)
    setRows(rankPrices(got, got[0]))
  }

  const notSame = rows.length > 1 && rows.some((r) => !r.current && !isSameItem(rows.find((x) => x.current), r))
  const first = rows.find((r) => r.current)
  return (
    <section className="price-compare">
      <div className="section-head">
        <h2>가격 비교</h2>
        <button type="button" className="btn text" onClick={onBack}>닫기</button>
      </div>
      <p className="muted small">같은 옷을 파는 쇼핑몰 주소를 붙여넣으면 정가·판매가·쿠폰가를 읽어 최대 할인가가 가장 싼 곳을 알려줘요. 카드·간편결제 할인과 적립금은 빼고 비교해요.</p>
      <div className="card">
        <textarea className="pc-input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={'https://www.musinsa.com/products/...\nhttps://www.29cm.co.kr/products/...'} aria-label="비교할 상품 주소" />
        <button type="button" className="btn primary" disabled={loading} onClick={compare}>{loading ? '가격 읽는 중…' : '가격 비교하기'}</button>
        {errors.map((e) => <p key={e} className="small error">{e}</p>)}
        {notSame && <p className="small bs-warn">상품명이 많이 달라 같은 상품이 아닐 수 있어요. 색상·옵션이 같은지 확인해 주세요.</p>}
        <PriceRows rows={rows} />
        {rows.length > 0 && <p className="muted small">주소로 읽은 가격은 페이지를 처음 받았을 때 값이라 타임특가처럼 화면에서 바뀌는 가격과 다를 수 있어요. 확장 프로그램으로 본 가격이 더 정확해요.</p>}
        {first && (
          <div className="pc-links">
            <span className="muted small">다른 쇼핑몰에서 찾아보기</span>
            {searchLinks(first.name, first.mall).map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="chip small">{l.label}</a>)}
          </div>
        )}
      </div>

      <h3 className="pc-sub">확장에서 본 가격</h3>
      {groups.length === 0 ? (
        <p className="muted small">확장 프로그램에서 상품을 분석하고 '내 옷장으로 보내기'를 누르면 그때 본 가격이 여기에 모여요. 같은 상품을 여러 쇼핑몰에서 보내면 함께 비교해요.</p>
      ) : (
        groups.map((g) => (
          <div key={g[0].url} className="card">
            <p className="small"><b>{g[0].name}</b> · {g.length}곳</p>
            <PriceRows rows={g} />
          </div>
        ))
      )}
      <p className="muted small">본 시점의 가격이라 지금은 다를 수 있어요.</p>
    </section>
  )
}
