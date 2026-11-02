import { useState } from 'react'
import { CATEGORY_MEASUREMENTS, defaultMeasurements } from '../data/measurements.js'

// 기능 ① 체형 프로필 입력
// 문서: "키·몸무게 등을 범위로 입력", 개인정보 최소 수집 → 사진 받지 않음
// 추가: 상품 카테고리에 맞는 상세 신체 치수(상의/하의/신발/아우터 등) 입력
const FIT_PREFS = [
  { value: 'tight', label: '딱 맞게' },
  { value: 'regular', label: '정사이즈' },
  { value: 'loose', label: '넉넉하게' },
]

export default function BodyProfileForm({ initial, category, onSubmit, onBack }) {
  const [height, setHeight] = useState(initial?.height ?? 165)
  const [weight, setWeight] = useState(initial?.weight ?? 55)
  const [fitPref, setFitPref] = useState(initial?.fitPref ?? 'regular')

  const categoryDef = CATEGORY_MEASUREMENTS[category]
  // 카테고리가 바뀌면 기존 상세 치수를 유지하되 없는 값은 기본값으로 채움
  const [measurements, setMeasurements] = useState(() => ({
    ...defaultMeasurements(category),
    ...(initial?.measurements || {}),
  }))
  const [showDetail, setShowDetail] = useState(
    Boolean(initial?.measurements && Object.keys(initial.measurements).length)
  )

  function updateMeasure(key, value) {
    setMeasurements((prev) => ({ ...prev, [key]: Number(value) }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    onSubmit({
      height: Number(height),
      weight: Number(weight),
      fitPref,
      // 상세 입력을 켠 경우에만 치수 전달
      measurements: showDetail ? measurements : undefined,
    })
  }

  return (
    <section className="card">
      <h2 className="step-title">내 정보 입력</h2>
      <p className="muted">
        입력한 정보는 사이즈 추천에만 쓰여요. 사진이나 개인정보는 받지 않습니다.
      </p>

      <form onSubmit={handleSubmit} className="profile-form">
        <label className="field">
          <span>키 <strong>{height}cm</strong></span>
          <input
            type="range" min="145" max="195" value={height}
            onChange={(e) => setHeight(e.target.value)}
            aria-label="키"
          />
        </label>

        <label className="field">
          <span>몸무게 <strong>{weight}kg</strong></span>
          <input
            type="range" min="38" max="110" value={weight}
            onChange={(e) => setWeight(e.target.value)}
            aria-label="몸무게"
          />
        </label>

        <fieldset className="field">
          <legend>선호하는 핏</legend>
          <div className="pref-group" role="radiogroup">
            {FIT_PREFS.map((p) => (
              <button
                type="button"
                key={p.value}
                className={`pref-chip ${fitPref === p.value ? 'active' : ''}`}
                aria-pressed={fitPref === p.value}
                onClick={() => setFitPref(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </fieldset>

        {/* 카테고리별 상세 치수 (선택 입력) */}
        {categoryDef && (
          <div className="detail-measure">
            <div className="detail-head">
              <div>
                <strong>{categoryDef.label} 실측 사이즈</strong>
                <p className="muted small">
                  평소 잘 맞는 옷을 재서 입력하면 추천이 더 정확해져요. 선택 사항이에요.
                </p>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showDetail}
                  onChange={(e) => setShowDetail(e.target.checked)}
                />
                <span>{showDetail ? '입력함' : '입력'}</span>
              </label>
            </div>

            {showDetail && (
              <div className="measure-grid">
                {categoryDef.fields.map((f) => (
                  <div className="measure-field" key={f.key}>
                    <div className="measure-top">
                      <span>{f.label}</span>
                      <strong>
                        {f.options
                          ? f.options[measurements[f.key] - 1] ?? ''
                          : `${measurements[f.key]}${f.unit}`}
                      </strong>
                    </div>
                    <input
                      type="range"
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      value={measurements[f.key] ?? f.default}
                      onChange={(e) => updateMeasure(f.key, e.target.value)}
                      aria-label={f.label}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="actions">
          <button type="button" className="btn ghost" onClick={onBack}>
            이전
          </button>
          <button type="submit" className="btn primary">
            추천 사이즈 보기
          </button>
        </div>
      </form>
    </section>
  )
}
