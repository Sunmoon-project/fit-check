<div align="center">

# 👕 핏체크 (fit-check)

**내 체형으로 고르는 사이즈·핏**

키·몸무게·체형을 한 번 적어두면, 쇼핑몰 상품 링크만 붙여넣어도
나에게 맞는 사이즈와 핏, 나와 비슷한 체형의 리뷰, 사진 합성 미리보기까지 한 화면에서 볼 수 있어요.

![React](https://img.shields.io/badge/React-18-1f3a2e?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-e2683c?logo=vite&logoColor=white)
![AI 합성](https://img.shields.io/badge/AI%20합성-fal.ai%20FASHN%20v1.6-d9a441)

</div>

---

## ✨ 주요 기능

| 기능 | 설명 |
| --- | --- |
| 🧍 **체형 온보딩** | 성별, 키, 몸무게, 어깨·배·하체 체형, 평소 입는 사이즈를 순서대로 입력해요. 치수를 직접 적으면 추정값 대신 그 값을 써요. |
| 🔗 **상품 링크 분석** | 쇼핑몰 상품 주소를 붙여넣으면 서버가 페이지를 받아 상품명, 가격, 이미지, 사이즈표, 리뷰를 뽑아요. |
| 📏 **사이즈·핏 추천** | 사이즈표 실측과 내 치수의 여유분으로 부위별 핏(타이트 / 적당 / 넉넉 등)을 판정하고 추천 사이즈를 골라요. |
| 💬 **비슷한 체형 리뷰** | 리뷰에 적힌 키·몸무게·구매 사이즈를 읽어 나와 비슷한 사람의 후기를 먼저 보여줘요. |
| 🖼️ **사진 합성 미리보기** | 내 전신 사진 위에 배경을 지운 옷 이미지를 얹어 대략적인 모습을 보여줘요. 선택한 사이즈가 넉넉할수록 조금 크게 그려요. |
| 🤖 **AI 합성** | `FAL_KEY`를 설정하면 fal.ai FASHN v1.6으로 실제 착용 이미지를 만들어요. |
| 🗂️ **옷장** | 마음에 든 옷을 사이즈·핏 판정·합성 이미지와 함께 담고, 나란히 비교하거나 비슷한 옷과 치수 차이를 볼 수 있어요. |
| 🎯 **착용 후기 보정** | 산 옷이 작았는지, 컸는지 기록하면 다음 추천부터 부위별로 보정해요. |

## 🧭 사용 흐름

```
① 내 정보 입력  →  ② 상품 링크 붙여넣기  →  ③ 사이즈·핏 추천 + 리뷰
                                                  ↓
                               ④ 사진 합성 미리보기 / AI 합성  →  ⑤ 옷장에 담기
```

입력한 체형 정보, 사진, 옷장은 **이 브라우저(localStorage)에만** 저장돼요.

## 🚀 시작하기

Node.js 18 이상이 필요해요.

```bash
npm install
npm run dev      # http://localhost:5173
```

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 개발 서버 + API (`/api/*`) 실행 |
| `npm run build` | 배포용 빌드 (`dist/`) |
| `npm run preview` | 빌드 결과를 API와 함께 실행 |
| `npm run smoke` | 추천 로직·파서 스모크 테스트 |

## 🤖 AI 합성 켜기

AI 합성은 [fal.ai](https://fal.ai)의 **FASHN v1.6** 가상 피팅 모델을 써요. 이미지 한 장에 약 **$0.075**예요.

1. [fal.ai 대시보드](https://fal.ai/dashboard/keys)에서 API 키를 만들어요.
2. `.env.example`을 `.env`로 복사하고 키를 넣어요.

   ```bash
   cp .env.example .env
   # .env
   FAL_KEY=여기에_키
   ```

3. 개발 서버를 다시 시작하면 결과 화면의 **AI로 합성하기** 버튼이 켜져요.

키가 없으면 버튼이 꺼진 채로 안내 문구가 나오고, 사진 합성 미리보기는 그대로 쓸 수 있어요.
키는 서버(`server/api.js`)에서만 읽고 브라우저로 보내지 않아요. `.env`는 git에 올라가지 않아요.

<details>
<summary>검토한 다른 API</summary>

| 후보 | 메모 |
| --- | --- |
| **fal.ai FASHN v1.6** ✅ | 상의·하의·원피스 지원, REST 한 번 호출로 결과 URL 반환. 채택 |
| Kling Kolors Virtual Try-On | 품질은 좋지만 상의 위주, 비동기 작업 조회가 필요 |
| Leffa | 오픈소스 모델, 직접 GPU 서버를 띄워야 함 |
| Google Vertex AI Virtual Try-On | GCP 프로젝트·결제 설정이 필요 |
| Hugging Face Spaces | 요청에 따라 쓰지 않음 |

</details>

## ⚠️ 한계

- **실시간 페이지 분석**: 화면을 자바스크립트로 그리는 쇼핑몰(예: [댄블](https://danble.co.kr), 무신사)은 HTML에 리뷰나 사이즈표가 없을 때가 많아요. 이럴 땐 결과 화면에 안내 문구가 뜨고, 예시 상품으로 기능을 체험할 수 있어요.
- **배경 지우기**: 사진 모서리 색에서부터 비슷한 색을 지우는 방식이라 단색 배경에서 잘 돼요. 쇼핑몰 이미지는 CORS 설정 때문에 배경을 못 지울 수 있어서, 이때는 옷 사진을 직접 올려주세요.
- **추천은 참고용**이에요. 원단 신축성, 두께, 재단 차이는 반영되지 않아요.

## 🗂️ 폴더 구조

```
fit-check/
├─ server/            # Vite 플러그인으로 붙는 API
│  ├─ api.js          #   /api/status, /api/product, /api/tryon
│  ├─ productParser.js#   HTML → 상품·사이즈표·리뷰
│  └─ safeFetch.js    #   내부망 접근 차단(SSRF 방지) fetch
├─ src/
│  ├─ components/     # 온보딩, 결과, 사진 합성(TryOnPanel), 옷장(Wardrobe) 등
│  ├─ data/           # 치수 정의, 예시 상품
│  └─ lib/            # 핏 판정, 체형 추정, 이미지 도구, 옷장, 저장소
└─ scripts/smoke.mjs  # 스모크 테스트
```
