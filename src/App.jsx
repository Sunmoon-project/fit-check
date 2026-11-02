import { useState } from 'react'
import { findProductByUrl } from './data/mockData.js'
import UrlInput from './components/UrlInput.jsx'
import BodyProfileForm from './components/BodyProfileForm.jsx'
import ResultView from './components/ResultView.jsx'

// 흐름: 링크 입력(step=url) → 체형 프로필(step=profile) → 결과(step=result)
export default function App() {
  const [step, setStep] = useState('url')
  const [product, setProduct] = useState(null)
  const [profile, setProfile] = useState(null)

  function handleUrl(url) {
    const found = findProductByUrl(url)
    if (found) {
      setProduct(found)
      setStep('profile')
      return found
    }
    return null
  }

  function handleProfile(p) {
    setProfile(p)
    setStep('result')
  }

  function restart() {
    setStep('url')
    setProduct(null)
  }

  const stepIndex = step === 'url' ? 0 : step === 'profile' ? 1 : 2

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <h1>핏체크</h1>
          <p className="tagline">쇼핑몰을 가리지 않는 체형 기반 사이즈·핏 도우미</p>
        </div>
      </header>

      <nav className="steps" aria-label="진행 단계">
        {['상품 링크', '내 정보', '사이즈 추천'].map((label, i) => (
          <div key={label} className={`step-dot ${i <= stepIndex ? 'done' : ''} ${i === stepIndex ? 'current' : ''}`}>
            <span className="num">{i + 1}</span>
            <span className="label">{label}</span>
          </div>
        ))}
      </nav>

      <main className="app-main">
        {step === 'url' && <UrlInput onSubmit={handleUrl} />}
        {step === 'profile' && (
          <BodyProfileForm
            initial={profile}
            category={product?.category}
            onSubmit={handleProfile}
            onBack={() => setStep('url')}
          />
        )}
        {step === 'result' && product && profile && (
          <ResultView product={product} profile={profile} onRestart={restart} />
        )}
      </main>

      <footer className="app-footer">
        <p className="muted small">
          데모용 데이터로 동작하는 프로토타입이에요. 사이즈 추천과 가상 피팅은 참고용입니다.
        </p>
      </footer>
    </div>
  )
}
