import { useState } from 'react'
import { CATEGORY_LABEL } from '../data/measurements.js'
import { TARGET_GENDER_LABEL } from '../lib/targetGender.js'
import { SIZE_CHART_DB_STORAGE_NOTE } from '../lib/sizeChartDb.js'

// 사이즈표 모음: 분석한 상품의 사이즈표 목록과 브랜드·모델명·품번 검색, 비우기. 이 브라우저에만 저장돼요.
// db는 createSizeChartDb()가 돌려준 객체(list/search/clear)예요. initialEntries는 첫 화면 목록이고, 이후는 db에서 다시 읽어요.
export default function SizeChartLibrary({ db, initialEntries = [], onBack, onChanged }) {
  const [entries, setEntries] = useState(initialEntries)
  const [q, setQ] = useState({ brand: '', model: '', code: '' })
  const [results, setResults] = useState(null) // null이면 목록 보기, 배열이면 검색 결과
  const [msg, setMsg] = useState('')

  async function search(e) {
    e.preventDefault()
    if (!q.brand.trim() && !q.model.trim() && !q.code.trim()) {
      setResults(null)
      return
    }
    setResults(await db.search(q))
  }

  async function clearAll() {
    await db.clear()
    setEntries([])
    setResults(null)
    setMsg('저장된 사이즈표를 모두 지웠어요.')
    onChanged?.(0)
  }

  const rows = results ?? entries.map((entry) => ({ entry }))
  return (
    <section className="card chart-library" aria-labelledby="chart-library-title">
      <div className="section-head">
        <h2 id="chart-library-title">사이즈표 모음 {entries.length}</h2>
        <button type="button" className="btn text" onClick={onBack}>돌아가기</button>
      </div>
      <p className="muted small">상품을 분석할 때 읽은 사이즈표를 브랜드·품번·모델명과 함께 저장해요. 후기와 체형 정보는 저장하지 않아요. {SIZE_CHART_DB_STORAGE_NOTE}</p>
      <form className="url-form" onSubmit={search} role="search">
        <input type="text" aria-label="브랜드" placeholder="브랜드 (예: 나이키, nike)" value={q.brand} onChange={(e) => setQ({ ...q, brand: e.target.value })} />
        <input type="text" aria-label="모델명" placeholder="모델명" value={q.model} onChange={(e) => setQ({ ...q, model: e.target.value })} />
        <input type="text" aria-label="품번" placeholder="품번" value={q.code} onChange={(e) => setQ({ ...q, code: e.target.value })} />
        <button type="submit" className="btn primary">검색</button>
      </form>
      {msg && <p className="small" role="status">{msg}</p>}
      {results && results.length === 0 && <p className="muted small">비슷한 사이즈표를 찾지 못했어요.</p>}
      {!results && entries.length === 0 && <p className="muted small">아직 저장된 사이즈표가 없어요. 상품을 분석하면 사이즈표를 읽은 경우에만 저장돼요.</p>}
      <ul className="chart-library-list">
        {rows.map(({ entry, score, reasons }) => (
          <li key={entry.id}>
            <strong>{entry.model || entry.url}</strong>
            <span className="muted small">
              {[entry.brand, entry.code, CATEGORY_LABEL[entry.category], TARGET_GENDER_LABEL[entry.gender]].filter(Boolean).join(' · ')}
              {` · 사이즈 ${Object.keys(entry.sizeChart.measures).length || entry.sizeChart.rows.length}개`}
            </span>
            {score != null && <span className="small"> 점수 {score}: {reasons.join(', ')}</span>}
          </li>
        ))}
      </ul>
      <button type="button" className="btn text danger" onClick={clearAll} disabled={entries.length === 0}>사이즈표 모음 비우기</button>
    </section>
  )
}
