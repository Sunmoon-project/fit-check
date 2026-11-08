// 옷 종류(상의·하의·신발·아우터·원피스)를 근거 점수를 합산해 정하는 순수 함수.
// 서버 파서, 크롬 확장, 웹 앱이 모두 이 함수를 써요 (의존성 없음).
// 결과에는 근거의 종류와 점수만 담고, 상품명 같은 원문은 담지 않아요.

// 동점일 때는 이 순서를 따라요 (예전 guessCategory와 같은 우선순위).
export const CATEGORY_ORDER = ['shoes', 'dress', 'outer', 'bottom', 'top']

export const EVIDENCE_LABEL = {
  jsonld: 'JSON-LD',
  breadcrumb: '이동경로',
  name: '상품명',
  option: '옵션',
  header: '머리글',
  chart: '사이즈표',
  user: '직접 선택',
}
export const EVIDENCE_KINDS = Object.keys(EVIDENCE_LABEL)
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low']

const NAME_RULES = {
  shoes: /스니커|운동화|신발|슈즈|로퍼|부츠|샌들|슬리퍼|구두|러닝화|모카신|플랫슈|sneaker|shoe|boots?(?![a-z])|loafer|sandal|slipper|moccasin|(?<![a-z])moc(?![a-z])|pumps?(?![a-z])|derby|clog/i,
  dress: /원피스|드레스|dress/i,
  outer: /자켓|재킷|코트|패딩|점퍼|블루종|아우터|파카|바람막이|무스탕|jacket|coat|parka/i,
  bottom: /팬츠|바지|청바지|데님|슬랙스|쇼츠|반바지|스커트|치마|조거|치노|트라우저|jeans|pants|slacks|skirt|shorts/i,
  top: /티셔츠|셔츠|니트|맨투맨|후드|스웨트|반팔|긴팔|블라우스|가디건|탑|베스트|조끼|t-shirt|tee|shirt|knit|hoodie|sweat|cardigan/i,
}
// 이동경로·JSON-LD 분류에는 큰 분류 이름(상의·하의 등)도 쓰여요.
const GROUP_RULES = {
  shoes: /신발/,
  outer: /아우터/,
  bottom: /하의|바지/,
  top: /상의/,
}

const HEADER_SHOES = /발\s*길이|발\s*볼|굽\s*높이|사이즈\s*\(\s*mm\s*\)/i

const SCORE = { jsonld: 3, breadcrumb: 2, name: 3, headerShoes: 4, headerBottom: 2, headerTop: 2, optionShoeFormat: 3, optionMm: 2, optionInch: 1, chart: 3, user: 10 }

const SHOE_OPTION_RE = /^(2[2-9]\d|3[01]\d)\s*\(\s*\d{3}\s*-\s*\d{3}\s*\)/
const MM_ONLY_RE = /^(2[2-9]\d|3[01]\d)(?:\.\d)?\s*(?:mm|㎜)?$/i
const INCH_RE = /^(2[4-9]|3\d|40)(?:\s*(?:inch|인치))?$/i

function matchCategories(text, extra = null) {
  const t = String(text || '')
  const out = []
  for (const cat of CATEGORY_ORDER) if (NAME_RULES[cat].test(t) || (extra && extra[cat]?.test(t))) out.push(cat)
  return out
}

/**
 * @param {{ name?:string, breadcrumb?:string, jsonLdCategory?:string, optionLabels?:string[], headers?:string[], chartCategory?:string }} input
 * @returns {{ category:string, confidence:'high'|'medium'|'low', scores:Record<string,number>, evidences:{kind:string, category:string, score:number}[], candidates:string[] }}
 */
export function classifyCategory(input = {}) {
  const scores = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0]))
  const evidences = []
  const add = (kind, category, score) => {
    scores[category] += score
    evidences.push({ kind, category, score })
  }

  for (const cat of matchCategories(input.jsonLdCategory, GROUP_RULES)) add('jsonld', cat, SCORE.jsonld)
  for (const cat of matchCategories(input.breadcrumb, GROUP_RULES)) add('breadcrumb', cat, SCORE.breadcrumb)
  for (const cat of matchCategories(input.name)) add('name', cat, SCORE.name)

  const options = (input.optionLabels || []).map((o) => String(o).trim()).filter(Boolean)
  if (options.some((o) => SHOE_OPTION_RE.test(o))) add('option', 'shoes', SCORE.optionShoeFormat)
  else {
    const mm = [...new Set(options.filter((o) => MM_ONLY_RE.test(o)).map(Number))]
    const inch = options.filter((o) => INCH_RE.test(o))
    if (mm.length >= 2 && mm.every((n) => n % 5 === 0) && mm.length === options.length) add('option', 'shoes', SCORE.optionMm)
    else if (inch.length >= 3 && inch.length === options.length) add('option', 'bottom', SCORE.optionInch)
  }

  const h = (input.headers || []).join(' ')
  if (HEADER_SHOES.test(h)) add('header', 'shoes', SCORE.headerShoes)
  else if (/허벅지|밑위|허리/.test(h) && !/어깨/.test(h)) add('header', 'bottom', SCORE.headerBottom)
  else if (/어깨|가슴/.test(h)) add('header', 'top', SCORE.headerTop)

  if (CATEGORY_ORDER.includes(input.chartCategory)) add('chart', input.chartCategory, SCORE.chart)

  const ranked = [...CATEGORY_ORDER].sort((a, b) => scores[b] - scores[a] || CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b))
  const top = scores[ranked[0]]
  const margin = top - scores[ranked[1]]
  // 근거가 하나도 없으면 예전처럼 상의로 보되 신뢰도는 낮아요.
  const category = top > 0 ? ranked[0] : 'top'
  const confidence = top >= 5 && margin >= 3 ? 'high' : top >= 3 && margin >= 2 ? 'medium' : 'low'
  const candidates = top > 0 ? ranked : ['top', ...CATEGORY_ORDER.filter((c) => c !== 'top')]
  return { category, confidence, scores, evidences, candidates }
}

