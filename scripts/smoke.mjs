// 순수 로직 스모크 테스트 (의존성 없음): node scripts/smoke.mjs
import assert from 'node:assert/strict'
import { BODY_FIELDS } from '../src/data/measurements.js'
import { estimateBody } from '../src/lib/bodyEstimate.js'
import {
  partVerdicts,
  recommendSize,
  generateFitComment,
  computeCalibration,
  bodyValuesForProfile,
  describeEvidence,
  CONFIDENCE_LABEL,
} from '../src/lib/fitEngine.js'
import {
  parseCsv,
  parseRows,
  mergeMapping,
  normalizeGender,
  normalizeBodyRow,
  normalizeBodyRows,
  errorStats,
  evaluateBody,
  fitLinear,
} from './lib/bodyMetrics.mjs'
import { PRODUCTS } from '../src/data/mockData.js'
import { parseReviewText } from '../src/lib/productCore.js'
import { parseProductHtml } from '../server/productParser.js'
import { parsePage, isProductPage } from '../src/lib/pageParser.js'
import { analyzePage, manualChartRows } from '../src/lib/extAnalyze.js'
import { collectDiagnostics, formatReport, REPORT_MAX } from '../src/lib/diagnose.js'
import { buildProfile, isUsableProfile } from '../src/lib/extProfile.js'
import { fakeDocument } from './lib/cheerioDom.mjs'
import { checkManifest } from './checkExtension.mjs'
import { findUndeclared } from './checkGlobals.mjs'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import vm from 'node:vm'
import { build as viteBuild } from 'vite'
import { findSimilar, describeDiff, categoryGroup, makeWardrobeItem } from '../src/lib/wardrobe.js'
import { isPrivateIp, decodeHtml } from '../server/safeFetch.js'
import { checkPostRequest } from '../server/api.js'
import {
  parseHeightCm, parseWeightKg, normalizeFit, normalizeRow, normalizeLines,
  confusionMatrix, accuracy, precisionRecall, neighborVotePredictions, trueRateByBucket, evaluate,
} from './lib/fitMetrics.mjs'
import { bodySimilarity } from '../src/lib/fitEngine.js'
import { runHfTryOn, parseSse, spaceBaseUrl, isValidSpaceId, clearTryOnCache, garmentDescription, isTryOnSupported, DEFAULT_SPACE } from '../server/hfTryOn.js'

import { toContribution, toBand, toDomain, contributionKey, ALLOWED_DOMAINS, SCHEMA_VERSION } from '../src/lib/contribution.js'
import { MAX_STEPS, MAX_MS, STALL_LIMIT, STOP_REASONS, shouldStop, isSafeMoreButton, toReportStop } from '../src/lib/reviewLoader.js'
import { CONSENT_SUMMARY, CONSENT_VERSION } from '../src/data/consent.js'
import { loadConsent, purgeStaleConsent, saveConsent, enqueueContribution, loadContribQueue, recordsForUpload } from '../src/lib/storage.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`ok - ${name}`)
  } catch (e) {
    console.error(`not ok - ${name}`)
    throw e
  }
}
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

const profile = {
  gender: 'male',
  height: 175,
  weight: 70,
  shape: { shoulder: 'normal', belly: 'none', lower: 'normal' },
  usual: { top: 'L', bottom: '', shoes: '' },
  preferredFit: 'regular',
  measurements: { chest: 98 },
}

test('estimateBody: BODY_FIELDS 전부 반환, 직접 입력 우선', () => {
  const { values, measured } = estimateBody(profile)
  for (const f of BODY_FIELDS) assert.equal(typeof values[f.key], 'number', f.key)
  assert.equal(values.chest, 98)
  assert.ok(measured.has('chest'))
  assert.ok(!measured.has('waist'))
})

test('partVerdicts: 가슴 여유 10 → 적당, -2 → 작을 수 있음', () => {
  const ok = partVerdicts({ chest: 100 }, { chest: 110 }, 'top')
  assert.equal(ok.length, 1)
  assert.equal(ok[0].ease, 10)
  assert.equal(ok[0].verdict, '적당')
  const small = partVerdicts({ chest: 100 }, { chest: 98 }, 'top')
  assert.equal(small[0].verdict, '작을 수 있음')
  assert.equal(small[0].level, 0)
})

test('partVerdicts: 보정 오프셋이 기준을 옮김', () => {
  // 가슴 여유 7은 기본 '적당'(6~14), 오프셋 +2면 기준 8~16이라 '타이트'
  const v = partVerdicts({ chest: 100 }, { chest: 107 }, 'top', { chest: { offset: 2 } })
  assert.equal(v[0].verdict, '타이트')
})

test('recommendSize: 데모 상의에서 사이즈표에 있는 사이즈 반환', () => {
  const top = PRODUCTS['https://shop-a.example.com/goods/12345']
  const { values } = bodyValuesForProfile(profile)
  const r = recommendSize(values, top.sizeChart, top.category, 'regular')
  assert.ok(r)
  const sizes = top.sizeChart.rows.map((row) => String(row[0]))
  assert.ok(sizes.includes(r.bestSize), r.bestSize)
  assert.equal(r.perSize.length, sizes.length)
  for (const p of r.perSize) assert.ok(p.score >= 0 && p.score <= 100)
})

test('generateFitComment: 모든 데모 상품에서 동작', () => {
  for (const p of Object.values(PRODUCTS)) {
    const r = generateFitComment(profile, p)
    assert.ok(r.headline && r.body, p.name)
    assert.ok(Array.isArray(r.matched) && Array.isArray(r.otherReviews))
  }
})

test('generateFitComment: 키·몸무게·사이즈 없는 후기도 처리', () => {
  const product = {
    url: 'https://example.com/p/1',
    source: 'live',
    name: '테스트 셔츠',
    category: 'top',
    sizeChart: {
      unit: 'cm',
      headers: ['사이즈', '어깨', '가슴'],
      rows: [['M', 45, 52], ['L', 47, 55]],
      measures: { M: { shoulder: 45, chest: 104 }, L: { shoulder: 47, chest: 110 } },
    },
    reviews: [
      { id: 1, nick: 'a', rating: 5, text: '좋아요', height: null, weight: null, size: null, fit: null },
      { id: 2, nick: 'b', rating: 4, text: '정사이즈', height: null, weight: null, size: 'M', fit: 'true' },
      { id: 3, nick: 'c', rating: 4, text: '키 176 70kg L', height: 176, weight: 70, size: 'L', fit: null },
    ],
    notes: [],
  }
  const r = generateFitComment(profile, product)
  assert.ok(['M', 'L'].includes(r.recommendedSize))
  assert.equal(r.matched.length, 1)
  assert.equal(r.otherReviews.length, 2)
  assert.ok(r.verdicts.length > 0)

  // 사이즈표도 후기도 없으면 평소 사이즈로 안내
  const bare = generateFitComment(profile, { ...product, sizeChart: null, reviews: [] })
  assert.equal(bare.recommendedSize, 'L')
  assert.equal(bare.confidence, 'low')
})

test('computeCalibration: ±6 제한, 1건이면 절반', () => {
  // 가슴 여유 30에서 작았음 → 30-6=24 → 6으로 제한 → 1건이라 3
  const one = computeCalibration([{ result: 'small', returned: false, parts: { chest: 30 } }])
  assert.equal(one.chest.offset, 3)
  assert.equal(one.chest.samples, 1)
  const two = computeCalibration([
    { result: 'small', returned: true, parts: { chest: 30 } },
    { result: 'small', returned: false, parts: { chest: 28 } },
  ])
  assert.equal(two.chest.offset, 6)
  // 컸음 → 음수 방향, 제한 -6
  const big = computeCalibration([
    { result: 'large', parts: { waist: -10 } },
    { result: 'large', parts: { waist: -12 } },
  ])
  assert.equal(big.waist.offset, -6)
  // 모르는 부위는 무시
  assert.deepEqual(computeCalibration([{ result: 'true', parts: { footWidth: 2 } }]), {})
})

test('parseProductHtml: JSON-LD 상품·리뷰 + 사이즈 표', () => {
  const html = `<!doctype html><html><head>
    <meta property="og:site_name" content="테스트몰">
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: '오버핏 코튼 셔츠',
      image: 'https://cdn.example.com/a.jpg',
      offers: { '@type': 'Offer', price: '39000', priceCurrency: 'KRW' },
      review: [
        { '@type': 'Review', author: { name: '구매자1' }, reviewRating: { ratingValue: 5 }, reviewBody: '키 175cm 몸무게 70kg M 사이즈 구매했는데 정사이즈예요' },
        { '@type': 'Review', author: '구매자2', reviewBody: '색이 예뻐요' },
      ],
    })}</script></head><body>
    <table>
      <tr><th>사이즈</th><th>어깨</th><th>가슴단면</th><th>총장</th></tr>
      <tr><td>M</td><td>48</td><td>56</td><td>72</td></tr>
      <tr><td>L</td><td>50</td><td>59</td><td>74</td></tr>
    </table></body></html>`
  const p = parseProductHtml(html, 'https://shop.example.com/goods/1')
  assert.equal(p.name, '오버핏 코튼 셔츠')
  assert.equal(p.mall, '테스트몰')
  assert.equal(p.price, '39,000원')
  assert.equal(p.category, 'top')
  assert.deepEqual(p.sizeChart.measures.M, { shoulder: 48, chest: 112, topLength: 72 })
  assert.equal(p.reviews.length, 2)
  assert.equal(p.reviews[0].height, 175)
  assert.equal(p.reviews[0].weight, 70)
  assert.equal(p.reviews[0].size, 'M')
  assert.equal(p.reviews[0].fit, 'true')
  assert.equal(p.reviews[1].height, null)
  assert.deepEqual(p.notes, [])

  // 파싱 결과로 추천까지
  const r = generateFitComment(profile, p)
  assert.ok(['M', 'L'].includes(r.recommendedSize))
})

test('옷장: 같은 그룹에서 가장 비슷한 옷과 부위별 차이', () => {
  const mk = (id, category, measures) => ({ id, product: { name: id, category, url: id }, size: 'M', measures })
  const wardrobe = [
    mk('a', 'top', { shoulder: 46, chest: 104, topLength: 70 }),
    mk('b', 'outer', { shoulder: 50, chest: 116, topLength: 74 }),
    mk('c', 'bottom', { waist: 80, hip: 100 }),
  ]
  const cmp = findSimilar({ id: 'x', category: 'top', measures: { shoulder: 47, chest: 108, topLength: 70 } }, wardrobe)
  assert.equal(cmp.item.id, 'a')
  assert.deepEqual(cmp.diffs.map((d) => d.diff), [1, 4, 0])
  assert.equal(describeDiff(cmp.diffs[1]), '가슴 +4cm 큼')
  assert.equal(describeDiff(cmp.diffs[2]), '총장 비슷')
  assert.equal(findSimilar({ id: 'y', category: 'shoes', measures: { footLength: 270 } }, wardrobe), null)
  assert.equal(categoryGroup('dress'), 'upper')

  const product = PRODUCTS[Object.keys(PRODUCTS)[0]]
  const size = Object.keys(product.sizeChart.measures)[0]
  const item = makeWardrobeItem({ product, size, verdicts: [{ part: 'chest', label: '가슴', verdict: '적당', key: 'regular', ease: 8, level: 2 }] })
  assert.deepEqual(item.measures, product.sizeChart.measures[size])
  assert.deepEqual(Object.keys(item.verdicts[0]), ['part', 'label', 'verdict', 'key', 'ease'])
  assert.equal(item.image, null)
})

test('isPrivateIp: 내부망·IPv4-mapped IPv6 차단, 공인 주소 허용', () => {
  const blocked = [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '64:ff9b::7f00:1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::FFFF:C0A8:0001', 'not-an-ip',
  ]
  for (const ip of blocked) assert.equal(isPrivateIp(ip), true, ip)
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '211.231.99.80', '2606:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, ip)
  }
})

test('decodeHtml: Content-Type·meta charset으로 EUC-KR 해석', () => {
  const euckr = Buffer.from([0xc7, 0xd1, 0xb1, 0xdb]) // '한글'
  assert.equal(decodeHtml(euckr, 'text/html; charset=EUC-KR'), '한글')
  const meta = Buffer.concat([Buffer.from('<meta charset="euc-kr"><p>'), euckr])
  assert.equal(decodeHtml(meta, 'text/html').endsWith('한글'), true)
  assert.equal(decodeHtml(Buffer.from('<p>한글</p>'), 'text/html'), '<p>한글</p>')
  assert.equal(decodeHtml(Buffer.from('abc'), 'text/html; charset=bogus-x'), 'abc')
})

test('checkPostRequest: JSON + 같은 출처만 허용', () => {
  const host = 'localhost:5173'
  assert.equal(checkPostRequest({ host, 'content-type': 'application/json' }), null)
  assert.equal(checkPostRequest({ host, 'content-type': 'application/json; charset=utf-8', origin: 'http://localhost:5173' }), null)
  assert.equal(checkPostRequest({ host, 'content-type': 'text/plain' }).status, 415)
  assert.equal(checkPostRequest({ host }).status, 415)
  assert.equal(checkPostRequest({ host, 'content-type': 'application/json', origin: 'https://evil.example' }).status, 403)
  assert.equal(checkPostRequest({ host, 'content-type': 'application/json', origin: 'null' }).status, 403)
})

// ---- Hugging Face IDM-VTON (가짜 fetch로 Gradio 흐름 검사) ----
const BASE = 'https://yisol-idm-vton.hf.space'
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const resp = (body, { status = 200, type = 'application/json' } = {}) =>
  new Response(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': type },
  })

