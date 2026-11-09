import { useState } from 'react'
import { LEARNING_NOTE, LEARNING_STORAGE_NOTE } from '../lib/learnedModel.js'

// 학습값 사용 표시와 초기화 버튼. 학습값이 없으면(learning이 null) 아무것도 보여주지 않아요.
export default function LearningNote({ learning, onReset, onExport }) {
  const [done, setDone] = useState(false)
  const [exported, setExported] = useState(null)
  if (!learning) return null
  async function reset() {
    await onReset?.()
    setDone(true)
  }
  async function exportSamples() {
    const n = await onExport?.()
    setExported(typeof n === 'number' ? n : 0)
  }
  return (
    <div className="info-box learning-note" role="note">
      <p className="small" role="status">{done ? '학습값과 모은 샘플을 모두 지웠어요. 다음 분석부터 기본 기준으로 판정해요.' : learning.text}</p>
      <p className="muted small">{LEARNING_NOTE} {LEARNING_STORAGE_NOTE}</p>
      {onExport && !done && (
        <>
          <button type="button" className="btn text" onClick={exportSamples}>학습 샘플 내보내기(JSON)</button>
          <p className="muted small">키·몸무게·후기 글 없이 부위별 여유분만 담겨요. 파일로 내려받기만 하고 어디로도 보내지 않아요.</p>
          {exported != null && <p className="small" role="status">{exported > 0 ? `샘플 ${exported}건을 파일로 내려받았어요.` : '내보낼 샘플이 아직 없어요.'}</p>}
        </>
      )}
      <button type="button" className="btn text" onClick={reset} disabled={done}>학습값 초기화</button>
    </div>
  )
}
