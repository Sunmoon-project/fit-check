import { useEffect, useMemo, useRef, useState } from 'react'
import Onboarding from './components/Onboarding.jsx'
import UrlInput from './components/UrlInput.jsx'
import ResultView from './components/ResultView.jsx'
import Wardrobe from './components/Wardrobe.jsx'
import { addImportedItem } from './lib/wardrobeImport.js'
import { loadProfile, saveProfile, loadFeedback, saveFeedback, loadWardrobe, saveWardrobe, loadSyncSeen, saveSyncSeen, trimNote } from './lib/storage.js'
import { applyDelivery, syncNotice } from './lib/wardrobeSync.js'
import { connectExtensionSync } from './lib/syncClient.js'
import { computeCalibration } from './lib/fitEngine.js'
import { localAdapter, loadLearning, learnFromProduct, resetLearning } from './lib/learnStore.js'
import SizeChartLibrary from './components/SizeChartLibrary.jsx'
import { createSizeChartDb, chartRecordFromProduct } from './lib/sizeChartDb.js'

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
  const [learningModel, setLearningModel] = useState(null) // 학습값 묶음 (이 브라우저의 localStorage에서 읽어요)
  const [showCharts, setShowCharts] = useState(false)
  const [chartEntries, setChartEntries] = useState([]) // 사이즈표 모음 목록 (이 브라우저의 localStorage)
  const chartDb = useMemo(() => createSizeChartDb(localAdapter()), [])
  const [notice, setNotice] = useState(null) // { text, error } 확장에서 자동으로 가져온 결과 한 줄

  const step = editing || !profile ? 'onboarding' : product ? 'result' : 'product'
  const stepIndex = step === 'onboarding' ? 0 : step === 'product' ? 1 : 2
  const wardrobeView = showWardrobe && step !== 'onboarding'
  const chartsView = showCharts && step !== 'onboarding' && !wardrobeView

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

  useEffect(() => {
    let alive = true
    loadLearning(localAdapter()).then((s) => alive && setLearningModel(s.model))
    chartDb.list().then((l) => alive && setChartEntries(l))
    return () => {
      alive = false
    }
  }, [])

  // 상품을 분석할 때 후기에서 학습 샘플을 쌓고(중복 방지) 갱신된 학습값을 판정에 써요.
  async function handleLearn(p) {
    // 사이즈표를 읽은 실제 상품만 사이즈표 모음에 저장해요(데모 상품은 제외, 같은 상품은 갱신).
    if (p.source !== 'demo') {
      try {
        const rec = chartRecordFromProduct(p, { pageUrl: p.url })
        if (rec && (await chartDb.put(rec)).saved) setChartEntries(await chartDb.list())
      } catch {
        /* 저장소를 못 쓰면 건너뛰어요 */
      }
    }
    try {
      const r = await learnFromProduct(localAdapter(), p, { pageUrl: p.url })
      setLearningModel(r.model)
    } catch {
      /* 저장소를 못 쓰면 학습 없이 기존 방식으로 보여줘요 */
    }
  }

  async function handleResetLearning() {
    await resetLearning(localAdapter())
    setLearningModel(null)
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

  // 확장 브리지가 보낸 항목을 옷장에 반영. 저장소가 기준이라 최신 목록을 다시 읽고, 항목 id로 한 번만 담아요.
  // 반환: 처리 끝난 id (저장에 실패한 항목은 빼서 확장이 대기열에 남겨요).
  function handleExtensionEntries(entries) {
    const r = applyDelivery(loadWardrobe(), entries, loadSyncSeen(), { addItem: addImportedItem })
    if (r.savedIds.length === 0) {
      setWardrobe(loadWardrobe()) // 다른 탭이 먼저 담았을 수 있어요: 오래된 목록으로 덮어쓰지 않게 최신으로 맞춰요
      if (r.rejected > 0) setNotice({ text: syncNotice(r), error: true })
      if (r.ignoredIds.length > 0) saveSyncSeen(r.seen)
      return r.ignoredIds
    }
    const res = saveWardrobe(r.list)
    if (res.failed) {
      setNotice({ text: '저장 공간이 부족해서 확장에서 보낸 옷을 담지 못했어요. 오래된 옷을 지우면 다시 가져와요.', error: true })
      return r.ignoredIds
    }
    setWardrobe(res.list)
    saveSyncSeen(r.seen)
    setNotice({ text: syncNotice(r, trimNote(res)), error: false })
    return [...r.savedIds, ...r.ignoredIds]
  }
  const syncHandler = useRef(handleExtensionEntries)
  syncHandler.current = handleExtensionEntries
  useEffect(() => connectExtensionSync((entries) => syncHandler.current(entries)), [])

  function handleClearReviews(id) {
    setWardrobe(saveWardrobe(wardrobe.map((w) => (w.id === id ? { ...w, reviews: [] } : w))).list)
  }

  function handleDeleteWardrobe(id) {
    setWardrobe(saveWardrobe(wardrobe.filter((w) => w.id !== id)).list)
  }

  function toggleWardrobe() {
    setShowCharts(false)
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
            <button type="button" className={`btn pill ${chartsView ? 'on' : ''}`} onClick={() => { setShowWardrobe(false); setShowCharts((v) => !v) }}>
              사이즈표 {chartEntries.length}
            </button>
            <button type="button" className="btn pill" onClick={() => { setShowWardrobe(false); setShowCharts(false); setEditing(true) }}>
              내 정보 {profile.height}·{profile.weight}
            </button>
          </div>
        )}
      </header>

      {!wardrobeView && !chartsView && (
        <nav className="steps" aria-label="진행 단계">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className={`step-dot ${i <= stepIndex ? 'done' : ''} ${i === stepIndex ? 'current' : ''}`}>
              <span className="num">{i + 1}</span>
              <span className="label">{label}</span>
            </div>
          ))}
        </nav>
      )}

      {notice && (
        <div className={`sync-notice ${notice.error ? 'error' : ''}`} role="status">
          <span>{notice.text}</span>
          {!notice.error && !showWardrobe && profile && !editing && (
            <button type="button" className="btn text" onClick={() => { setShowWardrobe(true); setNotice(null) }}>옷장 보기</button>
          )}
          <button type="button" className="btn text" onClick={() => setNotice(null)}>닫기</button>
        </div>
      )}

      <main className="app-main">
        {wardrobeView && <Wardrobe items={wardrobe} onDelete={handleDeleteWardrobe} onBack={toggleWardrobe} onImport={handleImportWardrobe} onClearReviews={handleClearReviews} />}
        {chartsView && <SizeChartLibrary db={chartDb} initialEntries={chartEntries} onBack={() => setShowCharts(false)} onChanged={() => setChartEntries([])} />}
        {!wardrobeView && !chartsView && step === 'onboarding' && (
          <Onboarding
            initial={profile}
            onComplete={handleProfile}
            onCancel={profile ? () => setEditing(false) : null}
          />
        )}
        {!wardrobeView && !chartsView && step === 'product' && <UrlInput onProduct={handleProduct} />}
        {!wardrobeView && !chartsView && step === 'result' && (
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
            learningModel={learningModel}
            onLearn={handleLearn}
            onResetLearning={handleResetLearning}
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
