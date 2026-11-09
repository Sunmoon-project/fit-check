// 사진 역검색 스모크 테스트: node scripts/smokeImageSearch.mjs (npm run smoke가 smoke.mjs 다음에 같이 실행해요)
// 실제 외부 API는 한 번도 호출하지 않아요. 모든 외부 호출은 가짜 fetch로만 확인해요(어댑터 응답 모양은 가짜·추정 데이터).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import {
  createImageSearchService, ImageSearchError, validateImageUrl, googleVisionAdapter, IMAGE_SEARCH_PROVIDERS,
  cleanText, cleanHttpsLink, MAX_CANDIDATES, MAX_PAGES, MAX_LABEL_LENGTH, MAX_TITLE_LENGTH, DISABLED_MESSAGE,
} from '../server/imageSearch.js'
import { fitCheckApi } from '../server/api.js'
import {
  createImageSearcher, createServerImageProvider, fetchImageSearchEnabled, IMAGE_SEARCH_NOTICE, IMAGE_SEARCH_MAX_PAGES,
} from '../src/lib/imageSearch.js'
import { buildProfile } from '../src/lib/extProfile.js'
import { loadComponents, render, textOf } from './lib/renderJsx.mjs'

let passed = 0
async function atest(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`ok - ${name}`)
  } catch (e) {
    console.error(`not ok - ${name}`)
    throw e
  }
}

const KEY = 'SECRET-KEY-DO-NOT-LEAK-123'
const ENV = { IMAGE_SEARCH_PROVIDER: 'google-vision', IMAGE_SEARCH_API_KEY: KEY }
const okResolve = async () => {} // DNS 없이 공개 주소로 취급
const IMG = 'https://img.example.com/a.jpg'

const visionBody = (web) => ({ responses: [{ webDetection: web }] })
const GOOD = visionBody({
  bestGuessLabels: [{ label: 'nike club fleece hoodie' }],
  webEntities: [{ description: 'Nike Club Fleece Hoodie', score: 0.91 }, { description: '후드티', score: 0.5 }, { description: '' }],
  pagesWithMatchingImages: [{ url: 'https://shop.example.com/p/1', pageTitle: 'Nike 후드' }, { url: 'http://insecure.example.com/x', pageTitle: 'http' }, { url: 'javascript:alert(1)' }],
})

/** 가짜 fetch: 호출 기록과 응답을 정해 줘요. */
function fakeFetch(responder) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    return responder(url, init)
  }
  fn.calls = calls
  return fn
}
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) })
const service = (fetchImpl, extra = {}, env = ENV) => createImageSearchService(env, { fetchImpl, resolve: okResolve, ...extra })

await atest('역검색 어댑터: Vision 요청 모양(WEB_DETECTION, imageUri)과 키는 헤더에만, 응답은 후보·링크로 정리된다 (가짜 fetch, 미검증 형태)', async () => {
  const f = fakeFetch(() => jsonRes(200, GOOD))
  const r = await service(f).search(IMG)
  assert.equal(f.calls.length, 1)
  const { url, init } = f.calls[0]
  assert.equal(url, 'https://vision.googleapis.com/v1/images:annotate')
  assert.ok(!url.includes(KEY) && !url.includes('key='), '키가 주소에 없어요')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers['X-Goog-Api-Key'], KEY)
  const body = JSON.parse(init.body)
  assert.equal(body.requests[0].image.source.imageUri, IMG)
  assert.equal(body.requests[0].features[0].type, 'WEB_DETECTION')
  assert.ok(!init.body.includes(KEY), '키가 본문에 없어요')
  assert.equal(r.candidates[0].label, 'nike club fleece hoodie')
  assert.equal(r.candidates.length, 2, '대소문자만 다른 중복은 합쳐요')
  assert.equal(r.candidates[0].brand, '나이키')
  assert.ok(r.candidates.some((c) => c.label === '후드티' && !c.brand))
  assert.deepEqual(r.pages, [{ url: 'https://shop.example.com/p/1', title: 'Nike 후드' }], 'https 링크만')
  assert.ok(!JSON.stringify(r).includes(KEY))
})

