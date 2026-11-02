<div align="center">

# 👕 핏체크 (fit-check)

### 내 체형으로 고르는 사이즈·핏

키·몸무게·체형을 한 번 적어두면, 쇼핑몰 상품 링크만 붙여넣어도<br>
**나에게 맞는 사이즈와 핏**, **나와 비슷한 체형의 리뷰**, **사진 합성 미리보기**까지 한 화면에서 볼 수 있어요.

![React](https://img.shields.io/badge/React-18-1f3a2e?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-e2683c?logo=vite&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-18%2B-3c873a?logo=node.js&logoColor=white)
![AI 합성](https://img.shields.io/badge/AI%20합성-Hugging%20Face%20IDM--VTON%20무료-d9a441)
![UI](https://img.shields.io/badge/UI-한국어-8a5a44)

[주요 기능](#-주요-기능) · [사용 흐름](#-사용-흐름) · [시작하기](#-시작하기) · [AI 합성 켜기](#-ai-합성-켜기) · [개인정보와 보안](#-개인정보와-보안) · [한계](#%EF%B8%8F-한계) · [폴더 구조](#%EF%B8%8F-폴더-구조)

</div>

---

## ✨ 주요 기능

| 기능 | 설명 |
| --- | --- |
| 🧍 **체형 온보딩** | 성별, 키, 몸무게, 어깨·배·하체 체형, 평소 입는 사이즈를 한 단계씩 입력해요. 치수를 직접 적으면 추정값 대신 그 값을 써요. |
| 🔗 **상품 링크 분석** | 쇼핑몰 상품 주소를 붙여넣으면 서버가 페이지를 받아 상품명, 가격, 이미지, 사이즈표, 리뷰를 뽑아요. EUC-KR로 된 오래된 쇼핑몰 페이지도 읽어요. |
| 📏 **사이즈·핏 추천** | 사이즈표 실측과 내 치수의 차이(여유분)로 부위별 핏(타이트 / 적당 / 넉넉 등)을 판정하고 추천 사이즈를 골라요. |
| 💬 **비슷한 체형 리뷰** | 리뷰에 적힌 키·몸무게·구매 사이즈를 읽어 나와 비슷한 사람의 후기를 먼저 보여줘요. |
| 🖼️ **사진 합성 미리보기** | 내 전신 사진 위에 배경을 지운 옷 이미지를 얹어 대략적인 모습을 보여줘요. 선택한 사이즈가 넉넉할수록 조금 크게 그려요. |
| 🤖 **AI 합성** | Hugging Face의 무료 IDM-VTON Space로 실제 착용 이미지를 만들어요. 키 없이 바로 동작해요. |
| 🗂️ **옷장** | 마음에 든 옷을 사이즈·핏 판정·합성 이미지와 함께 담고, 나란히 비교하거나 비슷한 옷과 치수 차이를 볼 수 있어요. 같은 상품·같은 사이즈는 한 칸만 차지해요. |
| 🎯 **착용 후기 보정** | 산 옷이 작았는지, 컸는지 기록하면 다음 추천부터 부위별로 보정해요. |

## 🧭 사용 흐름

```
① 내 정보 입력  →  ② 상품 링크 붙여넣기  →  ③ 사이즈·핏 추천 + 리뷰
                                                  ↓
                               ④ 사진 합성 미리보기 / AI 합성  →  ⑤ 옷장에 담기
```

> 💡 상품 링크가 없어도 괜찮아요. 링크 입력 화면의 **데모 상품으로 체험하기**에서 모든 기능을 바로 써볼 수 있어요.

## 🚀 시작하기

Node.js 18 이상이 필요해요.

```bash
npm install
npm run dev      # http://localhost:5173
```

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 개발 서버 + API (`/api/*`) 실행 |
| `npm run build` | 화면 파일만 빌드 (`dist/`) |
| `npm run build:file` | 서버 없이 여는 HTML 파일 하나 빌드 (`dist/fit-check.html`) |
| `npm run preview` | 빌드 결과를 API와 함께 실행 |
| `npm run smoke` | 추천 로직·파서·보안 검사 스모크 테스트 |

> ⚠️ API(`/api/status`, `/api/product`, `/api/tryon`)는 Vite 개발·미리보기 서버에 붙는 플러그인이에요.
> `dist/` 폴더만 정적 호스팅에 올리면 **상품 링크 분석과 AI 합성이 동작하지 않아요.** `npm run preview`로 실행하거나 별도 서버가 필요해요.

### 서버 없이 파일 하나로 보기

```bash
npm run build:file   # dist/fit-check.html 생성
```

`dist/fit-check.html`을 더블클릭하면 브라우저에서 바로 열려요. JS·CSS가 모두 파일 안에 들어 있어서 다른 파일이 필요 없어요.
온보딩, 데모 상품 사이즈·핏 추천과 리뷰, 사진 합성 미리보기, 옷장은 동작해요. 상품 링크 분석과 AI 합성은 서버가 필요해서 이 파일에서는 꺼져 있어요.
`npm run build`를 다시 돌리면 `dist/`가 비워지니 그 뒤에 `npm run build:file`을 다시 실행하세요.

## 🤖 AI 합성 켜기

AI 합성은 Hugging Face Space [yisol/IDM-VTON](https://huggingface.co/spaces/yisol/IDM-VTON)을 **무료**로 써요.
`npm run dev`로 실행하면 키 없이 바로 결과 화면의 **AI로 합성하기** 버튼이 켜져요. 서버(`server/hfTryOn.js`)가 Gradio API로 Space를 호출하고, 결과 이미지를 받아 브라우저에 넘겨요.

- **기다리는 시간**: 무료 GPU(ZeroGPU) 대기열을 거쳐서 보통 **30초~2분** 걸려요.
- **하루 사용량**: 무료 GPU 시간은 하루 단위로 제한돼요(토큰 없이 약 2분). 다 쓰면 "오늘 쓸 수 있는 무료 GPU 시간을 다 썼어요" 안내가 나와요. 내일 다시 시도하거나 아래처럼 토큰을 넣어주세요.
- **같은 사진·같은 옷**으로 다시 누르면 서버에 저장해둔 결과를 바로 보여줘서 사용량을 쓰지 않아요(서버를 다시 시작하면 비워져요).
- **상의 위주 모델**: IDM-VTON은 주로 상의로 학습돼서 하의·원피스는 결과가 부정확할 수 있어요. 신발은 지원하지 않아요.
- **라이선스**: IDM-VTON 모델은 **CC BY-NC-SA 4.0**이라 **비상업적 용도로만** 쓸 수 있어요.

### 선택 설정 (`.env`)

```bash
cp .env.example .env
# .env
HF_TOKEN=hf_여기에_토큰        # 선택: 무료 토큰을 넣으면 하루 GPU 사용량이 약 5분으로 늘어나요
HF_SPACE=yisol/IDM-VTON        # 선택: 기본 Space가 잠들었거나 붐빌 때 다른 Space로 바꿔요
```

- 토큰은 [Hugging Face 설정](https://huggingface.co/settings/tokens)에서 무료로 만들 수 있어요(읽기 권한이면 충분해요).
- 같은 API를 쓰는 다른 Space: `John6666/IDM-VTON`, `LPDoctor/IDM-VTON-demo`, `jjlealse/IDM-VTON`
- `.env`를 바꾼 뒤에는 개발 서버를 다시 시작하세요.

<details>
<summary>검토한 다른 API</summary>

| 후보 | 메모 |
| --- | --- |
| **Hugging Face Spaces IDM-VTON** ✅ | 무료(하루 GPU 사용량 제한), 키 없이 동작. 비상업적 라이선스. 채택 |
| fal.ai FASHN v1.6 | 유료(이미지 한 장에 약 $0.075), 상업적 이용 가능. 상의·하의·원피스 지원. 유료 대안으로 남겨둠 |
| Kling Kolors Virtual Try-On | 품질은 좋지만 상의 위주, 비동기 작업 조회가 필요 |
| Leffa | 오픈소스 모델, 직접 GPU 서버를 띄워야 함 |
| Google Vertex AI Virtual Try-On | GCP 프로젝트·결제 설정이 필요 |

</details>

## 🔒 개인정보와 보안

- 체형 정보, 사진, 옷장은 **이 브라우저(localStorage)에 저장**되고 서버에 따로 보관하지 않아요.
- **예외: AI로 합성하기**를 누르면 그때만 내 전신 사진과 옷 이미지가 Hugging Face Space로 전송돼요. 버튼 아래에도 같은 안내가 나와요.
- `HF_TOKEN`은 서버(`server/api.js`)에서만 읽고 브라우저로 보내지 않아요. `.env`는 git에 올라가지 않아요.
- 상품 페이지를 가져올 때 localhost·사설 IP·클라우드 메타데이터 주소(IPv4-mapped IPv6 표기 포함)는 막아요. 리다이렉트마다 다시 검사해요.
- `/api/*` POST 요청은 `Content-Type: application/json`이고 같은 출처일 때만 받아요. 다른 사이트가 몰래 AI 합성을 호출해 함께 쓰는 무료 GPU 사용량을 써버리는 일을 막아요.

## ⚠️ 한계

- **실시간 페이지 분석**: 화면을 자바스크립트로 그리는 쇼핑몰(예: [댄블](https://danble.co.kr), 무신사)은 HTML에 리뷰나 사이즈표가 없을 때가 많아요. 리뷰는 지금 페이지에 들어 있는 구조화 데이터(JSON-LD)에서만 읽어요. 이럴 땐 결과 화면에 안내 문구가 뜨고, 데모 상품으로 기능을 체험할 수 있어요.
- **배경 지우기**: 사진 모서리 색에서부터 비슷한 색을 지우는 방식이라 단색 배경에서 잘 돼요. 쇼핑몰 이미지는 CORS 설정 때문에 배경을 못 지울 수 있어서, 이때는 옷 사진을 직접 올려주세요.
- **개발용 서버**: DNS 검사와 실제 접속이 따로 이름을 풀기 때문에 DNS 리바인딩은 완전히 막지 못해요. 내 컴퓨터에서 쓰는 용도로 만들었고, 공개 배포하려면 서버를 따로 보강해야 해요.
- **추천은 참고용**이에요. 원단 신축성, 두께, 재단 차이는 반영되지 않아요.

## 🗂️ 폴더 구조

```
fit-check/
├─ server/             # Vite 플러그인으로 붙는 API
│  ├─ api.js           #   /api/status, /api/product, /api/tryon
│  ├─ hfTryOn.js       #   Hugging Face IDM-VTON Space 호출(Gradio API)
│  ├─ productParser.js #   HTML → 상품·사이즈표·리뷰
│  └─ safeFetch.js     #   내부망 차단(SSRF 방지) + 인코딩 판별 fetch
├─ src/
│  ├─ components/      # 온보딩, 결과, 사진 합성(TryOnPanel), 옷장(Wardrobe) 등
│  ├─ data/            # 치수 정의, 예시 상품
│  └─ lib/             # 핏 판정, 체형 추정, 이미지 도구, 옷장, 저장소
└─ scripts/smoke.mjs   # 스모크 테스트
```

<div align="center">
<sub>핏체크는 프로토타입이에요. 사이즈 추천은 참고만 하고, 최종 선택은 상품 상세의 실측을 꼭 확인해주세요.</sub>
</div>
