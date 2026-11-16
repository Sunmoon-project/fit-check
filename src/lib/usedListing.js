// 중고 판매글(번개장터·후르츠패밀리 등) 읽기와 판매글 텍스트 파서. 순수 함수라 웹 앱·크롬 확장이 같이 써요.
//
// 중요: 이 환경에서는 번개장터·후르츠패밀리 실제 페이지를 열어보지 못했어요. 아래 도메인은 추정이고,
// 페이지 읽기는 사이트별 구조를 아는 것이 아니라 일반 규칙(og:title, og:description, JSON-LD Product, 본문 영역 글)에만 기대요.
// 실제 사이트에서 동작한다고 확인한 것이 아니에요. 그래서 판매글 파서는 가짜 HTML·글로만 테스트했어요.
//
// 이 파일은 네트워크를 쓰지 않고, 읽은 글을 저장하거나 전송하지 않아요.
import { classifyCategory } from './categoryClassifier.js'
import { genderFromText } from './targetGender.js'
import { detectBrand, brandKeyOfName, normalizeCode } from './sizeChartDb.js'

export const USED_SITES = Object.freeze([
  { id: 'bunjang', name: '번개장터', hosts: ['bunjang.co.kr', 'www.bunjang.co.kr', 'm.bunjang.co.kr'] },
  { id: 'fruitsfamily', name: '후르츠패밀리', hosts: ['fruitsfamily.com', 'www.fruitsfamily.com'] },
])
export const USED_SITES_NOTE = '번개장터·후르츠패밀리 주소는 추정이고 실제 사이트에서 확인하지 못했어요. 페이지 읽기는 일반 규칙(og 태그, JSON-LD, 본문 글) 기반이라 사이트 구조가 다르면 일부만 읽힐 수 있어요.'