await atest('역검색 비활성: 키·공급자 중 하나라도 없거나 이름을 모르면 꺼지고 fetch를 안 부른다', async () => {
  for (const env of [{}, { IMAGE_SEARCH_PROVIDER: 'google-vision' }, { IMAGE_SEARCH_API_KEY: KEY }, { IMAGE_SEARCH_PROVIDER: 'unknown', IMAGE_SEARCH_API_KEY: KEY }, { IMAGE_SEARCH_PROVIDER: '__proto__', IMAGE_SEARCH_API_KEY: KEY }]) {
    const f = fakeFetch(() => jsonRes(200, GOOD))
    const s = service(f, {}, env)
    assert.equal(s.enabled, false)
    assert.deepEqual(s.status(), { imageSearch: false })
    await assert.rejects(() => s.search(IMG), (e) => e instanceof ImageSearchError && e.status === 503 && e.message === DISABLED_MESSAGE)
    assert.equal(f.calls.length, 0)
  }
  assert.deepEqual(service(fakeFetch(() => jsonRes(200, GOOD))).status(), { imageSearch: true })
})

await atest('역검색 오류 매핑: 400/429/401/5xx/타임아웃/깨진 응답이 사용자 친화 문구로, 키는 어디에도 없다', async () => {
  const cases = [
    [() => jsonRes(429, 'x'), 429, 'QUOTA'],
    [() => jsonRes(400, `bad ${KEY}`), 502, 'UPSTREAM_ERROR'],
    [() => jsonRes(401, `denied ${KEY}`), 502, 'PROVIDER_AUTH'],
    [() => jsonRes(403, 'x'), 502, 'PROVIDER_AUTH'],
    [() => jsonRes(500, `boom ${KEY}`), 502, 'UPSTREAM_ERROR'],
    [() => jsonRes(200, 'not json'), 502, 'BAD_UPSTREAM'],
    [() => jsonRes(200, { responses: [] }), 502, 'BAD_UPSTREAM'],
    [() => jsonRes(200, { responses: [{ error: { code: 429, message: KEY } }] }), 429, 'QUOTA'],
    [() => jsonRes(200, { responses: [{ error: { code: 7, message: KEY } }] }), 502, 'PROVIDER_AUTH'],
    [() => jsonRes(200, { responses: [{ error: { code: 3, message: KEY } }] }), 502, 'UPSTREAM_ERROR'],
    [() => { throw Object.assign(new Error(`connect ${KEY}`), { name: 'FetchError' }) }, 502, 'UPSTREAM_ERROR'],
    [() => jsonRes(200, 'x'.repeat(1024 * 1024 + 1)), 502, 'BAD_UPSTREAM'],
  ]
  for (const [responder, status, code] of cases) {
    await assert.rejects(() => service(fakeFetch(responder)).search(IMG), (e) => {
      assert.ok(e instanceof ImageSearchError)
      assert.equal(e.status, status)
      assert.equal(e.code, code)
      assert.ok(e.message.length > 5 && !e.message.includes(KEY) && !String(e.stack).includes(KEY))
      return true
    })
  }
  // 타임아웃: 신호가 중단되면 504
  const slow = fakeFetch((url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))))
  await assert.rejects(() => service(slow, { timeoutMs: 20 }).search(IMG), (e) => e.status === 504 && e.code === 'TIMEOUT')
})

await atest('역검색 SSRF: http, localhost, 사설 IP, 사용자정보, 포트, 이상한 값을 외부 호출 전에 거부한다 (실제 safeFetch 규칙)', async () => {
  const bad = [
    'http://img.example.com/a.jpg', 'https://localhost/a.jpg', 'https://foo.localhost/a.jpg', 'https://127.0.0.1/a.jpg', 'https://10.0.0.5/a.jpg',
    'https://192.168.0.1/a.jpg', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/a.jpg', 'https://[::ffff:7f00:1]/a.jpg', 'https://172.16.0.1/a.jpg',
    'https://user:pw@img.example.com/a.jpg', 'https://user@img.example.com/a.jpg', 'https://img.example.com:8443/a.jpg', 'https://printer.local/a.jpg',
    'ftp://img.example.com/a.jpg', 'file:///etc/passwd', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'not a url', '', '   ', null, undefined, 42, {}, [], `https://img.example.com/${'a'.repeat(1100)}`,
  ]
  for (const u of bad) {
    // resolve를 바꾸지 않은 서비스: DNS 없이 걸러지는 값은 DNS 이전에, IP 리터럴은 safeFetch의 사설 대역 검사로 거부돼요.
    const f = fakeFetch(() => jsonRes(200, GOOD))
    const s = createImageSearchService(ENV, { fetchImpl: f })
    await assert.rejects(() => s.search(u), (e) => e instanceof ImageSearchError && e.status === 400 && e.code === 'INVALID_URL', String(u))
    assert.equal(f.calls.length, 0, `${u}는 외부 호출 전에 거부`)
  }
  assert.equal(await validateImageUrl('https://img.example.com/a.jpg#frag', okResolve), 'https://img.example.com/a.jpg', '해시는 떼요')
  assert.equal(await validateImageUrl('https://img.example.com:443/a.jpg', okResolve), 'https://img.example.com/a.jpg')
})

