// 처음 온 사람에게 보여주는 소개: 무엇을 해주는 앱인지(결과 예시)와 해야 할 일 3단계
const STEPS = [
  ['내 체형 알려주기', '키와 몸무게만 있어도 돼요. 1분 정도 걸려요.'],
  ['상품 링크 붙여넣기', '무신사·29CM 같은 쇼핑몰에서 사고 싶은 옷의 주소를 복사해 오세요.'],
  ['추천 사이즈 확인하기', '어깨·가슴·기장이 끼는지 넉넉한지 부위별로 보여드려요.'],
]

export default function Intro({ onStart }) {
  return (
    <section className="intro">
      <h2 className="q-title">옷 사기 전에,<br />내 사이즈부터 확인하세요</h2>
      <p className="muted">쇼핑몰 상품 링크를 붙여넣으면 사이즈표와 후기를 읽어, 내 체형에 어떤 사이즈가 맞는지 알려드려요.</p>

      <figure className="card reco-card tone-reco intro-sample" aria-label="추천 결과 예시">
        <div className="fit-head">
          <span className="eyebrow">이런 결과를 받아요</span>
          <span className="conf-badge">예시</span>
        </div>
        <div className="reco-size">
          <strong className="size-big">L</strong>
          <span className="muted small">추천 사이즈</span>
        </div>
        <p className="fit-headline">L 사이즈가 무난해요</p>
        <p className="wd-verdicts">
          <span className="v-regular">어깨 적당</span>
          <span className="v-regular">가슴 적당</span>
          <span className="v-regular">팔길이 적당</span>
          <span className="v-relaxed">총장 여유</span>
        </p>
      </figure>

      <ol className="intro-steps">
        {STEPS.map(([title, desc]) => (
          <li key={title}>
            <strong>{title}</strong>
            <span className="muted small">{desc}</span>
          </li>
        ))}
      </ol>
      <p className="muted small">입력한 체형 정보는 이 브라우저에만 저장되고 서버로 보내지 않아요.</p>

      <div className="cta-bar">
        <button type="button" className="btn primary" onClick={onStart}>내 체형 입력하기</button>
      </div>
    </section>
  )
}
