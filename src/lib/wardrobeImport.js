// 확장에서 만든 옷장 항목을 웹 옷장으로 옮기는 순수 로직 (저장·전송 없음).
// 확장은 사용자가 누를 때만 JSON을 클립보드에 복사하고, 웹 옷장은 붙여넣거나 고른 파일을 여기서 검사해요.
// 가져오는 데이터는 믿지 않습니다: 모양·길이·범위를 검사하고, 모르는 키는 버리고, http/https 주소만 남겨요.
import { CATEGORY_LABEL } from '../data/measurements.js'
import { SHOE_STATUSES, SHOE_UNSUPPORTED_NOTE, resolveShoeSizeMm, shoeGender } from './shoeFit.js'

export const ENVELOPE_APP = 'fitcheck'
export const ENVELOPE_KIND = 'wardrobe-item'
export const ENVELOPE_VERSION = 1

export const LIMITS = {
  text: 300000,
  name: 120,
  mall: 30,
  nick: 20,
  review: 600,
  reviews: 20,
  photosPerReview: 5,
  photosTotal: 40,
  url: 500,
  size: 20,
  label: 20,
  parts: 12,
}

const REASONS = {
  empty: '붙여넣은 내용이 없어요.',
  tooLong: '내용이 너무 길어요. 확장에서 복사한 글이 맞는지 확인해주세요.',
  notJson: '핏체크 확장에서 복사한 글이 아니에요. 처음부터 끝까지 그대로 붙여넣어주세요.',
  envelope: '핏체크 옷장 항목이 아니거나 지원하지 않는 버전이에요.',
  item: '옷 정보를 읽지 못했어요. 상품 이름과 종류가 있는지 확인해주세요.',
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
// 제어 문자를 지우고 길이를 자릅니다. 문자열이 아니면 null.
function str(v, max) {
  if (typeof v !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  return s.slice(0, max)
}
// http/https 주소만. javascript:, data:, file: 등과 너무 긴 주소는 버립니다.
export function safeUrl(v) {
  if (typeof v !== 'string' || v.length > LIMITS.url) return null
  const s = v.trim()
  if (!/^https?:\/\//i.test(s)) return null
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : null
  } catch {
    return null
  }
}
const inRange = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null)

function sanitizeMeasures(raw) {
  if (raw == null) return null
  if (!isObj(raw)) return undefined
  const out = {}
  // 키 이름 검사를 먼저 하고 그 뒤에 개수를 자릅니다 (버려질 키가 유효한 키를 밀어내지 않게).
  for (const k of Object.keys(raw)) {
    if (Object.keys(out).length >= LIMITS.parts) break
    if (!/^[A-Za-z]{1,20}$/.test(k)) continue
    const n = inRange(raw[k], 0, 1000)
    if (n != null) out[k] = n
  }
  return Object.keys(out).length ? out : null
}

function sanitizeVerdicts(raw) {
  if (raw == null) return []
  if (!Array.isArray(raw)) return undefined
  const out = []
  for (const v of raw.slice(0, LIMITS.parts)) {
    if (!isObj(v)) continue
    const part = str(v.part, 20)
    const label = str(v.label, LIMITS.label)
    const verdict = str(v.verdict, LIMITS.label)
    const key = str(v.key, 20)
    if (!part || !label || !verdict || !key || !/^[A-Za-z0-9-]+$/.test(key)) continue
    out.push({ part, label, verdict, key, ease: inRange(v.ease, -1000, 1000) })
  }
  return out
}

function sanitizeReview(r) {
  if (!isObj(r)) return null
  const text = str(r.text, LIMITS.review) || ''
  // 리뷰 사진은 https 주소만, 같은 주소는 한 번만 남깁니다.
  const photos = Array.isArray(r.photos)
    ? [...new Set(r.photos.map(safeUrl).filter((u) => u && /^https:\/\//i.test(u)))].slice(0, LIMITS.photosPerReview)
    : []
  if (!text && photos.length === 0) return null
  return {
    nick: str(r.nick, LIMITS.nick) || '',
    text,
    photos,
    height: inRange(r.height, 100, 230),
    weight: inRange(r.weight, 30, 200),
    size: str(r.size, LIMITS.size) || null,
    fitLabel: str(r.fitLabel, LIMITS.label) || null,
    similarity: inRange(r.similarity, 0, 100),
  }
}

function sanitizeReviews(raw) {
  if (raw == null) return []
  if (!Array.isArray(raw)) return undefined
  const out = []
  let photoCount = 0
  for (const r of raw) {
    if (out.length >= LIMITS.reviews) break
    const s = sanitizeReview(r)
    if (!s) continue
    const room = LIMITS.photosTotal - photoCount
    s.photos = s.photos.slice(0, Math.max(0, room))
    if (!s.text && s.photos.length === 0) continue
    photoCount += s.photos.length
    out.push(s)
  }
  return out
}

// 옷장 항목(makeWardrobeItem과 같은 모양 + source, reviews)으로 만듭니다. 잘못된 입력이면 null.
export function sanitizeItem(raw, { now = Date.now() } = {}) {
  if (!isObj(raw)) return null
  const p = raw.product
  if (!isObj(p)) return null
  const name = str(p.name, LIMITS.name)
  if (!name || !Object.prototype.hasOwnProperty.call(CATEGORY_LABEL, p.category)) return null
  const measures = sanitizeMeasures(raw.measures)
  const verdicts = sanitizeVerdicts(raw.verdicts)
  const reviews = sanitizeReviews(raw.reviews)
  if (measures === undefined || verdicts === undefined || reviews === undefined) return null
  if (raw.size != null && typeof raw.size !== 'string') return null
  const size = raw.size == null ? null : str(raw.size, LIMITS.size) || null
  // 신발은 판정이 비어 있어도 조용히 두지 않고 이유를 남겨요 (verdictStatus는 허용 목록만, 설명 글은 받은 글을 믿지 않고 새로 만듭니다).
  let status = null
  let note = ''
  let outMeasures = measures
  if (p.category === 'shoes') {
    if (raw.verdictStatus != null && !SHOE_STATUSES.includes(raw.verdictStatus)) return null
    if (verdicts.length === 0) {
      const r = size ? resolveShoeSizeMm(size, { gender: shoeGender(null, name), productName: name }) : null
      if (r?.converted) {
        status = 'converted'
        note = r.text
        outMeasures = measures || { footLength: r.mm }
      } else {
        status = 'unsupported'
        note = SHOE_UNSUPPORTED_NOTE
      }
    }
  }
  return {
    id: `w${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    savedAt: now,
    product: {
      name,
      mall: str(p.mall, LIMITS.mall) || '',
      category: p.category,
      image: safeUrl(p.image),
      emoji: null,
      url: safeUrl(p.url) || '',
    },
    size,
    measures: outMeasures,
    verdicts,
    image: null,
    imageKind: null,
    source: 'extension',
    reviews,
    ...(status ? { verdictStatus: status, verdictNote: note } : {}),
  }
}

// analyzePage 결과(status 'ok')에서 내보낼 봉투를 만듭니다. 항상 sanitizeItem을 거쳐서 가져오기에서 통과하는 모양만 나가요.
export function buildExportEnvelope(result, { now = Date.now() } = {}) {
  const ex = result?.exportData
  if (!result || result.status !== 'ok' || !ex) return null
  const views = [...(result.reviewViews?.matched || []), ...(result.reviewViews?.others || [])]
  const item = sanitizeItem(
    {
      product: { name: result.name, mall: ex.mall, category: ex.category, image: ex.image, url: ex.url },
      size: ex.size,
      measures: ex.measures,
      verdicts: ex.verdicts,
      reviews: views.map((v) => ({
        nick: v.nick, text: v.text, photos: v.photos, height: v.height, weight: v.weight,
        size: v.size, fitLabel: v.fitLabel, similarity: v.similarity,
      })),
    },
    { now },
  )
  if (!item) return null
  return { app: ENVELOPE_APP, kind: ENVELOPE_KIND, v: ENVELOPE_VERSION, item }
}

// 붙여넣은 글 → { ok: true, item } | { ok: false, reason }
export function parseImportText(text, { now = Date.now() } = {}) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: REASONS.empty }
  if (text.length > LIMITS.text) return { ok: false, reason: REASONS.tooLong }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, reason: REASONS.notJson }
  }
  return parseEnvelopeData(data, { now })
}

// 이미 JSON으로 풀린 봉투 → { ok: true, item } | { ok: false, reason }. 붙여넣기와 자동 전달이 같은 검사를 써요.
export function parseEnvelopeData(data, { now = Date.now() } = {}) {
  if (!isObj(data) || data.app !== ENVELOPE_APP || data.kind !== ENVELOPE_KIND || data.v !== ENVELOPE_VERSION) return { ok: false, reason: REASONS.envelope }
  const item = sanitizeItem(data.item, { now })
  if (!item) return { ok: false, reason: REASONS.item }
  return { ok: true, item }
}

// 가져온 항목을 맨 앞에 넣습니다. 같은 상품·같은 사이즈가 이미 있으면 그 항목의 id·합성 이미지·종류는 이어받고
// 확장에서 온 정보(치수·판정·리뷰)만 새 값으로 바꿔요. 개수 제한은 saveWardrobe가 지킵니다.
export function addImportedItem(list, item) {
  const same = (w) => item.product.url && w.product?.url === item.product.url && w.size === item.size
  const prev = (list || []).find(same)
  const rest = (list || []).filter((w) => !same(w))
  const next = prev ? { ...item, id: prev.id, image: prev.image ?? null, imageKind: prev.imageKind ?? null } : item
  return [next, ...rest]
}