await atest('역검색 캐시: 같은 사진은 두 번째에 fetch를 안 부르고, TTL이 지나면 다시 부르고, 최대 항목 수를 넘기면 오래된 것부터 버린다', async () => {
  let t = 1000
  const f = fakeFetch(() => jsonRes(200, GOOD))
  const s = service(f, { now: () => t, ttlMs: 5000, maxEntries: 2 })
  const a = await s.search(IMG)
  const b = await s.search(`${IMG}#다른-해시`)
  assert.equal(f.calls.length, 1)
  assert.equal(a.cached, false)
  assert.equal(b.cached, true)
  assert.deepEqual(b.candidates, a.candidates)
  t += 6000
  assert.equal((await s.search(IMG)).cached, false)
  assert.equal(f.calls.length, 2)
  await s.search('https://img.example.com/2.jpg')
  await s.search('https://img.example.com/3.jpg') // maxEntries=2라 IMG가 밀려나요
  assert.equal(f.calls.length, 4)
  assert.equal((await s.search(IMG)).cached, false)
  assert.equal(f.calls.length, 5)
  // 실패는 캐시하지 않아요
  const g = fakeFetch(() => jsonRes(500, 'x'))
  const s2 = service(g)
  await assert.rejects(() => s2.search(IMG))
  await assert.rejects(() => s2.search(IMG))
  assert.equal(g.calls.length, 2)
  // 동시에 같은 사진을 보내도 한 번만 불러요
  const h = fakeFetch(async () => jsonRes(200, GOOD))
  const s3 = service(h)
  await Promise.all([s3.search(IMG), s3.search(IMG), s3.search(IMG)])
  assert.equal(h.calls.length, 1)
})

await atest('역검색 응답 검증: 악성·과대 응답은 개수·길이 제한, 태그·제어문자 제거, https 링크만', async () => {
  const cleaned = cleanText('<script>alert(1)</script>안녕\u0000\u202e  하세요', 50)
  assert.ok(!/[<>\u0000\u202e]/.test(cleaned) && cleaned.includes('안녕 하세요'), cleaned)
  assert.equal(cleanText('x'.repeat(5000), 30).length, 30)
  assert.equal(cleanText(123, 30), '')
  assert.equal(cleanHttpsLink('https://a.example/x'), 'https://a.example/x')
  for (const u of ['http://a.example/x', 'javascript:alert(1)', 'https://u:p@a.example/x', 'https://a.example/\u0000x', `https://a.example/${'a'.repeat(600)}`, 5, null, '//a.example']) assert.equal(cleanHttpsLink(u), '', String(u))

  const evil = visionBody({
    bestGuessLabels: [{ label: 'L'.repeat(100000) }],
    webEntities: Array.from({ length: 600 }, (_, i) => ({ description: `<b>상품</b> ${i} ${'가'.repeat(400)}`, score: i % 2 ? 7 : -3 })),
    pagesWithMatchingImages: Array.from({ length: 250 }, (_, i) => ({ url: `https://p.example/${i}`, pageTitle: `<a href=x>t</a>${i}${'나'.repeat(900)}` })),
  })
  const r = await service(fakeFetch(() => jsonRes(200, evil))).search(IMG)
  assert.ok(r.candidates.length <= MAX_CANDIDATES && r.pages.length <= MAX_PAGES)
  for (const c of r.candidates) {
    assert.ok(c.label.length <= MAX_LABEL_LENGTH && !/[<>]/.test(c.label))
    if (c.score !== undefined) assert.ok(c.score >= 0 && c.score <= 1)
  }
  for (const p of r.pages) assert.ok(p.title.length <= MAX_TITLE_LENGTH && !/[<>]/.test(p.title) && p.url.startsWith('https://'))
  // 이상한 모양의 응답도 죽지 않고 빈 결과
  for (const web of [null, 'x', 5, [], { webEntities: 'x', pagesWithMatchingImages: { a: 1 }, bestGuessLabels: 7 }, { webEntities: [null, 5, 'x', {}], pagesWithMatchingImages: [null, 'x', {}] }]) {
    const out = googleVisionAdapter.parseResponse({ responses: [{ webDetection: web }] })
    assert.deepEqual(out, { candidates: [], pages: [] })
  }
  // 어댑터는 이름으로 바꿔 끼울 수 있어요
  assert.equal(IMAGE_SEARCH_PROVIDERS['google-vision'], googleVisionAdapter)
  const custom = { name: 'fake', buildRequest: ({ imageUrl }) => ({ url: 'https://fake.example/s', init: { method: 'POST', body: imageUrl } }), parseResponse: () => ({ candidates: [{ label: 'x', model: 'x' }], pages: [] }) }
  const f = fakeFetch(() => jsonRes(200, {}))
  const out = await createImageSearchService({ IMAGE_SEARCH_PROVIDER: 'fake', IMAGE_SEARCH_API_KEY: 'k' }, { fetchImpl: f, resolve: okResolve, providers: { fake: custom } }).search(IMG)
  assert.equal(out.candidates[0].label, 'x')
  assert.equal(f.calls[0].url, 'https://fake.example/s')
})