// 호출을 기록하는 가짜 fetch. sse로 결과 스트림 본문을 바꿀 수 있어요.
function fakeHf({ prefix = '/gradio_api', sse, extra } = {}) {
  const calls = []
  const api = `${BASE}${prefix}`
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts })
    const special = extra && (await extra(url, opts))
    if (special) return special
    if (url === `${BASE}/config`) return resp({ api_prefix: prefix })
    if (url === `${api}/upload`) return resp([`/tmp/gradio/upload${calls.length}.png`])
    if (url === `${api}/call/tryon`) return resp({ event_id: 'ev123' })
    if (url === `${api}/call/tryon/ev123`) {
      const body = sse ?? `event: generating\ndata: null\n\nevent: complete\ndata: ${JSON.stringify([
        { path: '/tmp/gradio/out.webp', url: `${api}/file=/tmp/gradio/out.webp`, meta: { _type: 'gradio.FileData' } },
        { path: '/tmp/gradio/mask.webp' },
      ])}\n\n`
      return resp(body, { type: 'text/event-stream' })
    }
    if (url === `${api}/file=/tmp/gradio/out.webp`) return resp(new Uint8Array([1, 2, 3]), { type: 'image/webp' })
    return resp('not found', { status: 404, type: 'text/plain' })
  }
  return { calls, fetchImpl }
}

const authOf = (c) => c.opts.headers?.Authorization

test('hfTryOn: Space 주소·ID 검사·SSE 파싱', () => {
  assert.equal(spaceBaseUrl('yisol/IDM-VTON'), 'https://yisol-idm-vton.hf.space')
  assert.equal(spaceBaseUrl('LPDoctor/IDM-VTON-demo'), 'https://lpdoctor-idm-vton-demo.hf.space')
  assert.equal(isValidSpaceId(DEFAULT_SPACE), true)
  assert.equal(isValidSpaceId('a/b/c'), false)
  assert.equal(isValidSpaceId('evil.com#'), false)
  assert.equal(isValidSpaceId(''), false)
  const events = parseSse('event: heartbeat\ndata: null\n\nevent: complete\ndata: [{"path":"/x.png"}]\n\n')
  assert.deepEqual(events, [
    { event: 'heartbeat', data: null },
    { event: 'complete', data: [{ path: '/x.png' }] },
  ])
  assert.deepEqual(parseSse('event: error\ndata: GPU quota exceeded'), [{ event: 'error', data: 'GPU quota exceeded' }])
})

await atest('hfTryOn: config → upload → call → SSE → 결과 data URI (토큰 없음)', async () => {
  clearTryOnCache()
  const { calls, fetchImpl } = fakeHf()
  const r = await runHfTryOn({ personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'top', garmentName: '  오버핏 셔츠  ', fetchImpl })
  const api = `${BASE}/gradio_api`
  assert.deepEqual(calls.map((c) => c.url), [
    `${BASE}/config`,
    `${api}/upload`,
    `${api}/upload`,
    `${api}/call/tryon`,
    `${api}/call/tryon/ev123`,
    `${api}/file=/tmp/gradio/out.webp`,
  ])
  // 업로드는 multipart, 필드 이름 files
  const form = calls[1].opts.body
  assert.ok(form instanceof FormData)
  const file = form.get('files')
  assert.equal(file.name, 'person.png')
  assert.equal(file.type, 'image/png')
  assert.equal(calls[2].opts.body.get('files').name, 'garment.png')
  // /call/tryon 입력 모양
  const { data } = JSON.parse(calls[3].opts.body)
  assert.equal(data.length, 7)
  assert.deepEqual(data[0], {
    background: { path: '/tmp/gradio/upload2.png', orig_name: 'person.png', meta: { _type: 'gradio.FileData' } },
    layers: [],
    composite: null,
  })
  assert.equal(data[1].path, '/tmp/gradio/upload3.png')
  assert.deepEqual(data.slice(2), ['a top', true, false, 30, 42]) // 한글 이름 대신 영어 문구
  for (const c of calls) assert.equal(authOf(c), undefined)
  assert.equal(r.image, 'data:image/webp;base64,AQID')
  assert.equal(r.model, 'IDM-VTON (Hugging Face yisol/IDM-VTON)')
  assert.equal(r.cached, undefined)
})

await atest('hfTryOn: 토큰은 있을 때만 보내고, https 옷 주소는 업로드 없이 넘김', async () => {
  clearTryOnCache()
  const { calls, fetchImpl } = fakeHf({ prefix: '' })
  const garment = 'https://cdn.example.com/shirt.jpg'
  await runHfTryOn({ personImage: PNG_1PX, garmentImage: garment, category: 'outer', token: 'hf_test', fetchImpl })
  assert.equal(calls.filter((c) => c.url.endsWith('/upload')).length, 1)
  assert.equal(calls[1].url, `${BASE}/upload`) // Gradio 4: 접두사 없음
  for (const c of calls) assert.equal(authOf(c), 'Bearer hf_test')
  const { data } = JSON.parse(calls.find((c) => c.url.endsWith('/call/tryon')).opts.body)
  assert.deepEqual(data[1], { path: garment, url: garment, orig_name: 'garment.jpg', meta: { _type: 'gradio.FileData' } })
  assert.equal(data[2], 'an outer jacket')
})

await atest('hfTryOn: 쿼터 소진 SSE 오류 → 429 QUOTA, Space 없음 → 503', async () => {
  clearTryOnCache()
  const origError = console.error
  console.error = () => {}
  try {
    const { fetchImpl } = fakeHf({ sse: 'event: error\ndata: "You have exceeded your GPU quota (60s requested vs. 0s left)."\n\n' })
    await assert.rejects(
      runHfTryOn({ personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'top', fetchImpl }),
      (e) => e.status === 429 && e.code === 'QUOTA' && /HF_TOKEN/.test(e.message),
    )
    const gone = async () => resp('Not Found', { status: 404, type: 'text/plain' })
    await assert.rejects(
      runHfTryOn({ personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'top', fetchImpl: gone }),
      (e) => e.status === 503 && e.code === 'SPACE_UNAVAILABLE',
    )
    const offline = async () => { throw new TypeError('fetch failed') }
    await assert.rejects(
      runHfTryOn({ personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'top', fetchImpl: offline }),
      (e) => e.status === 502 && e.code === 'HF_UNREACHABLE',
    )
  } finally {
    console.error = origError
  }
})

await atest('hfTryOn: 같은 입력은 캐시에서 바로 반환 (fetch 0회)', async () => {
  clearTryOnCache()
  const first = fakeHf()
  const args = { personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'outer', garmentName: 'Wool Jacket' }
  const a = await runHfTryOn({ ...args, fetchImpl: first.fetchImpl })
  const second = fakeHf()
  const b = await runHfTryOn({ ...args, fetchImpl: second.fetchImpl })
  assert.equal(second.calls.length, 0)
  assert.equal(b.cached, true)
  assert.equal(b.image, a.image)
  // 입력이 다르면 다시 호출
  await runHfTryOn({ ...args, garmentName: 'Denim Jacket', fetchImpl: second.fetchImpl })
  assert.ok(second.calls.length > 0)
})

// 테스트 중 [tryon] 로그를 숨겨요.
async function quiet(fn) {
  const origError = console.error
  console.error = () => {}
  try {
    await fn()
  } finally {
    console.error = origError
  }
}
const sseWith = (out) => `event: complete\ndata: ${JSON.stringify([out])}\n\n`
const isFailed = (e) => e.status === 502 && e.code === 'TRYON_FAILED'

test('hfTryOn: 옷 설명은 영어 이름만 그대로, 한글은 카테고리 영어 문구', () => {
  assert.equal(garmentDescription('top', 'Oversized Cotton Shirt'), 'Oversized Cotton Shirt')
  assert.equal(garmentDescription('top', '오버핏 코튼 셔츠'), 'a top')
  assert.equal(garmentDescription('outer', 'Wool 코트'), 'an outer jacket')
  assert.equal(garmentDescription(undefined, ''), 'a top')
  assert.equal(garmentDescription('top', 'x'.repeat(200)).length, 100)
  assert.equal(isTryOnSupported('top'), true)
  assert.equal(isTryOnSupported('outer'), true)
  for (const c of ['bottom', 'dress', 'shoes']) assert.equal(isTryOnSupported(c), false)
})

await atest('hfTryOn: 하의·원피스·신발은 업스트림 호출 없이 400 UNSUPPORTED', async () => {
  clearTryOnCache()
  for (const category of ['bottom', 'dress', 'shoes']) {
    const { calls, fetchImpl } = fakeHf()
    await assert.rejects(
      runHfTryOn({ personImage: PNG_1PX, garmentImage: PNG_1PX, category, fetchImpl }),
      (e) => e.status === 400 && e.code === 'UNSUPPORTED',
    )
    assert.equal(calls.length, 0)
  }
})

await atest('hfTryOn: 다른 호스트 결과 주소는 쓰지 않고 토큰도 보내지 않음', async () => {
  await quiet(async () => {
    const api = `${BASE}/gradio_api`
    // 절대 주소가 다른 호스트면 path로 Space 주소를 직접 만들어요.
    clearTryOnCache()
    let f = fakeHf({ sse: sseWith({ path: '/tmp/gradio/out.webp', url: 'https://attacker.example/x.png' }) })
    let r = await runHfTryOn({ personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'top', token: 'hf_secret', fetchImpl: f.fetchImpl })
    assert.equal(r.image, 'data:image/webp;base64,AQID')
    assert.equal(f.calls.at(-1).url, `${api}/file=/tmp/gradio/out.webp`)
    assert.ok(f.calls.every((c) => c.url.startsWith(`${BASE}/`)))
    // 같은 호스트라도 http:// 주소는 쓰지 않아요.
    clearTryOnCache()
    f = fakeHf({ sse: sseWith({ path: '/tmp/gradio/out.webp', url: 'http://yisol-idm-vton.hf.space/gradio_api/file=/tmp/gradio/out.webp' }) })
    await runHfTryOn({ personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'top', token: 'hf_secret', fetchImpl: f.fetchImpl })
    assert.equal(f.calls.at(-1).url, `${api}/file=/tmp/gradio/out.webp`)
    // path도 없으면 오류이고, 그 주소로는 요청하지 않아요.
    for (const out of [{ url: 'https://attacker.example/x.png' }, { path: 'https://attacker.example/x.png' }]) {
      clearTryOnCache()
      f = fakeHf({ sse: sseWith(out) })
      await assert.rejects(runHfTryOn({ personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'top', token: 'hf_secret', fetchImpl: f.fetchImpl }), isFailed)
      assert.ok(f.calls.every((c) => c.url.startsWith(`${BASE}/`)))
    }
  })
})

await atest('hfTryOn: path만 있는 결과는 {api}/file= 주소로 내려받음', async () => {
  clearTryOnCache()
  const f = fakeHf({ sse: sseWith({ path: '/tmp/gradio/out.webp' }) })
  const r = await runHfTryOn({ personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'top', fetchImpl: f.fetchImpl })
  assert.equal(f.calls.at(-1).url, `${BASE}/gradio_api/file=/tmp/gradio/out.webp`)
  assert.equal(f.calls.at(-1).opts.redirect, 'manual')
  assert.equal(r.image, 'data:image/webp;base64,AQID')
})

await atest('hfTryOn: 결과 다운로드 실패는 주소 대신 오류, 캐시하지 않음', async () => {
  await quiet(async () => {
    clearTryOnCache()
    const fileUrl = `${BASE}/gradio_api/file=/tmp/gradio/out.webp`
    const fail = fakeHf({ extra: (url) => url === fileUrl && resp('boom', { status: 500, type: 'text/plain' }) })
    const args = { personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'top' }
    await assert.rejects(runHfTryOn({ ...args, fetchImpl: fail.fetchImpl }), isFailed)
    // 실패 결과는 보관하지 않아서 다시 누르면 다시 호출해요.
    const again = fakeHf()
    const r = await runHfTryOn({ ...args, fetchImpl: again.fetchImpl })
    assert.ok(again.calls.length > 0)
    assert.equal(r.cached, undefined)
  })
})

await atest('hfTryOn: 결과 리디렉션은 같은 Space 안에서만 따라감', async () => {
  await quiet(async () => {
    const fileUrl = `${BASE}/gradio_api/file=/tmp/gradio/out.webp`
    const moved = `${BASE}/gradio_api/file=/tmp/gradio/moved.webp`
    const redirect = (location) => new Response(null, { status: 302, headers: { location } })
    clearTryOnCache()
    let f = fakeHf({
      extra: (url) => (url === fileUrl ? redirect('/gradio_api/file=/tmp/gradio/moved.webp') : url === moved && resp(new Uint8Array([9]), { type: 'image/png' })),
    })
    const r = await runHfTryOn({ personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'top', token: 'hf_secret', fetchImpl: f.fetchImpl })
    assert.equal(r.image, 'data:image/png;base64,CQ==')
    assert.equal(f.calls.at(-1).url, moved)
    clearTryOnCache()
    f = fakeHf({ extra: (url) => url === fileUrl && redirect('https://attacker.example/x.png') })
    await assert.rejects(runHfTryOn({ personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'top', token: 'hf_secret', fetchImpl: f.fetchImpl }), isFailed)
    assert.ok(f.calls.every((c) => c.url.startsWith(`${BASE}/`)))
  })
})

