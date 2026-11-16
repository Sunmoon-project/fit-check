// 브랜드 지역(국내/일본/미국/유럽/기타/알 수 없음)을 근거 점수를 합산해 추정하는 순수 함수.
// categoryClassifier.classifyCategory와 같은 방식이에요: { region, confidence, scores, evidence[] }를 돌려주고, 근거가 없으면 'unknown'.
//
// 중요한 한계:
// - 결과는 모두 "추정"이에요. 브랜드 사전은 직접 정리한 최소 예시이고(항목마다 estimated: true), 출처를 확인한 값이 아니에요.
// - 브랜드의 본사 국가와 그 상품이 실제로 재단된 기준(예: 한국 판매용 별도 규격)은 다를 수 있어요.
// - 도메인·통화는 "쇼핑몰"의 근거이지 브랜드 국적의 근거가 아니라서 점수를 낮게 줬어요.
// - 아래 점수는 설계상의 판단이고, 실제 상품으로 맞는 비율을 재서 정한 값이 아니에요.
// 근거에는 종류와 지역, 점수, 짧은 표시용 글자만 담아요(상품명 원문은 담지 않아요).
import { brandKeyOfName, detectBrand } from './sizeChartDb.js'

export const REGIONS = ['kr', 'jp', 'us', 'eu', 'other']
export const REGION_LABEL = { kr: '국내', jp: '일본', us: '미국', eu: '유럽', other: '기타', unknown: '알 수 없음' }

export const REGION_EVIDENCE_LABEL = {
  originLabel: '쇼핑몰 표시',
  brandDict: '브랜드 사전',
  sizeNotation: '사이즈 표기',
  currency: '통화',
  domain: '도메인',
}

// 브랜드 키(sizeChartDb.brandKeyOfName 결과) → 본사 국가 추정. 최소 예시이고, 항목마다 확인이 필요한 추정이에요(estimated: true).
// 여기에 지역별 사이즈 차이의 고정 수치는 두지 않아요. 지역 차이는 학습값(learnedModel의 지역별 오프셋)으로만 반영해요.
export const BRAND_REGION_DICT = Object.freeze({
  nike: { region: 'us', estimated: true },
  newbalance: { region: 'us', estimated: true },
  carhartt: { region: 'us', estimated: true },
  stussy: { region: 'us', estimated: true },
  thenorthface: { region: 'us', estimated: true },
  patagonia: { region: 'us', estimated: true },
  levis: { region: 'us', estimated: true },
  polo: { region: 'us', estimated: true },
  converse: { region: 'us', estimated: true },
  vans: { region: 'us', estimated: true },
  adidas: { region: 'eu', estimated: true },
  puma: { region: 'eu', estimated: true },
  zara: { region: 'eu', estimated: true },
  uniqlo: { region: 'jp', estimated: true },
  musinsastandard: { region: 'kr', estimated: true },
  thisisneverthat: { region: 'kr', estimated: true },
  covernat: { region: 'kr', estimated: true },
})

// 점수 (설계상의 판단)
export const REGION_SCORE = Object.freeze({ originLabel: 4, brandDict: 3, sizeNotation: 2, currency: 1, domain: 1 })
export const REGION_MIN_SCORE = 2 // 가장 높은 합계가 이 값 미만이면 'unknown'

const ORIGIN_RULES = [
  ['kr', /국내\s*브랜드|한국\s*브랜드|korea/i],
  ['jp', /일본\s*브랜드|일본\s*직구|japan/i],
  ['us', /미국\s*브랜드|미국\s*직구|usa|u\.s\.a/i],
  ['eu', /(유럽|독일|프랑스|이탈리아|영국|스웨덴|덴마크|스페인)\s*(브랜드|직구)|europe/i],
]

const CURRENCY = { KRW: 'kr', JPY: 'jp', USD: 'us', EUR: 'eu', GBP: 'eu' }
const CURRENCY_WORD = [
  ['jp', /(?:^|[^\w])(?:¥|￥|JPY)|엔(?![가-힣])/],
  ['us', /(?:^|[^\w])(?:\$|USD)/],
  ['eu', /(?:^|[^\w])(?:€|EUR|£|GBP)/],
]

// 사이즈 표기 패턴: 옵션 이름 앞에 붙은 지역 표기. 한 상품의 옵션이 이 패턴이면 그 지역의 표기를 쓴 것으로 봐요.
const NOTATION_RULES = [
  ['us', /^US\s*[\d.]+/i],
  ['eu', /^(EU|EUR|FR|IT|DE)\s*[\d.]+/i],
  ['eu', /^UK\s*[\d.]+/i], // UK 표기는 유럽으로 묶었어요(별도 지역을 두지 않았어요)
  ['jp', /^JP\s*[\d.]+/i],
]
const KR_SHOE_MM = /^(2[2-9]\d|3[01]\d)$/

function domainRegion(host) {
  const h = String(host || '').toLowerCase()
  if (/\.(co\.)?jp$/.test(h)) return 'jp'
  if (/\.(co\.)?kr$/.test(h)) return 'kr'
  if (/\.(de|fr|it|es|eu|nl|se|dk|co\.uk|uk)$/.test(h)) return 'eu'
  return null
}

