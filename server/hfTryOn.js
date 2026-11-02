// Hugging Face Space(IDM-VTON) 가상 피팅. Gradio HTTP API를 Node 내장 기능(fetch, FormData, Blob)만으로 호출해요.
//   1) GET  {base}/config                     → api_prefix 확인 (Gradio 5는 '/gradio_api', Gradio 4는 없음)
//   2) POST {base}{prefix}/upload             → data URI 사진을 Space에 올리고 서버 경로를 받음
//   3) POST {base}{prefix}/call/tryon         → { event_id }
//   4) GET  {base}{prefix}/call/tryon/{id}    → SSE로 결과(FileData) 수신
//   5) 결과 이미지를 내려받아 data URI로 돌려줌 (브라우저는 hf.space에 접속하지 않고, 링크 만료도 없음)
// 토큰(HF_TOKEN)은 선택이에요. 없어도 무료 ZeroGPU 쿼터로 동작하고, 있으면 하루 쿼터가 늘어나요.
import { createHash } from 'node:crypto'

export const DEFAULT_SPACE = 'yisol/IDM-VTON'
// 같은 IDM-VTON /tryon API를 쓰는 Space 목록 (기본 Space가 잠들었거나 붐빌 때 HF_SPACE로 바꿔 쓸 수 있어요)
export const KNOWN_SPACES = ['yisol/IDM-VTON', 'John6666/IDM-VTON', 'LPDoctor/IDM-VTON-demo', 'jjlealse/IDM-VTON']

const GARMENT_FALLBACK = { top: 'a top', outer: 'an outer jacket', bottom: 'a pair of pants', dress: 'a dress' }
const DENOISE_STEPS = 30
const SEED = 42
const CACHE_MAX = 20
const LOG_MAX = 300

export const isValidSpaceId = (id) => typeof id === 'string' && /^[\w.-]+\/[\w.-]+$/.test(id)

export const spaceBaseUrl = (id) => `https://${id.toLowerCase().replace(/[/._]/g, '-')}.hf.space`

// Gradio SSE 본문을 [{ event, data }]로 나눠요. data는 JSON이면 파싱하고, 아니면 문자열 그대로 둬요.
export function parseSse(text) {
  const events = []
  for (const block of String(text || '').split(/\r?\n\r?\n/)) {
    let event = 'message'
    const lines = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''))
    }
    if (!lines.length && event === 'message') continue
    const raw = lines.join('\n')
    let data = raw
    try {
      data = JSON.parse(raw)
    } catch {
      // JSON이 아니면 문자열 그대로
    }
    events.push({ event, data })
  }
  return events
}

// 같은 입력으로 다시 누르면 쿼터를 쓰지 않도록 최근 결과를 메모리에 보관해요.
const cache = new Map()
export function clearTryOnCache() {
  cache.clear()
}