// ── /api 라우팅 (미들웨어를 가짜 요청으로) ──
async function callApi(env, { method = 'POST', url = '/api/image-search', body, headers, service: svc }) {
  const plugin = fitCheckApi(env, svc ? { imageSearch: svc } : {})
  let mw
  plugin.configureServer({ middlewares: { use: (fn) => (mw = fn) } })
  const raw = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  const req = Object.assign(Readable.from([Buffer.from(raw)]), { url, method, headers: { 'content-type': 'application/json', host: 'localhost:5173', ...headers } })
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, end(t) { this.body = t; this.done = true } }
  let nexted = false
  await mw(req, res, () => { nexted = true })
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, nexted, raw: res.body || '' }
}

await atest('/api/image-search 라우팅: 상태에 켜짐 여부만 노출, 성공·오류 응답에 키가 없고, 비활성이면 503, Content-Type·Origin 검사를 거친다', async () => {
  const f = fakeFetch(() => jsonRes(200, GOOD))
  const svc = service(f)
  const st = await callApi(ENV, { method: 'GET', url: '/api/status', service: svc })
  assert.equal(st.status, 200)
  assert.equal(st.json.imageSearch, true)
  assert.ok(!st.raw.includes(KEY) && !st.raw.includes('google-vision'))
  assert.equal((await callApi({}, { method: 'GET', url: '/api/status' })).json.imageSearch, false)

  const ok = await callApi(ENV, { body: { imageUrl: IMG }, service: svc })
  assert.equal(ok.status, 200)
  assert.deepEqual(Object.keys(ok.json).sort(), ['candidates', 'pages'])
  assert.ok(!ok.raw.includes(KEY))

  assert.equal((await callApi(ENV, { body: { imageUrl: 'http://x.example/a.jpg' }, service: svc })).status, 400)
  assert.equal((await callApi(ENV, { body: { imageUrl: 'https://127.0.0.1/a.jpg' }, service: createImageSearchService(ENV, { fetchImpl: f }) })).status, 400, '실제 SSRF 검사')
  assert.equal((await callApi(ENV, { body: {}, service: svc })).status, 400)
  assert.equal((await callApi(ENV, { body: 'not json', service: svc })).status, 400)
  assert.equal((await callApi(ENV, { body: { imageUrl: IMG }, headers: { 'content-type': 'text/plain' }, service: svc })).status, 415)
  assert.equal((await callApi(ENV, { body: { imageUrl: IMG }, headers: { origin: 'https://evil.example' }, service: svc })).status, 403)
  const calls = f.calls.length

  const off = await callApi({}, { body: { imageUrl: IMG } })
  assert.equal(off.status, 503)
  assert.ok(off.json.message.length > 5)
  const quota = await callApi(ENV, { body: { imageUrl: 'https://img.example.com/q.jpg' }, service: service(fakeFetch(() => jsonRes(429, '')), {}) })
  assert.equal(quota.status, 429)
  assert.equal(f.calls.length, calls, '거부된 요청은 외부로 나가지 않았어요')
})