await atest('hfTryOn: 중단 신호는 AbortError로 그대로 전달, 캐시하지 않음', async () => {
  clearTryOnCache()
  const ctrl = new AbortController()
  const f = fakeHf({
    extra: (url, opts) =>
      url.endsWith('/call/tryon/ev123') &&
      new Promise((_, reject) => {
        ctrl.abort()
        if (opts.signal?.aborted) reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      }),
  })
  const args = { personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'top' }
  await assert.rejects(runHfTryOn({ ...args, fetchImpl: f.fetchImpl, signal: ctrl.signal }), (e) => e.name === 'AbortError')
  const again = fakeHf()
  await runHfTryOn({ ...args, fetchImpl: again.fetchImpl })
  assert.ok(again.calls.length > 0)
})

await atest('hfTryOn: 토큰이 있는데 401이면 BAD_TOKEN', async () => {
  await quiet(async () => {
    clearTryOnCache()
    const denied = async () => resp('Unauthorized', { status: 401, type: 'text/plain' })
    await assert.rejects(
      runHfTryOn({ personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'top', token: 'hf_bad', fetchImpl: denied }),
      (e) => e.status === 502 && e.code === 'BAD_TOKEN',
    )
  })
})

test('fitMetrics: 키 ft/in -> cm, 몸무게 lbs -> kg 변환', () => {
  assert.equal(parseHeightCm('5\' 8"'), 172.7)
  assert.equal(parseHeightCm('5ft 0in'), 152.4)
  assert.equal(parseHeightCm('170cm'), 170)
  assert.equal(parseHeightCm('abc'), null)
  assert.equal(parseHeightCm(null), null)
  assert.equal(parseWeightKg('137lbs'), 62.1)
  assert.equal(parseWeightKg('60kg'), 60)
  assert.equal(parseWeightKg('많이'), null)
})

test('fitMetrics: 핏 라벨 small/fit/large -> small/true/large', () => {
  assert.equal(normalizeFit('fit'), 'true')
  assert.equal(normalizeFit('Small'), 'small')
  assert.equal(normalizeFit('large'), 'large')
  assert.equal(normalizeFit('weird'), null)
})

test('fitMetrics: 행 정규화와 제외 사유 집계', () => {
  const ok = normalizeRow({ item_id: 'a', size: '8', fit: 'fit', height: '5\' 6"', weight: '130lbs' })
  assert.deepEqual(ok, { item: 'a', size: '8', fit: 'true', height: 167.6, weight: 59 })
  assert.ok(normalizeRow({ item_id: 'a', size: '8', fit: 'fit', weight: '130lbs' }).excluded)
  const text = [
    JSON.stringify({ item_id: 'a', size: 'm', fit: 'small', height: '5\' 6"', weight: '130lbs' }),
    '',
    '{깨짐',
    JSON.stringify({ item_id: 'a', size: 'm', fit: '??', height: '5\' 6"', weight: '130lbs' }),
  ].join('\n')
  const n = normalizeLines(text)
  assert.equal(n.total, 3)
  assert.equal(n.rows.length, 1)
  assert.equal(n.rows[0].size, 'M')
  assert.equal(n.excluded['JSON 해석 실패'], 1)
})

test('fitMetrics: 혼동행렬, 정확도, precision/recall', () => {
  const pairs = [
    { actual: 'true', predicted: 'true' },
    { actual: 'true', predicted: 'true' },
    { actual: 'true', predicted: 'small' },
    { actual: 'small', predicted: 'small' },
    { actual: 'large', predicted: 'true' },
  ]
  const m = confusionMatrix(pairs)
  assert.equal(m.true.true, 2)
  assert.equal(m.true.small, 1)
  assert.equal(m.large.true, 1)
  assert.equal(accuracy(m), 3 / 5)
  const pr = precisionRecall(m)
  assert.equal(pr.true.precision, 2 / 3)
  assert.equal(pr.true.recall, 2 / 3)
  assert.equal(pr.small.precision, 1 / 2)
  assert.equal(pr.small.recall, 1)
  assert.equal(pr.large.precision, null)
  assert.equal(pr.large.recall, 0)
  assert.equal(accuracy(confusionMatrix([])), null)
})

test('fitMetrics: 이웃 투표는 자기 자신과 다른 사이즈를 제외하고, 이웃이 없으면 예측 불가', () => {
  const rows = [
    { item: 'a', size: 'M', fit: 'small', height: 165, weight: 55 },
    { item: 'a', size: 'M', fit: 'small', height: 165, weight: 56 },
    { item: 'a', size: 'M', fit: 'large', height: 190, weight: 100 },
    { item: 'a', size: 'L', fit: 'true', height: 165, weight: 55 },
  ]
  const p = neighborVotePredictions(rows, bodySimilarity)
  assert.equal(p.length, 4)
  assert.equal(p.find((x) => x.index === 0).predicted, 'small')
  assert.equal(p.find((x) => x.index === 2).predicted, null)
  assert.equal(p.find((x) => x.index === 3).predicted, null)
})

test('fitMetrics: 구간별 정사이즈 비율', () => {
  const rows = [
    { height: 150, fit: 'true' },
    { height: 152, fit: 'small' },
    { height: 170, fit: 'true' },
  ]
  const b = trueRateByBucket(rows, 'height', [160])
  assert.equal(b[0].n, 2)
  assert.equal(b[0].rate, 0.5)
  assert.equal(b[1].rate, 1)
})

test('bodyMetrics: 오차 지표 (MAE, RMSE, bias, 이내 비율)', () => {
  const s = errorStats([1, -2, 4, -6])
  assert.equal(s.n, 4)
  assert.equal(s.mae, 3.25)
  assert.equal(s.bias, -0.75)
  assert.ok(Math.abs(s.rmse - Math.sqrt(57 / 4)) < 1e-9)
  assert.equal(s.within3, 0.5)
  assert.equal(s.within5, 0.75)
  assert.equal(errorStats([]), null)
})

test('bodyMetrics: CSV 파싱(따옴표, BOM, CRLF)과 성별 정규화', () => {
  const rows = parseCsv('\uFEFFgender,note\r\n여,"a,b"\r\nM,"say ""hi"""\r\n')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].note, 'a,b')
  assert.equal(rows[1].note, 'say "hi"')
  assert.equal(normalizeGender('여'), 'female')
  assert.equal(normalizeGender('M'), 'male')
  assert.equal(normalizeGender('?'), null)
  assert.equal(parseRows('[{"a":1}]').length, 1)
  assert.equal(parseRows('{"a":1}\n{"a":2}').length, 2)
})

test('bodyMetrics: 컬럼 매핑 덮어쓰기와 mm 단위 변환', () => {
  const map = mergeMapping({ height: 'H_mm', footLength: 'F' })
  const r = normalizeBodyRow({ gender: '남', H_mm: '1700', weight: '65', F: '260' }, map, 'mm')
  assert.equal(r.height, 170)
  assert.equal(r.actual.footLength, 260)
  assert.equal(normalizeBodyRow({ gender: '남', H_mm: '1700', weight: '65' }, map, 'mm').excluded, '실측 부위 값 없음')
  assert.equal(normalizeBodyRow({ gender: 'x', height: 170, weight: 60, waist: 70 }, mergeMapping()).excluded, '성별 없음/해석 불가')
  const n = normalizeBodyRows([{ gender: 'female', height: 160, weight: 50, waist: 66 }, null], mergeMapping())
  assert.equal(n.rows.length, 1)
  assert.equal(n.total, 2)
})

test('bodyMetrics: 추정과 실측 비교, 발길이는 cm로 환산', () => {
  const est = estimateBody({ gender: 'female', height: 160, weight: 50 }).values
  const rows = [{ gender: 'female', height: 160, weight: 50, actual: { waist: est.waist + 4, footLength: est.footLength } }]
  const res = evaluateBody(rows, estimateBody)
  assert.equal(res.female.waist.bias, -4)
  assert.equal(res.female.waist.within3, 0)
  assert.equal(res.female.waist.within5, 1)
  assert.equal(res.female.footLength.mae, 0)
  assert.equal(res.male.waist, undefined)
})

test('bodyMetrics: 최소제곱 회귀가 정확한 선형 관계를 복원', () => {
  const samples = []
  for (const h of [150, 160, 170, 180]) for (const w of [45, 60, 75]) samples.push({ height: h, weight: w, value: 0.3 * h + 0.5 * w + 7 })
  const f = fitLinear(samples)
  assert.ok(Math.abs(f.height - 0.3) < 1e-6 && Math.abs(f.weight - 0.5) < 1e-6 && Math.abs(f.intercept - 7) < 1e-4)
  assert.equal(fitLinear(samples.slice(0, 3)), null)
  assert.equal(fitLinear(samples.map((s) => ({ ...s, weight: 50 }))), null)
})

const FB = { url: 'https://www.musinsa.com/products/123456?utm=x', productName: '오버핏 셔츠 아주긴이름', category: 'top', size: 'M', result: 'large', returned: true, parts: { chest: 9.3, shoulder: 1.1 }, savedAt: Date.UTC(2026, 10, 2) }
const PF = { gender: 'male', height: '172', weight: 63, shape: { shoulder: 'normal', belly: 'none', lower: 'normal' }, usual: { top: 'M', bottom: '30' }, measurements: { chest: 98 }, preferredFit: 'regular' }

test('toBand: 5단위 구간 경계', () => {
  assert.equal(toBand(170, 5), '170-174')
  assert.equal(toBand(174.9, 5), '170-174')
  assert.equal(toBand(175, 5), '175-179')
  assert.equal(toBand('63', 5), '60-64')
  assert.equal(toBand(0, 5), null)
  assert.equal(toBand('abc', 5), null)
})

test('toDomain: 도메인만 남김', () => {
  assert.equal(toDomain('https://www.musinsa.com/products/1?a=b'), 'musinsa.com')
  assert.equal(toDomain('not a url'), null)
})

test('toContribution: 미동의면 null', () => {
  assert.equal(toContribution(FB, PF, false), null)
  assert.equal(toContribution(FB, PF, undefined), null)
  assert.equal(toContribution(FB, PF, 'true'), null)
})

test('toContribution: 식별 정보 제외, 구간 값만', () => {
  const c = toContribution(FB, PF, true)
  assert.equal(c.schemaVersion, SCHEMA_VERSION)
  assert.equal(c.body.heightBand, '170-174')
  assert.equal(c.body.weightBand, '60-64')
  assert.equal(c.domain, 'musinsa.com')
  assert.equal(c.month, '2026-11')
  assert.deepEqual(c.parts, { chest: 10, shoulder: 2 })
  const json = JSON.stringify(c)
  for (const bad of ['productName', 'url', 'photo', 'image', 'measurements', 'usual', '오버핏', '123456', 'utm']) assert.ok(!json.includes(bad), bad)
  assert.ok(!json.includes('172') && !/"weight":63/.test(json))
  assert.ok(!('productName' in c) && !('url' in c) && !('savedAt' in c))
})

test('toContribution: 기존 feedback 형식(parts 없음 등)도 처리, 필수값 없으면 null', () => {
  const old = { url: 'https://www.musinsa.com/x', productName: 'x', category: 'top', size: 'L', result: 'true', returned: false, savedAt: 1 }
  const c = toContribution(old, PF, true)
  assert.deepEqual(c.parts, {})
  assert.equal(c.returned, false)
  assert.equal(toContribution({ ...old, result: '?' }, PF, true), null)
  assert.equal(toContribution(old, { ...PF, height: '' }, true), null)
})

test('동의 문구에 철회와 미동의 사용 가능 안내 포함', () => {
  const all = CONSENT_SUMMARY.join(' ')
  assert.ok(all.includes('철회') && all.includes('동의하지 않아도'))
})

test('toDomain: IP, localhost, 사설·예시 호스트는 null', () => {
  for (const u of ['http://192.168.0.1/a', 'http://localhost:3000/a', 'http://[::1]/a', 'https://shop.internal/a', 'https://intranet/a', 'https://a.example.com/p', 'https://example.com/p', 'https://x.test/p']) assert.equal(toDomain(u), null, u)
  assert.equal(toDomain('https://m.musinsa.com/p'), 'musinsa.com')
})

test('toContribution: 공개 도메인을 알 수 없으면 null(데모 상품 제외)', () => {
  assert.equal(toContribution({ ...FB, url: 'https://shop.example.com/p/1' }, PF, true), null)
  assert.equal(toContribution({ ...FB, url: '' }, PF, true), null)
})

test('toContribution: shape는 어깨·배·하체만 복사', () => {
  const c = toContribution(FB, { ...PF, shape: { shoulder: 'wide', belly: 'none', lower: 'normal', extra: 'x', nested: { a: 1 } } }, true)
  assert.deepEqual(c.body.shape, { shoulder: 'wide', belly: 'none', lower: 'normal' })
  assert.equal(toContribution(FB, { ...PF, shape: null }, true).body.shape, null)
})

test('동의 문구: 미구현 k-익명 공개를 현재형으로 약속하지 않음', () => {
  const all = CONSENT_SUMMARY.join(' ')
  assert.ok(all.includes('계획') && all.includes('아직 적용되지 않았어요'))
  assert.ok(!all.includes('가려낼 수 있는 값은 보내지 않아요'))
})

function withLocalStorage(fn) {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  try { fn() } finally { delete globalThis.localStorage }
}

