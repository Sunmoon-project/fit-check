// 상품의 대상 성별(여성용/남성용/공용)을 근거 점수를 합산해 추정하는 순수 함수.
// categoryClassifier.classifyCategory와 같은 방식이에요. 확신이 없으면 null('모름')이에요.
// 결과에는 근거의 종류와 점수만 담고, 상품명 같은 원문은 담지 않아요. 추정은 휴리스틱이고 정확도를 측정한 값이 아니에요.
// 주의: 신발 사이즈 '판정'은 발길이(mm) 기준이라 성별과 무관해요. 성별은 안내와 US/UK 환산에만 써요.

export const TARGET_GENDER_LABEL = { female: '여성용', male: '남성용', unisex: '공용' }
export const GENDER_EVIDENCE_LABEL = { name: '상품명', breadcrumb: '이동경로', jsonld: 'JSON-LD', option: '옵션 범위' }
export const MM_BASIS_NOTE = '판정은 발길이(mm) 기준이에요'

const SCORE = { name: 3, breadcrumb: 2, jsonld: 3, option: 2 }
const MIN_SCORE = 2 // 이 점수 이상이어야 추정해요
const MIN_MARGIN = 2 // 반대 성별과 이 점수 이상 차이 나야 해요 (근거가 부딪히면 모름)

// 'women'이 'men'을 포함하므로 영문은 앞뒤에 영문자가 없을 때만 맞춰요.
const UNISEX_RE = /유니섹스|공용|남녀|남여|여남|(?<![a-z])unisex(?![a-z])|(?<![a-z])(?:men|man)\s*(?:&|and|\/)\s*(?:women|woman)(?![a-z])|(?<![a-z])(?:women|woman)\s*(?:&|and|\/)\s*(?:men|man)(?![a-z])|(?<![a-z])all\s*gender(?![a-z])/i
const FEMALE_RE = /여성|여자|우먼|레이디|걸즈|(?<![a-z])(?:womens?|woman|wmns?|ladies|lady|girls?|female)(?![a-z])/i
const MALE_RE = /남성|남자|맨즈|보이즈|(?<![a-z])(?:mens?|man|boys?|male)(?![a-z])/i

/** 글 하나 → 'female' | 'male' | 'unisex' | null. 혼합 표기(남녀, Men & Women)는 unisex예요. */
export function genderFromText(text) {
  const t = String(text ?? '')
  if (!t) return null
  if (UNISEX_RE.test(t)) return 'unisex'
  const f = FEMALE_RE.test(t)
  const m = MALE_RE.test(t)
  if (f && m) return 'unisex'
  return f ? 'female' : m ? 'male' : null
}

const OPTION_MM_RE = /^(2[2-9]\d|3[01]\d)(?!\d)/

/** 신발 옵션 글 → { min, max, text:'230~250' } | null (mm로 읽히는 옵션이 2개 이상일 때만) */
export function shoeOptionRange(labels) {
  const mms = []
  for (const l of labels || []) {
    const m = String(l ?? '').trim().match(OPTION_MM_RE)
    if (m && !mms.includes(Number(m[1]))) mms.push(Number(m[1]))
  }
  // 서로 다른 mm 옵션이 2개 이상일 때만 범위로 봐요 ('250 (250-255)'와 '250'은 같은 옵션)
  if (mms.length < 2) return null
  const min = Math.min(...mms)
  const max = Math.max(...mms)
  return { min, max, text: min === max ? `${min}` : `${min}~${max}` }
}

/**
 * @param {{ name?:string, breadcrumb?:string, jsonLdGender?:string, optionLabels?:string[], isShoes?:boolean }} input
 *   optionLabels는 신발일 때만 근거로 써요 (최대 옵션 250 이하 + 최소 220~235면 여성용 쪽, 최소 250 이상이면 남성용 쪽).
 * @returns {{ gender:'female'|'male'|'unisex'|null, confidence:'high'|'medium'|'low'|null, scores:{female:number,male:number,unisex:number}, evidences:{kind:string, gender:string, score:number}[], optionRangeText:string, isShoes:boolean }}
 */
export function classifyTargetGender(input = {}) {
  const scores = { female: 0, male: 0, unisex: 0 }
  const evidences = []
  const add = (kind, gender) => {
    const score = SCORE[kind]
    scores[gender] += score
    evidences.push({ kind, gender, score })
  }
  for (const [kind, text] of [['name', input.name], ['breadcrumb', input.breadcrumb], ['jsonld', input.jsonLdGender]]) {
    const g = genderFromText(text)
    if (g) add(kind, g)
  }
  let optionRangeText = ''
  if (input.isShoes) {
    const range = shoeOptionRange(input.optionLabels)
    if (range) {
      optionRangeText = range.text
      if (range.max <= 250 && range.min >= 220 && range.min <= 235) add('option', 'female')
      else if (range.min >= 250) add('option', 'male')
    }
  }
  const { female, male, unisex } = scores
  const top = Math.max(female, male)
  let gender = null
  let win = 0
  if (unisex >= MIN_SCORE && unisex >= top) {
    // 공용 표기가 있으면 남/여 근거가 함께 있어도 공용으로 봐요 (남녀 모두 입는 상품)
    gender = 'unisex'
    win = unisex
  } else if (top >= MIN_SCORE && Math.abs(female - male) >= MIN_MARGIN) {
    gender = female > male ? 'female' : 'male'
    win = top
  }
  const confidence = !gender ? null : win >= 5 ? 'high' : win >= 3 ? 'medium' : 'low'
  return { gender, confidence, scores, evidences, optionRangeText, isShoes: input.isShoes === true }
}

/**
 * 상품 대상 성별과 프로필 성별이 다를 때만 안내 한 줄을 만들어요. 같거나 모르면 null.
 * @returns {{ gender:'female'|'male', text:string, mismatch:true } | null}
 */
export function targetGenderNotice(target, profileGender) {
  const g = target?.gender
  if ((g !== 'female' && g !== 'male') || (profileGender !== 'female' && profileGender !== 'male') || g === profileGender) return null
  const range = target.optionRangeText ? `(옵션 ${target.optionRangeText})` : ''
  return { gender: g, mismatch: true, text: `${TARGET_GENDER_LABEL[g]}으로 보이는 상품이에요${range}.${target.isShoes ? ` ${MM_BASIS_NOTE}.` : ''}` }
}