// ── 클라이언트 ──
await atest('역검색 클라이언트: 서버 공급자는 첫 사진 한 장만 /api/image-search로 보내고, 서버 문구를 오류로 넘기며, 상태 확인은 사진을 보내지 않는다', async () => {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, json: async () => ({ candidates: [{ brand: '나이키', model: 'Club Hoodie', label: 'x' }, { label: '라벨만 있음' }], pages: [{ url: 'https://p.example/1', title: '페이지' }, { url: 'http://bad.example/', title: 'x' }, { url: 'javascript:1', title: 'y' }] }) }
  }
  const searcher = createImageSearcher(createServerImageProvider(fetchFn))
  assert.equal(searcher.enabled, true)
  const r = await searcher.search(['https://a.example/1.jpg', 'https://a.example/2.jpg'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/image-search')
  assert.deepEqual(JSON.parse(calls[0].init.body), { imageUrl: 'https://a.example/1.jpg' })
  assert.equal(r.status, 'ok')
  assert.deepEqual(r.candidates.map((c) => c.model), ['Club Hoodie', '라벨만 있음'])
  assert.deepEqual(r.pages, [{ url: 'https://p.example/1', title: '페이지' }])
  const many = createImageSearcher(createServerImageProvider(async () => ({ ok: true, json: async () => ({ candidates: [], pages: Array.from({ length: 50 }, (_, i) => ({ url: `https://p.example/${i}`, title: 't' })) }) })))
  assert.equal((await many.search(['https://a.example/1.jpg'])).pages.length, IMAGE_SEARCH_MAX_PAGES)

  const quota = createImageSearcher(createServerImageProvider(async () => ({ ok: false, status: 429, json: async () => ({ error: 'QUOTA', message: '사용 한도에 도달했어요.' }) })))
  assert.deepEqual(await quota.search(['https://a.example/1.jpg']), { status: 'error', candidates: [], pages: [], message: '사용 한도에 도달했어요.' })
  const down = createImageSearcher(createServerImageProvider(async () => { throw new Error('ECONNREFUSED') }))
  const d = await down.search(['https://a.example/1.jpg'])
  assert.equal(d.status, 'error')
  assert.ok(!d.message.includes('ECONNREFUSED'))
  const noJson = createImageSearcher(createServerImageProvider(async () => ({ ok: false, status: 500, json: async () => { throw new Error('x') } })))
  assert.equal((await noJson.search(['https://a.example/1.jpg'])).message, '사진 검색에 실패했어요.')

  const statusCalls = []
  assert.equal(await fetchImageSearchEnabled(async (u, i) => { statusCalls.push([u, i]); return { ok: true, json: async () => ({ imageSearch: true }) } }), true)
  assert.deepEqual(statusCalls, [['/api/status', undefined]], '상태 확인은 주소만 부르고 사진 주소를 보내지 않아요')
  assert.equal(await fetchImageSearchEnabled(async () => ({ ok: true, json: async () => ({ imageSearch: 'true' }) })), false)
  assert.equal(await fetchImageSearchEnabled(async () => ({ ok: false })), false)
  assert.equal(await fetchImageSearchEnabled(async () => { throw new Error('offline') }), false)
})

// ── 화면 ──
const WEB = await loadComponents()
const profile = buildProfile({ gender: 'male', height: '175', weight: '70', preferredFit: 'regular' }).profile
const noop = () => {}

