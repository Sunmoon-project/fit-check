// 사이즈표 모음(브라우저 DB). 본 상품의 사이즈표를 브랜드·품번·모델명·카테고리·대상 성별과 함께 저장하고,
// 브랜드·모델명·품번으로 비슷한 사이즈표를 점수순으로 찾아요. 이후 단계(중고 판매글 분석)에서 입력으로 쓰려고 만들었어요.
//
// 저장소는 어댑터({ get, set, remove }, 모두 Promise)가 감춰요. 웹은 localStorage, 확장은 chrome.storage.local이고
// learnStore.js의 어댑터를 그대로 써요. 나중에 서버 DB로 바꿀 때는 같은 메서드(put/search/list/clear)를 가진 어댑터만 갈아 끼우면 돼요.
// 이 파일은 서버로 아무것도 보내지 않아요(서버 업로드는 구현하지 않았어요).
//
// 저장 위치: 키 'fitcheck.sizechart.v1' 하나에 { schemaVersion, entries }를 JSON으로 넣어요. (학습 샘플 키와 별개)
// 저장하는 것: 브랜드, 모델명(상품명), 품번, 카테고리, 대상 성별, 사이즈표(단위·머리글·행·부위별 실측 숫자), 상품 주소(쿼리·해시 제외), 날짜.
// 저장하지 않는 것: 사용자 키·몸무게·프로필, 후기 본문·닉네임·사진 주소, 추천 결과.
// 같은 상품(주소, 또는 브랜드+품번)은 새 항목을 만들지 않고 갱신해요. 상한(건수·글자 수)을 넘으면 오래 갱신되지 않은 항목부터 정리해요.
// 스키마 버전이 다르면 저장된 값을 모두 폐기하고 빈 상태로 시작해요.
//
// 점수는 설계상의 규칙이고 실제 상품 데이터로 정확도를 측정한 값이 아니에요.

export const SIZE_CHART_DB_VERSION = 1
export const SIZE_CHART_DB_KEY = 'fitcheck.sizechart.v1'
export const SIZE_CHART_DB = Object.freeze({
  maxEntries: 300,
  maxBytes: 500000,
  maxRows: 30,
  maxCols: 20,
  minScore: 30, // 이 점수 미만 후보는 돌려주지 않아요
  maxResults: 10,
  codeMinLen: 3, // 품번으로 인정하는 최소 글자 수
})
export const SIZE_CHART_DB_STORAGE_NOTE = '사이즈표 모음은 이 브라우저에만 저장돼요(서버로 보내지 않아요).'

// 브랜드 별칭: 한글/영문 표기를 하나의 키로 합쳐요. 값은 정규화(소문자, 공백·특수문자 제거)된 별칭이에요. 예시 목록이고 전부가 아니에요.
const BRAND_ALIASES = {
  nike: ['나이키', 'nike'],
  adidas: ['아디다스', 'adidas'],
  newbalance: ['뉴발란스', 'new balance', 'newbalance', 'nb'],
  musinsastandard: ['무신사 스탠다드', '무신사스탠다드', 'musinsa standard', 'musinsastandard', 'mss'],
  uniqlo: ['유니클로', 'uniqlo'],
  zara: ['자라', 'zara'],
  carhartt: ['칼하트', 'carhartt', '칼하트 wip', 'carhartt wip'],
  stussy: ['스투시', 'stussy', "stüssy"],
  thenorthface: ['노스페이스', 'the north face', 'north face', 'thenorthface', 'tnf'],
  patagonia: ['파타고니아', 'patagonia'],
  levis: ['리바이스', "levi's", 'levis', 'levi'],
  thisisneverthat: ['디스이즈네버댓', 'thisisneverthat', 'this is never that'],
  covernat: ['커버낫', 'covernat'],
  polo: ['폴로 랄프로렌', '폴로', 'polo ralph lauren', 'polo'],
  converse: ['컨버스', 'converse'],
  vans: ['반스', 'vans'],
  fila: ['휠라', 'fila'],
  puma: ['푸마', 'puma'],
}

/** 글자 정규화: NFKC, 소문자, 글자·숫자 외 문자는 공백, 공백 하나로. */
export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const squash = (s) => normalizeText(s).replace(/\s+/g, '')

const ALIAS_TO_KEY = (() => {
  const m = new Map()
  for (const [key, list] of Object.entries(BRAND_ALIASES)) {
    m.set(key, key)
    for (const a of list) m.set(squash(a), key)
  }
  return m
})()
const KEY_TO_TOKENS = (() => {
  const m = new Map()
  for (const [key, list] of Object.entries(BRAND_ALIASES)) m.set(key, new Set(list.flatMap((a) => normalizeText(a).split(' ')).filter((t) => t.length >= 2)))
  return m
})()