test('대기열: 같은 달·도메인·종류·사이즈의 다른 상품은 덮어쓰지 않고, 같은 상품은 최신으로 교체', () => {
  withLocalStorage(() => {
    const a = { ...FB, url: 'https://www.musinsa.com/products/111' }
    const b = { ...FB, url: 'https://www.musinsa.com/products/222' }
    assert.notEqual(contributionKey(a), contributionKey(b))
    assert.equal(contributionKey(a), contributionKey({ ...a, url: 'https://www.musinsa.com/products/111?utm=1' }))
    enqueueContribution(toContribution(a, PF, true), contributionKey(a), CONSENT_VERSION)
    enqueueContribution(toContribution(b, PF, true), contributionKey(b), CONSENT_VERSION)
    assert.equal(loadContribQueue().length, 2)
    enqueueContribution(toContribution({ ...a, result: 'small' }, PF, true), contributionKey(a), CONSENT_VERSION)
    const q = loadContribQueue()
    assert.equal(q.length, 2)
    assert.equal(q.find((e) => e.key === contributionKey(a)).record.result, 'small')
    assert.ok(!JSON.stringify(q).includes('111'))
    assert.equal(enqueueContribution(null, 'k', 1), false)
  })
})

test('동의 버전이 바뀌면 이전 동의로 쌓인 대기열도 지워짐', () => {
  withLocalStorage(() => {
    saveConsent(true, CONSENT_VERSION)
    enqueueContribution(toContribution(FB, PF, true), contributionKey(FB), CONSENT_VERSION)
    assert.equal(loadConsent(CONSENT_VERSION), true)
    assert.equal(loadContribQueue().length, 1)
    assert.equal(loadConsent(CONSENT_VERSION + 1), false)
    assert.equal(loadContribQueue().length, 1) // 읽기는 삭제하지 않음
    assert.equal(purgeStaleConsent(CONSENT_VERSION + 1), true)
    assert.equal(loadContribQueue().length, 0)
    assert.equal(loadConsent(CONSENT_VERSION), false)
  })
})

test('contributionKey: 쿼리로 상품을 가르는 URL은 다른 키, www·추적 파라미터는 같은 키', () => {
  const k = (url) => contributionKey({ ...FB, url })
  assert.notEqual(k('https://shop.com/goods/view?goodsNo=1'), k('https://shop.com/goods/view?goodsNo=2'))
  assert.notEqual(k('https://shop.com/detail.html?product_no=1'), k('https://shop.com/detail.html?product_no=2'))
  assert.equal(k('https://www.shop.com/goods/view?goodsNo=1'), k('https://shop.com/goods/view?goodsNo=1&utm_source=a&fbclid=x'))
  assert.equal(k('https://shop.com/g?a=1&b=2'), k('https://shop.com/g?b=2&a=1'))
})

test('toDomain: 허용 목록 밖(소규모·무료 서브도메인)은 null, 허용 목록은 통과', () => {
  for (const u of ['https://tiny-shop.co.kr/p/1', 'https://mystore.cafe24.com/p/1', 'https://abc.myshopify.com/p', 'https://smartstore.naver.com/abc/products/1']) assert.equal(toDomain(u), null, u)
  assert.equal(toContribution({ ...FB, url: 'https://tiny-shop.co.kr/p/1' }, PF, true), null)
  assert.equal(toContribution({ ...FB, url: 'https://www.musinsa.com/products/1' }, PF, true).domain, 'musinsa.com')
  assert.ok(ALLOWED_DOMAINS.includes('musinsa.com'))
})

test('recordsForUpload: record만 반환하고 key·이전 동의 버전 항목은 제외', () => {
  const rec = toContribution({ ...FB, url: 'https://www.musinsa.com/products/1' }, PF, true)
  const q = [
    { key: 'k1', consentVersion: CONSENT_VERSION, record: rec },
    { key: 'k2', consentVersion: CONSENT_VERSION - 1, record: rec },
  ]
  const out = recordsForUpload(q, CONSENT_VERSION)
  assert.equal(out.length, 1)
  assert.ok(!('key' in out[0]) && !JSON.stringify(out).includes('k1'))
  assert.deepEqual(recordsForUpload(null, CONSENT_VERSION), [])
})

test('loadConsent는 저장소를 바꾸지 않고, purgeStaleConsent만 지움', () => {
  withLocalStorage(() => {
    saveConsent(true, CONSENT_VERSION)
    enqueueContribution(toContribution({ ...FB, url: 'https://www.musinsa.com/products/1' }, PF, true), 'k', CONSENT_VERSION)
    assert.equal(loadConsent(CONSENT_VERSION + 1), false)
    assert.equal(loadContribQueue().length, 1)
    assert.equal(purgeStaleConsent(CONSENT_VERSION), false)
    assert.equal(purgeStaleConsent(CONSENT_VERSION + 1), true)
    assert.equal(loadContribQueue().length, 0)
    assert.equal(loadConsent(CONSENT_VERSION), false)
  })
})

test('fitMetrics: 이웃 투표 동률은 예측 불가로 처리하고 집계', () => {
  // 비슷한 체형 이웃 둘의 라벨이 small/large로 갈려 득표가 같음
  const rows = [
    { item: 'a', size: 'M', fit: 'true', height: 165, weight: 55 },
    { item: 'a', size: 'M', fit: 'small', height: 165, weight: 55 },
    { item: 'a', size: 'M', fit: 'large', height: 165, weight: 55 },
  ]
  const p = neighborVotePredictions(rows, bodySimilarity)
  const me = p.find((x) => x.index === 0)
  assert.equal(me.predicted, null)
  assert.equal(me.tie, true)
  assert.equal(evaluate(rows, bodySimilarity).ties, 3) // 세 행 모두 이웃 둘의 라벨이 갈림
})

test('evidence: 리뷰·사이즈표 개수가 실제 데이터와 일치', () => {
  const p = Object.values(PRODUCTS)[0]
  const profile = { height: 170, weight: 65, gender: 'male', preferredFit: 'regular' }
  const r = generateFitComment(profile, p)
  assert.equal(r.evidence.reviewTotal, (p.reviews || []).length)
  assert.equal(r.evidence.reviewMatched, r.matched.length)
  assert.equal(r.evidence.sizeChart, !!p.sizeChart && r.perSize.length > 0)
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ height: 170, weight: 65, size: 'M', fit: 'true', i }))
  const r12 = generateFitComment(profile, { ...p, reviews: mk(12) })
  assert.equal(r12.evidence.reviewTotal, 12)
  assert.equal(r12.evidence.reviewMatched, r12.matched.length)
  assert.equal(r12.evidence.reviewVotes <= r12.evidence.reviewMatched, true)
})

test('describeEvidence: 높음/보통/낮음 문구와 개수', () => {
  const ev = { reviewTotal: 12, reviewMatched: 5, reviewVotes: 5, sizeChart: true, measuredParts: 2, estimatedParts: 0, calibrated: false }
  const hi = describeEvidence(ev, 'high')
  assert.equal(hi.summary, '리뷰 12건 중 비슷한 체형 5건 · 사이즈표 실측 비교 · 확신도 높음')
  assert.equal(hi.reasons.length, 0)
  const mid = describeEvidence({ ...ev, estimatedParts: 1 }, 'medium')
  assert.ok(mid.summary.includes('확신도 보통'))
  assert.ok(mid.reasons.some((x) => x.includes('1개 부위')))
  const lo = describeEvidence(ev, 'low')
  assert.ok(lo.summary.includes('확신도 낮음'))
  assert.ok(lo.reasons.length > 0)
  // 요약의 숫자는 evidence에 있는 값뿐
  const nums = hi.summary.match(/\d+/g).map(Number)
  assert.ok(nums.every((n) => Object.values(ev).includes(n)))
})

test('describeEvidence: 리뷰·사이즈표가 없으면 낮음과 사유', () => {
  const profile = { height: 170, weight: 65, gender: 'male' }
  const r = generateFitComment(profile, { name: 'x', category: 'top', sizeChart: null, reviews: [] })
  assert.equal(r.confidence, 'low')
  assert.equal(r.evidence.reviewTotal, 0)
  assert.equal(r.evidence.sizeChart, false)
  const d = describeEvidence(r.evidence, r.confidence)
  assert.ok(d.summary.includes('리뷰 없음') && d.summary.includes('사이즈표 없음'))
  assert.ok(d.reasons.some((x) => x.includes('리뷰가 없어요')))
  assert.ok(!/\d/.test(d.summary.replace(CONFIDENCE_LABEL.low.text, '')))
})


// ---------- 크롬 확장: DOM 파서 ----------
// JS로 그려진 페이지처럼 div 기반 리뷰 + 표 하나 (실제 쇼핑몰 HTML이 아니라 직접 만든 예시예요)
const EXT_HTML = `<html><head><title>x</title><meta property="og:title" content="오버핏 후드 티셔츠"></head><body>
<h1>오버핏 후드 티셔츠</h1>
<table><tr><th>사이즈</th><th>어깨너비</th><th>가슴단면</th><th>총장</th></tr>
<tr><td>M</td><td>50</td><td>57</td><td>68</td></tr>
<tr><td>L</td><td>52</td><td>60</td><td>70</td></tr></table>
<div class="ReviewList"><div class="review-item"><span>키 175 몸무게 70 L 사이즈로 구매했는데 딱 맞아요 정사이즈예요</span></div>
<div class="review-item"><span>키 173 몸무게 68 M 샀는데 작아요 타이트합니다</span></div>
<div class="review-item"><span>짧음</span></div></div></body></html>`

test('DOM 파서: 이름·사이즈표(단면 ×2)·리뷰를 읽는다', () => {
  const p = parsePage(fakeDocument(EXT_HTML), 'https://shop.example/p/1')
  assert.equal(p.name, '오버핏 후드 티셔츠')
  assert.equal(p.category, 'top')
  assert.deepEqual(p.sizeChart.rows.map((r) => r[0]), ['M', 'L'])
  assert.equal(p.sizeChart.measures.M.chest, 114)
  assert.equal(p.sizeChart.measures.L.shoulder, 52)
  assert.equal(p.reviews.length, 2)
  assert.deepEqual([p.reviews[0].height, p.reviews[0].weight, p.reviews[0].size, p.reviews[0].fit], [175, 70, 'L', 'true'])
  assert.equal(p.reviews[1].fit, 'small')
})

test('DOM 파서와 서버 파서가 같은 표에서 같은 사이즈표를 만든다', () => {
  const html = `<html><head><title>t</title><meta property="og:title" content="오버핏 후드 티셔츠"></head><body>${EXT_HTML.match(/<table>[\s\S]*<\/table>/)[0]}</body></html>`
  const server = parseProductHtml(html, 'https://shop.example/p/1')
  const dom = parsePage(fakeDocument(html), 'https://shop.example/p/1')
  assert.deepEqual(dom.sizeChart, server.sizeChart)
  assert.equal(dom.category, server.category)
})

test('DOM 파서: JSON-LD 리뷰도 읽고 같은 문장은 한 번만 센다', () => {
  const ld = JSON.stringify({ '@type': 'Product', name: '슬랙스 팬츠', review: [{ reviewBody: '키 180 몸무게 75 L 사이즈로 구매 정사이즈예요 잘 맞아요' }] })
  const html = `<html><body><script type="application/ld+json">${ld}</script><div class="review">키 180 몸무게 75 L 사이즈로 구매 정사이즈예요 잘 맞아요</div></body></html>`
  const p = parsePage(fakeDocument(html), 'https://shop.example/p/2')
  assert.equal(p.category, 'bottom')
  assert.equal(p.reviews.length, 1)
  assert.equal(p.sizeChart, null)
  assert.ok(p.notes.some((n) => n.includes('사이즈표')))
})

test('DOM 파서: 단서 없는 안내 문구는 리뷰 건수에 넣지 않는다', () => {
  const html = '<html><body><h1>니트</h1><div class="review-guide">리뷰 작성하고 적립금 받아가세요 지금 바로</div><div class="review-item">키 170 몸무게 60 M 사이즈로 구매 정사이즈예요</div></body></html>'
  assert.equal(parsePage(fakeDocument(html), '').reviews.length, 1)
})

test('상품 페이지 판별: JSON-LD Product·og:type·사이즈표만 true', () => {
  assert.equal(isProductPage(fakeDocument('<html><body><h1>주문 내역</h1></body></html>')), false)
  assert.equal(isProductPage(fakeDocument('<html><head><meta property="og:type" content="product"></head><body></body></html>')), true)
  assert.equal(isProductPage(fakeDocument(EXT_HTML)), true)
})

test('DOM 파서: 이름을 못 읽으면 null, 깨진 JSON-LD는 무시', () => {
  assert.equal(parsePage(fakeDocument('<html><body><p>hi</p></body></html>'), ''), null)
  const p = parsePage(fakeDocument('<html><body><h1>니트</h1><script type="application/ld+json">{oops</script></body></html>'), '')
  assert.equal(p.name, '니트')
})

test('확장 분석: generateFitComment와 같은 추천·확신도·근거 문장', () => {
  const profile = buildProfile({ gender: 'male', height: '175', weight: '70', preferredFit: 'regular', measurements: {} }).profile
  const doc = fakeDocument(EXT_HTML)
  const r = analyzePage(doc, 'https://shop.example/p/1', profile)
  const direct = generateFitComment(profile, parsePage(doc, 'https://shop.example/p/1'))
  assert.equal(r.status, 'ok')
  assert.equal(r.recommendedSize, direct.recommendedSize)
  assert.equal(r.confidence, direct.confidence)
  assert.equal(r.summary, describeEvidence(direct.evidence, direct.confidence).summary)
  assert.ok(r.summary.includes(CONFIDENCE_LABEL[direct.confidence].text))
})

test('확장 분석: 사이즈표도 리뷰도 없으면 추천하지 않고 알린다', () => {
  const profile = buildProfile({ gender: 'male', height: '175', weight: '70' }).profile
  const r = analyzePage(fakeDocument('<html><body><h1>니트 스웨터</h1></body></html>'), '', profile)
  assert.equal(r.status, 'no-data')
  assert.ok(!('recommendedSize' in r))
  assert.equal(analyzePage(fakeDocument('<html><body></body></html>'), '', profile).status, 'no-product')
})