// 사용자가 직접 고른 카테고리: 자동 분류보다 우선하고 신뢰도는 높음으로 봐요.
export function userChosen(category, auto) {
  return {
    category,
    confidence: 'high',
    scores: auto?.scores || {},
    evidences: [{ kind: 'user', category, score: SCORE.user }],
    candidates: auto?.candidates || [...CATEGORY_ORDER],
    overridden: true,
  }
}

// JSON-LD 노드 목록에서 Product.category와 BreadcrumbList 항목 이름을 따로 읽어요.
const isType = (n, t) => (Array.isArray(n?.['@type']) ? n['@type'].includes(t) : n?.['@type'] === t)
export function ldCategoryHints(nodes) {
  const cat = []
  const crumbs = []
  const gen = []
  for (const n of nodes || []) {
    if (isType(n, 'Product')) {
      // 대상 성별: audience.suggestedGender 또는 gender (문자열/배열/{name})
      for (const v of [n.audience?.suggestedGender, n.audience?.name, n.gender]) {
        for (const x of Array.isArray(v) ? v : [v]) if (x) gen.push(String(typeof x === 'object' ? x.name ?? '' : x))
      }
    }
    if (isType(n, 'Product') && n.category) cat.push(String(Array.isArray(n.category) ? n.category.join(' ') : n.category))
    if (isType(n, 'BreadcrumbList') && Array.isArray(n.itemListElement)) {
      for (const it of n.itemListElement) {
        const nm = it?.name ?? it?.item?.name
        if (nm) crumbs.push(String(nm))
      }
    }
  }
  const trim = (a) => a.join(' ').replace(/\s+/g, ' ').trim().slice(0, 300)
  return { jsonLdCategory: trim(cat), breadcrumb: trim(crumbs), jsonLdGender: trim(gen) }
}

// 진단 리포트용 한 줄 ('분류 근거: 상품명 +3 · 옵션 +3 → 신발 (높음)'). 근거 종류와 점수만 쓰고 원문은 쓰지 않아요.
const CONF_TEXT = { high: '높음', medium: '보통', low: '낮음' }
const CAT_TEXT = { top: '상의', outer: '아우터', bottom: '하의', dress: '원피스', shoes: '신발' }
export function cleanCategoryInfo(info) {
  if (!info || typeof info !== 'object' || !CATEGORY_ORDER.includes(info.category)) return null
  const sum = new Map()
  for (const e of Array.isArray(info.evidence) ? info.evidence : []) {
    if (!EVIDENCE_KINDS.includes(e?.kind)) continue
    const s = Number(e.score)
    if (Number.isFinite(s) && s > 0 && s <= 99) sum.set(e.kind, (sum.get(e.kind) || 0) + s)
  }
  return {
    category: info.category,
    confidence: CONFIDENCE_LEVELS.includes(info.confidence) ? info.confidence : 'low',
    evidence: [...sum].map(([kind, score]) => ({ kind, score })),
  }
}
export function categoryEvidenceLine(info) {
  const c = cleanCategoryInfo(info)
  if (!c) return ''
  const parts = c.evidence.map((e) => `${EVIDENCE_LABEL[e.kind]} +${e.score}`)
  return `분류 근거: ${parts.length ? parts.join(' · ') : '근거 없음'} → ${CAT_TEXT[c.category]} (신뢰도 ${CONF_TEXT[c.confidence]})`
}

// 분류 결과 중 화면에 보여줄 요약 (원문 없음)
export function categoryInfo(cls) {
  return {
    category: cls.category,
    confidence: cls.confidence,
    evidence: cls.evidences.filter((e) => e.category === cls.category).map((e) => ({ kind: e.kind, score: e.score })),
    candidates: cls.candidates,
    overridden: cls.overridden === true,
  }
}
