// 학습 샘플 내보내기 (순수 함수). 이 브라우저에 쌓인 학습 샘플을 파일로 내려받아 npm run eval:fit 의 입력으로 쓰기 위한 용도예요.
// 서버로 보내지 않아요. 파일은 사용자가 직접 내려받아요.
//
// 내보내는 것(허용 목록): 종류(cat), 브랜드 키, 지역 추정, 라벨, 가중치, 부위별 여유분(e), 날짜(일 번호).
// 내보내지 않는 것: 키·몸무게·성별·사이즈 이름·후기 본문·닉네임·사진·상품 주소·상품명, 그리고 중복 방지 id
// (id는 키·몸무게·본문 앞부분을 섞어 만든 해시라서, 원문을 복원할 수는 없어도 내보내는 파일에는 넣지 않아요).
import { LEARN_SCHEMA_VERSION } from './learnedModel.js'

export const EXPORT_KIND = 'fitcheck-learn-samples'
export const EXPORT_FILENAME = 'fitcheck-learn-samples.json'
export const EXPORT_NOTE = '키·몸무게·후기 글이 없는 부위별 여유분만 담긴 학습 샘플이에요. npm run eval:fit -- --file <이 파일> 로 평가할 수 있어요.'

const FITS = ['small', 'true', 'large']
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

function cleanSample(s) {
  if (!s || typeof s.cat !== 'string' || !FITS.includes(s.label) || !s.e || typeof s.e !== 'object') return null
  const e = {}
  for (const [part, v] of Object.entries(s.e)) if (isNum(v)) e[part] = v
  if (Object.keys(e).length === 0) return null
  return {
    cat: s.cat,
    brand: typeof s.brand === 'string' ? s.brand : null,
    ...(typeof s.region === 'string' ? { region: s.region } : {}),
    label: s.label,
    w: isNum(s.w) ? s.w : 1,
    e,
    ...(isNum(s.d) ? { d: s.d } : {}),
  }
}

/** 저장된 샘플 → 내보내기 객체. 허용 목록 밖의 필드는 버려요. */
export function buildLearnExport(samples) {
  const list = (Array.isArray(samples) ? samples : []).map(cleanSample).filter(Boolean)
  return { kind: EXPORT_KIND, schemaVersion: LEARN_SCHEMA_VERSION, note: EXPORT_NOTE, count: list.length, samples: list }
}