function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * @param {{ brand?:string, name?:string, originLabel?:string, optionLabels?:string[], priceCurrency?:string, priceText?:string, url?:string }} input
 * @returns {{ region:string, label:string, estimated:true, confidence:'high'|'medium'|'low', scores:Record<string,number>, evidence:{kind:string, region:string, score:number, text:string}[] }}
 */
export function classifyBrandRegion(input = {}) {
  const scores = Object.fromEntries(REGIONS.map((r) => [r, 0]))
  const evidence = []
  const add = (kind, region, text) => {
    const score = REGION_SCORE[kind]
    scores[region] += score
    evidence.push({ kind, region, score, text })
  }

  const origin = String(input.originLabel || '')
  for (const [region, re] of ORIGIN_RULES) if (re.test(origin)) { add('originLabel', region, `쇼핑몰 표시: ${REGION_LABEL[region]} 브랜드`); break }

  const key = brandKeyOfName(input.brand) || detectBrand(input.name)
  const hit = key ? BRAND_REGION_DICT[key] : null
  if (hit) add('brandDict', hit.region, `브랜드 사전(추정): ${REGION_LABEL[hit.region]}`)

  const opts = (input.optionLabels || []).map((o) => String(o).trim()).filter(Boolean)
  if (opts.length) {
    for (const [region, re] of NOTATION_RULES) {
      if (opts.some((o) => re.test(o))) { add('sizeNotation', region, `사이즈 표기가 ${REGION_LABEL[region]} 방식(${opts.find((o) => re.test(o)).slice(0, 8)})`); break }
    }
    if (!evidence.some((e) => e.kind === 'sizeNotation') && opts.length >= 2 && opts.every((o) => KR_SHOE_MM.test(o.replace(/\s*mm$/i, '')))) add('sizeNotation', 'kr', '사이즈 표기가 mm 단위(국내 신발 방식)')
  }

  const cur = String(input.priceCurrency || '').toUpperCase()
  if (CURRENCY[cur]) add('currency', CURRENCY[cur], `통화 ${cur}`)
  else if (input.priceText) {
    const m = CURRENCY_WORD.find(([, re]) => re.test(String(input.priceText)))
    if (m) add('currency', m[0], `가격 표기가 ${REGION_LABEL[m[0]]} 통화`)
  }

  const dr = domainRegion(hostOf(input.url))
  if (dr) add('domain', dr, `쇼핑몰 도메인이 ${REGION_LABEL[dr]} 계열`)

  const ranked = [...REGIONS].sort((a, b) => scores[b] - scores[a])
  const top = ranked[0]
  const margin = scores[top] - scores[ranked[1]]
  // 최고점이 기준 미만이거나 1위와 2위가 같으면 판단하지 않아요.
  if (scores[top] < REGION_MIN_SCORE || margin === 0) {
    return { region: 'unknown', label: REGION_LABEL.unknown, estimated: true, confidence: 'low', scores, evidence }
  }
  const confidence = scores[top] >= 5 && margin >= 3 ? 'high' : scores[top] >= 3 && margin >= 2 ? 'medium' : 'low'
  return { region: top, label: REGION_LABEL[top], estimated: true, confidence, scores, evidence }
}

/** 상품 객체에서 판단 입력을 모아요. */
export function regionInputOf(product, pageUrl = '') {
  return {
    brand: product?.chartBrand || product?.brand || '',
    name: product?.name || '',
    originLabel: product?.originLabel || '',
    optionLabels: product?.optionLabels || [],
    priceCurrency: product?.priceCurrency || '',
    priceText: product?.priceText || '',
    url: product?.url || product?.regionUrl || pageUrl || '',
  }
}

/** 샘플 저장·학습에 쓰는 지역 키. 판단하지 못했으면 null. */
export function regionKeyOf(product, pageUrl = '') {
  const r = classifyBrandRegion(regionInputOf(product, pageUrl)).region
  return r === 'unknown' ? null : r
}

/** 화면 한 줄: '브랜드 지역: 일본(추정) 근거: 브랜드 사전(추정): 일본, …' */
export function regionLine(info) {
  if (!info) return ''
  if (info.region === 'unknown') {
    return info.evidence.length ? `브랜드 지역: 알 수 없음(근거가 약하거나 엇갈려요) 확인한 단서: ${info.evidence.map((e) => e.text).join(', ')}` : '브랜드 지역: 알 수 없음(단서가 없어요)'
  }
  return `브랜드 지역: ${info.label}(추정) 근거: ${info.evidence.filter((e) => e.region === info.region).map((e) => e.text).join(', ')}`
}

export const REGION_HYPOTHESIS_NOTE =
  '지역 차이(미국 브랜드는 같은 글자 사이즈가 더 크게, 일본은 비슷하거나 약간 작게, 유럽은 슬림하게 나온다는 이야기)는 검증 전 가설이에요. 고정 수치를 쓰지 않고, 이 브라우저에 모은 후기로 확인된 만큼만 반영해요.'
