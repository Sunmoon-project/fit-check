import { useMemo, useState } from 'react'
import Onboarding from './components/Onboarding.jsx'
import UrlInput from './components/UrlInput.jsx'
import ResultView from './components/ResultView.jsx'
import Wardrobe from './components/Wardrobe.jsx'
import { addImportedItem } from './lib/wardrobeImport.js'
import { loadProfile, saveProfile, loadFeedback, saveFeedback, loadWardrobe, saveWardrobe } from './lib/storage.js'
import { computeCalibration } from './lib/fitEngine.js'

// 흐름: 내 정보(온보딩, 저장된 정보가 없을 때만) → 상품 링크 → 사이즈·핏 추천
const STEP_LABELS = ['내 정보', '상품 링크', '사이즈 추천']

export default function App() {
  const [profile, setProfile] = useState(() => loadProfile())
  const [editing, setEditing] = useState(() => !loadProfile())
  const [product, setProduct] = useState(null)
  const [feedback, setFeedback] = useState(() => loadFeedback())
  const calibration = useMemo(() => computeCalibration(feedback), [feedback])
  const [wardrobe, setWardrobe] = useState(() => loadWardrobe())
  const [showWardrobe, setShowWardrobe] = useState(false)

  const step = editing || !profile ? 'onboarding' : product ? 'result' : 'product'
  const stepIndex = step === 'onboarding' ? 0 : step === 'product' ? 1 : 2
  const wardrobeView = showWardrobe && step !== 'onboarding'

  function handleProfile(p) {
    saveProfile(p)
    setProfile(p)
    setEditing(false)
    window.scrollTo(0, 0)
  }

  function handleProduct(p) {
    setProduct(p)
    window.scrollTo(0, 0)
  }

  function handleFeedback(item) {
    // 같은 상품에 대한 기록은 최신 것으로 바꿉니다.
    const next = [...feedback.filter((f) => f.url !== item.url), item]
    setFeedback(next)
    saveFeedback(next)
  }

  // 옷장: 최신 항목을 앞에. 같은 상품·같은 사이즈는 새 항목으로 바꿔요.
  // 저장 공간이 부족하면 storage.js가 이미지를 덜어내요.
  function handleSaveWardrobe(item) {
    const rest = wardrobe.filter((w) => !(w.product?.url === item.product?.url && w.size === item.size))
    const res = saveWardrobe([item, ...rest])
    setWardrobe(res.list)
    return res
  }

  // 확장에서 가져온 항목(이미 검사를 거친 것)을 맨 앞에 저장
  function handleImportWardrobe(item) {
    const res = saveWardrobe(addImportedItem(wardrobe, item))
    if (!res.failed) setWardrobe(res.list)
    return res
  }

  function handleClearReviews(id) {
    setWardrobe(saveWardrobe(wardrobe.map((w) => (w.id === id ? { ...w, reviews: [] } : w))).list)
  }

  function handleDeleteWardrobe(id) {
    setWardrobe(saveWardrobe(wardrobe.filter((w) => w.id !== id)).list)
  }

  function toggleWardrobe() {
    setShowWardrobe((v) => !v)
    window.scrollTo(0, 0)
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <h1>핏체크</h1>
          <p className="tagline">내 체형으로 고르는 사이즈·핏</p>
        </div>
        {profile && !editing && (
          <div className="header-actions">
            <button type="button" className={`btn pill ${showWardrobe ? 'on' : ''}`} onClick={toggleWardrobe}>
              옷장 {wardrobe.length}
            </button>
            <button type="button" className="btn pill" onClick={() => { setShowWardrobe(false); setEditing(true) }}>
              내 정보 {profile.height}·{profile.weight}
            </button>
          </div>
        )}
      </header>

      {!wardrobeView && (
        <nav className="steps" aria-label="진행 단계">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className={`step-dot ${i <= stepIndex ? 'done' : ''} ${i === stepIndex ? 'current' : ''}`}>
              <span className="num">{i + 1}</span>
              <span className="label">{label}</span>
            </div>
          ))}
        </nav>
      )}

      <main className="app-main">
        {wardrobeView && <Wardrobe items={wardrobe} onDelete={handleDeleteWardrobe} onBack={toggleWardrobe} onImport={handleImportWardrobe} onClearReviews={handleClearReviews} />}
        {!wardrobeView && step === 'onboarding' && (
          <Onboarding
            initial={profile}
            onComplete={handleProfile}
            onCancel={profile ? () => setEditing(false) : null}
          />
        )}
        {!wardrobeView && step === 'product' && <UrlInput onProduct={handleProduct} />}
        {!wardrobeView && step === 'result' && (
          <ResultView
            product={product}
            profile={profile}
            calibration={calibration}
            feedbackCount={feedback.length}
            existingFeedback={feedback.find((f) => f.url === product.url) || null}
            onFeedback={handleFeedback}
            onRestart={() => setProduct(null)}
            wardrobe={wardrobe}
            onSaveWardrobe={handleSaveWardrobe}
          />
        )}
      </main>

      <footer className="app-footer">
        <p className="muted small">
          상품 페이지 분석은 사이트 구조에 따라 일부만 가져올 수 있어요. 사이즈·핏 추천은 참고용이며, 입력한 체형 정보는 이 브라우저에만 저장돼요.
        </p>
      </footer>
    </div>
  )
}