function hfError(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

const logUpstream = (what, detail) => console.error(`[tryon] ${what}`, String(detail ?? '').slice(0, LOG_MAX))

// 업스트림 오류(HTTP 상태 + 본문 또는 SSE 오류 메시지)를 한국어 안내로 바꿔요.
function mapUpstreamError(status, text, hasToken) {
  const t = String(text || '')
  if (status === 429 || /quota|GPU.*(limit|exceed)/i.test(t)) {
    return hfError(
      429,
      'QUOTA',
      '오늘 쓸 수 있는 무료 GPU 시간을 다 썼어요. 내일 다시 시도하거나, .env에 무료 HF_TOKEN을 넣으면 쿼터가 늘어나요.',
    )
  }
  if ((status === 401 || status === 403) && hasToken) {
    return hfError(502, 'BAD_TOKEN', 'HF 토큰이 올바르지 않아요. .env의 HF_TOKEN을 확인해주세요.')
  }
  if (status === 404 || status === 503 || /sleep|paused|building|starting|not found/i.test(t)) {
    return hfError(
      503,
      'SPACE_UNAVAILABLE',
      'Hugging Face Space가 지금 쉬고 있거나 준비 중이에요. 잠시 후 다시 시도하거나 .env의 HF_SPACE로 다른 Space를 지정해보세요.',
    )
  }
  return hfError(502, 'TRYON_FAILED', 'AI 합성에 실패했어요. 다른 사진으로 시도해보세요.')
}

function parseDataUri(uri) {
  const m = /^data:(image\/[\w.+-]+);base64,(.*)$/s.exec(uri)
  if (!m) return null
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') }
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp' }

const fileData = (path, origName, url) => ({ path, ...(url ? { url } : {}), orig_name: origName, meta: { _type: 'gradio.FileData' } })

export async function runHfTryOn({
  personImage,
  garmentImage,
  category,
  garmentName,
  space = DEFAULT_SPACE,
  token = '',
  fetchImpl = fetch,
  signal,
} = {}) {
  const garmentDesc =
    typeof garmentName === 'string' && garmentName.trim() ? garmentName.trim().slice(0, 100) : GARMENT_FALLBACK[category] || 'a top'
  const model = `IDM-VTON (Hugging Face ${space})`
  const key = createHash('sha256')
    .update([space, category, garmentDesc, personImage, garmentImage].join('\n'))
    .digest('hex')
  const hit = cache.get(key)
  if (hit) return { ...hit, cached: true }

  const base = spaceBaseUrl(space)
  const auth = token ? { Authorization: `Bearer ${token}` } : {}
  const hasToken = Boolean(token)

  // 모든 요청에 같은 인증 헤더와 중단 신호를 붙이고, 연결 실패는 HF_UNREACHABLE로 바꿔요.
  async function hf(url, opts = {}) {
    try {
      return await fetchImpl(url, { ...opts, signal, headers: { ...auth, ...(opts.headers || {}) } })
    } catch (e) {
      if (e?.name === 'AbortError') throw e
      logUpstream('연결 실패', e?.cause?.code || e?.message)
      throw hfError(502, 'HF_UNREACHABLE', 'Hugging Face 서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.')
    }
  }

  async function failFrom(r, what) {
    const text = await r.text().catch(() => '')
    logUpstream(`${what} ${r.status}`, text)
    return mapUpstreamError(r.status, text, hasToken)
  }

  // 1) api_prefix
  const cfgRes = await hf(`${base}/config`)
  if (!cfgRes.ok) throw await failFrom(cfgRes, 'config')
  const config = await cfgRes.json().catch(() => null)
  if (!config) throw mapUpstreamError(503, 'config not json', hasToken)
  const prefix = typeof config.api_prefix === 'string' && /^(\/[\w-]+)*$/.test(config.api_prefix) ? config.api_prefix : ''
  const api = `${base}${prefix}`

  // 2) 이미지 준비: data URI는 업로드, https 주소는 Space가 직접 내려받게 넘겨요.
  async function toFileData(image, name) {
    if (/^https:\/\//i.test(image)) return fileData(image, `${name}.jpg`, image)
    const parsed = parseDataUri(image)
    if (!parsed) throw hfError(400, 'INVALID_IMAGE', '사진 형식을 확인해주세요 (PNG, JPG, WEBP).')
    const filename = `${name}.${EXT[parsed.mime] || 'jpg'}`
    const form = new FormData()
    form.append('files', new Blob([parsed.buffer], { type: parsed.mime }), filename)
    const r = await hf(`${api}/upload`, { method: 'POST', body: form })
    if (!r.ok) throw await failFrom(r, 'upload')
    const paths = await r.json().catch(() => null)
    if (!Array.isArray(paths) || typeof paths[0] !== 'string') {
      logUpstream('upload 응답 이상', JSON.stringify(paths))
      throw mapUpstreamError(502, '', hasToken)
    }
    return fileData(paths[0], filename)
  }
  const personFD = await toFileData(personImage, 'person')
  const garmentFD = await toFileData(garmentImage, 'garment')

  // 3) 작업 시작 (입력 순서: 사람 ImageEditor, 옷, 옷 설명, 자동 마스크, 자동 크롭, 단계 수, 시드)
  const callRes = await hf(`${api}/call/tryon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: [{ background: personFD, layers: [], composite: null }, garmentFD, garmentDesc, true, false, DENOISE_STEPS, SEED],
    }),
  })
  if (!callRes.ok) throw await failFrom(callRes, 'call')
  const { event_id: eventId } = (await callRes.json().catch(() => null)) || {}
  if (typeof eventId !== 'string' || !/^[\w-]+$/.test(eventId)) {
    logUpstream('event_id 없음', eventId)
    throw mapUpstreamError(502, '', hasToken)
  }

  // 4) 결과 수신 (SSE). 대기열이 길면 여기서 오래 기다려요.
  const sseRes = await hf(`${api}/call/tryon/${eventId}`, { headers: { Accept: 'text/event-stream' } })
  if (!sseRes.ok) throw await failFrom(sseRes, 'result')
  const events = parseSse(await sseRes.text())
  const errorEvent = events.find((e) => e.event === 'error')
  if (errorEvent) {
    const detail = typeof errorEvent.data === 'string' ? errorEvent.data : JSON.stringify(errorEvent.data)
    logUpstream('Space 오류', detail)
    throw mapUpstreamError(200, detail, hasToken)
  }
  const complete = events.find((e) => e.event === 'complete')
  const out = Array.isArray(complete?.data) ? complete.data[0] : null
  const outPath = out && (out.url || out.path)
  if (!outPath) {
    logUpstream('결과 없음', JSON.stringify(events.map((e) => e.event)))
    throw hfError(502, 'TRYON_FAILED', '합성 결과가 비어 있어요.')
  }
  const resultUrl = /^https?:\/\//i.test(out.url || '') ? out.url : `${api}/file=${out.path}`

  // 5) 결과를 data URI로 바꿔요. 실패하면 주소를 그대로 넘겨요.
  let image = resultUrl
  try {
    const r = await hf(resultUrl)
    if (r.ok) {
      const type = (r.headers.get('content-type') || 'image/png').split(';')[0].trim()
      const buf = Buffer.from(await r.arrayBuffer())
      image = `data:${type.startsWith('image/') ? type : 'image/png'};base64,${buf.toString('base64')}`
    } else {
      logUpstream(`결과 다운로드 ${r.status}`, '')
    }
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    // 다운로드 실패는 주소로 대신해요
  }

  const result = { image, model }
  // 만료될 수 있는 주소 결과는 보관하지 않아요.
  if (image.startsWith('data:')) {
    cache.set(key, result)
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  }
  return result
}
