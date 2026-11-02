import { useState } from 'react'
import { BODY_FIELDS, TOP_SIZES, BOTTOM_SIZES } from '../data/measurements.js'
import { estimateBody } from '../lib/bodyEstimate.js'
import { FIT_PREF_LABEL } from '../lib/fitEngine.js'

// 체형 정보를 한 화면에 한 가지씩 순서대로 묻는 온보딩
const STEPS = ['gender', 'height', 'weight', 'shape', 'usual', 'detail', 'summary']

const DEFAULT_PROFILE = {
  gender: '',
  height: '',
  weight: '',
  shape: { shoulder: 'normal', belly: 'none', lower: 'normal' },
  usual: { top: '', bottom: '' },
  preferredFit: 'regular',
  measurements: {},
}

const SHAPE_OPTIONS = [
  { axis: 'shoulder', title: '어깨', options: [['narrow', '좁은 편'], ['normal', '보통'], ['wide', '넓은 편']] },
  { axis: 'belly', title: '배', options: [['none', '거의 없음'], ['some', '조금 있음'], ['much', '많이 있음']] },
  { axis: 'lower', title: '하체', options: [['slim', '마른 편'], ['normal', '보통'], ['thick', '튼튼한 편']] },
]

const RANGE = { height: [140, 210], weight: [35, 150] }