/** 주소(또는 호스트 이름) → 중고 사이트 정보. 아니면 null. */
export function usedSiteOf(urlOrHost) {
  let host = ''
  try {
    host = /^[a-z]+:\/\//i.test(urlOrHost) ? new URL(urlOrHost).hostname : String(urlOrHost || '')
  } catch {
    host = ''
  }
  host = host.toLowerCase()
  if (!host) return null
  for (const s of USED_SITES) if (s.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return { id: s.id, name: s.name }
  return null
}

// ---------- 판매글 텍스트 파서 ----------

const ALPHA = 'XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-5]XL|FREE|F'
// 부위 말: key와 값 검증 범위(cm). sec는 단면(옷을 펴서 잰 폭) 범위, circ는 둘레 범위. 겹치는 구간은 단면/둘레를 알 수 없어요.
const PARTS = [
  // 화장(어깨+소매): 목 뒤 중심에서 소매 끝까지. 어깨너비를 알면 소매길이(화장 − 어깨/2)로 바꿔 써요.
  { key: 'yuki', re: '어깨\\s?\\+\\s?소매|화장', range: [55, 100] },
  { key: 'shoulder', re: '어깨(?:\\s?(?:너비|넓이))?', range: [30, 65] },
  { key: 'chest', re: '가슴(?:\\s?(?:둘레|단면))?|품(?:\\s?(?:둘레|단면))?', sec: [35, 75], circ: [70, 150] },
  { key: 'length', re: '총\\s?장|총\\s?기장|전체\\s?길이|기장|길이', range: [35, 150] },
  { key: 'arm', re: '소매(?:\\s?(?:길이|장))?|팔\\s?길이', range: [40, 80] },
  { key: 'waist', re: '허리(?:\\s?(?:둘레|단면))?', sec: [28, 60], circ: [56, 120] },
  { key: 'hip', re: '엉덩이(?:\\s?(?:둘레|단면))?|힙(?:\\s?(?:둘레|단면))?', sec: [35, 65], circ: [70, 130] },
  { key: 'thigh', re: '허벅지(?:\\s?(?:둘레|단면))?', sec: [20, 45], circ: [40, 90] },
  { key: 'rise', re: '밑위', range: [15, 45] },
  { key: 'innerLeg', re: '인심|안\\s?기장', range: [50, 100] },
]
export const PART_WORD = Object.freeze({ shoulder: '어깨', chest: '가슴', length: '총장', arm: '소매', waist: '허리', hip: '엉덩이', thigh: '허벅지', rise: '밑위', innerLeg: '인심' })
const WORD_ALT = PARTS.map((p) => `(?:${p.re})`).join('|')
const PART_TEST = PARTS.map((p) => ({ ...p, test: new RegExp(`^(?:${p.re})$`) }))
const MEASURE_RE_SRC = `(?<![가-힣A-Za-z])(${WORD_ALT})(?:\\s*\\((?:상의|하의|아우터|원피스)\\))?\\s*(단면|둘레)?\\s*[:=]?\\s*(\\d{1,3}(?:\\.\\d)?)\\s*(cm|㎝|센치|mm|㎜|인치|inch)?\\s*(?:\\(?\\s*(단면|둘레)\\s*\\)?)?`
const BARE_SECTION_RE = /(?<![가-힣A-Za-z])단면\s*[:=]?\s*(\d{1,3}(?:\.\d)?)\s*(?:cm|㎝|센치)?/g
const HEADER_RE = new RegExp(`(?:^|[\\n/|,;·•])[ \\t]*(?:사이즈|size)?[ \\t]*[\\[(]?[ \\t]*(${ALPHA}|9\\d|1[0-2]\\d|2[4-9]|3\\d|40)[ \\t]*[\\])]?[ \\t]*[:：\\-]?[ \\t]*(?=(?:${WORD_ALT}))`, 'gi')

const inRange = (v, r) => !!r && v >= r[0] && v <= r[1]
// 계산에 쓰는 부위 키 이름으로 바꿔요(총장은 종류에 따라 다름)
const LENGTH_KEY = { top: 'topLength', outer: 'outerLength', dress: 'dressLength', bottom: 'inseam' }

/** 값 하나를 검증해 둘레(cm)로 바꿔요. 못 쓰면 { drop: 'range'|'ambiguous' }. kind: 'section'(단면×2) | 'circ'(둘레) | 'direct' */
function resolveValue(part, v, hint, globalHint) {
  if (part.range) return inRange(v, part.range) ? { cm: v, kind: 'direct', inferred: false } : { drop: 'range' }
  const asSec = inRange(v, part.sec)
  const asCirc = inRange(v, part.circ)
  const make = (kind, inferred) => ({ cm: kind === 'section' ? Math.round(v * 2 * 10) / 10 : v, kind, inferred })
  if (hint === 'section') return asSec ? make('section', false) : { drop: 'range' }
  if (hint === 'circ') return asCirc ? make('circ', false) : { drop: 'range' }
  if (globalHint === 'section' && asSec) return make('section', false)
  if (globalHint === 'circ' && asCirc) return make('circ', false)
  if (asSec && asCirc) return { drop: 'ambiguous' }
  if (asSec) return make('section', true)
  if (asCirc) return make('circ', true)
  return { drop: 'range' }
}

function parseMeasures(text, category, globalHint, stats) {
  const out = {}
  let rest = text
  const re = new RegExp(MEASURE_RE_SRC, 'g')
  const spans = []
  for (const m of text.matchAll(re)) {
    spans.push([m.index, m.index + m[0].length])
    const part = PART_TEST.find((p) => p.test.test(m[1].replace(/\s+/g, ' ').replace(/(단면|둘레)$/, '').trim()) || p.test.test(m[1].replace(/\s+/g, ' ').trim()))
    if (!part) continue
    const wordHint = /단면$/.test(m[1]) ? 'section' : /둘레$/.test(m[1]) ? 'circ' : null
    const hint = wordHint || (m[2] === '단면' ? 'section' : m[2] === '둘레' ? 'circ' : m[5] === '단면' ? 'section' : m[5] === '둘레' ? 'circ' : null)
    let v = Number(m[3])
    const unit = (m[4] || '').toLowerCase()
    if (/mm|㎜/.test(unit)) {
      stats.dropped += 1
      continue
    }
    if (/인치|inch/.test(unit)) v = Math.round(v * 2.54 * 10) / 10
    const r = resolveValue(part, v, /인치|inch/.test(unit) ? 'circ' : hint, globalHint)
    if (r.drop) {
      stats.dropped += 1
      if (r.drop === 'ambiguous') stats.ambiguous += 1
      continue
    }
    const key = part.key === 'length' ? LENGTH_KEY[category] || null : part.key
    if (!key) {
      stats.dropped += 1
      continue
    }
    if (out[key]) continue // 같은 부위가 여러 번 나오면 처음 값만 써요
    out[key] = { cm: r.cm, kind: r.kind, raw: Number(m[3]), inferred: r.inferred, bare: false }
  }
  if (out.yuki) {
    if (out.shoulder && !out.arm) out.arm = { cm: Math.round((out.yuki.cm - out.shoulder.cm / 2) * 10) / 10, kind: 'yuki', raw: out.yuki.raw, inferred: true, bare: false }
    else stats.dropped += 1
    delete out.yuki
  }
  // 부위 이름 없이 '단면 55'만 있으면 가슴 단면으로 추정해요(상의·아우터·원피스만)
  for (const [a, b] of spans) rest = rest.slice(0, a) + ' '.repeat(b - a) + rest.slice(b)
  if ((category === 'top' || category === 'outer' || category === 'dress') && !out.chest) {
    for (const m of rest.matchAll(BARE_SECTION_RE)) {
      const v = Number(m[1])
      if (inRange(v, PARTS.find((x) => x.key === 'chest').sec)) {
        out.chest = { cm: Math.round(v * 2 * 10) / 10, kind: 'section', raw: v, inferred: true, bare: true }
        break
      }
      stats.dropped += 1
    }
  }
  return out
}

const SIZE_KIND = (label) => {
  const u = String(label).toUpperCase()
  if (u === 'FREE' || u === 'F') return 'free'
  if (new RegExp(`^(?:${ALPHA})$`).test(u)) return 'alpha'
  const n = Number(label)
  if (/^\d{3}$/.test(label) && n >= 90 && n <= 130) return 'kr-top'
  if (/^\d{3}$/.test(label) && n >= 220 && n <= 310) return 'mm'
  if (/^\d{2}$/.test(label) && n >= 24 && n <= 40) return 'inch'
  return 'other'
}
const normSize = (s) => String(s).replace(/\s+/g, '').toUpperCase()

function addSize(list, label, source) {
  const l = String(label).trim()
  if (!l) return
  if (list.some((x) => normSize(x.label) === normSize(l))) return
  list.push({ label: /^[a-z]+$/i.test(l) ? l.toUpperCase() : l, kind: /^(US|UK|EU)/i.test(l) ? 'foreign' : SIZE_KIND(l), source })
}

function findSizes(title, text) {
  const sizes = []
  const scan = (s, source) => {
    for (const line of String(s).split('\n')) {
      for (const m of line.matchAll(new RegExp(`(?:사이즈|size)\\s*[:：=\\-]?\\s*[\\[(]?\\s*(${ALPHA})(?![A-Za-z])`, 'gi'))) addSize(sizes, m[1], source)
      for (const m of line.matchAll(new RegExp(`(?<![A-Za-z0-9])(${ALPHA})\\s*(?:사이즈|size)`, 'gi'))) addSize(sizes, m[1], source)
      for (const m of line.matchAll(new RegExp(`[\\[(]\\s*(${ALPHA})\\s*[\\])]`, 'g'))) addSize(sizes, m[1], source)
      for (const m of line.matchAll(/[[(]\s*(\d{2,3})\s*[\])]/g)) if (SIZE_KIND(m[1]) !== 'other') addSize(sizes, m[1], source)
      for (const m of line.matchAll(/(?:사이즈|size)\s*[:：=]?\s*(\d{2,3})(?!\d)/gi)) if (SIZE_KIND(m[1]) !== 'other') addSize(sizes, m[1], source)
      for (const m of line.matchAll(/(?<![\d.])(\d{2,3})\s*(?:사이즈|size)/gi)) if (SIZE_KIND(m[1]) !== 'other') addSize(sizes, m[1], source)
      for (const m of line.matchAll(/(?<![\d.])(\d{2})\s*(?:인치|inch)/gi)) if (SIZE_KIND(m[1]) === 'inch') addSize(sizes, m[1], source)
      for (const m of line.matchAll(/(?<![A-Za-z0-9])W\s?(\d{2})(?![\d])/g)) if (SIZE_KIND(m[1]) === 'inch') addSize(sizes, m[1], source)
      for (const m of line.matchAll(/(?<![\d.])(2[2-9]\d|3[01]\d)\s*(?:mm|㎜)/gi)) addSize(sizes, m[1], source)
      for (const m of line.matchAll(/(?<![A-Za-z])((?:US|UK|EU)\s?\d{1,2}(?:\.5)?)(?![\d])/gi)) addSize(sizes, m[1].toUpperCase().replace(/\s+/, ' '), source)
    }
  }
  if (title) {
    scan(title, 'title')
    const tail = String(title).trim().match(new RegExp(`(?:^|\\s)(${ALPHA})$`))
    if (tail) addSize(sizes, tail[1], 'title')
  }
  scan(text, 'text')
  return sizes.slice(0, 8)
}

const MODEL_NOISE = /무료\s*배송|무배|택배|반택|직거래|새\s*상품|새상품|새제품|미개봉|풀박스|정품|급처|최저가|가격\s*인하|네고|[SABC]\+?급|거의\s*새것|상태\s*(좋음|최상)|사이즈/gi
function modelFrom(title, text) {
  const label = String(text).match(/(?:모델명|상품명|제품명)\s*[:：]\s*([^\n]{2,80})/)
  let m = label ? label[1] : String(title || '').split('\n')[0] || String(text).split('\n')[0] || ''
  m = m.normalize('NFKC')
  const cut = m.search(new RegExp(`(?<![가-힣A-Za-z])(?:${WORD_ALT})\\s*[:=]?\\s*\\d`))
  if (cut > 0) m = m.slice(0, cut)
  m = m
    .replace(/(?<![\d.])\d{2,3}\s*(?:사이즈|size)/gi, ' ')
    .replace(/[[(][^\])]{0,20}[\])]/g, ' ')
    .replace(MODEL_NOISE, ' ')
    .replace(new RegExp(`(?<![A-Za-z0-9])(?:${ALPHA})(?![A-Za-z0-9])`, 'g'), ' ')
    .replace(/[~!@#$%^&*_+=|\\<>?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:：/\-]+|[\s:：/\-]+$/g, '')
  return m.slice(0, 80)
}

function codeFrom(text) {
  const labeled = String(text).match(/(?:품번|모델\s*번호|제품\s*번호|상품\s*번호|스타일\s*(?:코드|넘버)|style\s*(?:no|code|#)?|article\s*(?:no|number)?|art\.?\s*no|sku)\.?\s*[:：#]?\s*([A-Za-z0-9][A-Za-z0-9\-_/. ]{3,22})/i)
  if (labeled) {
    const c = labeled[1].trim().split(/\s{2,}|[,;\n]/)[0].trim()
    if (normalizeCode(c).length >= 4) return c.slice(0, 24)
  }
  const bare = String(text).match(/(?<![A-Za-z0-9])([A-Z]{1,3}\d{3,5}[- ]\d{2,3}|[A-Z]{2}\d{4,5})(?![A-Za-z0-9])/)
  return bare && normalizeCode(bare[1]).length >= 6 ? bare[1].replace(/\s/, '-') : ''
}

function brandFrom(title, text) {
  const label = String(text).match(/브랜드\s*[:：]\s*([^\n,/]{2,30})/)
  if (label) return { key: brandKeyOfName(label[1]), text: label[1].trim() }
  const words = String(title || String(text).split('\n')[0] || '').normalize('NFKC').split(/\s+/).filter(Boolean).slice(0, 14)
  for (let i = 0; i < words.length; i++) {
    const k = detectBrand(words.slice(i, i + 4).join(' '))
    if (k) return { key: k, text: k }
  }
  return null
}

/**
 * 판매글 글 → 읽은 값. 못 읽은 값은 null/빈 목록이에요.
 * @param {string} text 제목·본문을 줄바꿈으로 이은 글
 * @param {{ title?:string, category?:string }} [opts] category를 주면 그대로 쓰고, 없으면 제목·실측 부위 말로 추정해요
 */
export function parseListingText(text, opts = {}) {
  const t = String(text ?? '').normalize('NFKC').replace(/㎝/g, 'cm').replace(/\r/g, '').slice(0, 12000)
  const title = String(opts.title ?? '').normalize('NFKC').slice(0, 200)
  const stats = { dropped: 0, ambiguous: 0 }
  const partWords = [...t.matchAll(new RegExp(MEASURE_RE_SRC, 'g'))].map((m) => m[1])
  const cls = classifyCategory({ name: title || t.split('\n')[0].slice(0, 120), headers: [...new Set(partWords)] })
  let category = opts.category || cls.category
  // 종류 단서가 약한데 사이즈가 mm(220~310)나 인치(24~40)로만 적혀 있으면 신발/하의로 봐요.
  const sizesPre = !opts.category && cls.confidence === 'low' && cls.evidences.length === 0 ? findSizes(title, t) : []
  if (sizesPre.some((s) => s.kind === 'mm')) category = 'shoes'
  else if (sizesPre.some((s) => s.kind === 'inch') && !partWords.some((w) => /어깨|가슴/.test(w))) category = 'bottom'
  const globalHint = /단면/.test(t) && !/둘레/.test(t) ? 'section' : /둘레/.test(t) && !/단면/.test(t) ? 'circ' : null

  // 사이즈 이름으로 나뉜 실측(예: 'M 가슴 55 총장 70 / L 가슴 58 …')은 사이즈별로, 나뉘지 않으면 한 묶음(default)으로 읽어요.
  const heads = [...t.matchAll(HEADER_RE)].map((m) => ({ at: m.index + m[0].length, start: m.index, label: m[1] }))
  const bySize = {}
  const named = []
  let defaultText = t
  if (heads.length) {
    defaultText = t.slice(0, heads[0].start)
    heads.forEach((h, i) => {
      const seg = t.slice(h.at, i + 1 < heads.length ? heads[i + 1].start : t.length)
      const label = /^[a-z]+$/i.test(h.label) ? h.label.toUpperCase() : h.label
      const parts = parseMeasures(seg, category, globalHint, stats)
      if (Object.keys(parts).length) {
        bySize[label] = parts
        named.push(label)
      }
    })
  }
  const defaultParts = parseMeasures(defaultText, category, globalHint, stats)
  if (Object.keys(defaultParts).length) bySize.default = defaultParts

  const sizes = findSizes(title, t)
  for (const h of named) addSize(sizes, h, 'text')
  const measureCount = Object.values(bySize).reduce((n, p) => n + Object.keys(p).length, 0)
  const brand = brandFrom(title, t)
  return {
    brand,
    model: modelFrom(title, t),
    code: codeFrom(t),
    sizes,
    category,
    categoryConfidence: opts.category ? 'high' : cls.confidence,
    gender: genderFromText(title) || genderFromText(t.slice(0, 600)),
    measuresBySize: bySize,
    namedSizes: named,
    counts: { measureCount, sizeCount: sizes.length, droppedCount: stats.dropped, ambiguousCount: stats.ambiguous },
  }
}

// ---------- 페이지 읽기 (일반 규칙) ----------

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'BR', 'TR', 'H1', 'H2', 'H3', 'H4', 'SECTION', 'ARTICLE', 'DL', 'DT', 'DD', 'TABLE'])
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME'])

// 줄바꿈(<br>, 블록 요소)을 살려서 글을 읽어요. 깊이·길이를 제한해요.
export function textWithBreaks(el, limit = 6000) {
  let out = ''
  const walk = (n, depth) => {
    if (out.length >= limit || depth > 14) return
    if (n.nodeType === 3) {
      out += String(n.nodeValue ?? n.textContent ?? '').replace(/[ \t\r\n]+/g, ' ')
      return
    }
    if (n.nodeType !== 1) return
    const tag = String(n.tagName || '').toUpperCase()
    if (SKIP.has(tag)) return
    const kids = n.childNodes ? [...n.childNodes] : []
    if (tag === 'BR') out += '\n'
    else if (BLOCK.has(tag) && out && !out.endsWith('\n')) out += '\n'
    for (const k of kids) walk(k, depth + 1)
    if (BLOCK.has(tag) && out && !out.endsWith('\n')) out += '\n'
  }
  walk(el, 0)
  return out.replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, limit)
}

function ldProducts(root) {
  const out = []
  const visit = (n, depth = 0) => {
    if (!n || typeof n !== 'object' || depth > 4) return
    if (Array.isArray(n)) return n.forEach((x) => visit(x, depth + 1))
    const type = [].concat(n['@type'] || [])
    if (type.includes('Product')) out.push(n)
    if (n['@graph']) visit(n['@graph'], depth + 1)
  }
  for (const s of root.querySelectorAll?.('script[type="application/ld+json"]') || []) {
    try {
      visit(JSON.parse(s.textContent || ''))
    } catch {
      /* 읽을 수 없는 JSON-LD는 건너뛰어요 */
    }
  }
  return out
}

const httpsOnly = (u) => (/^https:\/\//i.test(String(u || '')) && String(u).length < 600 ? String(u) : null)
const BODY_SELECTORS = ['[class*="description" i]', '[class*="desc" i]', '[class*="content" i]', '[class*="detail" i]', '[class*="info" i]', 'article', 'main']

/** 문서에서 signal(실측·사이즈 단서) 개수를 센다 */
function signalOf(text) {
  const p = parseListingText(text)
  return p.counts.measureCount * 2 + p.counts.sizeCount
}

/**
 * 판매글 페이지에서 제목·설명·가격·사진 주소·본문 글을 읽어요(일반 규칙). 읽지 못한 값은 빈 문자열/null/빈 목록.
 * @returns {{ title:string, description:string, bodyText:string, price:{amount:number|null,currency:string}, photos:string[], sources:string[] }}
 */
const GENERIC_TITLE_RE = /^(?:번개장터|bunjang|후[르루]츠\s?패밀리|fruits\s?family)$/i
const SITE_SUFFIX_RE = /\s*[|｜]\s*(?:번개장터|후[르루]츠\s?패밀리|fruits\s?family)\s*$/i
const PRICE_LINE_RE = /^\d{1,3}(?:,\d{3})+\s*원$/

export function readListing(root) {
  const sources = []
  const meta = (sel) => clean(root.querySelector?.(sel)?.getAttribute?.('content'))
  const ld = ldProducts(root)[0] || null
  let title = meta('meta[property="og:title"]')
  if (title) sources.push('og:title')
  if (!title && ld?.name) {
    title = clean(ld.name)
    sources.push('json-ld')
  }
  // 대표 제목이 사이트 이름뿐이면(번개장터 og:title) 제목으로 쓰지 않아요.
  title = title.replace(SITE_SUFFIX_RE, '')
  if (GENERIC_TITLE_RE.test(title)) {
    title = ''
    sources.pop()
  }
  if (!title) {
    const h1 = clean(root.querySelector?.('h1')?.textContent)
    if (h1) {
      title = h1
      sources.push('h1')
    }
  }
  // 그래도 없으면 화면 글에서 가격 줄(180,000원) 바로 위 줄을 상품명으로 봐요.
  if (!title) {
    const lines = String(root.body?.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 400)
    const at = lines.findIndex((l) => PRICE_LINE_RE.test(l))
    const cand = at > 0 ? lines[at - 1] : ''
    if (cand.length >= 4 && cand.length <= 120 && /[가-힣A-Za-z]{2}/.test(cand)) {
      title = cand
      sources.push('price-line')
    }
  }
  let description = meta('meta[property="og:description"]') || meta('meta[name="description"]')
  if (description) sources.push('og:description')
  if (ld?.description && !description) {
    description = clean(ld.description)
    sources.push('json-ld')
  }
  const ldDesc = ld?.description ? String(ld.description).slice(0, 4000) : ''

  // 본문 영역: 실측·사이즈 단서가 많은 요소를 고르고, 같으면 짧은 요소를 골라요.
  let bodyText = ''
  let best = null
  for (const sel of BODY_SELECTORS) {
    let els = []
    try {
      els = [...(root.querySelectorAll?.(sel) || [])].slice(0, 40)
    } catch {
      els = []
    }
    for (const el of els) {
      const t = textWithBreaks(el, 4000)
      if (t.length < 10) continue
      const sig = signalOf(t)
      const cand = { t, sig }
      if (!best || sig > best.sig || (sig === best.sig && sig > 0 && t.length < best.t.length)) best = cand
    }
  }
  if (best && best.sig > 0) {
    bodyText = best.t
    sources.push('body')
  }

  const priceMeta = meta('meta[property="product:price:amount"]') || meta('meta[property="og:price:amount"]')
  const offer = [].concat(ld?.offers || [])[0] || null
  const amountRaw = priceMeta || offer?.price
  let amount = Number(String(amountRaw ?? '').replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) amount = null
  const currency = (meta('meta[property="product:price:currency"]') || meta('meta[property="og:price:currency"]') || clean(offer?.priceCurrency)).toUpperCase().slice(0, 3)
  if (amount == null) {
    const m = (bodyText || description || '').match(/(\d{1,3}(?:,\d{3})+)\s*원/)
    if (m) amount = Number(m[1].replace(/,/g, ''))
  }

  const photos = []
  const pushPhoto = (u) => {
    const h = httpsOnly(u)
    if (h && !/\.svg(\?|$)|icon|logo|sprite/i.test(h) && !photos.includes(h) && photos.length < 5) photos.push(h)
  }
  pushPhoto(meta('meta[property="og:image"]'))
  for (const i of [].concat(ld?.image || [])) pushPhoto(typeof i === 'string' ? i : i?.url)
  for (const img of root.querySelectorAll?.('img') || []) {
    if (photos.length >= 5) break
    pushPhoto(img.getAttribute?.('src'))
  }
  return { title: title.slice(0, 200), description: description.slice(0, 2000), ldDescription: ldDesc, bodyText, price: { amount, currency }, photos, sources }
}

/** 읽은 값 → 파서에 넣을 글 (같은 문장은 한 번만) */
export function listingText(listing) {
  const parts = []
  for (const p of [listing.title, listing.ldDescription, listing.description, listing.bodyText]) {
    const t = String(p || '').trim()
    if (t && !parts.some((x) => x.includes(t))) parts.push(t)
  }
  return parts.join('\n')
}

/** 중고 판매글 페이지로 볼 수 있는지: 알려진 중고 사이트 주소이고 제목(og:title 등)이나 JSON-LD Product가 있을 때 */
export function isUsedListingPage(root, pageUrl) {
  if (!usedSiteOf(pageUrl)) return false
  try {
    return !!readListing(root).title
  } catch {
    return false
  }
}
