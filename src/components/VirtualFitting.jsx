import { useState } from 'react'

// 기능 ④ 가상 피팅 (참고용 미리보기)
// 문서: 실제 합성 대신, 사진 업로드 없이 "참고용 미리보기"임을 분명히 표기.
// 프로토타입에서는 체형 비율에 맞춘 간단한 실루엣으로 근사치를 보여줍니다.
export default function VirtualFitting({ product, profile }) {
  const [open, setOpen] = useState(false)

  // 키/몸무게로 실루엣 비율을 아주 단순하게 조정 (데모용 근사)
  const scaleW = Math.min(1.35, Math.max(0.7, profile.weight / 55))
  const scaleH = Math.min(1.2, Math.max(0.85, profile.height / 165))

  return (
    <div className="card">
      <div className="section-head">
        <h3>가상 피팅 <span className="muted small">참고용</span></h3>
      </div>

      {!open ? (
        <div className="vf-intro">
          <p className="muted small">
            내 체형 비율에 상품을 얹어 대략적인 느낌만 보여줘요.
          </p>
          <button className="btn line" onClick={() => setOpen(true)}>
            미리보기 생성
          </button>
        </div>
      ) : (
        <div className="vf-stage">
          <div
            className="vf-figure"
            style={{ transform: `scaleX(${scaleW}) scaleY(${scaleH})` }}
            aria-hidden
          >
            <div className="vf-head" />
            <div className={`vf-garment vf-${product.category}`} />
            <div className="vf-legs" />
          </div>
          <p className="vf-caption muted small">
            {profile.height}cm · {profile.weight}kg 기준 실루엣 근사
          </p>
        </div>
      )}

      <p className="muted small disclaimer">
        가상 피팅은 시각적 근사치예요. 원단 신축성·무게감·재단 차이는 반영되지 않아요.
      </p>
    </div>
  )
}