test('확장 프로필: 입력 검증과 치수 정리', () => {
  assert.ok(buildProfile({ gender: '', height: '175', weight: '70' }).error)
  assert.ok(buildProfile({ gender: 'male', height: '90', weight: '70' }).error)
  assert.ok(buildProfile({ gender: 'male', height: '175', weight: '500' }).error)
  const { profile } = buildProfile({ gender: 'female', height: '160', weight: '50', preferredFit: 'bad', measurements: { chest: '88', waist: '', hip: 'abc' } })
  assert.equal(profile.preferredFit, 'regular')
  assert.deepEqual(profile.measurements, { chest: 88 })
  assert.ok(isUsableProfile(profile))
  assert.ok(!isUsableProfile(null))
})

// ---------- 크롬 확장: <table>이 아닌 사이즈표 (전부 직접 만든 가짜 HTML, 실제 무신사 DOM이 아님) ----------
const TABLE_CHART_HTML = '<html><body><h1>오버핏 후드 티셔츠</h1><table><tr><th>사이즈</th><th>어깨너비</th><th>가슴단면</th><th>총장</th></tr><tr><td>M</td><td>50</td><td>57</td><td>68</td></tr><tr><td>L</td><td>52</td><td>60</td><td>70</td></tr></table></body></html>'
const wrapBody = (inner) => `<html><head><meta property="og:title" content="오버핏 후드 티셔츠"></head><body><h1>오버핏 후드 티셔츠</h1>${inner}</body></html>`
const refMeasures = parsePage(fakeDocument(TABLE_CHART_HTML), '').sizeChart.measures
const measuresOf = (html) => parsePage(fakeDocument(wrapBody(html)), '').sizeChart?.measures

test('가짜 HTML: class만 있는 div/grid 사이즈표가 table과 같은 measures를 만든다', () => {
  const html = `<section><h3>사이즈 정보</h3><div class="sz-grid">
<div class="sz-row"><span class="c">사이즈</span><span class="c">어깨너비</span><span class="c">가슴단면</span><span class="c">총장</span></div>
<div class="sz-row"><span class="c">M</span><span class="c">50</span><span class="c">57</span><span class="c">68</span></div>
<div class="sz-row"><span class="c">L</span><span class="c">52</span><span class="c">60</span><span class="c">70</span></div></div></section>`
  assert.deepEqual(measuresOf(html), refMeasures)
})

test('가짜 HTML: 칸이 한 줄로 늘어선 CSS grid도 읽는다', () => {
  const cells = ['사이즈', '어깨너비', '가슴단면', '총장', 'M', '50', '57', '68', 'L', '52', '60', '70'].map((c) => `<div>${c}</div>`).join('')
  assert.deepEqual(measuresOf(`<div class="g">${cells}</div>`), refMeasures)
})

test('가짜 HTML: role=table/row/cell 사이즈표가 table과 같은 measures를 만든다', () => {
  const row = (cs, role = 'cell') => `<div role="row">${cs.map((c) => `<div role="${role}">${c}</div>`).join('')}</div>`
  const html = `<div role="table">${row(['사이즈', '어깨너비', '가슴단면', '총장'], 'columnheader')}${row(['M', '50', '57', '68'])}${row(['L', '52', '60', '70'])}</div>`
  assert.deepEqual(measuresOf(html), refMeasures)
})

test('가짜 HTML: 세로 방향(한 줄이 한 항목) 사이즈표를 뒤집어 읽는다', () => {
  const line = (cs) => `<ul class="m">${cs.map((c) => `<li>${c}</li>`).join('')}</ul>`
  const html = `<div class="chart">${line(['사이즈', 'M', 'L'])}${line(['어깨너비', '50', '52'])}${line(['가슴단면', '57', '60'])}${line(['총장', '68', '70'])}</div>`
  assert.deepEqual(measuresOf(html), refMeasures)
})

test('가짜 HTML: 한 열이 한 사이즈인 열 단위 구조도 읽는다', () => {
  const col = (cs) => `<div class="col">${cs.map((c) => `<span>${c}</span>`).join('')}</div>`
  const html = `<div class="cols">${col(['사이즈', '어깨너비', '가슴단면', '총장'])}${col(['M', '50', '57', '68'])}${col(['L', '52', '60', '70'])}</div>`
  assert.deepEqual(measuresOf(html), refMeasures)
})

test('가짜 HTML: 숨겨진(display:none, hidden, aria-hidden) 사이즈표도 읽는다', () => {
  const chart = `<div class="sz"><div class="r"><b>사이즈</b><b>어깨너비</b><b>가슴단면</b><b>총장</b></div><div class="r"><b>M</b><b>50</b><b>57</b><b>68</b></div><div class="r"><b>L</b><b>52</b><b>60</b><b>70</b></div></div>`
  for (const attrs of ['style="display:none"', 'hidden', 'aria-hidden="true"']) {
    assert.deepEqual(measuresOf(`<div ${attrs}>${chart}</div>`), refMeasures, attrs)
  }
})

test('가짜 HTML: 단위가 따로 붙은 칸과 Free/95/100(M)/(cm) 머리글을 허용한다', () => {
  const row = (cs) => `<div class="r">${cs.map((c) => `<i>${c}</i>`).join('')}</div>`
  const html = `<div>${row(['사이즈', '어깨(cm)', '가슴단면(cm)', '총장(cm)'])}${row(['Free', '50', '57', '68'])}${row(['95', '51', '58', '69'])}${row(['100(M)', '52', '60', '70'])}${row(['M cm', '53', '61', '71'])}</div>`
  const m = measuresOf(html)
  assert.deepEqual(Object.keys(m).sort(), ['100(M)', '95', 'FREE', 'M'])
  assert.equal(m.FREE.shoulder, 50)
})

test('가짜 HTML: 나중에 그려지는 사이즈표는 그려지기 전엔 없고 후엔 읽힌다', () => {
  const before = '<div class="sz-area"><h3>사이즈 정보</h3></div>'
  const chart = '<div class="r"><b>사이즈</b><b>어깨너비</b><b>가슴단면</b><b>총장</b></div><div class="r"><b>M</b><b>50</b><b>57</b><b>68</b></div>'
  assert.equal(parsePage(fakeDocument(wrapBody(before)), '').sizeChart, null)
  assert.ok(parsePage(fakeDocument(wrapBody(`<div class="sz-area"><h3>사이즈 정보</h3><div>${chart}</div></div>`)), '').sizeChart)
})

const PLANT = { name: '비밀상품이름XYZ', review: '리뷰본문비밀문장 키 171 몸무게 63 M 사이즈 정사이즈예요', profile: '체형값987654' }
const IMG_HTML = `<html><head><meta property="og:title" content="${PLANT.name}"></head><body><h1>${PLANT.name}</h1>
<section class="size-info"><h3>사이즈 정보</h3><img src="a.jpg"></section>
<div class="review-item">${PLANT.review}</div><div class="x">${PLANT.profile}</div></body></html>`

test('가짜 HTML: 이미지뿐인 사이즈표는 차트 없이 진단 개수를 던지지 않고 만든다', () => {
  const root = fakeDocument(IMG_HTML)
  assert.equal(parsePage(root, '').sizeChart, null)
  const d = collectDiagnostics(root, 'https://shop.example/p/1?a=1#h', '0.1.0')
  assert.equal(d.chartRowCount, 0)
  assert.equal(d.imageNearHeading, true)
  assert.equal(d.tableCount, 0)
  assert.equal(d.reviewsKept, 1)
})

test('가짜 HTML: 진단 리포트에 프로필·리뷰 글·상품명·쿼리·해시가 없다', () => {
  const d = collectDiagnostics(fakeDocument(IMG_HTML), 'https://shop.example/p/1?token=SECRETQ#frag', '0.1.0')
  d.errorName = 'TypeError'
  d.errorMessage = 'x failed at https://shop.example/p/1?token=SECRETQ'
  const rep = formatReport(d)
  for (const bad of [PLANT.name, PLANT.profile, '리뷰본문비밀문장', 'SECRETQ', 'frag', '171']) assert.ok(!rep.includes(bad), bad)
  assert.ok(rep.includes('https://shop.example/p/1'))
  assert.ok(rep.includes('0.1.0'))
  assert.ok(!rep.includes('failed at'))
  assert.ok(rep.includes('TypeError'))
})

test('가짜 HTML: 오류 경로 리포트는 오류 이름만 담고 페이지 글이 든 메시지는 버린다', () => {
  const d = collectDiagnostics(fakeDocument(IMG_HTML), 'https://shop.example/p/1', '0.1.0')
  d.errorName = 'DOMException'
  d.errorMessage = `bad node: ${PLANT.review} ${PLANT.name}`
  const rep = formatReport(d)
  assert.ok(rep.includes('DOMException'))
  for (const bad of [PLANT.name, '리뷰본문비밀문장', 'bad node']) assert.ok(!rep.includes(bad), bad)
})

test('가짜 HTML: 메뉴·상품 목록·스펙 격자는 사이즈표로 읽지 않는다', () => {
  const nav = '<ul class="nav"><li><a>기장</a><a>허리</a></li><li><a>소매</a><a>어깨</a></li><li><a>가슴</a><a>단면</a></li></ul>'
  const list = '<ul class="goods">' + Array.from({ length: 4 }, (_, i) => `<li><span>허리 편한 바지 ${i}</span><span>${10000 + i}원</span></li>`).join('') + '</ul>'
  const spec = '<dl class="spec"><div><dt>기장</dt><dd>긴 기장</dd></div><div><dt>허리</dt><dd>밴딩</dd></div><div><dt>소매</dt><dd>없음</dd></div></dl>'
  for (const html of [nav, list, spec]) assert.equal(parsePage(fakeDocument(wrapBody(html)), '').sizeChart, null, html.slice(0, 30))
})

test('가짜 HTML: 차트 앞에 측정 단어 조각이 많아도 실제 차트를 찾는다', () => {
  const noise = Array.from({ length: 120 }, (_, i) => `<p>기장 ${i}</p>`).join('')
  const chart = '<div class="c"><div><b>사이즈</b><b>어깨</b><b>가슴</b></div><div><b>M</b><b>50</b><b>57</b></div><div><b>L</b><b>52</b><b>60</b></div></div>'
  assert.ok(parsePage(fakeDocument(wrapBody(noise + chart)), '').sizeChart)
})

test('가짜 HTML: 진단 리포트 길이는 상한을 넘지 않는다', () => {
  const rows = Array.from({ length: 300 }, (_, i) => `<div class="r${i}"><b>사이즈</b><b>어깨</b><b>M</b></div>`).join('')
  const rep = formatReport(collectDiagnostics(fakeDocument(wrapBody(`<div class="big">${rows}</div>`)), 'https://shop.example/p/' + 'a'.repeat(5000)))
  assert.ok(rep.length <= REPORT_MAX)
})

test('가짜 HTML: 데이터가 없을 때 analyzePage 메시지와 details에 구체적인 개수가 있다', () => {
  const r = analyzePage(fakeDocument(IMG_HTML), 'https://shop.example/p/1', { height: 175, weight: 70 }, '0.1.0')
  assert.equal(r.status, 'no-data')
  assert.ok(r.message.includes('이미지'))
  assert.ok(r.details.some((l) => /table 0개/.test(l)))
  assert.ok(r.details.some((l) => /리뷰 후보 \d+개/.test(l)))
  assert.equal(r.recommendedSize, undefined)
  assert.ok(r.diagnostics && typeof r.diagnostics.gridCandidateCount === 'number')
})

test('가짜 HTML: 직접 입력한 사이즈표로 분석을 다시 할 수 있다', () => {
  const extraRows = manualChartRows('어깨 가슴 총장', 'M 50 57 68\nL 52 60 70\n잘못된 줄 1')
  assert.equal(extraRows[0].length, 3)
  const r = analyzePage(fakeDocument(IMG_HTML), 'https://shop.example/p/1', { height: 175, weight: 70 }, '', { extraRows })
  assert.equal(r.status, 'ok')
  assert.deepEqual(manualChartRows('', 'M 1'), [])
})

// ---- 구매 옵션 이름·표 라벨 판단 (전부 가짜 HTML이며 실제 무신사 페이지 검증이 아니에요) ----
const OPTION_LIST = ['0 (S)', '1 (M)', '2 (L)', '3 (XL)', '4 (2XL)']
  .map((l, i) => `<li><span>${l}</span><span>${i < 2 ? '11.13(금) 이내 발송 예정 예약배송' : '내일(월) 도착보장'}</span></li>`)
  .join('')
const optionsHtml = `<ul class="option-list">${OPTION_LIST}</ul>`
const chartTable = (labels) =>
  `<table><tr><th>사이즈</th><th>총장</th><th>어깨</th><th>가슴</th><th>소매</th></tr>` +
  labels.map((l, i) => `<tr><td>${l}</td><td>${67 + i * 2}</td><td>${44 + i * 2}</td><td>${52 + i * 2}</td><td>${60 + i}</td></tr>`).join('') +
  `</table>`
const fakeProfile = { height: 175, weight: 70, gender: 'male', preferredFit: 'regular' }

