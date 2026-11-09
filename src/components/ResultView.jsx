import { useEffect, useMemo, useRef, useState } from 'react'
import { generateFitComment, bodyValuesForProfile } from '../lib/fitEngine.js'
import { compareSizes } from '../lib/sizeCompare.js'
import { resolveLearned, brandKeyOf } from '../lib/learnedModel.js'
import LearningNote from './LearningNote.jsx'
import { CATEGORY_LABEL } from '../data/measurements.js'
import { recategorizeProduct } from '../lib/recategorize.js'
import CategoryPicker from './CategoryPicker.jsx'
import { trimNote } from '../lib/storage.js'
import { makeWardrobeItem } from '../lib/wardrobe.js'
import FitComment from './FitComment.jsx'
import MeasureMatch from './MeasureMatch.jsx'
import ShoeCompare from './ShoeCompare.jsx'
import { targetGenderNotice, classifyTargetGender } from '../lib/targetGender.js'
import { shoeViewFor, withShoeRecommendation } from '../lib/shoeFit.js'
import MatchedReviews from './MatchedReviews.jsx'
import SimilarityCompare from './SimilarityCompare.jsx'
import SizeChart from './SizeChart.jsx'
import SizeSummary from './SizeSummary.jsx'
import FeedbackForm from './FeedbackForm.jsx'
import TryOnPanel from './TryOnPanel.jsx'
import { SimilarInWardrobe } from './Wardrobe.jsx'

