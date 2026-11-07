// 확장 → 웹 옷장 자동 전달의 순수 로직 (저장·전송·DOM 없음). 서버를 거치지 않고 이 브라우저 안에서만 옮겨요.
//
// 흐름: 확장 카드의 '내 옷장으로 보내기' → chrome.storage.local 대기열(SYNC_QUEUE_KEY)에 항목 추가
//       → 웹 앱 페이지에서 도는 브리지(extension/bridge.js)가 window.postMessage로 전달
//       → 웹 앱이 검사·저장 → 처리한 항목 id를 ack로 돌려줌 → 브리지가 대기열에서 삭제
//
// 같은 창 안의 postMessage는 발신자를 완전히 증명할 수 없어요(페이지 스크립트도 같은 메시지를 만들 수 있음).
// 그래서 (1) 허용한 웹 앱 주소에서만 브리지를 켜고, (2) 브리지는 '대기열 전달'과 'ack 수신'만 하며,
// (3) 받은 데이터는 언제나 믿지 않는 입력으로 보고 wardrobeImport의 검사를 다시 거칩니다.
import { parseEnvelopeData, LIMITS } from './wardrobeImport.js'

export const SYNC_QUEUE_KEY = 'fitcheckWardrobeQueue'

// 웹 앱이 열리는 주소(출처) 목록. 여기 한 곳에서 관리하고, extension/manifest.json의 브리지 matches와 일치해야 해요(smoke가 확인).
// 배포 주소가 생기면 여기에 'https://내-주소' 를 더하고 manifest의 bridge matches에도 'https://내-주소/*' 를 더하세요.
export const WEB_APP_ORIGINS = [
  'http://localhost:5173', // npm run dev
  'http://127.0.0.1:5173',
  'http://localhost:4173', // npm run preview
  'http://127.0.0.1:4173',
]
export const WEB_APP_FILE_NAME = 'fit-check.html' // npm run build:file 로 만든 단일 HTML (file:// 로 열 때)
export const WEB_APP_OPEN_URL = `${WEB_APP_ORIGINS[0]}/`
// manifest content_scripts(bridge)에 넣을 matches. file:// 은 크롬에서 '파일 URL에 대한 액세스 허용'을 켜야 동작해요.
export const BRIDGE_MATCHES = [...WEB_APP_ORIGINS.map((o) => `${o}/*`), `file:///*/${WEB_APP_FILE_NAME}`]

export const SOURCE_EXT = 'fitcheck-ext'
export const SOURCE_WEB = 'fitcheck-web'
export const MSG_VERSION = 1
export const QUEUE_MAX = 10 // 대기열에 쌓아둘 최대 항목 수
export const QUEUE_TTL_MS = 3 * 24 * 60 * 60 * 1000 // 3일 지나면 버려요
export const ACK_MAX = 50
export const SEEN_MAX = 200 // 웹 앱이 기억하는 처리 완료 id 수

const ID_RE = /^q[a-z0-9]{6,40}$/
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// 브리지를 켜도 되는 페이지인가. loc은 { protocol, origin, pathname } (window.location 모양).
export function isAllowedPage(loc) {
  if (!isObj(loc)) return false
  if (loc.protocol === 'file:') return typeof loc.pathname === 'string' && loc.pathname.split('/').pop() === WEB_APP_FILE_NAME
  return typeof loc.origin === 'string' && WEB_APP_ORIGINS.includes(loc.origin)
}

// postMessage의 targetOrigin. file:// 페이지의 origin은 'null'(불투명)이라 지정할 수 없어 '*'를 써요.
// 어차피 받는 쪽은 같은 창(window 자신)이고, 보내는 내용은 아래 trusted 검사와 데이터 검사를 거칩니다.
export function postTargetOrigin(loc) {
  return loc?.protocol === 'file:' ? '*' : loc?.origin
}

// 받은 message 이벤트를 믿을지. 같은 창에서 온 것이고, 출처가 이 페이지와 같을 때만.
// file:// 은 origin이 문자열 'null' 이므로 그 경우만 따로 허용합니다 (다른 출처의 'null'과 구분되진 않으므로 event.source === win 이 핵심).
export function isTrustedMessage(event, win, loc) {
  if (!event || !isObj(event.data) || event.source !== win) return false
  if (loc?.protocol === 'file:') return event.origin === 'null'
  return typeof loc?.origin === 'string' && event.origin === loc.origin
}

export function newQueueId(now = Date.now(), rand = Math.random()) {
  return `q${now.toString(36)}${Math.floor(rand * 36 ** 4).toString(36).padStart(4, '0')}`
}

function validEntry(e) {
  return isObj(e) && typeof e.id === 'string' && ID_RE.test(e.id) && Number.isFinite(e.queuedAt) && isObj(e.envelope)
}
const sizeOk = (e) => JSON.stringify(e.envelope).length <= LIMITS.text