test('가짜 HTML: "0 (S)"~"4 (2XL)" 옵션과 같은 이름의 사이즈표는 인식하고 추천은 옵션 이름으로 보여준다', () => {
  const doc = fakeDocument(wrapBody(`<h1>코튼 재킷 아우터</h1>${optionsHtml}${chartTable(OPTION_LIST_LABELS())}`))
  const p = parsePage(doc, '')
  assert.deepEqual(p.optionLabels, ['0 (S)', '1 (M)', '2 (L)', '3 (XL)', '4 (2XL)'])
  assert.deepEqual(p.sizeChart.rows.map((r) => r[0]), ['0(S)', '1(M)', '2(L)', '3(XL)', '4(2XL)'])
  assert.equal(p.sizeChart.display['1(M)'], '1 (M)')
  const r = analyzePage(doc, '', fakeProfile)
  assert.equal(r.status, 'ok')
  assert.ok(OPTION_LIST_LABELS().includes(r.recommendedLabel), r.recommendedLabel)
  assert.ok(r.headline.includes(r.recommendedLabel))
})
function OPTION_LIST_LABELS() {
  return ['0 (S)', '1 (M)', '2 (L)', '3 (XL)', '4 (2XL)']
}

test('가짜 HTML: 표 라벨이 "S/M/L" 글자뿐이어도 옵션 "N (S)"와 이어져 옵션 이름으로 보여준다', () => {
  const doc = fakeDocument(wrapBody(`<h1>코튼 재킷 아우터</h1>${optionsHtml}${chartTable(['S', 'M', 'L', 'XL', '2XL'])}`))
  const p = parsePage(doc, '')
  assert.equal(p.sizeChart.display.M, '1 (M)')
  const r = analyzePage(doc, '', fakeProfile)
  assert.ok(r.recommendedLabel == null || OPTION_LIST_LABELS().includes(r.recommendedLabel))
})

test('가짜 HTML: 사이즈 이름 줄이 없고 첫 열에 총장 값(67/69/71)이 있는 격자는 67을 사이즈로 읽지 않는다', () => {
  const grid =
    '<div class="g"><div><b>총장</b><b>67</b><b>69</b><b>71</b></div><div><b>어깨</b><b>45</b><b>47</b><b>49</b></div><div><b>가슴</b><b>55</b><b>57</b><b>59</b></div></div>'
  const doc = fakeDocument(wrapBody(`<h1>코튼 재킷 아우터</h1>${grid}`))
  const p = parsePage(doc, '')
  assert.equal(p.sizeChart, null)
  const r = analyzePage(doc, '', fakeProfile)
  assert.notEqual(r.recommendedSize, '67')
  assert.notEqual(r.recommendedLabel, '67')
  assert.ok(!JSON.stringify(r).includes('"67"'))
  const rep = formatReport(collectDiagnostics(doc, 'https://shop.example/p/1'))
  assert.match(rep, /뒤집어도 못 쓴 후보 [1-9]/)
})

// 가로세로가 뒤집힌 표: 첫 열이 실측 항목, 첫 행이 사이즈 이름
const MEASURE_ROWS = [
  ['총장', 67, 69, 71, 73, 75],
  ['어깨너비', 44, 46, 48, 50, 52],
  ['가슴단면', 52, 54, 56, 58, 60],
  ['소매길이', 60, 61, 62, 63, 64],
]
const flippedTable = (names) =>
  `<table><tr><th>사이즈</th>${names.map((n) => `<th>${n}</th>`).join('')}</tr>` +
  MEASURE_ROWS.map((r) => `<tr><td>${r[0]}</td>${r.slice(1).map((v) => `<td>${v}</td>`).join('')}</tr>`).join('') +
  `</table>`
const flippedGrid = (names) =>
  `<div class="g"><div><b>사이즈</b>${names.map((n) => `<b>${n}</b>`).join('')}</div>` +
  MEASURE_ROWS.map((r) => `<div><b>${r[0]}</b>${r.slice(1).map((v) => `<b>${v}</b>`).join('')}</div>`).join('') +
  `</div>`

test('가짜 HTML: 첫 열이 실측 항목이고 첫 행이 0~4인 뒤집힌 표를 옵션 "0 (S)"~"4 (2XL)"와 이어 읽는다', () => {
  const doc = fakeDocument(wrapBody(`<h1>코튼 재킷 아우터</h1>${optionsHtml}${flippedTable([0, 1, 2, 3, 4])}`))
  const p = parsePage(doc, '')
  assert.ok(p.sizeChart)
  assert.deepEqual(p.sizeChart.rows.map((r) => r[0]), ['0(S)', '1(M)', '2(L)', '3(XL)', '4(2XL)'])
  assert.equal(p.sizeChart.display['0(S)'], '0 (S)')
  assert.equal(p.sizeChart.headers[1], '총장')
  assert.equal(p.sizeChart.rows[0][1], '67')
  assert.equal(p.sizeChartMeta.flipped, 1)
  const r = analyzePage(doc, '', fakeProfile)
  assert.equal(r.status, 'ok')
  assert.ok(OPTION_LIST_LABELS().includes(r.recommendedLabel), r.recommendedLabel)
  assert.notEqual(r.recommendedLabel, '67')
  const rep = formatReport(collectDiagnostics(doc, 'https://shop.example/p/1'))
  assert.match(rep, /뒤집어 읽은 후보 [1-9]/)
})

test('가짜 HTML: 첫 행이 S,M,L,XL,2XL인 뒤집힌 표도 옵션 이름으로 보여준다', () => {
  const doc = fakeDocument(wrapBody(`<h1>코튼 재킷 아우터</h1>${optionsHtml}${flippedTable(['S', 'M', 'L', 'XL', '2XL'])}`))
  const p = parsePage(doc, '')
  assert.deepEqual(p.sizeChart.rows.map((r) => r[0]), ['S', 'M', 'L', 'XL', '2XL'])
  assert.equal(p.sizeChart.display.M, '1 (M)')
  const r = analyzePage(doc, '', fakeProfile)
  assert.ok(r.recommendedLabel == null || OPTION_LIST_LABELS().includes(r.recommendedLabel))
  // 옵션이 없어도 글자 사이즈 이름이면 읽는다
  assert.ok(parsePage(fakeDocument(wrapBody(`<h1>코튼 재킷 아우터</h1>${flippedTable(['S', 'M', 'L', 'XL', '2XL'])}`)), '').sizeChart)
})

test('가짜 HTML: 뒤집힌 표에서도 총장 값 67은 사이즈 이름으로 읽히지 않는다', () => {
  // 옵션이 없을 때 뒤집어 읽은 숫자 이름 후보는 쓰지 않는다 (같은 모양의 세로 후보가 있으면 그쪽이 쓰일 수는 있어요)
  const noOpt = parsePage(fakeDocument(wrapBody(`<h1>코튼 재킷 아우터</h1>${flippedTable([0, 1, 2, 3, 4])}`)), '')
  assert.equal(noOpt.sizeChartMeta.flipped, 0)
  assert.ok(!(noOpt.sizeChart?.rows || []).some((row) => row[0] === '67'))
  const doc = fakeDocument(wrapBody(`<h1>코튼 재킷 아우터</h1>${optionsHtml}${flippedTable([0, 1, 2, 3, 4])}`))
  const r = analyzePage(doc, '', fakeProfile)
  assert.ok(!JSON.stringify(r).includes('"67"'))
  const p = parsePage(doc, '')
  assert.ok(!p.sizeChart.rows.some((row) => row[0] === '67'))
})

test('가짜 HTML: 뒤집힌 표의 사이즈 이름이 구매 옵션과 전혀 안 맞으면 거부한다', () => {
  const doc = fakeDocument(wrapBody(`<h1>코튼 재킷 아우터</h1>${optionsHtml}${flippedTable([95, 100, 105, 110, 115])}`))
  const p = parsePage(doc, '')
  assert.equal(p.sizeChart, null)
  assert.ok(p.sizeChartMeta.rejectedNoOverlap >= 1)
})

test('가짜 HTML: div로 만든 뒤집힌 격자도 뒤집어 읽는다', () => {
  const doc = fakeDocument(wrapBody(`<h1>코튼 재킷 아우터</h1>${optionsHtml}${flippedGrid([0, 1, 2, 3, 4])}`))
  const p = parsePage(doc, '')
  assert.ok(p.sizeChart)
  assert.deepEqual(p.sizeChart.rows.map((r) => r[0]), ['0(S)', '1(M)', '2(L)', '3(XL)', '4(2XL)'])
  assert.ok(p.sizeChartMeta.flipped >= 1)
})

test('가짜 HTML: 사이즈 제목 근처가 이미지뿐이면 이미지로 제공된 것 같다는 안내를 준다', () => {
  const doc = fakeDocument(wrapBody('<h1>코튼 재킷 아우터</h1><div><h3>사이즈 정보</h3><img src="a.png"></div>'))
  const p = parsePage(doc, '')
  assert.equal(p.sizeChart, null)
  assert.ok(p.notes.some((n) => /이미지로 제공된 것 같아요.*직접 입력/.test(n)))
})

test('가짜 HTML: 숫자뿐인 라벨은 증가 순서가 아니거나 한 줄뿐이면 사이즈표로 쓰지 않는다', () => {
  const t = (labels) => `<table><tr><th>사이즈</th><th>어깨</th></tr>${labels.map((l) => `<tr><td>${l}</td><td>45</td></tr>`).join('')}</table>`
  assert.equal(parsePage(fakeDocument(wrapBody(`<h1>재킷</h1>${t([71, 67, 69])}`)), '').sizeChart, null)
  assert.equal(parsePage(fakeDocument(wrapBody(`<h1>재킷</h1>${t([95])}`)), '').sizeChart, null)
  assert.equal(parsePage(fakeDocument(wrapBody(`<h1>재킷</h1>${t([95, 100, 105])}`)), '').sizeChart.rows.length, 3)
})

test('가짜 HTML: 구매 옵션과 이름이 하나도 겹치지 않는 사이즈표는 버리고 추천하지 않는다', () => {
  const doc = fakeDocument(wrapBody(`<h1>코튼 재킷 아우터</h1>${optionsHtml}${chartTable(['95', '100', '105'])}`))
  const p = parsePage(doc, '')
  assert.equal(p.sizeChart, null)
  assert.ok(p.notes.some((n) => n.includes('구매 옵션과 맞지 않아')))
  const r = analyzePage(doc, '', fakeProfile)
  assert.equal(r.status, 'no-data')
  assert.equal(r.recommendedSize, undefined)
  assert.match(formatReport(collectDiagnostics(doc, '')), /구매 옵션과 안 겹쳐 버린 후보 [1-9]개/)
})

test('가짜 HTML: 후기 733건 표시와 불러온 2건이면 요약에 "불러온 2건 / 전체 약 733건"을 밝힌다', () => {
  const rv = (t) => `<div class="review-item">${t}</div>`
  const html =
    `<h1>코튼 재킷 아우터</h1><div class="tab"><span>후기 733</span></div>${optionsHtml}${chartTable(OPTION_LIST_LABELS())}` +
    rv('키 175 몸무게 70 1 (M) 사이즈로 샀는데 정사이즈예요') +
    rv('키 172 몸무게 66 M 사이즈 구매 약간 커요 만족합니다')
  const doc = fakeDocument(wrapBody(html))
  const p = parsePage(doc, '')
  assert.equal(p.reviewTotalOnPage, 733)
  assert.equal(p.reviews.length, 2)
  const r = analyzePage(doc, '', fakeProfile)
  assert.ok(r.summary.includes('페이지에 불러온 리뷰 2건'), r.summary)
  assert.ok(r.summary.includes('전체 약 733건 중 일부'), r.summary)
  assert.ok(OPTION_LIST_LABELS().includes(r.recommendedLabel))
})

test('가짜 HTML: 전체 리뷰 수 표시는 보수적으로 읽고 없으면 null이다', () => {
  const total = (inner) => parsePage(fakeDocument(wrapBody(`<h1>재킷</h1>${inner}`)), '').reviewTotalOnPage
  assert.equal(total('<em>리뷰 1,234개</em>'), 1234)
  assert.equal(total('<p>리뷰 <span>(733)</span></p>'), 733)
  assert.equal(total('<p>리뷰 작성하고 적립금 1000원 받기</p>'), null)
  assert.equal(total('<p>포토리뷰 120</p>'), null)
})

test('가짜 HTML: 리뷰 목록의 li도 키·몸무게 단서가 있을 때만 리뷰로 센다', () => {
  const html = `<h1>재킷</h1><ul class="review-list"><li>키 180 몸무게 75 L 사이즈 샀어요 잘 맞아요</li><li>리뷰 작성하고 적립금 받아가세요 지금 바로</li></ul>`
  assert.equal(parsePage(fakeDocument(wrapBody(html)), '').reviews.length, 1)
})

test('가짜 HTML: 진단 리포트에 새 판단 줄이 있고 리뷰 글·체형 정보는 없다', () => {
  const secret = '비밀후기문장키175'
  const html =
    `<h1>코튼 재킷 아우터</h1><span>후기 733</span>${optionsHtml}${chartTable(OPTION_LIST_LABELS())}` +
    `<div class="review-item">${secret} 몸무게 70 1 (M) 사이즈로 샀어요 정사이즈</div>`
  const rep = formatReport(collectDiagnostics(fakeDocument(wrapBody(html)), 'https://shop.example/p/1?uid=9'))
  for (const want of ['사이즈표 후보', '선택한 후보', '사이즈 이름 5개', '모양 paren', '구매 옵션 이름 5개, 표와 겹침 5개', '불러온 리뷰 1건', '전체 리뷰 약 733건'])
    assert.ok(rep.includes(want), want)
  assert.ok(!rep.includes(secret) && !rep.includes('uid=9') && !rep.includes('코튼 재킷'))
  assert.ok(rep.length <= REPORT_MAX)
})