/** 브랜드 표기 → 브랜드 키. 별칭 표(한글/영문)에 있으면 대표 키, 없으면 정규화한 글자 그대로. 빈 값이면 null. */
export function brandKeyOfName(name) {
  const k = squash(name).slice(0, 40)
  if (!k) return null
  return ALIAS_TO_KEY.get(k) || k
}

/** 상품명 앞쪽에서 알려진 브랜드 별칭을 찾아요(브랜드 칸이 비었을 때만 보조로 써요). 못 찾으면 null. */
export function detectBrand(text) {
  const words = normalizeText(text).split(' ').filter(Boolean).slice(0, 4)
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= Math.min(words.length, 4); i++) {
      const key = ALIAS_TO_KEY.get(words.slice(i, i + n).join(''))
      if (key) return key
    }
  }
  return null
}

/** 품번 정규화: 영숫자만 남기고 대문자. 'ab-123 x' → 'AB123X'. */
export function normalizeCode(s) {
  return String(s ?? '').normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 40)
}

const STOP = new Set(['남성', '여성', '남자', '여자', '공용', '남녀공용', '유니섹스', '맨즈', '우먼즈', 'men', 'mens', 'women', 'womens', 'unisex', '정품', '신상', '신상품', 'new', 'sale', 'the'])

/** 모델명 → 비교용 토큰. 브랜드 표기와 성별 표기는 빼요. */
export function modelTokens(model, brandKey = null) {
  const brandTokens = (brandKey && KEY_TO_TOKENS.get(brandKey)) || new Set()
  const out = []
  for (const t of normalizeText(model).split(' ')) {
    if (!t || STOP.has(t) || brandTokens.has(t)) continue
    if (!out.includes(t)) out.push(t)
  }
  return out
}

function editDistance(a, b) {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

// 토큰 두 개의 닮은 정도 0~1. 숫자가 든 토큰(모델 번호)은 같아야만 인정하고, 나머지는 글자 4개 이상일 때 편집거리 비율이 0.75 이상이면 부분 점수를 줘요.
function tokenSim(a, b) {
  if (a === b) return 1
  if (/\d/.test(a) || /\d/.test(b)) return 0
  if (Math.min(a.length, b.length) < 4) return 0
  const ratio = 1 - editDistance(a, b) / Math.max(a.length, b.length)
  return ratio >= 0.75 ? ratio * 0.8 : 0
}

/** 모델명 토큰 두 목록의 닮은 정도 0~1 (Dice 방식: 2×겹침 / (개수 합)). */
export function modelSimilarity(ta, tb) {
  if (!ta.length || !tb.length) return 0
  const used = new Set()
  let sum = 0
  for (const a of ta) {
    let best = 0
    let bj = -1
    tb.forEach((b, j) => {
      if (used.has(j)) return
      const s = tokenSim(a, b)
      if (s > best) {
        best = s
        bj = j
      }
    })
    if (bj >= 0) {
      used.add(bj)
      sum += best
    }
  }
  return (2 * sum) / (ta.length + tb.length)
}

const CATEGORIES = ['top', 'bottom', 'outer', 'dress', 'shoes']
const GENDERS = ['female', 'male', 'unisex']
const pickEnum = (v, list) => (list.includes(v) ? v : null)

/** 상품 주소 → 쿼리·해시를 뺀 'origin/path' (http/https만). 아니면 null. */
export function cleanUrl(u) {
  try {
    const x = new URL(String(u))
    if (x.protocol !== 'http:' && x.protocol !== 'https:') return null
    return (x.origin + x.pathname).replace(/\/+$/, '').slice(0, 300)
  } catch {
    return null
  }
}

const cell = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? v : null) : typeof v === 'string' ? v.slice(0, 20) : null)

function cleanChart(c) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.rows) || c.rows.length === 0) return null
  const headers = Array.isArray(c.headers) ? c.headers.slice(0, SIZE_CHART_DB.maxCols).map((h) => String(h ?? '').slice(0, 30)) : []
  const rows = c.rows
    .slice(0, SIZE_CHART_DB.maxRows)
    .filter(Array.isArray)
    .map((r) => r.slice(0, SIZE_CHART_DB.maxCols).map(cell))
  if (rows.length === 0) return null
  const measures = {}
  if (c.measures && typeof c.measures === 'object') {
    for (const [size, parts] of Object.entries(c.measures).slice(0, SIZE_CHART_DB.maxRows)) {
      if (!parts || typeof parts !== 'object') continue
      const o = {}
      for (const [k, v] of Object.entries(parts).slice(0, SIZE_CHART_DB.maxCols)) if (typeof v === 'number' && Number.isFinite(v)) o[String(k).slice(0, 30)] = v
      measures[String(size).slice(0, 30)] = o
    }
  }
  return { unit: typeof c.unit === 'string' ? c.unit.slice(0, 8) : 'cm', headers, rows, measures }
}

