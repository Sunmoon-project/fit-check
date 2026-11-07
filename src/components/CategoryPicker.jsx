import { CATEGORY_LABEL } from '../data/measurements.js'

// 자동 분류가 확실하지 않을 때(신뢰도 보통·낮음) 카테고리를 직접 고르는 칩. 고르면 그 카테고리로 다시 분석해요.
export default function CategoryPicker({ product, onPick }) {
  const level = product.categoryConfidence
  if (!level || (level === 'high' && !product.categoryOverridden)) return null
  const keys = (product.categoryCandidates?.length ? product.categoryCandidates : Object.keys(CATEGORY_LABEL)).filter((k) => CATEGORY_LABEL[k])
  return (
    <div className="category-picker">
      <p className="muted small">
        {product.categoryOverridden ? '직접 고른 종류예요.' : '옷 종류를 자동으로 정했지만 확실하지 않아요. 맞는 종류를 눌러 주세요.'}
      </p>
      <div className="chip-row" role="group" aria-label="옷 종류 선택">
        {keys.map((k) => (
          <button key={k} type="button" className={`chip small${product.category === k ? ' active' : ''}`} aria-pressed={product.category === k} onClick={() => onPick(k)}>
            {CATEGORY_LABEL[k]}
          </button>
        ))}
      </div>
      {product.categoryNotice && (
        <p className="muted small category-notice" role="status">
          {product.categoryNotice.message}{' '}
          <button type="button" className="chip small" onClick={() => onPick(product.categoryNotice.actionCategory)}>{product.categoryNotice.actionLabel}</button>
        </p>
      )}
    </div>
  )
}