const NOCHART_REVIEWS = ['ZQXWORD1 키 183 몸무게 77 L 사이즈 샀어요 정사이즈', 'ZQXWORD2 178cm 66kg M 사이즈로 샀어요 작아요', 'ZQXWORD3 키 169 몸무게 58 S 사이즈 샀어요 커요', 'ZQXWORD4 그냥 좋아요']
const NOCHART_HTML = `<h1>코튼 재킷 아우터</h1>${NOCHART_REVIEWS.map((t) => `<div class="review-item">${t}</div>`).join('')}`

test('확장 분석: 사이즈표 없이 리뷰만 있는 ok 결과도 diagnostics와 sizeChartMissing을 가진다', () => {
  const profile = buildProfile({ gender: 'male', height: '175', weight: '70' }).profile
  const r = analyzePage(fakeDocument(wrapBody(NOCHART_HTML)), 'https://shop.example/p/1', profile)
  assert.equal(r.status, 'ok')
  assert.equal(r.sizeChartMissing, true)
  assert.ok(r.diagnostics && r.diagnostics.reviewStats.loaded >= 3)
  const withChart = analyzePage(fakeDocument(EXT_HTML), 'https://shop.example/p/1', profile)
  assert.equal(withChart.status, 'ok')
  assert.equal(withChart.sizeChartMissing, false)
  assert.ok(withChart.diagnostics)
})

test('진단 리포트: 리뷰 통계 개수와 스크롤 정보가 있고 리뷰 글·키·몸무게 값은 없다', () => {
  const d = collectDiagnostics(fakeDocument(wrapBody(NOCHART_HTML)), 'https://shop.example/p/1', '', { scroll: { before: 3, after: 12, stop: 'reached-end' } })
  const s = d.reviewStats
  assert.ok(s.loaded >= 3 && s.withHeight >= 1 && s.withWeight >= 1 && s.withBoth >= 1 && s.withSize >= 1 && s.withFit >= 1)
  assert.ok(s.numCm >= 1 && s.numKg >= 1 && s.wordHeight >= 1 && s.wordWeight >= 1)
  const rep = formatReport(d)
  assert.ok(rep.includes('몸무게 읽음') && rep.includes('숫자+cm') && rep.includes('3건 -> 12건, 멈춘 이유 reached-end'))
  for (const secret of ['ZQXWORD', '183', '178', '77', '66kg', '169']) assert.ok(!rep.includes(secret), secret)
  assert.ok(rep.length <= REPORT_MAX)
  const bad = formatReport(collectDiagnostics(fakeDocument(wrapBody(NOCHART_HTML)), '', '', { scroll: { before: 1, after: 2, stop: '비밀 글' } }))
  assert.ok(bad.includes('멈춘 이유 not-run') && !bad.includes('비밀'))
  assert.ok(!formatReport(collectDiagnostics(fakeDocument(wrapBody(NOCHART_HTML)), '')).includes('리뷰 불러오기'))
})

test('확장 소스와 diagnose.js에 네트워크 호출이 없다 (새 코드 포함)', () => {
  for (const f of ['src/lib/diagnose.js', 'src/lib/pageParser.js', 'src/lib/extAnalyze.js', 'extension/content.js']) {
    const code = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\b/.test(code), f)
  }
})

// ---------- 크롬 확장: manifest ----------
const EXT_MANIFEST = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'))

test('확장 manifest: MV3, 최소 권한, 광범위 호스트 권한·원격 코드 없음', () => {
  assert.deepEqual(checkManifest(EXT_MANIFEST), [])
  assert.deepEqual([...EXT_MANIFEST.permissions].sort(), ['activeTab', 'scripting', 'storage'])
  assert.equal(EXT_MANIFEST.host_permissions, undefined)
  assert.ok(EXT_MANIFEST.content_scripts[0].matches.length <= 5)
})

test('확장 manifest 검사기: 나쁜 manifest를 잡아낸다', () => {
  const bad = { ...EXT_MANIFEST, manifest_version: 2, host_permissions: ['<all_urls>'], content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }], content_security_policy: { extension_pages: "script-src 'self' https://evil.example/x.js" } }
  const errs = checkManifest(bad)
  assert.ok(errs.length >= 4, errs.join('|'))
})

test('확장 소스에 네트워크 호출이 없다', () => {
  for (const f of ['content.js', 'popup.js']) {
    const code = readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8')
    assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\b/.test(code), f)
  }
})

const HW_CASES = [
  ['175cm 70kg', 175, 70],
  ['175cm/70kg', 175, 70],
  ['175cm · 70kg', 175, 70],
  ['키 175 몸무게 70', 175, 70],
  ['키175/몸무게70', 175, 70],
  ['175 / 70', 175, 70],
  ['후기 175/70 입니다', 175, 70],
  ['175.5cm', 175.5, null],
  ['남성 · 175cm · 70kg', 175, 70],
  ['키 205 몸무게 90', 205, 90],
]

test('리뷰 키·몸무게: 여러 표기를 읽는다', () => {
  for (const [text, h, w] of HW_CASES) {
    const r = parseReviewText(text)
    assert.deepEqual([r.height, r.weight], [h, w], text)
  }
})

test('리뷰 키·몸무게: 가격·날짜·할인율은 읽지 않는다', () => {
  for (const text of ['175,000원', '2024-01-175', '70% 할인', '1175 / 70', '175 / 700', '175/70/3']) {
    const r = parseReviewText(text)
    assert.deepEqual([r.height, r.weight], [null, null], text)
  }
})

test('리뷰 키·몸무게: 175/100 같은 의류 사이즈 표기는 읽지 않는다', () => {
  for (const text of ['175/100 구매했어요', '175/100 사이즈 입니다', '사이즈 175/100', 'size: 170/95', '170/95호 샀어요']) {
    const r = parseReviewText(text)
    assert.deepEqual([r.height, r.weight], [null, null], text)
  }
})

test('content.js: 더보기 후보는 button으로 좁고, 중단은 대기를 깨우며, 전체 수를 넘긴다', () => {
  const src = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8')
  assert.ok(!src.includes('javascript:'))
  assert.ok(src.includes(`querySelectorAll('button, [role="button"]')`))
  assert.ok(src.includes('quietWait(STEP_QUIET_MS, STEP_WAIT_MS, state)') && src.includes('loader.wake()'))
  assert.ok(src.includes('count, total }') && !src.includes('total: null'))
  assert.ok(src.includes(`behavior: 'instant'`))
})

test('DOM 파서: 리뷰 요소의 다양한 키·몸무게 표기를 읽는다', () => {
  const items = ['남성 · 175cm · 70kg L 사이즈로 구매 정사이즈예요', '키175/몸무게70 M 사이즈로 구매 잘 맞아요', '175 / 70 L 사이즈로 구매 정사이즈예요']
  const html = `<html><body><h1>니트</h1>${items.map((x) => `<div class="review-item">${x}</div>`).join('')}</body></html>`
  const p = parsePage(fakeDocument(html), '')
  assert.equal(p.reviews.length, 3)
  for (const r of p.reviews) assert.deepEqual([r.height, r.weight], [175, 70])
})

test('reviewLoader.shouldStop: 한도·중단·전체 수·정체를 정해진 이유로 알려준다', () => {
  assert.equal(shouldStop({ steps: 1, elapsedMs: 1000, stalls: 0, count: 5, total: 50 }), null)
  assert.equal(shouldStop({ aborted: true, count: 5, total: 5 }), 'aborted')
  assert.equal(shouldStop({ count: 50, total: 50 }), 'reached-total')
  assert.equal(shouldStop({ count: 5, total: null }), null)
  assert.equal(shouldStop({ stalls: STALL_LIMIT }), 'no-more')
  assert.equal(shouldStop({ steps: MAX_STEPS }), 'limit-steps')
  assert.equal(shouldStop({ elapsedMs: MAX_MS }), 'limit-time')
  for (const reason of STOP_REASONS) assert.ok(['reached-end', 'no-growth', 'limit', 'limit-time', 'aborted'].includes(toReportStop(reason)))
  assert.equal(toReportStop('이상한 값'), 'not-run')
})

test('reviewLoader.isSafeMoreButton: 리뷰 영역의 더보기만 허용한다', () => {
  const inReview = { inReviewContainer: true }
  for (const t of ['더보기', '더 보기', '리뷰 더보기', '후기 더보기', ' 더보기 ']) assert.equal(isSafeMoreButton(t, inReview), true, t)
  for (const t of ['구매하기', '장바구니 담기', '좋아요', '리뷰 작성', '바로구매', '신고', '삭제', '로그인', '찜', '', '더보기 구매하기'])
    assert.equal(isSafeMoreButton(t, inReview), false, t)
  assert.equal(isSafeMoreButton('더보기', { inReviewContainer: false }), false)
  assert.equal(isSafeMoreButton('더보기', null), false)
})

test('diagnose: 리뷰 불러오기 멈춘 이유(시간 한도·중단)가 리포트에 보인다', () => {
  for (const stop of ['limit-time', 'aborted']) {
    const rep = formatReport(collectDiagnostics(fakeDocument(wrapBody(NOCHART_HTML)), '', '', { scroll: { before: 2, after: 9, stop } }))
    assert.ok(rep.includes(stop), stop)
  }
})

// 확장 content.js를 임시 폴더에 IIFE로 빌드해 가짜 DOM(node:vm)에서 fab 클릭(run) 경로를 실행합니다. 실제 무신사·크롬이 아니에요.
async function runContentInFakeDom() {
  const root = resolvePath(import.meta.dirname, '..')
  const outDir = mkdtempSync(join(tmpdir(), 'fitcheck-content-'))
  try {
    await viteBuild({
      configFile: false, root, logLevel: 'silent', publicDir: false,
      build: { outDir, emptyOutDir: true, minify: false, target: 'es2020', lib: { entry: resolvePath(root, 'extension/content.js'), formats: ['iife'], name: 'fitcheck_content', fileName: () => 'content.js' } },
    })
    const code = readFileSync(join(outDir, 'content.js'), 'utf8')
    const texts = []
    const listeners = {}
    const makeEl = (tag) => {
      const e = {
        tagName: String(tag).toUpperCase(), children: [], className: '', hidden: false, disabled: false, style: {},
        _text: '', set textContent(v) { this._text = String(v); texts.push(this._text) }, get textContent() { return this._text },
        append(...n) { this.children.push(...n) }, appendChild(n) { this.children.push(n); return n }, replaceChildren() { this.children = [] },
        setAttribute() {}, getAttribute() { return null }, addEventListener(type, fn) { (this._l ||= {})[type] = fn },
        attachShadow() { return makeEl('shadow') }, remove() {}, select() {}, querySelectorAll() { return [] }, querySelector() { return null }, closest() { return null },
      }
      return e
    }
    const created = []
    const doc = {
      readyState: 'complete', body: makeEl('body'), documentElement: makeEl('html'),
      createElement(tag) { const e = makeEl(tag); created.push(e); return e },
      querySelectorAll() { return [] }, querySelector() { return null }, execCommand() { return false },
    }
    const win = { scrollX: 0, scrollY: 0, scrollTo() {} }
    const profile = buildProfile({ gender: 'male', height: '175', weight: '70', preferredFit: 'regular', measurements: {} }).profile
    const sandbox = {
      document: doc, window: win, location: { href: 'https://shop.example/products/1' }, navigator: {},
      MutationObserver: class { observe() {} disconnect() {} },
      CSSStyleSheet: class { replaceSync() {} },
      setTimeout: (f) => setTimeout(f, 0), clearTimeout,
      chrome: {
        runtime: { getManifest: () => ({ version: '0.0.0' }), onMessage: { addListener: (f) => { listeners.msg = f } } },
        storage: { local: { get: (k, cb) => cb({ fitcheckProfile: profile }) } },
      },
    }
    sandbox.window = Object.assign(sandbox.window, sandbox)
    vm.createContext(sandbox)
    vm.runInContext(code, sandbox)
    listeners.msg({ type: 'fitcheck-run' }) // 팝업에서 실행한 경우: 버튼을 만들고 run()을 호출
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 10))
      const f = created.find((e) => e.className === 'fab')
      if (f && !f.disabled && f.textContent === '내 사이즈 찾기') break
    }
    return texts
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

await atest('content.js(가짜 DOM, vm): 분석 실행 경로에서 ReferenceError 없이 끝난다', async () => {
  const texts = await runContentInFakeDom()
  assert.ok(!texts.some((t) => t.includes('분석 중 문제가 생겼어요')), '오류 카드가 나오면 안 돼요')
  assert.ok(texts.some((t) => t.includes('내 사이즈 찾기')), '실행이 끝나 버튼이 돌아와야 해요')
})

test('formatReport: 오류 위치와 식별자 줄은 검증된 값만 보인다', () => {
  const base = collectDiagnostics(fakeDocument(wrapBody(NOCHART_HTML)), '')
  const rep = formatReport({ ...base, errorName: 'ReferenceError', errorWhere: 'wait', errorIdent: 'state' })
  assert.ok(rep.includes('오류 위치: wait, 식별자: state'))
  const bad = formatReport({ ...base, errorName: 'ReferenceError', errorWhere: 'wait', errorIdent: 'a b<script>' })
  assert.ok(bad.includes('오류 위치: wait') && !bad.includes('식별자') && !bad.includes('script'))
  const badWhere = formatReport({ ...base, errorName: 'ReferenceError', errorWhere: '리뷰 본문 키 175', errorIdent: 'state' })
  assert.ok(!badWhere.includes('오류 위치') && !badWhere.includes('175'))
  assert.ok(!formatReport(base).includes('오류 위치'))
})

