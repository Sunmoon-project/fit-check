import { generateFitComment } from '../lib/fitEngine.js'
import FitComment from './FitComment.jsx'
import MatchedReviews from './MatchedReviews.jsx'
import VirtualFitting from './VirtualFitting.jsx'
import SizeChart from './SizeChart.jsx'
import MeasureMatch from './MeasureMatch.jsx'

export default function ResultView({ product, profile, onRestart }) {
  const result = generateFitComment(profile, product)

  return (
    <section className="result">
      <div className="product-head card">
        <span className="product-emoji" aria-hidden>{product.emoji}</span>
        <div className="product-info">
          <span className="muted small">{product.mall}</span>
          <h2>{product.name}</h2>
          <span className="price">{product.price}</span>
        </div>
        <button className="btn ghost" onClick={onRestart}>다시 검색</button>
      </div>

      {/* 기능 ③ */}
      <FitComment result={result} />

      <div className="result-grid">
        {/* 기능 ② */}
        <MatchedReviews matched={result.matched} />
        <div className="result-col">
          {/* 상세 치수 대조 (입력한 경우에만) */}
          {result.measureResult && profile.measurements && (
            <MeasureMatch product={product} profile={profile} measureResult={result.measureResult} />
          )}
          {/* 사이즈표 대조 */}
          <SizeChart chart={product.sizeChart} recommendedSize={result.recommendedSize} />
          {/* 기능 ④ */}
          <VirtualFitting product={product} profile={profile} />
        </div>
      </div>
    </section>
  )
}