export default function ResultView({ product: parsedProduct, profile, calibration, feedbackCount, existingFeedback, onFeedback, onRestart, wardrobe = [], onSaveWardrobe, learningModel = null, onLearn, onResetLearning }) {
  // 분류 신뢰도가 낮을 때 사용자가 고른 카테고리로 다시 분석해요 (자동 분류보다 우선).
  const [chosen, setChosen] = useState(null)
  const product = useMemo(() => (chosen ? recategorizeProduct(parsedProduct, chosen) : parsedProduct), [parsedProduct, chosen])
  const result = useMemo(() => generateFitComment(profile, product, calibration, learningModel), [profile, product, calibration, learningModel])
  const learned = useMemo(() => (learningModel ? resolveLearned(learningModel, product.category, brandKeyOf(product)) : null), [learningModel, product])
  // 상품을 분석할 때 후기에서 학습 샘플을 쌓아요(중복은 건너뜀). 결과는 App이 학습값으로 다시 내려줘요.
  const learnRef = useRef(onLearn)
  learnRef.current = onLearn
  useEffect(() => {
    learnRef.current?.(product)
  }, [product])
  const compare = useMemo(
    () => compareSizes({ chart: product.sizeChart, bodyValues: bodyValuesForProfile(profile).values, measured: result.measured, category: product.category, calibration: calibration || {}, learned }),
    [profile, product, calibration, result, learned],
  )
  const [picked, setPicked] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveNote, setSaveNote] = useState('')
  const captureRef = useRef(null)
  const isLive = product.source === 'live'
  // 신발은 옵션(mm)을 읽을 수 있을 때만 신발 비교를 쓰고, 못 읽으면 기존 비교로 돌아가요.
  const shoe = useMemo(() => (product.category === 'shoes' ? shoeViewFor(product, profile) : null), [product, profile])
  const isShoes = !!shoe
  // 상품 대상 성별 안내 (신발 비교 카드는 자체 안내를 가져서 옷일 때만 여기서 보여줘요)
  const targetGender = useMemo(
    () => targetGenderNotice(product.targetGender || classifyTargetGender({ name: product.name, optionLabels: product.shoeOptionLabels, isShoes: product.category === 'shoes' }), profile?.gender),
    [product, profile],
  )
  // 신발이면 추천 사이즈를 신발 추천으로 통일해요 (추천 카드, 선택 기본값, 옷장, 입어보기가 같은 사이즈를 가리킴).
  const shownResult = useMemo(() => withShoeRecommendation(result, shoe), [result, shoe])
  const selectedSize = picked || shownResult.recommendedSize || (shoe?.noFit ? String(shoe.noFit.size) : null) || result.perSize[0]?.size || null
  const verdicts = result.perSize.find((p) => p.size === selectedSize)?.verdicts || []
  // 지금 보는 옷 (옷장 비교용)
  const currentTarget = useMemo(
    () => ({ ...makeWardrobeItem({ product, size: selectedSize, verdicts, profile, now: 0 }), id: 'current' }),
    [product, selectedSize, verdicts, profile],
  )

  async function handleSave() {
    setSaving(true)
    const shot = (await captureRef.current?.()) || { image: null, kind: null }
    const item = makeWardrobeItem({ product, size: selectedSize, verdicts, profile, image: shot.image, imageKind: shot.kind })
    const res = onSaveWardrobe?.(item)
    setSaving(false)
    setSaveNote(res?.trimmed ? `옷장에 담았어요. ${trimNote(res) || '저장 공간이 부족해 오래된 이미지 일부를 뺐어요.'}` : '옷장에 담았어요. 위쪽 ‘옷장’에서 비교할 수 있어요.')
  }

  return (
    <section className="result">
      <div className="card product-head">
        {product.image ? (
          <img className="product-thumb" src={product.image} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="product-emoji" aria-hidden>{product.emoji}</span>
        )}
        <div className="product-info">
          <div className="product-meta">
            <span className={`source-badge ${isLive ? 'live' : 'demo'}`}>{isLive ? 'live' : '데모'}</span>
            <span className="muted small">{product.mall} · {CATEGORY_LABEL[product.category]}</span>
          </div>
          <h2>{product.name}</h2>
          <CategoryPicker product={product} onPick={setChosen} />
          {product.price && <span className="price">{product.price}</span>}
          {isLive && (
            <a className="small source-link" href={product.url} target="_blank" rel="noopener noreferrer">원본 페이지 보기</a>
          )}
        </div>
      </div>

      {product.notes?.length > 0 && (
        <div className="info-box">
          {product.notes.map((n) => <p key={n} className="small">{n}</p>)}
        </div>
      )}

      {!isShoes && targetGender && <p className="info-box small target-gender" role="note">{targetGender.text}</p>}

      <FitComment result={shownResult} />

      <LearningNote learning={result.learning} onReset={onResetLearning} />

      {isShoes ? (
        <ShoeCompare view={shoe} selectedSize={picked} onSelect={setPicked} />
      ) : (
        <>
          <SizeSummary compare={compare} recommendedSize={result.recommendedSize} category={product.category} />

          <MeasureMatch
            perSize={result.perSize}
            selectedSize={selectedSize}
            recommendedSize={result.recommendedSize}
            compare={compare}
            onSelect={setPicked}
          />
        </>
      )}

      <TryOnPanel product={product} profile={profile} selectedSize={selectedSize} verdicts={verdicts} captureRef={captureRef} />

      <SimilarInWardrobe target={currentTarget} wardrobe={wardrobe} />

      <div className="save-row">
        <button type="button" className="btn ghost block" onClick={handleSave} disabled={saving}>
          {saving ? '담는 중…' : `옷장에 담기${selectedSize ? ` (${selectedSize})` : ''}`}
        </button>
        {saveNote && <p className="muted small">{saveNote}</p>}
      </div>

      <MatchedReviews matched={result.matched} others={result.otherReviews} excluded={result.excludedReviews} />

      {!isShoes && <SimilarityCompare profile={profile} reviews={[...result.matched, ...result.otherReviews]} />}

      <SizeChart chart={product.sizeChart} compare={compare} onSelect={setPicked} recommendedSize={shownResult.recommendedSize} selectedSize={selectedSize} />

      <FeedbackForm
        key={product.url}
        product={product}
        perSize={result.perSize}
        defaultSize={selectedSize}
        existing={existingFeedback}
        calibration={calibration}
        feedbackCount={feedbackCount}
        profile={profile}
        onSave={onFeedback}
      />

      <div className="result-actions">
        <button type="button" className="btn ghost block" onClick={onRestart}>다른 옷 찾기</button>
      </div>
    </section>
  )
}