// 형식이 틀린 것·만료된 것·중복 id를 버리고, 오래된 순으로 정렬해 최대 QUEUE_MAX개만 남겨요 (넘치면 오래된 것부터 버림).
export function pruneQueue(entries, now = Date.now()) {
  if (!Array.isArray(entries)) return []
  const seen = new Set()
  const ok = []
  for (const e of entries) {
    if (!validEntry(e) || seen.has(e.id)) continue
    if (now - e.queuedAt > QUEUE_TTL_MS || e.queuedAt - now > 60 * 1000) continue
    if (!sizeOk(e)) continue
    seen.add(e.id)
    ok.push(e)
  }
  ok.sort((a, b) => a.queuedAt - b.queuedAt)
  return ok.slice(-QUEUE_MAX)
}

// 같은 상품·같은 사이즈를 다시 보내면 대기열의 이전 항목을 바꿔 넣어요 (대기열이 같은 옷으로 차지 않게).
const keyOf = (env) => `${env?.item?.product?.url || ''}\n${env?.item?.size ?? ''}`
export function enqueue(queue, envelope, { now = Date.now(), id = newQueueId(now) } = {}) {
  if (!isObj(envelope) || !isObj(envelope.item)) return { ok: false, queue: pruneQueue(queue, now) }
  const entry = { id, queuedAt: now, envelope }
  if (!validEntry(entry) || !sizeOk(entry)) return { ok: false, queue: pruneQueue(queue, now) }
  const k = keyOf(envelope)
  const rest = pruneQueue(queue, now).filter((e) => !(k !== '\n' && keyOf(e.envelope) === k))
  return { ok: true, entry, queue: pruneQueue([...rest, entry], now) }
}

export function removeAcked(queue, ids) {
  const gone = new Set(Array.isArray(ids) ? ids : [])
  return (Array.isArray(queue) ? queue : []).filter((e) => !gone.has(e?.id))
}

// ---- 메시지 ----
export const makeDeliverMessage = (entries) => ({ source: SOURCE_EXT, v: MSG_VERSION, type: 'deliver', entries })
export const makeAckMessage = (ids) => ({ source: SOURCE_WEB, v: MSG_VERSION, type: 'ack', ids: ids.slice(0, ACK_MAX) })
export const makeReadyMessage = () => ({ source: SOURCE_WEB, v: MSG_VERSION, type: 'ready' })

const hasShape = (d, source, type) => isObj(d) && d.source === source && d.v === MSG_VERSION && d.type === type

// 웹 앱이 받는 쪽: 모양이 맞는 항목만 (최대 QUEUE_MAX개). 아니면 null.
export function parseDeliverMessage(d) {
  if (!hasShape(d, SOURCE_EXT, 'deliver') || !Array.isArray(d.entries)) return null
  return d.entries.filter(validEntry).slice(0, QUEUE_MAX)
}
// 브리지가 받는 쪽: ack는 id 문자열 배열만, 최대 ACK_MAX개.
export function parseAckMessage(d) {
  if (!hasShape(d, SOURCE_WEB, 'ack') || !Array.isArray(d.ids)) return null
  return d.ids.filter((x) => typeof x === 'string' && ID_RE.test(x)).slice(0, ACK_MAX)
}
export const isReadyMessage = (d) => hasShape(d, SOURCE_WEB, 'ready')

// ---- 웹 앱: 전달된 항목을 옷장 목록에 반영 (순수 함수) ----
// 항목 id 기준으로 한 번만 반영해요(seen에 있으면 다시 저장하지 않고 처리 완료로만 표시).
// 반환: list(새 옷장 목록), savedIds(새로 담은 id), ignoredIds(중복·형식 오류로 건너뛴 id), names(담은 옷 이름), rejected(형식 오류 수), seen(갱신된 처리 완료 id)
export function applyDelivery(list, entries, seen, { now = Date.now(), addItem }) {
  const seenSet = new Set(Array.isArray(seen) ? seen : [])
  const out = { list: list || [], savedIds: [], ignoredIds: [], names: [], rejected: 0, duplicates: 0, seen: [...seenSet] }
  const batch = new Set()
  const ordered = [...entries].sort((a, b) => a.queuedAt - b.queuedAt) // 오래된 것부터 넣어야 가장 최근 것이 맨 앞에 와요
  for (const e of ordered) {
    if (seenSet.has(e.id) || batch.has(e.id)) {
      out.ignoredIds.push(e.id)
      out.duplicates++
      continue
    }
    batch.add(e.id)
    if (now - e.queuedAt > QUEUE_TTL_MS) {
      out.ignoredIds.push(e.id)
      out.rejected++
      continue
    }
    const res = parseEnvelopeData(e.envelope, { now })
    if (!res.ok) {
      out.ignoredIds.push(e.id)
      out.rejected++
      continue
    }
    out.list = addItem(out.list, res.item)
    out.savedIds.push(e.id)
    out.names.push(res.item.product.name)
  }
  out.seen = [...seenSet, ...out.savedIds, ...out.ignoredIds.filter((id) => !seenSet.has(id))].slice(-SEEN_MAX)
  return out
}

// 알림 한 줄
export function syncNotice(r, extra = '') {
  if (r.savedIds.length > 0) return `확장에서 ${r.savedIds.length}벌 가져왔어요. ${extra}`.trim()
  if (r.rejected > 0) return '확장에서 보낸 내용을 읽지 못했어요.'
  return ''
}
