<div align="center">

# 👕 핏체크 (fit-check)

### 내 체형으로 고르는 사이즈·핏

키·몸무게·체형을 한 번 적어두면, 쇼핑몰 상품 링크만 붙여넣어도<br>
**나에게 맞는 사이즈와 핏**, **나와 비슷한 체형의 리뷰**, **가상 피팅 이미지**까지 한 화면에서 볼 수 있어요.

![React](https://img.shields.io/badge/React-18-111?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-111?logo=vite&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-18%2B-111?logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-111?logo=docker&logoColor=white)
![Chrome](https://img.shields.io/badge/Chrome%20확장-MV3-111?logo=googlechrome&logoColor=white)

[소개](#-소개) · [주요 기능](#-주요-기능) · [사용 흐름](#-사용-흐름) · [기술 스택](#%EF%B8%8F-기술-스택) · [실행 방법](#-실행-방법) · [크롬 확장](#-크롬-확장) · [폴더 구조](#%EF%B8%8F-폴더-구조)

</div>

---

## 🎯 소개

온라인으로 옷을 살 때 가장 자주 겪는 문제는 **"이 옷, 나한테 맞을까?"** 입니다.
사이즈표의 숫자는 어렵고, 후기는 나와 체형이 다른 사람 이야기라 믿기 어렵고, 안 맞으면 반품하는 수고와 배송비가 듭니다.

핏체크는 세 가지 근거로 사이즈를 골라줍니다.

- **내 체형 ↔ 상품 실측의 차이**로 부위별 핏(타이트 / 적당 / 넉넉)을 계산합니다.
- **나와 키·몸무게가 비슷한 사람의 후기**를 먼저 보여줍니다.
- **내 사진에 옷을 입혀 본 이미지**로 대략적인 모습을 확인합니다.

🌐 **웹 앱:** https://fit-check-joy1.onrender.com (무료 서버라 한동안 접속이 없으면 첫 화면이 뜨는 데 1분 정도 걸려요)

웹 앱과 크롬 확장 두 가지로 쓸 수 있고, 둘은 같은 핏 엔진(`src/lib/fitEngine.js`)을 씁니다.

## ✨ 주요 기능

| 기능 | 설명 |
| --- | --- |
| 🧍 **체형 입력** | 성별, 키, 몸무게, 어깨·배·하체 체형, 평소 사이즈, 팔·다리 길이를 단계별로 입력해요. 처음 시작할 때 치수 재는 법을 그림으로 안내해요. |
| 📸 **사진·웹캠 체형 추정** | 전신 사진이나 웹캠으로 어깨·가슴·허리 등 치수를 추정해요. 자세 인식(MediaPipe)은 브라우저 안에서 돌아가요. |
| 🔗 **상품 링크 분석** | 쇼핑몰 상품 주소를 붙여넣으면 서버가 페이지를 받아 상품명, 가격, 이미지, 사이즈표, 리뷰를 뽑아요. |
| 📏 **사이즈·핏 추천** | 사이즈표 실측과 내 치수의 차이(여유분)로 부위별 핏을 판정하고, 추천 사이즈와 근거·확신도를 함께 보여줘요. 바지는 다리 길이로 총장도 판정해요. |
| 💬 **비슷한 체형 리뷰** | 리뷰의 키·몸무게·구매 사이즈를 읽어 나와 비슷한 사람의 후기를 먼저 보여주고, `체형 비교`에서 내 값과 나란히 비교해요. 이상한 후기는 사유와 함께 계산에서 빼요. |
| 🎓 **후기 학습 보정** | 분석한 상품의 후기로 옷 종류·브랜드·지역별 여유분 기준을 보정하고, 내가 산 옷이 작았는지 컸는지 기록하면 다음 추천에 반영해요. |
| 🤖 **가상 피팅** | Hugging Face의 무료 모델(IDM-VTON, Leffa)로 내 사진에 옷을 입힌 이미지를 만들어요. Leffa는 상의·하의·원피스를 지원해요. |
| 🗂️ **옷장** | 마음에 든 옷을 사이즈·핏 판정·합성 이미지와 함께 담고, 나란히 비교하거나 비슷한 옷과 치수 차이를 볼 수 있어요. |
| 📚 **사이즈표 모음** | 분석한 상품의 사이즈표를 브랜드·품번·모델명과 함께 저장하고 검색해요. |
| 🛍 **중고 판매글 분석** | 번개장터·후르츠패밀리 판매글의 실측·사이즈 표기를 읽어 작음/맞음/큼을 알려줘요. 서버에 이미지 검색 키를 설정하면 사진으로 같은 상품을 찾을 수 있어요. |

체형 정보, 사진, 옷장은 이 브라우저(localStorage)에 저장돼요. 사진은 가상 피팅 버튼을 누를 때만 Hugging Face로 전송돼요.

## 🧭 사용 흐름

```
① 내 정보 입력  →  ② 상품 링크 붙여넣기  →  ③ 사이즈·핏 추천 + 리뷰
                                                  ↓
                                   ④ 가상 피팅  →  ⑤ 옷장에 담기
```

> 💡 상품 링크가 없어도 링크 입력 화면의 **데모 상품으로 체험하기**에서 모든 기능을 써볼 수 있어요.

## 🛠️ 기술 스택

| 구분 | 사용 기술 |
| --- | --- |
| 프론트엔드 | React 18, Vite 5 |
| 서버 | Node.js (`node:http`), cheerio (HTML 파싱) |
| AI | Hugging Face Spaces: IDM-VTON(CC BY-NC-SA 4.0, 비상업용), Leffa — Gradio API로 호출 / MediaPipe Pose (브라우저 내 자세 인식) |
| 크롬 확장 | Manifest V3 (권한: storage, activeTab, scripting) |
| 테스트 | Node 기본 `assert` 기반 스모크 테스트 (`scripts/smoke.mjs`) |
| CI/CD | GitHub Actions(테스트·빌드·Docker 검사, Claude 자동 PR 리뷰), Docker, Render |

## 🚀 실행 방법

### 개발 서버

Node.js 18 이상이 필요해요.

```bash
npm install
npm run dev      # http://localhost:5173
```

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 개발 서버 + API (`/api/*`) 실행 |
| `npm run build` | 화면 파일 빌드 (`dist/`) |
| `npm start` | 프로덕션 서버: `dist/` + API를 한 포트(기본 3000)로 실행. 먼저 `npm run build` |
| `npm run preview` | 빌드 결과를 API와 함께 미리보기 |
| `npm run build:file` | 서버 없이 여는 HTML 파일 하나 빌드 (`dist/fit-check.html`) |
| `npm run build:extension` | 크롬 확장 빌드 (`dist-extension/`) |
| `npm run smoke` | 스모크 테스트 |
| `npm run eval:fit` | 핏 추천 정확도 지표 측정 ([측정 방법](docs/평가_핏정확도.md)) |

### Docker

```bash
docker build -t fit-check .
docker run -p 3000:3000 --env-file .env fit-check   # http://localhost:3000
```

헬스체크 주소는 `/healthz`예요.

### 배포 (Render)

Render 대시보드 → **New → Blueprint** → 이 저장소를 고르면 `render.yaml`대로 서비스가 만들어져요. 이후 `main`에 push되어 CI가 통과할 때마다 자동으로 배포돼요.

### 환경 변수 (`.env`, 모두 선택)

```bash
cp .env.example .env
```

| 이름 | 설명 |
| --- | --- |
| `HF_TOKEN` | Hugging Face 무료 토큰. 넣으면 하루 무료 GPU 사용량이 늘어나요. 서버에서만 읽어요. |
| `HF_SPACE` | 가상 피팅에 쓸 Space (기본 `yisol/IDM-VTON`) |
| `IMAGE_SEARCH_PROVIDER`, `IMAGE_SEARCH_API_KEY` | 중고 상품 사진 검색 (`google-vision`). 둘 다 있어야 켜져요. |

아무것도 넣지 않아도 실행돼요. 토큰은 [Hugging Face 설정](https://huggingface.co/settings/tokens)에서 무료로 만들 수 있어요.

## 🧩 크롬 확장

쇼핑몰 상품 페이지에서 바로 **내 사이즈 찾기**를 눌러 추천을 받는 확장이에요. 열려 있는 페이지에서 사이즈표와 리뷰를 직접 읽어요.

설치(개발자 모드):

1. `npm run build:extension` → `dist-extension/` 생성
2. 크롬에서 `chrome://extensions` → 오른쪽 위 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** → `dist-extension` 폴더 선택
4. 확장 아이콘을 눌러 키·몸무게 등을 저장하고, 상품 페이지에서 **내 사이즈 찾기**를 눌러요.

- 무신사·29CM·W컨셉·아크테릭스·번개장터·후르츠패밀리에는 버튼이 자동으로 뜨고, 다른 사이트는 확장 아이콘을 누르면 실행돼요.
- 결과 카드에서 `비슷한 체형` / `전체 리뷰` / `사진 모아보기` / `체형 비교` 탭으로 리뷰를 볼 수 있어요.
- **내 옷장으로 보내기**를 누르면 웹 앱이 열릴 때 옷장에 자동으로 담겨요.

## 🗂️ 폴더 구조

```
fit-check/
├─ src/                    # 웹 앱 (React)
│  ├─ components/          #   온보딩, 결과, 리뷰, 가상 피팅(TryOnStudio), 체형 스캔(BodyScan), 옷장, 중고 분석 등
│  ├─ data/                #   치수 정의, 데모 상품
│  └─ lib/                 #   핏 엔진(fitEngine), 체형 추정, 사진 자세 인식, 후기 학습, 사이즈표 DB, 페이지 파서 등
├─ server/                 # API 서버
│  ├─ start.js             #   프로덕션 서버 (dist/ + API)
│  ├─ api.js               #   /api/status, /api/product, /api/tryon, /api/image-search
│  ├─ productParser.js     #   HTML → 상품·사이즈표·리뷰
│  ├─ hfTryOn.js           #   Hugging Face 가상 피팅 호출
│  ├─ imageSearch.js       #   사진 검색 공급자 연결
│  └─ safeFetch.js         #   외부 페이지 안전하게 가져오기 (내부망 차단)
├─ extension/              # 크롬 확장 (manifest, content, popup, bridge)
├─ scripts/                # 스모크 테스트, 확장 빌드, 정확도 측정 스크립트
├─ docs/                   # 설계·검증 방법 문서
├─ .github/workflows/      # GitHub Actions: CI(ci.yml), 자동 PR 리뷰(claude-review.yml)
├─ Dockerfile              # Docker 이미지 빌드
└─ render.yaml             # Render 배포 설정
```