await atest('역검색 웹 화면: 켜졌을 때 외부 전송 고지·동의 체크·버튼(동의 전에는 비활성)과 결과 링크(noopener), 꺼졌을 때 비활성 안내', async () => {
  const on = createImageSearcher(createServerImageProvider(async () => { throw new Error('화면 렌더에서 호출되면 안 돼요') }))
  const html = render(WEB.UsedListing, { profile, db: null, imageSearcher: on, onBack: noop })
  const text = textOf(html)
  assert.ok(text.includes('판매글 사진 주소가 외부 이미지 검색 서비스로 전송돼요'))
  assert.ok(text.includes(IMAGE_SEARCH_NOTICE))
  assert.ok(/type="checkbox"/.test(html) && !/aria-label="사진 주소"[^>]*disabled/.test(html))
  assert.ok(/<button[^>]*disabled[^>]*>사진으로 찾기<\/button>/.test(html), '동의·사진 주소 전에는 버튼 비활성')

  const withResult = render(WEB.UsedListing, {
    profile, db: null, imageSearcher: on, onBack: noop,
    initialPhoto: { status: 'ok', candidates: [{ brand: '나이키', model: 'Club Hoodie' }], pages: [{ url: 'https://shop.example.com/p/1', title: 'Nike 후드' }], message: '' },
  })
  assert.ok(textOf(withResult).includes('나이키 Club Hoodie'))
  assert.ok(/<a href="https:\/\/shop\.example\.com\/p\/1" target="_blank" rel="noopener noreferrer">Nike 후드<\/a>/.test(withResult))
  const failed = textOf(render(WEB.UsedListing, { profile, db: null, imageSearcher: on, onBack: noop, initialPhoto: { status: 'error', candidates: [], pages: [], message: '사용 한도에 도달했어요.' } }))
  assert.ok(failed.includes('사용 한도에 도달했어요.'))

  const offHtml = render(WEB.UsedListing, { profile, db: null, imageSearcher: createImageSearcher(null), onBack: noop })
  const offText = textOf(offHtml)
  assert.ok(offText.includes('준비 중') && offText.includes('IMAGE_SEARCH_API_KEY') && offText.includes('확인하지 못한'))
  assert.ok(/aria-label="사진 주소"[^>]*disabled/.test(offHtml) && /<button[^>]*disabled[^>]*>사진으로 찾기<\/button>/.test(offHtml) && /type="checkbox"[^>]*disabled/.test(offHtml))
})

await atest('역검색 소스 검사: 자동 호출 없음, 분석하기는 검색을 새로 부르지 않음, 키 이름은 서버·문서에만, 확장은 링크만(네트워크 없음), 크롤링 없음', async () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  const ui = read('src/components/UsedListing.jsx')
  assert.equal((ui.match(/imageSearcher\.search\(/g) || []).length, 1, '검색 호출은 한 곳뿐')
  const analyze = ui.slice(ui.indexOf('async function analyze'), ui.indexOf('return (', ui.indexOf('async function analyze')))
  assert.ok(!analyze.includes('imageSearcher.search'), '분석하기가 검색을 부르면 안 돼요')
  assert.ok(ui.includes('onClick={findByPhoto}') && ui.includes('if (!photoEnabled || !consent || !firstUrl) return'))
  const app = read('src/App.jsx')
  assert.ok(!/imageSearcher\.search/.test(app), 'App은 검색을 부르지 않고 켜짐 여부만 물어요')
  for (const f of ['src/App.jsx', 'src/components/UsedListing.jsx', 'src/lib/imageSearch.js', 'extension/content.js']) {
    assert.ok(!read(f).includes('IMAGE_SEARCH_API_KEY') || f === 'src/components/UsedListing.jsx', `${f}에 키 이름 사용 금지(안내 문구만 허용)`)
    assert.ok(!/API_KEY\s*[:=]\s*['"][^'"]+['"]/.test(read(f)), f)
  }
  const content = read('extension/content.js')
  assert.ok(content.includes('중고 상품 분석') && content.includes('WEB_APP_OPEN_URL'))
  assert.ok(!/api\/image-search|imageSearch|createServerImageProvider/.test(content), '확장은 역검색을 부르지 않아요')
  const server = read('server/imageSearch.js')
  assert.ok(!/cheerio|parseProductHtml|safeFetchHtml/.test(server), '결과 페이지를 가져와 읽지 않아요(크롤링 없음)')
  assert.ok(server.includes('미검증'))
  assert.ok(read('.env.example').includes('IMAGE_SEARCH_PROVIDER=') && !/IMAGE_SEARCH_API_KEY=\S/.test(read('.env.example')), '.env.example에는 키 이름만')
})

console.log(`\n사진 역검색 ${passed}개 통과`)