// 클래스 이름이 해시처럼 보이는 가짜 리뷰 카드: 키·몸무게는 본문과 다른 span, 구매 옵션은 따로
const CARD_BODIES = ['ZQCARD1 배송이 빨라요 만족합니다 감사해요', 'ZQCARD2 재질이 부드럽고 좋아요 추천해요', 'ZQCARD3 색상이 사진과 같아요 예뻐요', 'ZQCARD4 정사이즈로 잘 맞아요 편해요', 'ZQCARD5 길이가 적당하고 핏이 좋아요', 'ZQCARD6 겨울에 입기 딱 좋아요 따뜻해요', 'ZQCARD7 세탁해도 줄지 않았어요 좋아요', 'ZQCARD8 가격 대비 훌륭해요 재구매 의사 있어요']
const cardsHtml = CARD_BODIES.map(
  (b, i) =>
    `<div class="sc-a1b2c3 xYz${i}"><div class="hd9"><span class="q7">${i % 2 ? '여성' : '남성'} · ${170 + i}cm · ${60 + i}kg</span></div><p class="bd3">${b}</p><div class="op5">구매 옵션: 1 (M)</div></div>`,
).join('')
const CARD_HTML = `<h1>코튼 재킷 아우터</h1>${optionsHtml}${chartTable(OPTION_LIST_LABELS())}<section class="lst0">${cardsHtml}</section><div class="zz1"><span>리뷰 작성하고 적립금 받기 안내 문구입니다</span><span>사진 후기를 남겨 주세요 감사합니다</span></div>`

test('가짜 HTML: 반복되는 리뷰 카드에서 별도 요소의 키·몸무게와 구매 옵션 사이즈를 읽고 안내 문구는 세지 않는다', () => {
  const p = parsePage(fakeDocument(wrapBody(CARD_HTML)), '')
  assert.equal(p.reviews.length, 8)
  assert.equal(p.reviews.filter((r) => r.height != null).length, 8)
  assert.equal(p.reviews.filter((r) => r.weight != null).length, 8)
  assert.equal(p.reviews.filter((r) => r.size === 'M').length, 8)
  assert.ok(p.reviews.every((r) => !r.text.includes('적립금')))
  assert.equal(p.reviewMeta.cards, 8)
})

test('가짜 HTML: 진단 리포트에 버린 후보 사유별 개수와 카드 개수가 있고 리뷰 글·값은 없다', () => {
  const d = collectDiagnostics(fakeDocument(wrapBody(CARD_HTML)), 'https://shop.example/p/1')
  assert.equal(d.reviewStats.withHeight, 8)
  assert.equal(d.reviewStats.withWeight, 8)
  const rep = formatReport(d)
  assert.ok(/버린 리뷰 후보 사유: 너무 짧음 \d+, 너무 김 \d+, 안쪽 중복 \d+, 단서 없음 \d+, 중복 \d+/.test(rep))
  assert.ok(rep.includes('리뷰 카드로 묶은 개수: 8'))
  for (const secret of ['ZQCARD', '170cm', '177', '적립금']) assert.ok(!rep.includes(secret), secret)
  assert.ok(rep.length <= REPORT_MAX)
})

test('가짜 HTML: 사이즈표 셀(150cm 등)은 리뷰 카드로 세지 않는다', () => {
  const rows = ['S', 'M', 'L', 'XL'].map((z, i) => `<tr><td>${z}</td><td>${150 + i * 5}cm</td><td>${50 + i * 5}kg</td><td>${60 + i}</td></tr>`).join('')
  const table = `<table><tr><th>사이즈</th><th>키</th><th>몸무게</th><th>총장</th></tr>${rows}</table>`
  const p = parsePage(fakeDocument(wrapBody(`${table}${optionsHtml}`)), '')
  assert.equal(p.reviewMeta.cards, 0)
  assert.equal(p.reviews.length, 0)
})

test('parseReviewText: 구매 옵션 사이즈가 본문 속 다른 사이즈 언급보다 먼저 쓰인다', () => {
  assert.equal(parseReviewText('M로 구매했어요 175cm 70kg 그런데 0(S) 도 있었어요').size, 'M')
  assert.equal(parseReviewText('구매 옵션: 1 (L) 175cm 70kg 예전에 S로 샀어요').size, 'L')
  assert.equal(parseReviewText('175cm 70kg 구매한 옵션 0(S)').size, 'S')
})

test('가짜 HTML: 일반 표의 숫자 라벨 행도 구매 옵션 이름(0(S))으로 이어진다', () => {
  const html = `<ul class="option-list"><li>0 (S)</li><li>1 (M)</li><li>2 (L)</li></ul><table><tr><th>사이즈</th><th>어깨</th><th>가슴</th></tr><tr><td>0</td><td>44</td><td>50</td></tr><tr><td>1</td><td>46</td><td>52</td></tr><tr><td>2</td><td>48</td><td>54</td></tr></table>`
  const p = parsePage(fakeDocument(wrapBody(html)), '')
  assert.ok(p.sizeChart, '표를 읽어야 해요')
  assert.deepEqual(p.sizeChart.rows.map((r) => r[0]), ['0(S)', '1(M)', '2(L)'])
})

test('가짜 HTML: div 격자 사이즈표(150cm 등)도 리뷰 카드로 세지 않는다', () => {
  const rows = ['S', 'M', 'L', 'XL'].map((z, i) => `<div class="r"><span>${z}</span><span>${150 + i * 5}cm</span><span>${50 + i * 5}kg</span><span>${60 + i}</span></div>`).join('')
  const p = parsePage(fakeDocument(wrapBody(`<div class="g">${rows}</div>${optionsHtml}`)), '')
  assert.equal(p.reviewMeta.cards, 0)
  assert.equal(p.reviews.length, 0)
})

test('가짜 HTML: 리뷰 단서가 있는 반복 카드는 계속 카드로 읽는다', () => {
  const rows = [0, 1, 2, 3].map((i) => `<div class="r"><span>25.01.0${i + 1}</span><span>${170 + i}cm</span><span>구매 옵션 : 블랙 / M</span><span>잘 맞아요</span></div>`).join('')
  const p = parsePage(fakeDocument(wrapBody(`<div class="g">${rows}</div>`)), '')
  assert.equal(p.reviewMeta.cards, 4)
})

test('parseReviewText: 구매 옵션 뒤에 색상이 먼저 와도 옵션의 사이즈를 쓴다', () => {
  assert.equal(parseReviewText('키 170cm 구매 옵션 : 블랙 / M 평소 L로 구매했는데 딱 맞아요').size, 'M')
  assert.equal(parseReviewText('키 170cm 구매 옵션 : Black / 1 (L) 평소 S로 구매했어요').size, 'L')
})

test('가짜 HTML: 옵션 번호와 표 번호가 어긋난 숫자 라벨 표는 거부한다', () => {
  const html = `<ul class="option-list"><li>0 (S)</li><li>1 (M)</li><li>2 (L)</li></ul><table><tr><th>사이즈</th><th>어깨</th><th>가슴</th></tr><tr><td>5</td><td>44</td><td>50</td></tr><tr><td>6</td><td>46</td><td>52</td></tr><tr><td>7</td><td>48</td><td>54</td></tr></table>`
  const p = parsePage(fakeDocument(wrapBody(html)), '')
  assert.equal(p.sizeChart, null)
})

test('formatReport: 오류 위치 profile 단계도 허용된다', () => {
  const base = collectDiagnostics(fakeDocument(wrapBody(NOCHART_HTML)), '')
  assert.ok(formatReport({ ...base, errorName: 'Error', errorWhere: 'profile' }).includes('오류 위치: profile'))
})

test('parseReviewText(가짜 문자열): 구매 옵션에 사이즈가 없으면 평소 사이즈를 구매 사이즈로 읽지 않는다', () => {
  assert.equal(parseReviewText('키 170cm 구매 옵션 : 블랙 평소 L 입는데 M 샀어요').size, 'M')
  assert.equal(parseReviewText('키 170cm 구매 옵션 : 블랙 평소 L 입는데 정사이즈예요').size, null)
  assert.equal(parseReviewText('키 170cm 구매 옵션 : 블랙 평소 L 입는데 M 샀어요', ['S', 'L']).size, null)
  assert.equal(parseReviewText('평소 사이즈는 L인데 이번엔 M으로 구매했어요 키 175cm').size, 'M')
  assert.equal(parseReviewText('보통 L 입는데 이건 잘 모르겠어요 키 175cm').size, null)
  assert.equal(parseReviewText('키 170cm 구매 옵션 : 블랙 / L 평소 M 입는데 크게 나와요').size, 'L')
  assert.equal(parseReviewText('구매 옵션 : 블랙 M, L 두 개 샀어요').size, null)
})

test('가짜 HTML: 리뷰의 구매 옵션에 사이즈가 없고 평소 사이즈만 있으면 옵션 이름 목록으로 교차 확인한다', () => {
  const cards = [0, 1, 2].map((i) => `<div class="c"><span>25.01.0${i + 1}</span><span>구매 옵션 : 블랙 평소 L 입는데 ${i === 0 ? 'M 샀어요' : '잘 모르겠어요'} 키 17${i}cm</span><span>배송 빨라요</span></div>`).join('')
  const p = parsePage(fakeDocument(wrapBody(`<ul class="option-list"><li>0 (S)</li><li>1 (M)</li><li>2 (L)</li></ul><div class="list">${cards}</div>`)), '')
  assert.equal(p.reviews.length, 3)
  assert.deepEqual(p.reviews.map((r) => r.size), ['M', null, null])
})

test('가짜 HTML: 사이즈표 격자 칸에 구매라는 낱말이 있어도 가짜 리뷰가 남지 않는다', () => {
  const rows = [['S', '구매', '150cm', '50kg'], ['M', '155cm', '55kg', '61'], ['L', '160cm', '60kg', '62'], ['XL', '165cm', '65kg', '63']]
    .map((r) => `<div class="r">${r.map((c) => `<span>${c}</span>`).join('')}</div>`)
    .join('')
  const p = parsePage(fakeDocument(wrapBody(`<div class="g"><div class="hd"><span>사이즈</span><span>가슴</span><span>키</span><span>몸무게</span></div>${rows}</div>${optionsHtml}`)), '')
  assert.equal(p.reviewMeta.cards, 0)
  assert.equal(p.reviews.length, 0)
})

test('가짜 HTML: 사이즈표 표 안의 review 클래스 요소와 서술형 없는 짧은 카드는 리뷰로 세지 않는다', () => {
  const table = `<table class="size-review"><tr><th>사이즈</th><th>가슴</th><th>기장</th></tr><tr class="review-row"><td>S 구매 90cm 50kg</td><td>50</td><td>60</td></tr><tr><td>M</td><td>52</td><td>62</td></tr><tr><td>L</td><td>54</td><td>64</td></tr></table>`
  const p = parsePage(fakeDocument(wrapBody(`${table}${optionsHtml}`)), '')
  assert.equal(p.reviews.length, 0)
  const bare = [0, 1, 2].map((i) => `<div class="r"><span>M</span><span>구매</span><span>17${i}cm</span></div>`).join('')
  const q = parsePage(fakeDocument(wrapBody(`<div class="g">${bare}</div>`)), '')
  assert.equal(q.reviews.length, 0)
})

test('가짜 HTML: 실측 낱말이 든 일반 리뷰 목록은 사이즈표로 오인해 버리지 않는다', () => {
  const cards = [0, 1, 2].map((i) => `<div class="c"><span>25.01.0${i + 1}</span><span>구매 옵션 : 블랙 / M</span><span>기장</span><span>키 17${i}cm 몸무게 6${i}kg 구매했는데 만족해요</span></div>`).join('')
  const p = parsePage(fakeDocument(wrapBody(`<div class="list">${cards}</div>`)), '')
  assert.equal(p.reviews.length, 3)
})

test('checkGlobals(가짜 코드 조각): 다른 함수의 지역 변수를 참조하는 직전 state 버그 모양을 잡는다', () => {
  const buggy = `(function(){
    async function run() { let state = 'start'; await waitForRender(); state = 'done' }
    function waitForRender() { return new Promise((resolve) => { setTimeout(resolve, 10); console.log(state) }) }
    run(); chrome.runtime.sendMessage({})
  })()`
  assert.deepEqual(findUndeclared(buggy), ['state'])
  assert.deepEqual(findUndeclared('(function(){ const a = 1; function f(){ return a + typoName } f(); document.title })()'), ['typoName'])
})

test('checkGlobals(가짜 코드 조각): 선언된 이름·브라우저 전역·화살표/클래스/구조분해는 오탐하지 않는다', () => {
  const ok = `(function(){ const {a, b: [c]} = {a: 1, b: [2]}; class K { m(x = a) { return x + c } } const f = (...r) => r.length
    try { new K().m() } catch (e) { console.log(e) } for (const k of [1]) { f(k) } label: for (;;) { break label }
    document.body; window.x = location.href; chrome.storage.local; setTimeout(f, 1); new MutationObserver(f) })()`
  assert.deepEqual(findUndeclared(ok), [])
})

await atest('checkGlobals: 임시 폴더에 빌드한 content.js·popup.js에 선언되지 않은 식별자가 없다', async () => {
  const root = resolvePath(import.meta.dirname, '..')
  const outDir = mkdtempSync(join(tmpdir(), 'fitcheck-globals-'))
  try {
    for (const name of ['content', 'popup']) {
      await viteBuild({
        configFile: false, root, logLevel: 'silent', publicDir: false,
        build: { outDir, emptyOutDir: false, minify: false, target: 'es2020', lib: { entry: resolvePath(root, `extension/${name}.js`), formats: ['iife'], name: `fitcheck_${name}`, fileName: () => `${name}.js` } },
      })
      assert.deepEqual(findUndeclared(readFileSync(join(outDir, `${name}.js`), 'utf8')), [], name)
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

console.log(`\n${passed}개 통과`)