function Chips({ value, options, onChange, name }) {
  return (
    <div className="chip-row" role="radiogroup" aria-label={name}>
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          className={`chip ${value === v ? 'active' : ''}`}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function NumberStep({ label, unit, value, range, onChange }) {
  const [min, max] = range
  const n = Number(value)
  return (
    <div className="big-number">
      <div className="big-number-input">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          min={min}
          max={max}
          placeholder={label}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
        />
        <span className="unit">{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={Number.isFinite(n) && value !== '' ? n : Math.round((min + max) / 2)}
        onChange={(e) => onChange(e.target.value)}
        aria-hidden
        tabIndex={-1}
      />
      <span className="muted small">{min}~{max}{unit} 사이로 입력해주세요</span>
    </div>
  )
}

export default function Onboarding({ initial, onComplete, onCancel }) {
  const [profile, setProfile] = useState(() => ({ ...DEFAULT_PROFILE, ...(initial || {}) }))
  const [idx, setIdx] = useState(0)
  const [error, setError] = useState('')
  const step = STEPS[idx]

  const set = (patch) => setProfile((p) => ({ ...p, ...patch }))
  const setNested = (key, k, v) => setProfile((p) => ({ ...p, [key]: { ...p[key], [k]: v } }))

  function validate() {
    if (step === 'gender' && !profile.gender) return '성별을 골라주세요.'
    for (const key of ['height', 'weight']) {
      if (step !== key) continue
      const n = Number(profile[key])
      const [min, max] = RANGE[key]
      if (profile[key] === '' || !Number.isFinite(n) || n < min || n > max) {
        return `${key === 'height' ? '키' : '몸무게'}는 ${min}~${max} 사이로 입력해주세요.`
      }
    }
    if (step === 'detail') {
      for (const f of BODY_FIELDS) {
        const v = profile.measurements[f.key]
        if (v === '' || v == null) continue
        const n = Number(v)
        if (!Number.isFinite(n) || n < f.min || n > f.max) return `${f.label}는 ${f.min}~${f.max}${f.unit} 사이로 입력하거나 비워두세요.`
      }
    }
    return ''
  }

  function next() {
    const msg = validate()
    setError(msg)
    if (msg) return
    if (step === 'summary') {
      onComplete(normalize(profile))
      return
    }
    setIdx((i) => i + 1)
  }

  function prev() {
    setError('')
    if (idx === 0) onCancel?.()
    else setIdx((i) => i - 1)
  }

  const normalized = step === 'summary' ? normalize(profile) : null
  const estimate = normalized ? estimateBody(normalized) : null

  return (
    <section className="onboarding">
      <div className="progress" aria-label={`${idx + 1} / ${STEPS.length} 단계`}>
        <div className="progress-fill" style={{ width: `${((idx + 1) / STEPS.length) * 100}%` }} />
      </div>
      <span className="eyebrow">내 정보 {idx + 1} / {STEPS.length}</span>

      {step === 'gender' && (
        <>
          <h2 className="q-title">성별을 알려주세요</h2>
          <p className="muted">체형 추정 공식이 달라져요.</p>
          <Chips name="성별" value={profile.gender} options={[['male', '남성'], ['female', '여성']]} onChange={(v) => set({ gender: v })} />
        </>
      )}

      {step === 'height' && (
        <>
          <h2 className="q-title">키가 어떻게 되세요?</h2>
          <NumberStep label="키" unit="cm" value={profile.height} range={RANGE.height} onChange={(v) => set({ height: v })} />
        </>
      )}

      {step === 'weight' && (
        <>
          <h2 className="q-title">몸무게를 알려주세요</h2>
          <p className="muted">브라우저에만 저장되고 서버로 보내지 않아요.</p>
          <NumberStep label="몸무게" unit="kg" value={profile.weight} range={RANGE.weight} onChange={(v) => set({ weight: v })} />
        </>
      )}

      {step === 'shape' && (
        <>
          <h2 className="q-title">체형은 어떤 편인가요?</h2>
          <p className="muted">같은 키·몸무게라도 체형에 따라 맞는 사이즈가 달라요.</p>
          {SHAPE_OPTIONS.map((g) => (
            <div key={g.axis} className="q-group">
              <strong>{g.title}</strong>
              <Chips name={g.title} value={profile.shape[g.axis]} options={g.options} onChange={(v) => setNested('shape', g.axis, v)} />
            </div>
          ))}
        </>
      )}

      {step === 'usual' && (
        <>
          <h2 className="q-title">평소 입는 사이즈는요?</h2>
          <p className="muted">모르면 비워두셔도 돼요.</p>
          <div className="q-group">
            <strong>상의</strong>
            <Chips name="상의" value={profile.usual.top} options={TOP_SIZES.map((s) => [s, s])} onChange={(v) => setNested('usual', 'top', v)} />
          </div>
          <div className="q-group">
            <strong>하의 (인치)</strong>
            <select value={profile.usual.bottom} onChange={(e) => setNested('usual', 'bottom', e.target.value)} aria-label="하의 사이즈">
              <option value="">선택 안 함</option>
              {BOTTOM_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="q-group">
            <strong>선호하는 핏</strong>
            <Chips name="선호 핏" value={profile.preferredFit} options={Object.entries(FIT_PREF_LABEL)} onChange={(v) => set({ preferredFit: v })} />
          </div>
        </>
      )}

      {step === 'detail' && (
        <>
          <h2 className="q-title">직접 잰 치수가 있나요?</h2>
          <p className="muted">선택 사항이에요. 비워두면 키·몸무게·체형으로 추정해요. 입력할수록 추천이 정확해져요.</p>
          <div className="measure-grid">
            {BODY_FIELDS.map((f) => (
              <label key={f.key} className="measure-field">
                <span>{f.label} <span className="muted small">({f.unit})</span></span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  placeholder={`${f.min}~${f.max}`}
                  value={profile.measurements[f.key] ?? ''}
                  onChange={(e) => setNested('measurements', f.key, e.target.value)}
                />
              </label>
            ))}
          </div>
        </>
      )}

      {step === 'summary' && estimate && (
        <>
          <h2 className="q-title">이렇게 계산했어요</h2>
          <p className="muted">
            {normalized.gender === 'female' ? '여성' : '남성'} · {normalized.height}cm · {normalized.weight}kg · {FIT_PREF_LABEL[normalized.preferredFit]} 핏 선호
          </p>
          <ul className="summary-list">
            {BODY_FIELDS.map((f) => (
              <li key={f.key}>
                <span>{f.label}</span>
                <strong>{estimate.values[f.key]}{f.unit}</strong>
                <span className={`tag ${estimate.measured.has(f.key) ? 'tag-measured' : 'tag-estimated'}`}>
                  {estimate.measured.has(f.key) ? '직접 입력' : '추정'}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted small">추정값은 ±3~5cm 오차가 있을 수 있어요. 언제든 '내 정보'에서 고칠 수 있어요.</p>
        </>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      <div className="cta-bar">
        <button type="button" className="btn ghost" onClick={prev} disabled={idx === 0 && !onCancel}>
          {idx === 0 ? '닫기' : '이전'}
        </button>
        <button type="button" className="btn primary" onClick={next}>
          {step === 'summary' ? '저장하고 시작하기' : step === 'detail' && !hasAny(profile.measurements) ? '건너뛰기' : '다음'}
        </button>
      </div>
    </section>
  )
}

function hasAny(m) {
  return Object.values(m || {}).some((v) => v !== '' && v != null)
}

// 입력값을 숫자로 정리하고 빈 치수는 제거
function normalize(p) {
  const measurements = {}
  for (const [k, v] of Object.entries(p.measurements || {})) {
    if (v !== '' && v != null && Number.isFinite(Number(v))) measurements[k] = Number(v)
  }
  return {
    ...p,
    height: Number(p.height),
    weight: Number(p.weight),
    usual: {
      top: p.usual.top || '',
      bottom: p.usual.bottom ? Number(p.usual.bottom) : '',
    },
    measurements,
  }
}
