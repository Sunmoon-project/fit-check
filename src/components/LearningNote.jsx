import { useState } from 'react'
import { LEARNING_NOTE, LEARNING_STORAGE_NOTE } from '../lib/learnedModel.js'

// 학습값 사용 표시와 초기화 버튼. 학습값이 없으면(learning이 null) 아무것도 보여주지 않아요.
export default function LearningNote({ learning, onReset }) {
  const [done, setDone] = useState(false)
  if (!learning) return null
  async function reset() {
    await onReset?.()
    setDone(true)
  }
  return (
    <div className="info-box learning-note" role="note">
      <p className="small" role="status">{done ? '학습값과 모은 샘플을 모두 지웠어요. 다음 분석부터 기본 기준으로 판정해요.' : learning.text}</p>
      <p className="muted small">{LEARNING_NOTE} {LEARNING_STORAGE_NOTE}</p>
      <button type="button" className="btn text" onClick={reset} disabled={done}>학습값 초기화</button>
    </div>
  )
}