/**
 * 저장할 항목으로 정리해요. 허용한 필드만 남기고 나머지는 버려요.
 * 사이즈표가 없거나 상품을 가리킬 단서(주소·품번·모델명)가 없으면 null.
 */
export function toEntry(input, now = Date.now()) {
  if (!input || typeof input !== 'object') return null
  const chart = cleanChart(input.sizeChart)
  if (!chart) return null
  const model = String(input.model ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120)
  const brand = String(input.brand ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
  const brandKey = brandKeyOfName(brand) || detectBrand(model)
  const code = String(input.code ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
  const codeNorm = normalizeCode(code)
  const url = cleanUrl(input.url)
  if (!url && !model && codeNorm.length < SIZE_CHART_DB.codeMinLen) return null
  return {
    id: '',
    url,
    brand: brand || (brandKey && !BRAND_ALIASES[brandKey] ? brandKey : brand),
    brandKey,
    model,
    code,
    codeNorm: codeNorm.length >= SIZE_CHART_DB.codeMinLen ? codeNorm : '',
    category: pickEnum(input.category, CATEGORIES),
    gender: pickEnum(input.gender, GENDERS),
    sizeChart: chart,
    savedAt: now,
    updatedAt: now,
  }
}

/**
 * 분석한 상품 → 저장 입력. 사이즈표를 읽지 못했으면 null(저장하지 않아요).
 * 상품 필드 중 name, chartBrand, chartCode, category, targetGender.gender(또는 문자열), sizeChart만 봐요. 후기·체형은 보지 않아요.
 */
export function chartRecordFromProduct(product, { pageUrl = null } = {}) {
  if (!product?.sizeChart?.rows?.length) return null
  const tg = product.targetGender
  const gender = typeof tg === 'string' ? tg : tg?.gender ?? null
  return {
    brand: product.chartBrand || '',
    model: product.name || '',
    code: product.chartCode || '',
    category: product.category,
    gender,
    url: product.url || pageUrl,
    sizeChart: product.sizeChart,
  }
}

const sameProduct = (a, b) => (a.url && b.url && a.url === b.url) || (a.codeNorm && b.codeNorm && a.codeNorm === b.codeNorm && a.brandKey && a.brandKey === b.brandKey)

/** 질의와 항목 하나의 점수(0~100)와 근거. 품번이 정확히 같으면 90~100, 그 밖에는 최대 89. */
export function scoreEntry(query, entry) {
  const reasons = []
  const qBrand = query.brandKey
  const qCode = query.codeNorm
  const brandBad = qBrand && entry.brandKey && qBrand !== entry.brandKey
  let catPenalty = 0
  let genPenalty = 0
  const qCat = query.category
  if (qCat && entry.category) {
    if (qCat === entry.category) reasons.push('카테고리 일치')
    else {
      catPenalty = 25
      reasons.push(`카테고리 불일치(-${catPenalty})`)
    }
  }
  const qGen = query.gender
  if (qGen && entry.gender) {
    if (qGen === entry.gender) reasons.push('대상 성별 일치')
    else if (qGen === 'unisex' || entry.gender === 'unisex') {
      genPenalty = 3
      reasons.push(`대상 성별 공용 혼합(-${genPenalty})`)
    } else {
      genPenalty = 20
      reasons.push(`대상 성별 불일치(-${genPenalty})`)
    }
  }
  if (qCode && entry.codeNorm && qCode === entry.codeNorm && !brandBad) {
    const score = Math.max(90, 100 - Math.round(catPenalty / 5) - Math.round(genPenalty / 4))
    return { score, reasons: ['품번 정확 일치', ...reasons] }
  }
  let score = 0
  if (qBrand && entry.brandKey) {
    if (brandBad) {
      score -= 35
      reasons.push('브랜드 불일치(-35)')
    } else {
      score += 30
      reasons.push('브랜드 일치(+30)')
    }
  } else if (qBrand || entry.brandKey) {
    score += 8
    reasons.push('브랜드 한쪽만 알려짐(+8)')
  }
  const sim = modelSimilarity(modelTokens(query.model, qBrand), modelTokens(entry.model, entry.brandKey || qBrand))
  if (sim > 0) {
    const pts = Math.round(sim * 60)
    score += pts
    reasons.push(`모델명 유사도 ${Math.round(sim * 100)}%(+${pts})`)
  }
  if (qCat && entry.category && catPenalty === 0) score += 10
  if (qGen && entry.gender && qGen === entry.gender) score += 5
  score -= catPenalty + genPenalty
  if (qCode && entry.codeNorm && qCode !== entry.codeNorm && qCode.slice(0, 5) === entry.codeNorm.slice(0, 5) && qCode.length >= 5) {
    score += 5
    reasons.push('품번 앞부분 비슷(+5)')
  }
  return { score: Math.max(0, Math.min(89, score)), reasons }
}

const publicView = (e) => ({ id: e.id, url: e.url, brand: e.brand, brandKey: e.brandKey, model: e.model, code: e.code, category: e.category, gender: e.gender, sizeChart: e.sizeChart, updatedAt: e.updatedAt })

/**
 * 사이즈표 모음을 만들어요. adapter는 { get(key), set(key, value)→Promise<boolean>, remove(key) }.
 * 서버 DB로 바꿀 때는 같은 put/search/list/clear를 가진 객체를 만들면 돼요(이 함수가 돌려주는 모양이 인터페이스예요).
 */
export function createSizeChartDb(adapter, opts = {}) {
  const lim = { ...SIZE_CHART_DB, ...(opts.limits || {}) }
  const empty = () => ({ schemaVersion: SIZE_CHART_DB_VERSION, entries: [] })

  async function load() {
    const raw = await adapter.get(SIZE_CHART_DB_KEY)
    if (!raw) return empty()
    if (raw.schemaVersion !== SIZE_CHART_DB_VERSION || !Array.isArray(raw.entries)) {
      await adapter.remove(SIZE_CHART_DB_KEY)
      return empty()
    }
    return { schemaVersion: SIZE_CHART_DB_VERSION, entries: raw.entries.filter((e) => e && typeof e === 'object' && e.sizeChart) }
  }

  const byRecent = (a, b) => b.updatedAt - a.updatedAt

  return {
    /** 저장하거나 갱신해요. @returns {{ saved:boolean, updated?:boolean, reason?:string, dropped?:number, total?:number }} */
    async put(input, now = opts.now ?? Date.now()) {
      const entry = toEntry(input, now)
      if (!entry) return { saved: false, reason: 'no-chart' }
      const state = await load()
      const idx = state.entries.findIndex((e) => sameProduct(e, entry))
      const updated = idx >= 0
      if (updated) {
        entry.id = state.entries[idx].id
        entry.savedAt = state.entries[idx].savedAt
        state.entries.splice(idx, 1)
      } else {
        const seed = `${entry.url || ''}|${entry.brandKey || ''}|${entry.codeNorm}|${normalizeText(entry.model)}`
        let h = 5381
        for (let i = 0; i < seed.length; i++) h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0
        entry.id = `${h.toString(36)}${now.toString(36)}`
      }
      let list = [entry, ...state.entries].sort(byRecent)
      let dropped = 0
      if (list.length > lim.maxEntries) {
        dropped += list.length - lim.maxEntries
        list = list.slice(0, lim.maxEntries)
      }
      const build = (l) => ({ schemaVersion: SIZE_CHART_DB_VERSION, entries: l })
      while (list.length > 1 && JSON.stringify(build(list)).length > lim.maxBytes) {
        const cut = Math.max(1, Math.floor(list.length * 0.1))
        list = list.slice(0, list.length - cut)
        dropped += cut
      }
      let saved = await adapter.set(SIZE_CHART_DB_KEY, build(list))
      if (!saved && list.length > 1) {
        const keep = Math.floor(list.length / 2)
        dropped += list.length - keep
        list = list.slice(0, keep)
        saved = await adapter.set(SIZE_CHART_DB_KEY, build(list))
      }
      return { saved, updated: saved && updated, dropped, total: list.length }
    },

    /** 최근 갱신순 목록. */
    async list() {
      return (await load()).entries.slice().sort(byRecent).map(publicView)
    },

    /**
     * 브랜드·모델명·품번·카테고리·성별로 찾아요. @returns {Promise<Array<{ score:number, reasons:string[], entry:object }>>} 점수순(같으면 최근순).
     * 질의에 브랜드·모델명·품번이 하나도 없으면 빈 배열이에요.
     */
    async search({ brand = '', model = '', code = '', category = null, gender = null } = {}, o = {}) {
      const query = {
        brandKey: brandKeyOfName(brand) || detectBrand(model),
        model: String(model ?? ''),
        codeNorm: normalizeCode(code).length >= lim.codeMinLen ? normalizeCode(code) : '',
        category: pickEnum(category, CATEGORIES),
        gender: pickEnum(gender, GENDERS),
      }
      if (!query.brandKey && !normalizeText(query.model) && !query.codeNorm) return []
      const min = o.minScore ?? lim.minScore
      const out = []
      for (const e of (await load()).entries) {
        const s = scoreEntry(query, e)
        if (s.score >= min) out.push({ score: s.score, reasons: s.reasons, entry: publicView(e) })
      }
      return out.sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt).slice(0, o.limit ?? lim.maxResults)
    },

    /** 모두 지워요. */
    async clear() {
      await adapter.remove(SIZE_CHART_DB_KEY)
    },
  }
}
