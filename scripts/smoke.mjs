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
import { parseReviewText, analyzeSizeCharts } from '../src/lib/productCore.js'
import { parseProductHtml } from '../server/productParser.js'
import { readOptionLabels, parsePage, isProductPage, splitSentences, extractCardView, parseGender } from '../src/lib/pageParser.js'
import { analyzePage, manualChartRows } from '../src/lib/extAnalyze.js'
import { collectDiagnostics, diagnosticLines, formatReport, REPORT_MAX } from '../src/lib/diagnose.js'
import { buildExportEnvelope, parseImportText, sanitizeItem, addImportedItem, LIMITS as IMPORT_LIMITS } from '../src/lib/wardrobeImport.js'
import {
  SYNC_QUEUE_KEY, WEB_APP_ORIGINS, BRIDGE_MATCHES, QUEUE_MAX, QUEUE_TTL_MS, isAllowedPage, postTargetOrigin, isTrustedMessage, enqueue, pruneQueue, removeAcked,
  makeDeliverMessage, makeAckMessage, makeReadyMessage, parseDeliverMessage, parseAckMessage, isReadyMessage, applyDelivery, newQueueId, syncNotice,
} from '../src/lib/wardrobeSync.js'
import { connectExtensionSync } from '../src/lib/syncClient.js'
import { compareSizes, MEASURE_ONLY_LABEL } from '../src/lib/sizeCompare.js'
import { summarizeSizeChart, NO_CHART_MESSAGE } from '../src/lib/sizeSummary.js'
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
import { bodySimilarity, splitReviews, matchReviews, BODY_SIM } from '../src/lib/fitEngine.js'
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
  const { view, ...domChart } = dom.sizeChart // view는 화면 표시용이라 서버 결과에는 없어요
  assert.ok(view && Array.isArray(view.rows))
  assert.deepEqual(domChart, server.sizeChart)
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

test('가짜 HTML: li/button의 "리뷰 250" "좋아요 300"은 mm 옵션으로 읽지 않고, select의 mm 옵션은 읽는다', () => {
  const noise = fakeDocument(wrapBody(`<ul><li>리뷰 250</li><li>좋아요 300</li></ul><button>찜 280</button>`))
  assert.deepEqual(readOptionLabels(noise), [])
  const shoe = fakeDocument(wrapBody(`<select><option>화이트 / 250</option><option>화이트 / 260</option></select><ul><li>블랙 / 270</li></ul>`))
  assert.deepEqual(readOptionLabels(shoe), ['250', '260', '270'])
})

test('가짜 HTML: "N (X)" 옵션과 mm 숫자가 섞이면 더 많은 한 종류만 돌려준다', () => {
  const doc = fakeDocument(wrapBody(`<select><option>블랙 / 0 (S)</option><option>블랙 / 1 (M)</option><option>블랙 / 2 (L)</option><option>블랙 / 250</option><option>블랙 / 260</option></select>`))
  assert.deepEqual(readOptionLabels(doc), ['0 (S)', '1 (M)', '2 (L)'])
})

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
  // 값 칸의 원문 '67'은 있어도 되지만 사이즈 이름·추천으로는 나오면 안 돼요
  assert.ok(!r.chartView.rows.some((row) => row.label === '67' || row.shown === '67'))
  assert.ok(r.recommendedSize !== '67' && r.recommendedLabel !== '67')
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
  assert.equal(EXT_MANIFEST.background, undefined, 'service worker 없음')
})

test('확장 manifest 검사기: 나쁜 manifest를 잡아낸다', () => {
  const bad = { ...EXT_MANIFEST, manifest_version: 2, host_permissions: ['<all_urls>'], content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }], content_security_policy: { extension_pages: "script-src 'self' https://evil.example/x.js" } }
  const errs = checkManifest(bad)
  assert.ok(errs.length >= 4, errs.join('|'))
})

test('확장 소스에 네트워크 호출이 없다', () => {
  for (const f of ['content.js', 'bridge.js', 'popup.js']) {
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

test('content.js CSS(소스 분석, 가짜 DOM 아님): 탭 규칙이 중복되지 않고 선택된 탭의 글자·배경 대비가 4.5:1 이상이다', () => {
  const src = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8')
  const rules = []
  for (const m of src.matchAll(/^(\.[a-z][\w.:-]*)\{([^}]*)\}$/gm)) rules.push({ sel: m[1], decl: m[2] })
  const count = (sel) => rules.filter((r) => r.sel === sel).length
  for (const sel of ['.tabs', '.tab', '.tab.on', '.rtabs', '.rtab', '.rtab.on']) assert.ok(count(sel) <= 1, `${sel} 중복 정의`)
  const hex = (c) => { const h = c.replace('#', ''); const f = h.length === 3 ? [...h].map((x) => x + x).join('') : h; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255) }
  const lum = (c) => { const [r, g, b] = hex(c).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
  const prop = (decl, name) => decl.match(new RegExp(`(?:^|;)${name}:(#[0-9a-fA-F]{3,6}|none)`))?.[1]
  // 선택된 탭 = 기본 규칙 + .on 규칙(.on이 특이도가 높아 우선). background 미지정/none은 흰 카드 위라고 봐요.
  for (const base of ['.tab', '.rtab']) {
    const b = rules.filter((r) => r.sel === base).map((r) => r.decl).join(';')
    const on = rules.filter((r) => r.sel === `${base}.on`).map((r) => r.decl).join(';')
    const color = prop(on, 'color') || prop(b, 'color')
    const bgRaw = prop(on, 'background') || prop(b, 'background')
    const bg = !bgRaw || bgRaw === 'none' ? '#ffffff' : bgRaw
    assert.ok(color, `${base}.on 글자색`)
    assert.ok(ratio(color, bg) >= 4.5, `${base}.on 대비 ${color} on ${bg}`)
  }
  assert.ok(src.includes(`'rtab on' : 'rtab'`) && src.includes(`el('button', 'rtab'`) && src.includes(`el('div', 'rtabs')`), '리뷰 탭은 rtab 클래스를 써요')
  assert.ok(src.includes(`'tab on' : 'tab'`), '사이즈 비교 알약 탭은 tab 클래스를 유지해요')
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
async function runContentInFakeDom(pageHtml = null, extra = {}) {
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
        set innerHTML(v) { throw new Error('innerHTML 사용 금지') }, set outerHTML(v) { throw new Error('outerHTML 사용 금지') }, insertAdjacentHTML() { throw new Error('insertAdjacentHTML 사용 금지') },
        _text: '', set textContent(v) { this._text = String(v); texts.push(this._text) }, get textContent() { return this._text },
        append(...n) { this.children.push(...n) }, appendChild(n) { this.children.push(n); return n }, replaceChildren(...n) { this.children = [...n] },
        setAttribute() {}, getAttribute() { return null }, addEventListener(type, fn) { (this._l ||= {})[type] = fn }, click() { this._l?.click?.() },
        classList: {
          contains: (c) => e.className.split(' ').includes(c),
          toggle: (c, on) => { const set = new Set(e.className.split(' ').filter(Boolean)); (on ?? !set.has(c)) ? set.add(c) : set.delete(c); e.className = [...set].join(' ') },
        },
        attachShadow() { return makeEl('shadow') }, remove() {}, select() {}, querySelectorAll() { return [] }, querySelector() { return null }, closest() { return null },
      }
      return e
    }
    const created = []
    const storageCalls = []
    const pageDoc = pageHtml ? fakeDocument(pageHtml) : null
    const doc = {
      readyState: 'complete', body: makeEl('body'), documentElement: makeEl('html'),
      createElement(tag) { const e = makeEl(tag); created.push(e); return e },
      querySelectorAll(sel) { return pageDoc ? pageDoc.querySelectorAll(sel) : [] }, querySelector(sel) { return pageDoc ? pageDoc.querySelector(sel) : null }, execCommand() { return false },
    }
    const win = { scrollX: 0, scrollY: 0, scrollTo() {} }
    const profile = buildProfile({ gender: 'male', height: '175', weight: '70', preferredFit: 'regular', measurements: {} }).profile
    const sandbox = {
      URL, document: doc, window: win, location: { href: 'https://shop.example/products/1' }, navigator: {},
      MutationObserver: class { observe() {} disconnect() {} },
      CSSStyleSheet: class { replaceSync() {} },
      setTimeout: (f) => setTimeout(f, 0), clearTimeout,
      ...extra,
      chrome: {
        runtime: { getManifest: () => ({ version: '0.0.0' }), onMessage: { addListener: (f) => { listeners.msg = f } } },
        storage: { local: { get: (k, cb) => cb({ fitcheckProfile: profile }), set: (...a) => { storageCalls.push(['set', a]); a.find((x) => typeof x === 'function')?.() }, remove: (...a) => storageCalls.push(['remove', a]), clear: (...a) => storageCalls.push(['clear', a]) } },
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
    return { texts, created, storageCalls, sandbox }
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

await atest('content.js(가짜 DOM, vm): 분석 실행 경로에서 ReferenceError 없이 끝난다', async () => {
  const { texts } = await runContentInFakeDom()
  assert.ok(!texts.some((t) => t.includes('분석 중 문제가 생겼어요')), '오류 카드가 나오면 안 돼요')
  assert.ok(texts.some((t) => t.includes('내 사이즈 찾기')), '실행이 끝나 버튼이 돌아와야 해요')
})

// ---- 리뷰 원문·사이즈표 원본 표시 (전부 직접 만든 가짜 HTML과 가짜 DOM이에요. 실제 무신사·크롬에서 확인한 것이 아니에요) ----
const LONG_REVIEW = '키 175 몸무게 70 1 (M) 사이즈로 샀어요 정사이즈예요 ' + '소재가 부드럽고 어깨 라인이 깔끔하게 떨어져서 마음에 들어요. '.repeat(4)
const VIEW_REVIEWS = [
  LONG_REVIEW,
  '키 174 몸무게 69 1 (M) 사이즈 구매 잘 맞아요',
  '키 150 몸무게 45 0 (S) 사이즈 구매 커요',
  'ZQOTHER 체형은 안 적었지만 M 사이즈 구매 정사이즈로 잘 맞아요',
  '&lt;img src=x onerror=alert(1)&gt; 키 175 몸무게 70 M 사이즈 구매 정사이즈',
]
const VIEW_HTML = (chartHtml) =>
  wrapBody(`${optionsHtml}${chartHtml}${VIEW_REVIEWS.map((t) => `<div class="review-item">${t}</div>`).join('')}`)

test('가짜 HTML: 분석 결과에 리뷰 원문(읽은 키·몸무게·사이즈·핏)과 사이즈표 원본이 들어 있다', () => {
  const r = analyzePage(fakeDocument(VIEW_HTML(chartTable(OPTION_LIST_LABELS()))), '', fakeProfile)
  assert.equal(r.status, 'ok')
  const rv = r.reviewViews
  assert.ok(rv.matched.length >= 2 && rv.matchedTotal === rv.matched.length)
  assert.ok(rv.matched.every((x) => x.similarity >= 55))
  const first = rv.matched.find((x) => x.text.startsWith('키 175 몸무게 70 1 (M)'))
  assert.equal(first.text, LONG_REVIEW.replace(/\s+/g, ' ').trim()) // 페이지에서 읽은 글 그대로
  assert.deepEqual([first.height, first.weight, first.size, first.fit, first.fitLabel], [175, 70, '1 (M)', 'true', '잘 맞아요'])
  const other = rv.others.find((x) => x.text.startsWith('ZQOTHER'))
  assert.deepEqual([other.height, other.weight], [null, null]) // 못 읽은 항목은 null -> 화면에서 '못 읽음'
  assert.ok(other.size === 'M' || other.size === '1 (M)')
  const v = r.chartView
  assert.deepEqual(v.headers, ['총장', '어깨', '가슴', '소매'])
  assert.equal(v.rows.length, 5)
  assert.equal(v.flipped, false)
  assert.ok(v.rows.some((row) => row.label === v.recommended), '추천 사이즈 행이 표 안에 있어야 해요')
  const chest = v.rows[0].cells[2] // 가슴 52 -> 단면으로 보고 둘레 104로 환산
  assert.deepEqual([chest.raw, chest.value, chest.converted], ['52', 104, true])
  const len = v.rows[0].cells[0]
  assert.deepEqual([len.raw, len.converted], ['67', false])
})

test('가짜 HTML: 뒤집어 읽은 사이즈표는 chartView.flipped와 원문 머리글을 유지한다', () => {
  const r = analyzePage(fakeDocument(VIEW_HTML(flippedTable([0, 1, 2, 3, 4]))), '', fakeProfile)
  assert.equal(r.chartView.flipped, true)
  assert.deepEqual(r.chartView.headers, ['총장', '어깨너비', '가슴단면', '소매길이'])
  assert.equal(r.chartView.rows[0].shown, '0 (S)')
  assert.equal(r.chartView.rows[0].cells[2].converted, true)
})

test('가짜 HTML: 사이즈표를 못 읽으면 chartView는 null이고 리뷰 원문은 그대로 있다', () => {
  const r = analyzePage(fakeDocument(wrapBody(NOCHART_HTML)), '', fakeProfile)
  assert.equal(r.status, 'ok')
  assert.equal(r.chartView, null)
  assert.ok(r.reviewViews.matched.length + r.reviewViews.others.length >= 3)
})

test('진단 리포트에는 리뷰 원문이 들어가지 않는다 (카드 표시와 별개)', () => {
  const doc = fakeDocument(VIEW_HTML(chartTable(OPTION_LIST_LABELS())))
  const rep = formatReport(analyzePage(doc, 'https://shop.example/p/1', fakeProfile).diagnostics)
  for (const piece of ['ZQOTHER', '소재가 부드럽고', 'onerror']) assert.ok(!rep.includes(piece), piece)
})

test('content.js 소스: innerHTML·outerHTML·insertAdjacentHTML·document.write를 쓰지 않는다', () => {
  const src = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8')
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser/.test(src))
})

await atest('content.js(가짜 DOM, vm): 리뷰 원문·사이즈표 구역이 오류 없이 그려지고 페이지 글은 텍스트로만 들어간다', async () => {
  const { texts, created } = await runContentInFakeDom(VIEW_HTML(chartTable(OPTION_LIST_LABELS())))
  assert.ok(!texts.some((t) => t.includes('분석 중 문제가 생겼어요')), '오류 카드가 나오면 안 돼요')
  const has = (s) => texts.some((t) => t.includes(s))
  assert.ok(has('리뷰 원문 (비슷한 체형'), '리뷰 구역 제목')
  assert.ok(has('읽은 사이즈표 (페이지 그대로)'), '사이즈표 구역 제목')
  assert.ok(has('(추천)'), '추천 행 표시')
  assert.ok(texts.some((t) => /^→ \d/.test(t)), '환산값 표시')
  assert.ok(has('키 175cm') && has('몸무게 70kg') && has('구매 사이즈 1 (M)') && has('핏 평가 잘 맞아요'))
  // 긴 리뷰는 미리보기 + 더보기
  const preview = LONG_REVIEW.replace(/\s+/g, ' ').trim().slice(0, 120)
  assert.ok(texts.includes(`${preview}…`), '긴 리뷰 미리보기')
  const more = created.find((e) => e.className === 'lnk')
  assert.ok(more, '더보기 버튼')
  more._l.click()
  assert.ok(texts.includes(LONG_REVIEW.replace(/\s+/g, ' ').trim()), '더보기를 누르면 전체 글')
  // 나머지 리뷰 구역은 처음엔 비어 있다가 열면 그려진다
  assert.ok(!has('ZQOTHER'))
  for (const d of created.filter((e) => e.tagName === 'DETAILS')) {
    d.open = true
    d._l?.toggle?.()
  }
  assert.ok(!has('ZQOTHER'), '전체 리뷰 탭은 열기 전에는 그리지 않아요')
  created.find((e) => e.className.split(' ').includes('rtab') && e.textContent === '전체 리뷰')._l.click()
  assert.ok(has('ZQOTHER'), '전체 리뷰 탭')
  assert.ok(texts.some((t) => t.includes('키 못 읽음') && t.length < 20), '못 읽은 항목 표시')
  // 페이지 글에 든 <img ...> 는 요소가 아니라 글자로만 들어간다
  assert.ok(has('<img src=x onerror=alert(1)>'))
  assert.ok(!created.some((e) => e.tagName === 'IMG' || e.tagName === 'SCRIPT'))
})

await atest('content.js(가짜 DOM, vm): 카드 문구가 줄었고 오래된 안내가 없으며 최소화·닫기가 동작한다', async () => {
  const { texts, created } = await runContentInFakeDom(VIEW_HTML(chartTable(OPTION_LIST_LABELS())))
  const all = texts.join('\n')
  for (const stale of ['자동으로 스크롤하지 않아요', '이 페이지에 불러와진 리뷰만 읽어요', '최종 선택은', '정확도를 측정한 값이 아니에요. 참고용', '이 브라우저 밖으로 나가지 않아요'])
    assert.ok(!all.includes(stale), stale)
  // 필수 고지는 한 줄에 합쳐서 한 번만
  assert.equal(texts.filter((t) => t.includes('확신도는 정확도를 측정한 값이 아니에요')).length, 1)
  assert.equal(texts.filter((t) => t.includes('참고용이에요')).length, 1)
  // 기본으로 보이는 영역(fold 바깥)의 문장 수는 적다: card 직계 자식은 헤더, 분류줄, 사이즈, 근거 한 줄, 고지 한 줄, fold뿐
  const card = created.find((e) => e.className.split(' ').includes('card'))
  assert.deepEqual(card.children.map((c) => c.className.split(' ')[0]), ['row', 'row', 'size', 'sum', 'tiny', 'fold'])
  // 최소화하면 fold가 숨겨지는 클래스가 붙고, 다시 누르면 풀린다
  const mini = created.find((e) => e.tagName === 'BUTTON' && e.textContent === '−')
  mini._l.click()
  assert.ok(card.className.split(' ').includes('min'))
  const plus = created.find((e) => e.tagName === 'BUTTON' && e.textContent === '+')
  plus._l.click()
  assert.ok(!card.className.split(' ').includes('min'))
  const close = created.find((e) => e.tagName === 'BUTTON' && e.textContent === '×')
  assert.ok(close)
})

test('content.js 소스: 카드 최대 높이·내부 스크롤·최소화 스타일이 있다', () => {
  const src = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8')
  assert.ok(/\.card\{[^}]*max-height:min\(80vh,560px\)[^}]*overflow-y:auto/.test(src))
  assert.ok(src.includes('.card.min .fold{display:none}'))
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

// ---- 사이즈표를 못 읽던 모양들 (전부 직접 만든 가짜 HTML이에요. 실제 무신사 DOM이 아니고, 실제 원인은 확정하지 못했어요) ----
{
  const MROWS = [['총장', 67, 69, 71, 73, 75], ['어깨너비', 44, 46, 48, 50, 52], ['가슴단면', 52, 54, 56, 58, 60], ['소매길이', 60, 61, 62, 63, 64]]
  const tdRow = (r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`
  const thRow = (r) => `<tr>${r.map((c) => `<th>${c}</th>`).join('')}</tr>`
  const readChart = (html, withOptions = true) => parsePage(fakeDocument(wrapBody(`<h1>코튼 재킷 아우터</h1>${withOptions ? optionsHtml : ''}${html}`)), '')
  const CASES = {
    '머리글 첫 칸이 빈칸': `<table>${thRow(['', 0, 1, 2, 3, 4])}${MROWS.map(tdRow).join('')}</table>`,
    '머리글 첫 칸이 cm': `<table>${thRow(['cm', 0, 1, 2, 3, 4])}${MROWS.map(tdRow).join('')}</table>`,
    '사이즈 이름이 0(S) 붙여쓰기': `<table>${thRow(['사이즈', '0(S)', '1(M)', '2(L)', '3(XL)', '4(2XL)'])}${MROWS.map(tdRow).join('')}</table>`,
    '항목명에 (cm) 단위': `<table>${thRow(['사이즈', 0, 1, 2, 3, 4])}${MROWS.map((r) => tdRow([`${r[0]}(cm)`, ...r.slice(1)])).join('')}</table>`,
    '값에 - 와 빈칸': `<table>${thRow(['사이즈', 0, 1, 2, 3, 4])}${MROWS.map((r, i) => tdRow(i === 3 ? [r[0], '-', '-', 62, '', 64] : r)).join('')}</table>`,
    '사이즈 이름 줄 위에 단위 안내 줄': `<table><tr><th colspan="6">단위: cm</th></tr>${thRow(['사이즈', 0, 1, 2, 3, 4])}${MROWS.map(tdRow).join('')}</table>`,
    '실측 줄 끝에 단위 칸': `<table>${thRow(['사이즈', 0, 1, 2, 3, 4, '단위'])}${MROWS.map((r) => tdRow([...r, 'cm'])).join('')}</table>`,
    '사이즈 이름 줄만 있는 표 + 실측 줄만 있는 표(table 2개)': `<table>${thRow(['사이즈', 0, 1, 2, 3, 4])}</table><table>${MROWS.map(tdRow).join('')}</table>`,
    '실측 줄만 있는 표(이름 줄 없음, 구매 옵션 5개와 칸 수 일치)': `<table>${MROWS.map(tdRow).join('')}</table>`,
    '머리글 제목 칸이 빠진 일반 표': `<table><tr><th>총장</th><th>어깨</th><th>가슴</th></tr>${[0, 1, 2].map((i) => tdRow([`${i} (${'SML'[i]})`, 67 + i, 44 + i, 52 + i])).join('')}</table>`,
  }
  for (const [name, html] of Object.entries(CASES)) {
    test(`가짜 HTML(사이즈표 읽기): ${name}`, () => {
      const p = readChart(html)
      assert.ok(p.sizeChart, '사이즈표를 읽어야 해요')
      assert.ok(p.sizeChart.rows.length >= 3)
      assert.ok(!p.sizeChart.rows.some((r) => r[0] === '67'))
      if (p.sizeChart.rows.length === 5) assert.deepEqual(p.sizeChart.rows.map((r) => r[0]), ['0(S)', '1(M)', '2(L)', '3(XL)', '4(2XL)'])
    })
  }

  test('가짜 HTML(사이즈표 읽기): 이름 줄이 다른 표나 구매 옵션에서 왔다면 어디서 가져왔는지 남긴다', () => {
    assert.equal(readChart(CASES['사이즈 이름 줄만 있는 표 + 실측 줄만 있는 표(table 2개)']).sizeChartMeta.namesFrom, 'other-table')
    assert.equal(readChart(CASES['실측 줄만 있는 표(이름 줄 없음, 구매 옵션 5개와 칸 수 일치)']).sizeChartMeta.namesFrom, 'options')
    assert.equal(readChart(CASES['머리글 첫 칸이 cm']).sizeChartMeta.namesFrom, 'table')
    // 옵션이 없고 이름 줄도 없으면 이름을 지어내지 않는다
    assert.equal(readChart(CASES['실측 줄만 있는 표(이름 줄 없음, 구매 옵션 5개와 칸 수 일치)'], false).sizeChart, null)
    // 옵션 개수와 칸 수가 다르면 옵션 순서로 이름 붙이지 않는다
    const four = `<table>${MROWS.map((r) => tdRow(r.slice(0, 5))).join('')}</table>`
    assert.equal(readChart(four).sizeChart, null)
  })

  test('가짜 HTML(사이즈표 읽기): M(95) 같은 글자+치수 이름도 사이즈 이름으로 읽고 구매 옵션과 잇는다', () => {
    const t = `<table>${thRow(['사이즈', '총장', '어깨'])}${['S', 'M', 'L'].map((s, i) => tdRow([`${s}(${95 + i * 5})`, 67 + i, 44 + i])).join('')}</table>`
    const p = readChart(t)
    assert.deepEqual(p.sizeChart.rows.map((r) => r[0]), ['S(95)', 'M(100)', 'L(105)'])
    assert.equal(p.sizeChartMeta.overlap, 3)
  })

  test('가짜 HTML(진단): 리포트에 사이즈표 후보별 헤더 모양(L/N/T)과 버린 사유가 한 줄씩 있고 페이지 글은 없다', () => {
    const secret = 'ZZ비밀항목명'
    // 첫 열이 실측 항목인데 이름 줄도 다른 표도 없고, 구매 옵션도 없는 경우 -> 못 읽은 사유가 보여야 한다
    const bad = `<table>${tdRow(['총장', 67, 69, 71])}${tdRow([`어깨${secret}`, 44, 46, 48])}</table>`
    const doc = fakeDocument(wrapBody(bad))
    const rep = formatReport(collectDiagnostics(doc, 'https://shop.example/p/1'))
    const line = rep.split('\n').find((l) => l.startsWith('후보 1번'))
    assert.ok(line, rep)
    assert.match(line, /\(table, 2줄 x 4칸\) 머리글 \[T N N N\] 첫 열 \[T T\] -> 첫 열이 실측 항목인데 사이즈 이름 줄을 못 찾음/)
    assert.ok(!rep.includes(secret))
    // 읽은 표는 '선택함'과 이름 출처가 나온다
    const ok = formatReport(collectDiagnostics(fakeDocument(wrapBody(`${optionsHtml}${CASES['사이즈 이름 줄만 있는 표 + 실측 줄만 있는 표(table 2개)']}`)), ''))
    assert.match(ok, /-> 선택함/)
    assert.match(ok, /사이즈 이름 출처: 다른 표/)
    assert.ok(ok.length <= REPORT_MAX)
  })
}

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

// ---- 리뷰 카드 항목만 읽기 (직접 만든 가짜 HTML이에요. 실제 무신사·크롬에서 확인한 것이 아니에요) ----
const RB_BODY = '일단 엄청 가볍고 색상도 예쁜데 따뜻.... 경량과 헤비 아우터 중간정도 되는 거 같음. 매우 만족.'
const RB_PRODUCT = '[10주년기획] © 모두의 Comfortemp® 미드웨이트 패딩_4 COLOR'
const RB_PHOTO = 'https://img.example.com/review1.jpg'
const rbCard = (i, extraImgs = '') =>
  `<li class="sc-x${i}"><div class="u1"><img src="https://img.example.com/avatar.png" alt="프로필" width="32"><span class="n1">지루한플럼반바지</span></div><span class="d1">26.10.08</span><span class="s1">5</span>` +
  `<div class="pr"><img src="https://img.example.com/thumb.jpg" alt="" width="80"><dl><span class="l">상품명</span><span class="v">${RB_PRODUCT}</span></dl></div>` +
  `<div class="o1"><span class="l">구매옵션</span><span class="v">그레이 · 2 (L)</span></div>` +
  `<div class="b1"><span class="l">체형정보</span><span class="v">남성 · 170cm · 70kg</span></div>` +
  `<p class="t1">${RB_BODY}</p><p class="t2">${RB_BODY} ...</p><button class="m">더보기</button>` +
  `<img src="${RB_PHOTO}" alt="" width="300">${extraImgs}<button class="h">도움돼요 11</button><button class="c">댓글</button></li>`
const RB_HTML = (cards) => wrapBody(`<h1>패딩 아우터</h1><ul class="lst9">${cards}</ul>`)
const RB_FULL = RB_HTML([rbCard(0), rbCard(1, '<img src="javascript:alert(1)"><img src="data:image/png;base64,AAAA">'), rbCard(2)].map((c, i) => c.replace('26.10.08', `26.10.0${i + 1}`).replace('지루한플럼반바지', i === 0 ? '지루한플럼반바지' : `닉${'abc'[i]}`)).join(''))

test('가짜 HTML: 리뷰 카드에서 닉네임·상품명·사이즈·본문(한 번만)·사진만 읽는다', () => {
  const p = parsePage(fakeDocument(RB_FULL), '')
  assert.ok(p.reviews.length >= 3)
  const r = p.reviews[0]
  assert.equal(r.view.body, RB_BODY)
  assert.equal(r.view.nick, '지루한플럼반바지')
  assert.equal(r.view.productName, RB_PRODUCT)
  assert.deepEqual([r.height, r.weight, r.size], [170, 70, 'L'])
  assert.deepEqual(r.view.photos, [RB_PHOTO])
  for (const bad of ['더보기', '도움돼요', '댓글', '상품명', '26.10', '지루한', '구매옵션']) assert.ok(!r.view.body.includes(bad), bad)
  const v = extractCardView(fakeDocument(RB_FULL).querySelectorAll('li')[0])
  assert.equal(v.option, '그레이 · 2 (L)')
  assert.equal(v.sizePart, '2 (L)')
  assert.equal(v.bodyInfo, '남성 · 170cm · 70kg')
  assert.equal(v.deduped, true)
  assert.deepEqual(p.reviews[1].view.photos, [RB_PHOTO]) // javascript:, data: 제외
  assert.ok(p.reviews.every((x) => x.view.productName === RB_PRODUCT))
})

test('splitSentences: 문장 끝 기호에서 나누고 소수점·ver.2는 나누지 않는다', () => {
  const s = splitSentences(RB_BODY)
  assert.deepEqual(s, ['일단 엄청 가볍고 색상도 예쁜데 따뜻....', '경량과 헤비 아우터 중간정도 되는 거 같음.', '매우 만족.'])
  assert.deepEqual(splitSentences('길이 2.5 늘었고 ver.2 입니다! 좋아요?? 네\n다음 줄'), ['길이 2.5 늘었고 ver.2 입니다!', '좋아요??', '네', '다음 줄'])
  assert.deepEqual(splitSentences(''), [])
})

test('가짜 HTML: <br>이 든 본문은 줄바꿈으로 읽고 문장을 나눈다', () => {
  const card = (i) => `<li class="k${i}"><span>닉${i}네임</span><span>상품명</span><span>겨울 패딩 상품</span><span>구매옵션</span><span>블랙 · M</span><span>체형정보</span><span>남성 · 175cm · 72kg</span><p>첫째 줄은 만족해요<br>둘째 줄은 따뜻해요</p></li>`
  const p = parsePage(fakeDocument(RB_HTML([0, 1, 2].map(card).join(''))), '')
  assert.equal(p.reviews[0].view.body, '첫째 줄은 만족해요\n둘째 줄은 따뜻해요')
  assert.deepEqual(splitSentences(p.reviews[0].view.body), ['첫째 줄은 만족해요', '둘째 줄은 따뜻해요'])
})

test('가짜 HTML: 라벨이 없는 카드는 전체 글에서 화면 글자만 빼고 본문으로 쓴다', () => {
  const card = (i) => `<li class="z${i}"><span>26.10.0${i + 1}</span><p>키 17${i} 몸무게 6${i} M 사이즈 구매 정사이즈로 잘 맞아요 편해요</p><button>더보기</button><button>도움돼요 3</button></li>`
  const p = parsePage(fakeDocument(RB_HTML([0, 1, 2].map(card).join(''))), '')
  assert.ok(p.reviews.length >= 3)
  assert.equal(p.reviews[0].view.productName, '')
  assert.ok(p.reviews[0].view.body.includes('정사이즈로 잘 맞아요') && !/더보기|도움돼요|26\.10/.test(p.reviews[0].view.body))
  const rep = formatReport(collectDiagnostics(fakeDocument(RB_HTML([0, 1, 2].map(card).join(''))), ''))
  assert.ok(/전체 글 대체 3건/.test(rep))
})

test('가짜 HTML: 진단 리포트와 기여 기록에는 닉네임·상품명·본문·사진 주소가 없고 추출 건수 줄만 있다', () => {
  const doc = fakeDocument(RB_FULL)
  const rep = formatReport(collectDiagnostics(doc, 'https://shop.example/p/1'))
  for (const piece of ['지루한', 'Comfortemp', '가볍고', 'img.example.com', '170cm', RB_PHOTO]) assert.ok(!rep.includes(piece), piece)
  assert.ok(/본문 추출: 라벨 구조 3건, 전체 글 대체 0건, 접힘\/펼침 중복 제거 3건 \| 닉네임 읽음 3건, 상품명 읽음 3건, 사진 있는 리뷰 3건/.test(rep))
  const r = analyzePage(doc, 'https://www.musinsa.com/products/1', fakeProfile)
  assert.ok(!JSON.stringify(r.diagnostics).includes('지루한'))
  const fb = { ...FB, url: 'https://www.musinsa.com/products/1' }
  const rv = parsePage(doc, '').reviews[0]
  const rec = JSON.stringify(toContribution({ ...fb, reviewNick: rv.view.nick, productName: rv.view.productName, body: rv.view.body, photo: rv.view.photos[0] }, PF, true))
  for (const piece of [rv.view.nick, rv.view.productName, rv.view.body, 'img.example.com', '지루한']) assert.ok(!rec.includes(piece), piece)
})

await atest('content.js(가짜 DOM, vm): 문장별 블록·사진 썸네일·닉네임/상품명이 그려지고 저장·전송은 없다', async () => {
  const { texts, created, storageCalls } = await runContentInFakeDom(RB_FULL)
  assert.ok(!texts.some((t) => t.includes('분석 중 문제가 생겼어요')), '오류 카드가 나오면 안 돼요')
  assert.ok(texts.includes('지루한플럼반바지'))
  assert.ok(texts.includes(`상품명 ${RB_PRODUCT}`))
  assert.ok(created.filter((e) => e.className === 'sent').length >= 3, '문장마다 별도 블록')
  assert.ok(!texts.some((t) => t.includes('도움돼요') || t.includes('더보기도움')))
  const imgs = created.filter((e) => e.tagName === 'IMG')
  assert.ok(imgs.length >= 1 && imgs.every((e) => e.src === RB_PHOTO && e.loading === 'lazy' && e.referrerPolicy === 'no-referrer'))
  assert.ok(!created.some((e) => /^(javascript|data):/i.test(e.src || '')))
  assert.ok(!created.some((e) => e.tagName === 'A'))
  assert.equal(storageCalls.length, 0, '리뷰 데이터를 저장하면 안 돼요')
})

await atest('content.js(가짜 DOM, vm): 본문이 3문장보다 길면 더보기로 전체 문장을 펼친다', async () => {
  const long = RB_BODY.replace('매우 만족.', '매우 만족. 배송도 빨랐음.')
  const { created } = await runContentInFakeDom(RB_FULL.replaceAll(RB_BODY, long))
  const more = created.find((e) => e.className === 'lnk')
  assert.ok(more && more.textContent === '더보기')
  const before = created.filter((e) => e.className === 'sent').length
  more._l.click()
  assert.equal(more.textContent, '접기')
  assert.ok(created.filter((e) => e.className === 'sent').length > before)
})

// ---- 리뷰 카드 읽기 보완 (직접 만든 가짜 HTML, 실제 무신사가 아님) ----
const rbVariant = (edit) => {
  const cards = [0, 1, 2].map((i) => edit(rbCard(i).replace('26.10.08', `26.10.0${i + 1}`)))
  return fakeDocument(RB_HTML(cards.join('')))
}
const rbFirst = (doc) => extractCardView(doc.querySelectorAll('li')[0])

test('가짜 HTML: <b> 같은 인라인 태그가 섞인 본문도 한 문장으로 읽는다', () => {
  const doc = rbVariant((c) => c.replace(`<p class="t1">${RB_BODY}</p><p class="t2">${RB_BODY} ...</p>`, '<p class="t1">가볍고 <b>정말</b> 따뜻해요. 만족<span>!</span></p>'))
  const v = rbFirst(doc)
  assert.equal(v.body, '가볍고 정말 따뜻해요. 만족!')
  assert.deepEqual(splitSentences(v.body), ['가볍고 정말 따뜻해요.', '만족!'])
  const p = parsePage(doc, '')
  assert.deepEqual([p.reviews[0].height, p.reviews[0].weight], [170, 70])
})

test('가짜 HTML: 문단이 여러 개인 본문은 모두 이어 붙이고 겹친 미리보기만 뺀다', () => {
  const two = (c) => c.replace(`<p class="t1">${RB_BODY}</p><p class="t2">${RB_BODY} ...</p>`, '<p class="t1">첫 문단입니다 좋아요.</p><p class="t2">둘째 문단은 조금 더 길게 적었어요 만족.</p><p class="t3">둘째 문단은 조금 더 길게 적었어요 만족. ...</p>')
  const v = rbFirst(rbVariant(two))
  assert.equal(v.body, '첫 문단입니다 좋아요.\n둘째 문단은 조금 더 길게 적었어요 만족.')
  assert.equal(rbFirst(fakeDocument(RB_FULL)).body, RB_BODY) // 기존 접힘 복사본 제거는 그대로
})

test('가짜 HTML: 지연 로딩 사진은 data-src를 쓰고 빈 그림 주소는 버린다', () => {
  const lazy = (c) => c.replace(`<img src="${RB_PHOTO}" alt="" width="300">`, `<img src="https://img.example.com/blank.gif" data-src="${RB_PHOTO}" alt="" width="300"><img src="https://img.example.com/spacer.gif" alt="" width="300">`)
  assert.deepEqual(rbFirst(rbVariant(lazy)).photos, [RB_PHOTO])
})

test('가짜 HTML: 닉네임 앞의 베스트·LV 배지는 닉네임이 아니다', () => {
  const badge = (c) => c.replace('<span class="n1">지루한플럼반바지</span>', '<span class="bd">베스트</span><span class="lv">LV.3</span><span class="n1">지루한플럼반바지</span>')
  assert.equal(rbFirst(rbVariant(badge)).nick, '지루한플럼반바지')
})

test('가짜 HTML: 본문이 없으면 빈 문장 목록을 주고 content.js는 빈 문단을 그리지 않는다', async () => {
  const empty = (c) => c.replace(`<p class="t1">${RB_BODY}</p><p class="t2">${RB_BODY} ...</p>`, '')
  const view = analyzePage(rbVariant(empty), 'https://shop.example/p/9', { height: 170, weight: 70 }, '').reviewViews
  for (const rv of [...(view?.matched || []), ...(view?.others || [])]) assert.deepEqual(rv.sentences, [])
  const { created } = await runContentInFakeDom(RB_FULL.replaceAll(RB_BODY, '').replaceAll(' ...', ''))
  assert.equal(created.filter((e) => e.className === 'sent' && !e.textContent).length, 0)
})

test('가짜 HTML: 문장이 40개를 넘으면 잘렸다는 표시를 주고, 카드를 감싼 <a> 안의 본문도 읽는다', () => {
  const longBody = Array.from({ length: 45 }, (_, i) => `문장 ${i + 1}번 좋아요.`).join(' ')
  const doc = rbVariant((c) => c.replace(`<p class="t1">${RB_BODY}</p><p class="t2">${RB_BODY} ...</p>`, `<p class="t1">${longBody}</p>`))
  const rv = analyzePage(doc, 'https://shop.example/p/9', { height: 170, weight: 70 }, '').reviewViews
  const one = [...rv.matched, ...rv.others][0]
  assert.equal(one.sentences.length, 40)
  assert.equal(one.sentencesCut, true)
  const wrapped = fakeDocument(`<html><body><a href="/r/1"><div class="card"><span>닉</span><span>상품명</span><span>${RB_PRODUCT}</span><span>구매옵션</span><span>그레이 · 2 (L)</span><p>따뜻하고 가벼워서 만족해요.</p></div></a></body></html>`)
  assert.equal(extractCardView(wrapped.querySelectorAll('div')[0]).body, '따뜻하고 가벼워서 만족해요.')
})

// ---- 옷장 가져오기·리뷰 탭 (전부 가짜 HTML과 가짜 데이터예요. 실제 무신사·크롬에서 확인한 것이 아니에요) ----
const fakeEnvelope = (patch = {}) => ({
  app: 'fitcheck', kind: 'wardrobe-item', v: 1,
  item: {
    product: { name: '가짜 니트', mall: 'shop.example', category: 'top', image: 'https://img.example.com/p.jpg', url: 'https://shop.example/p/1' },
    size: 'M', measures: { chest: 104, shoulder: 50 },
    verdicts: [{ part: 'chest', label: '가슴', verdict: '적당', key: 'regular', ease: 8 }],
    reviews: [{ nick: '가짜닉', text: '가짜 리뷰 본문', photos: ['https://img.example.com/r1.jpg'], height: 175, weight: 70, size: 'M', fitLabel: '잘 맞아요', similarity: 80 }],
    ...patch,
  },
})

test('가짜 데이터: 내보낸 봉투를 다시 가져오면 같은 내용이 된다 (왕복)', () => {
  const r = analyzePage(fakeDocument(VIEW_HTML(chartTable(OPTION_LIST_LABELS()))), 'https://shop.example/products/1', fakeProfile)
  const env = buildExportEnvelope(r, { now: 1000 })
  assert.deepEqual([env.app, env.kind, env.v], ['fitcheck', 'wardrobe-item', 1])
  const back = parseImportText(JSON.stringify(env), { now: 2000 })
  assert.equal(back.ok, true)
  assert.equal(back.item.source, 'extension')
  assert.equal(back.item.product.name, r.name)
  assert.equal(back.item.product.mall, 'shop.example')
  assert.equal(back.item.product.url, 'https://shop.example/products/1')
  assert.equal(back.item.size, r.recommendedLabel)
  assert.ok(back.item.verdicts.length > 0 && back.item.measures)
  assert.equal(back.item.reviews.length, Math.min(IMPORT_LIMITS.reviews, r.reviewViews.matched.length + r.reviewViews.others.length))
  assert.deepEqual(back.item.reviews.map((x) => x.text), env.item.reviews.map((x) => x.text))
  assert.equal(buildExportEnvelope({ status: 'no-data' }), null)
})

test('가짜 데이터: 가져오기 거부 (javascript:·data: 주소, 잘못된 형식, 큰 입력, 다른 앱·버전)', () => {
  const ok = parseImportText(JSON.stringify(fakeEnvelope()))
  assert.equal(ok.ok, true)
  const bad = (text) => assert.equal(parseImportText(text).ok, false, String(text).slice(0, 40))
  bad('')
  bad('   ')
  bad('이건 JSON이 아니에요')
  bad('[1,2]')
  bad('x'.repeat(IMPORT_LIMITS.text + 1))
  bad(JSON.stringify({ ...fakeEnvelope(), app: 'other' }))
  bad(JSON.stringify({ ...fakeEnvelope(), kind: 'profile' }))
  bad(JSON.stringify({ ...fakeEnvelope(), v: 2 }))
  bad(JSON.stringify({ ...fakeEnvelope(), item: null }))
  bad(JSON.stringify(fakeEnvelope({ product: { name: 'x', category: 'weird' } })))
  bad(JSON.stringify(fakeEnvelope({ product: { name: 123, category: 'top' } })))
  bad(JSON.stringify(fakeEnvelope({ measures: 'abc' })))
  bad(JSON.stringify(fakeEnvelope({ reviews: 'abc' })))
  bad(JSON.stringify(fakeEnvelope({ size: { a: 1 } })))
  // 나쁜 주소는 항목은 받되 그 주소만 버린다
  const evil = parseImportText(JSON.stringify(fakeEnvelope({
    product: { name: '가짜', category: 'top', image: 'javascript:alert(1)', url: 'data:text/html,hi' },
    reviews: [{ text: '본문', photos: ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///etc/passwd', 'ftp://x/y.jpg', 'https://ok.example/a.jpg', 'https://x.example/' + 'a'.repeat(600)] }],
  })))
  assert.equal(evil.ok, true)
  assert.equal(evil.item.product.image, null)
  assert.equal(evil.item.product.url, '')
  assert.deepEqual(evil.item.reviews[0].photos, ['https://ok.example/a.jpg'])
})

test('가짜 데이터: 가져오기 길이·개수·범위 제한과 모르는 키 버리기', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ nick: 'n'.repeat(50), text: `리뷰${i} ` + 'ㅇ'.repeat(900), photos: Array.from({ length: 9 }, (_, k) => `https://img.example.com/${i}-${k}.jpg`), height: 90 + i * 5, weight: 20 + i * 7, evil: '<script>' }))
  const res = parseImportText(JSON.stringify(fakeEnvelope({
    product: { name: '이'.repeat(500), mall: 'm'.repeat(100), category: 'top', url: 'https://shop.example/p/1', extra: 'x' },
    reviews: many, hacked: true, size: 'L'.repeat(100),
  })))
  assert.equal(res.ok, true)
  const it = res.item
  assert.equal(it.product.name.length, IMPORT_LIMITS.name)
  assert.equal(it.product.mall.length, IMPORT_LIMITS.mall)
  assert.equal(it.size.length, IMPORT_LIMITS.size)
  assert.ok(it.reviews.length <= IMPORT_LIMITS.reviews)
  assert.ok(it.reviews.every((r) => r.nick.length <= IMPORT_LIMITS.nick && r.text.length <= IMPORT_LIMITS.review && r.photos.length <= IMPORT_LIMITS.photosPerReview))
  assert.ok(it.reviews.reduce((n, r) => n + r.photos.length, 0) <= IMPORT_LIMITS.photosTotal)
  assert.ok(it.reviews.every((r) => (r.height == null || (r.height >= 100 && r.height <= 230)) && (r.weight == null || (r.weight >= 30 && r.weight <= 200))))
  assert.ok(!('hacked' in it) && !('extra' in it.product) && it.reviews.every((r) => !('evil' in r)))
  assert.equal(sanitizeItem(null), null)
  // 같은 상품·같은 사이즈는 새 항목으로 바뀐다
  const a = sanitizeItem(fakeEnvelope().item)
  const b = sanitizeItem(fakeEnvelope().item)
  assert.equal(addImportedItem([a], b).length, 1)
  assert.equal(addImportedItem([a], { ...b, size: 'L' }).length, 2)
})

test('가짜 데이터: 같은 옷을 다시 가져와도 기존 합성 이미지와 id를 이어받는다', () => {
  const old = { ...sanitizeItem(fakeEnvelope().item), id: 'w-old', image: 'data:image/png;base64,AAAA', imageKind: 'ai' }
  const fresh = sanitizeItem(fakeEnvelope().item)
  const out = addImportedItem([old], fresh)
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'w-old')
  assert.equal(out[0].image, old.image)
  assert.equal(out[0].imageKind, 'ai')
  assert.deepEqual(out[0].reviews, fresh.reviews)
})

test('가짜 데이터: 리뷰 사진은 https만, 중복은 한 번만 남기고 measures는 유효한 키부터 12개를 채운다', () => {
  const res = parseImportText(JSON.stringify(fakeEnvelope({
    reviews: [{ text: '본문', photos: ['http://img.example.com/a.jpg', 'https://img.example.com/b.jpg', 'https://img.example.com/b.jpg'] }],
  })))
  assert.deepEqual(res.item.reviews[0].photos, ['https://img.example.com/b.jpg'])
  const junk = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`bad_${i}`, 1]))
  const it = sanitizeItem({ ...fakeEnvelope().item, measures: { ...junk, chest: 50, length: 70 } })
  assert.equal(it.measures.chest, 50)
  assert.equal(it.measures.length, 70)
})

test('가짜 데이터: trimNote는 지워진 리뷰와 밀려난 옷을 문구로 알린다', async () => {
  const { trimNote } = await import('../src/lib/storage.js')
  assert.equal(trimNote({ trimmed: false }), '')
  assert.match(trimNote({ trimmed: true, reviewsCleared: 2, imagesCleared: 0, droppedItems: 0 }), /리뷰를 지웠어요/)
  assert.match(trimNote({ trimmed: true, reviewsCleared: 0, imagesCleared: 1, droppedItems: 3 }), /3개가 빠졌어요.*합성 이미지/)
})

test('가짜 데이터: saveWardrobe는 용량이 부족하면 이미지, 그다음 리뷰 순으로 오래된 항목부터 덜어낸다', async () => {
  const { saveWardrobe } = await import('../src/lib/storage.js')
  const prev = globalThis.localStorage
  const mk = (id) => ({ id, product: { name: id, category: 'top', url: `https://s.example/${id}` }, size: 'M', image: 'data:image/png;base64,AAAA', imageKind: 'ai', reviews: [{ text: '리뷰', photos: [] }] })
  try {
    const strip = (w, reviews) => ({ ...w, image: null, imageKind: null, reviews })
    const [a, b, c] = [mk('a'), mk('b'), mk('c')]
    // 이미지를 다 빼고 c의 리뷰까지 빼야 들어가는 용량
    const limit = JSON.stringify([strip(a, a.reviews), strip(b, b.reviews), strip(c, [])]).length
    globalThis.localStorage = { getItem: () => null, removeItem() {}, setItem: (k, v) => { if (v.length > limit) throw new Error('quota') } }
    const res = saveWardrobe([a, b, c])
    assert.equal(res.failed, undefined)
    assert.ok(res.list.every((w) => w.image === null), '이미지가 먼저 모두 빠져요')
    assert.deepEqual(res.list.map((w) => w.reviews.length), [1, 1, 0], '그다음 가장 오래된 항목의 리뷰부터 빠져요')
    assert.equal(res.reviewsCleared, 1)
    assert.equal(res.imagesCleared, 3)
    globalThis.localStorage = { getItem: () => null, removeItem() {}, setItem() { throw new Error('quota') } }
    assert.equal(saveWardrobe([mk('a')]).failed, true)
  } finally {
    if (prev === undefined) delete globalThis.localStorage
    else globalThis.localStorage = prev
  }
})

test('가짜 HTML: 닉네임·리뷰 본문은 진단 리포트와 기여 기록에 들어가지 않는다', () => {
  const doc = fakeDocument(RB_FULL)
  const r = analyzePage(doc, 'https://www.musinsa.com/products/1', { height: 170, weight: 70, gender: 'male', preferredFit: 'regular' })
  assert.equal(r.status, 'ok')
  const secrets = ['지루한플럼반바지', RB_BODY.slice(0, 20), RB_PHOTO]
  const mine = [...r.reviewViews.matched, ...r.reviewViews.others]
  assert.ok(mine.some((v) => v.nick === '지루한플럼반바지' && v.text.includes(RB_BODY.slice(0, 20))), '카드용 값에는 있어요')
  const report = formatReport(r.diagnostics)
  const diag = JSON.stringify(r.diagnostics)
  const rec = toContribution({ url: 'https://www.musinsa.com/products/1', productName: r.name, category: 'top', size: 'M', result: 'true', returned: false, parts: {}, savedAt: 1 }, { gender: 'male', height: 170, weight: 70, preferredFit: 'regular' }, true)
  assert.ok(rec)
  for (const piece of secrets) {
    assert.ok(!report.includes(piece), `리포트: ${piece}`)
    assert.ok(!diag.includes(piece), `진단 값: ${piece}`)
    assert.ok(!JSON.stringify(rec).includes(piece), `기여 기록: ${piece}`)
  }
  // 내보내기 봉투에는 있다 (사용자가 누를 때만 만들어요)
  assert.ok(JSON.stringify(buildExportEnvelope(r)).includes('지루한플럼반바지'))
})

await atest('content.js(가짜 DOM, vm): 리뷰 탭 4개와 사진 모아보기, 내 옷장으로 보내기 버튼이 오류 없이 그려진다', async () => {
  const { texts, created } = await runContentInFakeDom(RB_FULL)
  assert.ok(!texts.some((t) => t.includes('분석 중 문제가 생겼어요')))
  const tabs = created.filter((e) => e.className.split(' ').includes('rtab'))
  assert.deepEqual(tabs.map((t) => t.textContent), ['비슷한 체형', '전체 리뷰', '사진 모아보기', '체형 비교'])
  assert.equal(created.find((e) => e.children.includes(tabs[0]))?.className, 'rtabs', '리뷰 탭 목록은 사이즈 알약 탭(tabs)과 다른 클래스')
  assert.ok(tabs.every((t) => !t.className.split(' ').includes('tab')), '리뷰 탭은 사이즈 알약 탭(tab) 클래스를 같이 쓰지 않아요')
  const panel = created.find((e) => e.className === 'tp')
  assert.ok(panel, '스크롤 패널')
  tabs[1]._l.click()
  assert.deepEqual(tabs.map((t) => t.className), ['rtab', 'rtab on', 'rtab', 'rtab'], '누른 리뷰 탭만 rtab on')
  assert.ok(panel.children.length > 0, '리뷰 탭을 누른 뒤 패널이 비어 있지 않아요')
  tabs[2]._l.click()
  const imgs = created.filter((e) => e.tagName === 'IMG' && e.className === 'ph big')
  assert.ok(imgs.length >= 1 && imgs.every((i) => i.src.startsWith('https://') && i.referrerPolicy === 'no-referrer' && i.loading === 'lazy'))
  assert.ok(!created.some((e) => e.tagName === 'IMG' && /^(javascript|data):/i.test(e.src || '')))
  const send = created.find((e) => e.tagName === 'BUTTON' && e.textContent === '내 옷장으로 보내기')
  assert.ok(send, '보내기 버튼')
  const NOTE = '3일 안에 웹을 열지 않으면 대기열에서 지워져요. file://로 연 웹은 크롬 확장 설정에서 ‘파일 URL에 대한 액세스 허용’을 켜야 자동으로 받아요.'
  assert.ok(texts.includes(NOTE), '안내문은 정확히 두 문장')
  assert.ok(!texts.some((t) => t.includes('닉네임·리뷰 원문') || t.includes('서버로 보내지 않고')), '앞 문장 삭제')
  const more = created.find((e) => e.tagName === 'BUTTON' && e.textContent === '리뷰 더 불러오기')
  const stopBtn = created.find((e) => e.tagName === 'BUTTON' && e.textContent === '중단')
  const row = created.find((e) => e.children.includes(more))
  assert.ok(more && stopBtn && row && row.className === 'btns' && row.children.includes(stopBtn), '불러오기와 중단은 같은 .btns 안')
  assert.ok(created.find((e) => e.children.includes(send))?.className === 'btns', '보내기 버튼도 .btns 안')
  const css = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8')
  const gap = css.match(/\.btns\{[^}]*gap:(\d+)px/)
  assert.ok(gap && Number(gap[1]) >= 8 && /\.btns\{[^}]*flex-wrap:wrap/.test(css), '.btns 간격 8px 이상, 줄바꿈 허용')
  assert.ok(!created.some((e) => e.tagName === 'TEXTAREA' && e.readOnly), '누르기 전에는 내용을 만들지 않아요')
  await send._l.click()
  await new Promise((r) => setTimeout(r, 20))
  const copy = created.find((e) => e.tagName === 'BUTTON' && e.textContent === '붙여넣기용으로 복사')
  assert.ok(copy, '대체 복사 버튼')
  copy._l.click()
  await new Promise((r) => setTimeout(r, 20))
  const ta = created.find((e) => e.tagName === 'TEXTAREA' && e.readOnly)
  assert.ok(ta, '읽기 전용 칸')
  assert.equal(parseImportText(ta.value).ok, true)
})

await atest('content.js(가짜 DOM, vm): 보내기를 누르면 변환된 항목이 확장 저장소 대기열에 들어가고 체형 정보는 없다', async () => {
  const { created, storageCalls } = await runContentInFakeDom(RB_FULL)
  const before = storageCalls.length
  const send = created.find((e) => e.tagName === 'BUTTON' && e.textContent === '내 옷장으로 보내기')
  await send._l.click()
  await new Promise((r) => setTimeout(r, 20))
  const sets = storageCalls.slice(before).filter((c) => c[0] === 'set')
  assert.equal(sets.length, 1)
  const queue = sets[0][1][0][SYNC_QUEUE_KEY]
  assert.equal(queue.length, 1)
  assert.equal(parseImportText(JSON.stringify(queue[0].envelope)).ok, true)
  const dump = JSON.stringify(queue)
  assert.ok(!dump.includes('"height":175') || !dump.includes('preferredFit'), '체형 정보 없음')
  assert.ok(!dump.includes('preferredFit') && !dump.includes('footLength'))
  assert.ok(created.some((e) => e.tagName === 'A' && e.href === 'http://localhost:5173/' && e.rel === 'noopener noreferrer'), '웹 열기 링크')
})

test('content.js 소스: 보내기는 클릭 핸들러 안에서만 만들고 네트워크 호출을 쓰지 않는다', () => {
  const src = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8')
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(src))
  assert.ok(/addEventListener\('click', async \(\) => \{\n\s+const env = buildExportEnvelope/.test(src))
})


// ---- 성별 + 체형 유사도 기준 (가짜 HTML·가짜 데이터만 사용. 기준 숫자는 설계상 판단이고 실제 데이터로 검증한 값이 아니에요) ----
test('가짜 문자열: 체형 정보 줄에서 성별을 읽는다 (남성/여성/남자/여자/남/여, 구분자 여러 가지)', () => {
  for (const [s, g] of [['남성 · 170cm · 70kg', 'male'], ['여성 · 160cm · 50kg', 'female'], ['남자 175cm 70kg', 'male'], ['여자 / 158cm / 48kg', 'female'], ['남 180cm 75kg', 'male'], ['여 162cm 52kg', 'female']]) {
    assert.equal(parseGender(s), g, s)
    assert.equal(parseGender(s, true), g, `strict ${s}`)
  }
  assert.equal(parseGender('170cm · 70kg'), null)
  assert.equal(parseGender(''), null)
})

test('가짜 문자열: 리뷰 본문 속 단어는 성별로 읽지 않는다 (카드 전체 글에서는 숫자 옆 표기만)', () => {
  assert.equal(parseGender('남자친구 선물로 샀어요. 여름에 입기 좋아요. 키 170 몸무게 70', true), null)
  assert.equal(parseGender('여자친구가 170cm 입니다', true), null)
  assert.equal(parseGender('남성용인데 170cm 70kg 입니다', true), null)
})

test('가짜 HTML: 리뷰 카드의 체형 줄에서 review.gender를 읽고 본문 속 단어는 무시한다', () => {
  const card = (info, body) => `<div class="review-item"><span>${info}</span> <span>구매 옵션 1 (M)</span> <p>${body}</p></div>`
  const doc = fakeDocument(wrapBody(`${optionsHtml}${chartTable(OPTION_LIST_LABELS())}${card('남성 · 175cm · 70kg', '정사이즈예요 잘 맞아요')}${card('여성 · 160cm · 50kg', '남자친구 선물 정사이즈 잘 맞아요')}${card('175cm · 70kg', '남자친구 선물 정사이즈 잘 맞아요')}`))
  const p = parsePage(doc, '')
  const g = p.reviews.map((r) => r.gender)
  assert.ok(g.includes('male') && g.includes('female'))
  assert.ok(p.reviews.every((r) => r.gender === 'male' || r.gender === 'female' || r.gender === null))
  assert.ok(p.reviews.filter((r) => r.height === 175 && r.gender === 'female').length === 0)
})

test('가짜 데이터: 성별이 다르면 0점이고 matched에 절대 들어가지 않는다 (기준 0이어도)', () => {
  const me = { gender: 'male', height: 175, weight: 70 }
  const r = { height: 175, weight: 70, gender: 'female' }
  assert.equal(bodySimilarity(me, r), 0)
  assert.equal(matchReviews(me, [r], 0).length, 0)
  assert.equal(splitReviews(me, [r], 0).others.length, 1)
})

test('가짜 데이터: 후기 성별을 못 읽으면 10점 감점, 내 성별이 없으면 성별을 따지지 않는다', () => {
  const me = { gender: 'male', height: 175, weight: 70 }
  assert.equal(bodySimilarity(me, { height: 175, weight: 70, gender: 'male' }), 100)
  assert.equal(bodySimilarity(me, { height: 175, weight: 70, gender: null }), 100 - BODY_SIM.unknownGenderPenalty)
  assert.equal(bodySimilarity(me, { height: 175, weight: 70 }), 100 - BODY_SIM.unknownGenderPenalty)
  const noG = { height: 175, weight: 70 }
  assert.equal(bodySimilarity(noG, { height: 175, weight: 70, gender: 'female' }), 100)
  assert.equal(bodySimilarity(noG, { height: 175, weight: 70 }), 100)
  assert.equal(bodySimilarity(me, { height: null, weight: 70, gender: 'male' }), null)
})

test('가짜 데이터: 키가 같아도 몸무게 20kg 차이는 비슷한 체형이 아니다, 가까운 체형은 맞는다', () => {
  const me = { gender: 'male', height: 175, weight: 70 }
  assert.ok(bodySimilarity(me, { height: 175, weight: 90, gender: 'male' }) < BODY_SIM.threshold)
  assert.equal(matchReviews(me, [{ height: 175, weight: 90, gender: 'male' }]).length, 0)
  assert.ok(bodySimilarity(me, { height: 177, weight: 72, gender: 'male' }) >= BODY_SIM.threshold)
  assert.equal(matchReviews(me, [{ height: 177, weight: 72, gender: 'male' }]).length, 1)
  assert.equal(BODY_SIM.threshold, 65)
})

test('가짜 데이터: 체형 차이가 커질수록 유사도는 줄어들기만 한다', () => {
  const me = { gender: 'female', height: 165, weight: 55 }
  let prev = Infinity
  for (let d = 0; d <= 40; d++) {
    const sim = bodySimilarity(me, { height: 165 + d, weight: 55 + d, gender: 'female' })
    assert.ok(sim <= prev)
    prev = sim
  }
  assert.equal(prev, 0)
})


// ---- 체형 비교 (직접 만든 가짜 데이터와 가짜 DOM이에요. 실제 무신사·크롬에서 확인한 것이 아니에요) ----
import { compareBody, countUpValue, similarityTier, TIER_LABEL, diffText, buySizeText } from '../src/lib/similarityBreakdown.js'

test('가짜 데이터: compareBody는 성별 같음/다름/모름과 키 없는 후기를 구분한다', () => {
  const me = { gender: 'male', height: 175, weight: 70 }
  assert.equal(compareBody(me, { gender: 'male', height: 175, weight: 70 }).gender.state, 'same')
  assert.equal(compareBody(me, { gender: 'female', height: 175, weight: 70 }).gender.state, 'diff')
  assert.equal(compareBody(me, { gender: null, height: 175, weight: 70 }).gender.state, 'unknown')
  assert.equal(compareBody({ ...me, gender: null }, { gender: 'male', height: 175, weight: 70 }).gender.state, 'unknown')
  const none = compareBody(me, { gender: 'male', height: null, weight: 70 })
  assert.equal(none.similarity, null)
  assert.equal(none.height.fill, 0)
  const near = compareBody(me, { gender: 'male', height: 177, weight: 72 })
  assert.deepEqual([near.height.diff, near.weight.diff], [2, 2])
  assert.ok(near.height.fill > near.weight.fill && near.weight.fill < 1)
})

test('가짜 데이터: compareBody의 유사도는 bodySimilarity와 같은 숫자다', () => {
  const me = { gender: 'female', height: 165, weight: 55 }
  for (const r of [{ height: 165, weight: 55, gender: 'female' }, { height: 170, weight: 62, gender: null }, { height: 160, weight: 50, gender: 'male' }]) {
    assert.equal(compareBody(me, r).similarity, bodySimilarity(me, r))
  }
})

test('countUpValue: 0에서 시작해 목표에서 끝나고 줄어들지 않으며 범위를 벗어나지 않는다', () => {
  assert.equal(countUpValue(0, 900, 87), 0)
  assert.equal(countUpValue(900, 900, 87), 87)
  assert.equal(countUpValue(5000, 900, 87), 87)
  assert.equal(countUpValue(-10, 900, 87), 0)
  assert.equal(countUpValue(100, 0, 87), 87)
  assert.equal(countUpValue(100, 900, -5), 0)
  let prev = -1
  for (let t = 0; t <= 1000; t += 10) {
    const v = countUpValue(t, 900, 87)
    assert.ok(Number.isInteger(v) && v >= prev && v <= 87)
    prev = v
  }
})

const CMP_HTML = () => VIEW_HTML(chartTable(OPTION_LIST_LABELS()))
const findCompareTab = (created) => created.find((e) => e.tagName === 'BUTTON' && e.textContent === '체형 비교')
const fillWidths = (created) => created.filter((e) => e.className === 'cbf').map((e) => e.style.width)

function fakeRaf() {
  const calls = { raf: 0, cancel: 0 }
  let t = 0
  return {
    calls,
    requestAnimationFrame: (f) => { calls.raf += 1; t += 450; return setTimeout(() => f(t), 0) },
    cancelAnimationFrame: () => { calls.cancel += 1 },
  }
}

await atest('content.js(가짜 DOM, vm): 체형 비교 탭이 그려지고 숫자가 올라가며 끝난다 (움직임 허용)', async () => {
  const raf = fakeRaf()
  const { created, texts } = await runContentInFakeDom(CMP_HTML(), { matchMedia: () => ({ matches: false }), requestAnimationFrame: raf.requestAnimationFrame, cancelAnimationFrame: raf.cancelAnimationFrame })
  const tab = findCompareTab(created)
  assert.ok(tab, '체형 비교 탭이 있어야 해요')
  tab._l.click()
  await new Promise((r) => setTimeout(r, 100))
  assert.ok(raf.calls.raf > 0, 'requestAnimationFrame을 써요')
  assert.ok(created.some((e) => e.className === 'cpct' && /^\d+%$/.test(e.textContent) && e.textContent !== '0%'), '끝나면 최종 값이어야 해요')
  assert.ok(fillWidths(created).length >= 2 && fillWidths(created).every((w) => /%$/.test(w)))
  assert.ok(!texts.some((t) => t.includes('분석 중 문제가 생겼어요')))
})

await atest('content.js(가짜 DOM, vm): 움직임 줄이기이면 requestAnimationFrame 없이 최종 값을 바로 보여준다', async () => {
  const raf = fakeRaf()
  const { created } = await runContentInFakeDom(CMP_HTML(), { matchMedia: () => ({ matches: true }), requestAnimationFrame: raf.requestAnimationFrame, cancelAnimationFrame: raf.cancelAnimationFrame })
  findCompareTab(created)._l.click()
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(raf.calls.raf, 0)
  const pct = created.filter((e) => e.className === 'cpct')
  assert.ok(pct.length > 0 && pct.some((e) => e.textContent !== '0%'))
  assert.ok(fillWidths(created).some((w) => w !== '0%'))
})

await atest('content.js(가짜 DOM, vm): matchMedia가 없어도 오류 없이 최종 값을 보여준다', async () => {
  const { created, texts } = await runContentInFakeDom(CMP_HTML())
  findCompareTab(created)._l.click()
  await new Promise((r) => setTimeout(r, 50))
  assert.ok(created.some((e) => e.className === 'cpct'))
  assert.ok(!texts.some((t) => t.includes('분석 중 문제가 생겼어요')))
})

test('content.js: 체형 비교는 innerHTML을 쓰지 않고 aria-live가 없으며 전역 검사를 통과한다', () => {
  const src = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8')
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(src.replace(/\/\/.*$/gm, '').replace(/set innerHTML/g, '')))
  assert.ok(!src.includes('aria-live'))
  assert.ok(src.includes('prefers-reduced-motion: reduce'))
  assert.deepEqual(findUndeclared(src), [])
  const web = readFileSync(new URL('../src/components/SimilarityCompare.jsx', import.meta.url), 'utf8')
  assert.ok(!web.includes('aria-live') && web.includes('prefers-reduced-motion'))
})


// ---- 확장 → 웹 옷장 자동 전달 (가짜 데이터·가짜 창·가짜 chrome.storage만 사용. 실제 크롬에서 확인한 것이 아니에요) ----
const FAKE_ENV = (name = '가짜 니트', url = 'https://shop.example/p/1', size = 'L') => ({
  app: 'fitcheck', kind: 'wardrobe-item', v: 1,
  item: { product: { name, mall: '가짜몰', category: 'top', image: null, url }, size, measures: { chest: 55 }, verdicts: [], reviews: [{ nick: '가짜닉', text: '가짜 리뷰', photos: ['https://img.example/a.jpg'] }] },
})
const NOW = 1_800_000_000_000

test('가짜 데이터 sync: 대기열 넣기 - 항목 id·시간이 붙고 같은 상품·사이즈는 하나로 합쳐진다', () => {
  let q = []
  const a = enqueue(q, FAKE_ENV('A'), { now: NOW, id: 'qaaaaaaa' })
  assert.equal(a.ok, true)
  q = a.queue
  const b = enqueue(q, FAKE_ENV('B', 'https://shop.example/p/2'), { now: NOW + 1, id: 'qbbbbbbb' })
  q = b.queue
  assert.equal(q.length, 2)
  const a2 = enqueue(q, FAKE_ENV('A2'), { now: NOW + 2, id: 'qcccccc1' }) // 같은 상품·사이즈
  assert.deepEqual(a2.queue.map((e) => e.envelope.item.product.name), ['B', 'A2'])
  assert.equal(enqueue(q, null).ok, false)
  assert.equal(enqueue(q, { item: 1 }).ok, false)
  assert.match(newQueueId(NOW, 0.5), /^q[a-z0-9]{6,40}$/)
})

test('가짜 데이터 sync: 대기열 상한과 만료, 형식이 틀린 항목 제거', () => {
  let q = []
  for (let i = 0; i < QUEUE_MAX + 5; i++) q = enqueue(q, FAKE_ENV(`n${i}`, `https://shop.example/p/${i}`), { now: NOW + i, id: `qid${String(i).padStart(5, '0')}` }).queue
  assert.equal(q.length, QUEUE_MAX)
  assert.equal(q[q.length - 1].envelope.item.product.name, `n${QUEUE_MAX + 4}`, '오래된 것부터 버림')
  const later = NOW + QUEUE_TTL_MS + 5000
  assert.deepEqual(pruneQueue(q, later).map((e) => e.queuedAt), q.filter((e) => later - e.queuedAt <= QUEUE_TTL_MS).map((e) => e.queuedAt))
  assert.equal(pruneQueue(q, NOW + QUEUE_TTL_MS + 10_000_000).length, 0, '모두 만료')
  const bad = [{ id: 'x', queuedAt: NOW, envelope: {} }, { id: 'qgood1234', queuedAt: NOW, envelope: {} }, { id: 'qgood1234', queuedAt: NOW, envelope: {} }, null, 'str', { id: 'qfuture12', queuedAt: NOW + 3_600_000, envelope: {} }]
  assert.deepEqual(pruneQueue(bad, NOW).map((e) => e.id), ['qgood1234'])
  assert.deepEqual(pruneQueue('nope', NOW), [])
  const big = { app: 'fitcheck', kind: 'wardrobe-item', v: 1, item: { x: 'a'.repeat(IMPORT_LIMITS.text + 1) } }
  assert.equal(enqueue([], big, { now: NOW }).ok, false, '너무 큰 항목')
})

test('가짜 데이터 sync: ack로 대기열에서 삭제하고 모르는 id는 무시한다', () => {
  const q = ['qaaaaaaa', 'qbbbbbbb', 'qcccccc1'].map((id, i) => ({ id, queuedAt: NOW + i, envelope: FAKE_ENV() }))
  assert.deepEqual(removeAcked(q, ['qbbbbbbb', 'qzzzzzzz']).map((e) => e.id), ['qaaaaaaa', 'qcccccc1'])
  assert.equal(removeAcked(q, null).length, 3)
})

test('가짜 데이터 sync: 페이지 허용 판정 - 허용 출처와 fit-check.html 파일만', () => {
  for (const o of WEB_APP_ORIGINS) assert.equal(isAllowedPage({ protocol: new URL(o).protocol, origin: o, pathname: '/' }), true, o)
  assert.equal(isAllowedPage({ protocol: 'file:', origin: 'null', pathname: '/Users/x/fit-check/dist/fit-check.html' }), true)
  for (const loc of [
    { protocol: 'file:', origin: 'null', pathname: '/Users/x/evil.html' },
    { protocol: 'file:', origin: 'null', pathname: '/Users/x/fit-check.html/../a.html' },
    { protocol: 'https:', origin: 'https://evil.example', pathname: '/' },
    { protocol: 'http:', origin: 'http://localhost:3000', pathname: '/' },
    { protocol: 'https:', origin: 'https://localhost:5173', pathname: '/' },
    { protocol: 'http:', origin: 'http://localhost:5173.evil.example', pathname: '/' },
    null, {},
  ]) assert.equal(isAllowedPage(loc), false, JSON.stringify(loc))
})

test('가짜 데이터 sync: manifest의 브리지 matches가 허용 출처 상수와 일치한다', () => {
  const bridge = EXT_MANIFEST.content_scripts.find((c) => c.js.includes('bridge.js'))
  assert.ok(bridge)
  assert.deepEqual([...bridge.matches].sort(), [...BRIDGE_MATCHES].sort())
  assert.ok(!EXT_MANIFEST.content_scripts.find((c) => c.js.includes('content.js')).matches.some((m) => /localhost|127\.0\.0\.1|file:/.test(m)), '쇼핑몰 content script에는 웹 앱 주소가 없다')
  assert.ok(bridge.matches.filter((m) => m.startsWith('file:')).every((m) => m === 'file:///*/fit-check.html'))
  const bad = { ...EXT_MANIFEST, content_scripts: [{ matches: ['file:///*'], js: ['bridge.js'] }] }
  assert.ok(checkManifest(bad).some((e) => e.includes('file://')))
})

test('가짜 데이터 sync: message 이벤트 신뢰 판정 - source, origin, file:// 의 null origin', () => {
  const win = {}
  const http = { protocol: 'http:', origin: 'http://localhost:5173' }
  const file = { protocol: 'file:', origin: 'null' }
  const ev = (o) => ({ data: { a: 1 }, source: win, origin: 'http://localhost:5173', ...o })
  assert.equal(isTrustedMessage(ev(), win, http), true)
  assert.equal(isTrustedMessage(ev({ source: {} }), win, http), false, '다른 창(iframe 등)')
  assert.equal(isTrustedMessage(ev({ source: null }), win, http), false)
  assert.equal(isTrustedMessage(ev({ origin: 'https://evil.example' }), win, http), false)
  assert.equal(isTrustedMessage(ev({ origin: 'null' }), win, http), false, 'http 페이지에서 null origin 거부')
  assert.equal(isTrustedMessage(ev({ data: 'str' }), win, http), false)
  assert.equal(isTrustedMessage(ev({ data: [1] }), win, http), false)
  assert.equal(isTrustedMessage(ev({ origin: 'null' }), win, file), true)
  assert.equal(isTrustedMessage(ev({ origin: 'http://localhost:5173' }), win, file), false)
  assert.equal(isTrustedMessage(ev({ origin: 'null', source: {} }), win, file), false)
  assert.equal(postTargetOrigin(http), 'http://localhost:5173')
  assert.equal(postTargetOrigin(file), '*')
})

test('가짜 데이터 sync: 메시지 모양 검사 - 틀린 메시지는 거부한다', () => {
  const q = [{ id: 'qaaaaaaa', queuedAt: NOW, envelope: FAKE_ENV() }]
  assert.equal(parseDeliverMessage(makeDeliverMessage(q)).length, 1)
  for (const m of [null, 'x', {}, { ...makeDeliverMessage(q), source: 'other' }, { ...makeDeliverMessage(q), v: 2 }, { ...makeDeliverMessage(q), type: 'ack' }, { ...makeDeliverMessage(q), entries: 'x' }]) assert.equal(parseDeliverMessage(m), null)
  assert.deepEqual(parseDeliverMessage({ ...makeDeliverMessage(q), entries: [...q, { id: 'bad', queuedAt: 1, envelope: {} }, null] }).map((e) => e.id), ['qaaaaaaa'])
  assert.deepEqual(parseAckMessage(makeAckMessage(['qaaaaaaa'])), ['qaaaaaaa'])
  assert.deepEqual(parseAckMessage({ ...makeAckMessage([]), ids: ['qaaaaaaa', 5, 'bad id', { a: 1 }] }), ['qaaaaaaa'])
  for (const m of [null, {}, { ...makeAckMessage(['qaaaaaaa']), source: 'fitcheck-ext' }, { ...makeAckMessage(['qaaaaaaa']), ids: 'x' }, makeDeliverMessage(q)]) assert.equal(parseAckMessage(m), null)
  assert.equal(isReadyMessage(makeReadyMessage()), true)
  assert.equal(isReadyMessage({ ...makeReadyMessage(), source: 'x' }), false)
  assert.equal(isReadyMessage(makeAckMessage([])), false)
})

test('가짜 데이터 sync: 전달 반영 - 한 번만 저장(중복 전달), 형식 오류·만료는 건너뛰고 처리 완료로 표시', () => {
  const entries = [
    { id: 'qaaaaaaa', queuedAt: NOW, envelope: FAKE_ENV('A', 'https://shop.example/p/1') },
    { id: 'qbbbbbbb', queuedAt: NOW + 1, envelope: FAKE_ENV('B', 'https://shop.example/p/2') },
  ]
  const r1 = applyDelivery([], entries, [], { now: NOW + 5, addItem: addImportedItem })
  assert.deepEqual(r1.savedIds.sort(), ['qaaaaaaa', 'qbbbbbbb'])
  assert.deepEqual(r1.list.map((w) => w.product.name), ['B', 'A'], '최근 것이 맨 앞')
  assert.ok(r1.list.every((w) => w.source === 'extension'))
  assert.equal(syncNotice(r1), '확장에서 2벌 가져왔어요.')
  // 같은 항목을 다시 전달(ack가 늦거나 유실): 저장하지 않고 처리 완료만
  const r2 = applyDelivery(r1.list, entries, r1.seen, { now: NOW + 6, addItem: addImportedItem })
  assert.deepEqual(r2.savedIds, [])
  assert.equal(r2.list.length, 2)
  assert.deepEqual(r2.ignoredIds.sort(), ['qaaaaaaa', 'qbbbbbbb'])
  assert.equal(syncNotice(r2), '')
  // 한 번의 전달 안에서 같은 id가 두 번
  const r3 = applyDelivery([], [entries[0], entries[0]], [], { now: NOW + 5, addItem: addImportedItem })
  assert.equal(r3.list.length, 1)
  assert.equal(r3.duplicates, 1)
  // 형식 오류 / 만료 / 위험 주소
  const evil = FAKE_ENV('악성')
  evil.item.product.url = 'javascript:alert(1)'
  evil.item.product.image = 'data:image/png;base64,AAAA'
  evil.item.reviews[0].photos = ['javascript:1', 'https://ok.example/x.jpg']
  const r4 = applyDelivery([], [
    { id: 'qbad00001', queuedAt: NOW, envelope: { app: 'other' } },
    { id: 'qold00001', queuedAt: NOW - QUEUE_TTL_MS - 1, envelope: FAKE_ENV('만료') },
    { id: 'qevil0001', queuedAt: NOW, envelope: evil },
  ], [], { now: NOW + 5, addItem: addImportedItem })
  assert.equal(r4.rejected, 2)
  assert.deepEqual(r4.savedIds, ['qevil0001'])
  assert.equal(r4.list[0].product.url, '')
  assert.equal(r4.list[0].product.image, null)
  assert.deepEqual(r4.list[0].reviews[0].photos, ['https://ok.example/x.jpg'])
  assert.equal(r4.ignoredIds.length, 2)
  assert.equal(syncNotice({ savedIds: [], rejected: 1 }), '확장에서 보낸 내용을 읽지 못했어요.')
  // seen 상한
  const many = applyDelivery([], [entries[0]], Array.from({ length: 500 }, (_, i) => `qold${i}xxxx`), { now: NOW + 5, addItem: addImportedItem })
  assert.equal(many.seen.length, 200)
  assert.equal(many.seen[many.seen.length - 1], 'qaaaaaaa')
})

test('가짜 데이터 sync: 같은 상품·사이즈가 옷장에 있으면 합성 이미지는 유지하고 id 기준 중복 저장은 없다', () => {
  const existing = [{ id: 'wold', savedAt: 1, product: { name: '기존', mall: '', category: 'top', image: null, emoji: null, url: 'https://shop.example/p/1' }, size: 'L', measures: null, verdicts: [], image: 'data:image/png;base64,XX', imageKind: 'ai', reviews: [] }]
  const r = applyDelivery(existing, [{ id: 'qaaaaaaa', queuedAt: NOW, envelope: FAKE_ENV('새 이름') }], [], { now: NOW + 1, addItem: addImportedItem })
  assert.equal(r.list.length, 1)
  assert.equal(r.list[0].id, 'wold')
  assert.equal(r.list[0].image, 'data:image/png;base64,XX')
  assert.equal(r.list[0].product.name, '새 이름')
})

// 가짜 창: postMessage는 같은 창의 리스너에게 source=창 자신, origin=설정값으로 전달합니다.
function fakeWindow(origin, protocol = 'http:') {
  const listeners = []
  const posted = []
  const win = {
    location: { origin, protocol, pathname: protocol === 'file:' ? '/x/fit-check.html' : '/' },
    posted,
    addEventListener: (t, f) => t === 'message' && listeners.push(f),
    removeEventListener: (t, f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1) },
    postMessage(data, target) { posted.push({ data, target }) },
    deliverToSelf(data, ev = {}) { for (const f of [...listeners]) f({ data, source: win, origin: win.location.origin, ...ev }) },
    listenerCount: () => listeners.length,
  }
  return win
}

test('가짜 데이터 sync: 웹 앱 연결 - 전달을 받으면 처리하고 ack, 출처가 다르면 무시, 해제하면 더 받지 않는다', () => {
  const win = fakeWindow('http://localhost:5173')
  const got = []
  const off = connectExtensionSync((entries) => { got.push(entries); return entries.map((e) => e.id) }, win)
  assert.equal(win.posted[0].data.type, 'ready')
  assert.equal(win.posted[0].target, 'http://localhost:5173')
  const q = [{ id: 'qaaaaaaa', queuedAt: NOW, envelope: FAKE_ENV() }]
  win.deliverToSelf(makeDeliverMessage(q), { origin: 'https://evil.example' })
  win.deliverToSelf(makeDeliverMessage(q), { source: {} })
  win.deliverToSelf({ type: 'deliver', entries: q })
  win.deliverToSelf(makeDeliverMessage([]))
  assert.equal(got.length, 0)
  win.deliverToSelf(makeDeliverMessage(q))
  assert.equal(got.length, 1)
  assert.deepEqual(win.posted[1].data, makeAckMessage(['qaaaaaaa']))
  off()
  win.deliverToSelf(makeDeliverMessage(q))
  assert.equal(got.length, 1)
  assert.equal(win.listenerCount(), 0)
  // 저장에 실패해 아무것도 처리하지 못하면 ack를 보내지 않는다
  const w2 = fakeWindow('null', 'file:')
  connectExtensionSync(() => [], w2)
  w2.deliverToSelf(makeDeliverMessage(q))
  assert.equal(w2.posted.length, 1, 'ready만 있고 ack 없음')
  assert.equal(w2.posted[0].target, '*')
})

// 브리지(extension/bridge.js)를 IIFE로 빌드해 가짜 window·chrome.storage에서 실행합니다.
async function runBridge(loc, initialQueue) {
  const root = resolvePath(import.meta.dirname, '..')
  const outDir = mkdtempSync(join(tmpdir(), 'fitcheck-bridge-'))
  try {
    await viteBuild({
      configFile: false, root, logLevel: 'silent', publicDir: false,
      build: { outDir, emptyOutDir: true, minify: false, target: 'es2020', lib: { entry: resolvePath(root, 'extension/bridge.js'), formats: ['iife'], name: 'fitcheck_bridge', fileName: () => 'bridge.js' } },
    })
    const code = readFileSync(join(outDir, 'bridge.js'), 'utf8')
    assert.deepEqual(findUndeclared(code), [])
    assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\b/.test(code))
    const win = fakeWindow(loc.origin, loc.protocol)
    win.location = loc
    const store = { [SYNC_QUEUE_KEY]: initialQueue }
    let changed = null
    const chromeFake = {
      storage: {
        local: {
          get: (k, cb) => cb({ [k]: store[k] }),
          set: (obj, cb) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); changed?.({ [SYNC_QUEUE_KEY]: {} }, 'local'); cb?.() },
        },
        onChanged: { addListener: (f) => { changed = f } },
      },
    }
    const sandbox = { window: win, chrome: chromeFake, console }
    vm.createContext(sandbox)
    vm.runInContext(code, sandbox)
    return { win, store, fireChanged: (area = 'local') => changed?.({ [SYNC_QUEUE_KEY]: {} }, area), hasChangedListener: () => !!changed }
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

await atest('브리지(가짜 window·chrome.storage): 열릴 때와 ready 요청에 대기열을 전달하고, ack를 받은 항목만 지운다', async () => {
  const now = Date.now()
  const q = [
    { id: 'qaaaaaaa', queuedAt: now - 1000, envelope: FAKE_ENV('A', 'https://shop.example/p/1') },
    { id: 'qbbbbbbb', queuedAt: now - 500, envelope: FAKE_ENV('B', 'https://shop.example/p/2') },
  ]
  const { win, store, fireChanged } = await runBridge({ protocol: 'http:', origin: 'http://localhost:5173', pathname: '/' }, q)
  assert.equal(win.posted.length, 1)
  assert.equal(win.posted[0].data.type, 'deliver')
  assert.equal(win.posted[0].data.entries.length, 2)
  assert.equal(win.posted[0].target, 'http://localhost:5173')
  win.deliverToSelf(makeReadyMessage())
  assert.equal(win.posted.length, 2)
  // 다른 출처·다른 창에서 온 ack는 무시
  win.deliverToSelf(makeAckMessage(['qaaaaaaa']), { origin: 'https://evil.example' })
  win.deliverToSelf(makeAckMessage(['qaaaaaaa']), { source: {} })
  assert.equal(store[SYNC_QUEUE_KEY].length, 2)
  // 모르는 명령은 무시 (페이지가 확장에 시킬 수 있는 일은 ready, ack뿐)
  win.deliverToSelf({ source: 'fitcheck-web', v: 1, type: 'clear-all' })
  win.deliverToSelf({ source: 'fitcheck-web', v: 1, type: 'set-profile', profile: {} })
  assert.equal(store[SYNC_QUEUE_KEY].length, 2)
  win.deliverToSelf(makeAckMessage(['qaaaaaaa']))
  assert.deepEqual(store[SYNC_QUEUE_KEY].map((e) => e.id), ['qbbbbbbb'])
  // 저장소가 바뀌면(웹이 이미 열려 있을 때 새로 보냄) 바로 전달
  const n = win.posted.length
  fireChanged('sync')
  assert.equal(win.posted.length, n, 'local 영역이 아니면 무시')
  fireChanged('local')
  assert.equal(win.posted.length, n + 1)
  win.deliverToSelf(makeAckMessage(['qbbbbbbb']))
  assert.equal(store[SYNC_QUEUE_KEY].length, 0)
  const m = win.posted.length
  fireChanged('local')
  assert.equal(win.posted.length, m, '빈 대기열은 보내지 않아요')
})

await atest('브리지(가짜 window·chrome.storage): 만료·형식 오류 항목은 전달하지 않고 대기열에서 정리한다', async () => {
  const now = Date.now()
  const q = [
    { id: 'qold00001', queuedAt: now - QUEUE_TTL_MS - 1000, envelope: FAKE_ENV('만료') },
    { id: 'bad', queuedAt: now, envelope: {} },
    { id: 'qgood0001', queuedAt: now, envelope: FAKE_ENV('정상') },
  ]
  const { win, store } = await runBridge({ protocol: 'http:', origin: 'http://127.0.0.1:4173', pathname: '/' }, q)
  assert.deepEqual(Array.from(win.posted[0].data.entries, (e) => e.id), ['qgood0001']) // vm 안에서 만든 배열이라 realm이 달라 Array.from으로 옮겨요
  assert.deepEqual(store[SYNC_QUEUE_KEY].map((e) => e.id), ['qgood0001'])
})

await atest('브리지(가짜 window): file:// 단일 HTML에서는 null origin과 targetOrigin * 로 동작한다', async () => {
  const now = Date.now()
  const q = [{ id: 'qaaaaaaa', queuedAt: now, envelope: FAKE_ENV() }]
  const { win, store } = await runBridge({ protocol: 'file:', origin: 'null', pathname: '/Users/x/fit-check/dist/fit-check.html' }, q)
  assert.equal(win.posted[0].target, '*')
  win.deliverToSelf(makeAckMessage(['qaaaaaaa']), { origin: 'http://localhost:5173' })
  assert.equal(store[SYNC_QUEUE_KEY].length, 1)
  win.deliverToSelf(makeAckMessage(['qaaaaaaa']), { origin: 'null' })
  assert.equal(store[SYNC_QUEUE_KEY].length, 0)
})

await atest('브리지(가짜 window): 허용 목록에 없는 페이지에서는 아무것도 하지 않는다', async () => {
  const q = [{ id: 'qaaaaaaa', queuedAt: Date.now(), envelope: FAKE_ENV() }]
  for (const loc of [
    { protocol: 'https:', origin: 'https://evil.example', pathname: '/' },
    { protocol: 'file:', origin: 'null', pathname: '/Users/x/other.html' },
    { protocol: 'http:', origin: 'http://localhost:3000', pathname: '/' },
  ]) {
    const { win, store, hasChangedListener } = await runBridge(loc, q)
    assert.equal(win.posted.length, 0, loc.origin + loc.pathname)
    assert.equal(win.listenerCount(), 0)
    assert.equal(hasChangedListener(), false)
    win.deliverToSelf(makeAckMessage(['qaaaaaaa']))
    assert.equal(store[SYNC_QUEUE_KEY].length, 1)
  }
})

test('빌드된 웹 앱 소스: 자동 가져오기 연결과 알림이 App에 있고, 확장 → 웹 메시지에 체형 정보 필드가 없다', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.ok(app.includes('connectExtensionSync') && app.includes('applyDelivery') && app.includes('sync-notice'))
  const sync = readFileSync(new URL('../src/lib/wardrobeSync.js', import.meta.url), 'utf8')
  assert.ok(!/preferredFit|footLength|loadProfile|EXT_PROFILE_KEY/.test(sync))
  const bridge = readFileSync(new URL('../extension/bridge.js', import.meta.url), 'utf8')
  assert.ok(!/EXT_PROFILE_KEY|fitcheckProfile|innerHTML|eval\(/.test(bridge))
  assert.ok(!bridge.includes("'*'"), 'targetOrigin 결정은 postTargetOrigin 한 곳')
})

test('웹 앱 소스: 이미 처리된 전달만 받아도 옷장 상태를 저장소 기준으로 새로 읽는다 (여러 탭)', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const i = app.indexOf('if (r.savedIds.length === 0) {')
  assert.ok(i > 0 && app.slice(i, i + 300).includes('setWardrobe(loadWardrobe())'))
})

test('가짜 데이터 sync: 두 탭(가짜 window)이 같은 전달을 받아도 한 번만 담긴다', () => {
  const entries = [{ id: 'qaaaaaaa', queuedAt: NOW, envelope: FAKE_ENV() }]
  let store = [], seen = []
  const handler = (es) => {
    const r = applyDelivery(store, es, seen, { now: NOW + 1, addItem: addImportedItem })
    store = r.list; seen = r.seen
    return [...r.savedIds, ...r.ignoredIds]
  }
  const a = fakeWindow('http://localhost:5173'), b = fakeWindow('http://localhost:5173')
  connectExtensionSync(handler, a); connectExtensionSync(handler, b)
  a.deliverToSelf(makeDeliverMessage(entries)); b.deliverToSelf(makeDeliverMessage(entries))
  assert.equal(store.length, 1)
  assert.deepEqual(b.posted[1].data.ids, ['qaaaaaaa'], '두 번째 탭도 처리 완료로 ack')
})

test('확장 분석: 상품 페이지가 아닌 화면(장바구니 등)은 따로 안내하고, 상품 페이지로 보이면 기존 문구를 쓴다', () => {
  const profile = buildProfile({ gender: 'male', height: '175', weight: '70' }).profile
  const cart = analyzePage(fakeDocument('<html><body><h1>장바구니</h1><p>담긴 상품이 없어요</p></body></html>'), 'https://shop.example/cart', profile)
  assert.equal(cart.status, 'no-data')
  assert.equal(cart.notProductPage, true)
  assert.ok(cart.message.includes('상품 상세 페이지가 아니에요') && cart.diagnostics, '직접 입력·리포트는 남김')
  const prod = analyzePage(fakeDocument('<html><head><meta property="og:type" content="product"></head><body><h1>니트 스웨터</h1></body></html>'), 'https://shop.example/p/1', profile)
  assert.equal(prod.status, 'no-data')
  assert.equal(prod.notProductPage, false)
  assert.ok(!prod.message.includes('상품 상세 페이지가 아니에요'))
})

test('사이즈표: 신발은 사이즈 이름(mm)이 발길이로 읽힌다 (가짜 표)', () => {
  const chartOf = (rows, cat, opts = []) => analyzeSizeCharts(rows, cat, opts)
  for (const [rows, cat] of [
    [[[['사이즈(mm)', '230', '240', '250', '260']]], 'top'],
    [[[['KR', '230', '240', '250'], ['US', '5', '6', '7']]], 'shoes'],
    [[[['사이즈'], ['230mm'], ['240mm'], ['250mm']]], 'shoes'],
    [[[['사이즈', '발 길이', '발볼'], ['230', '230', '95'], ['240', '240', '98']]], 'shoes'],
  ]) {
    const { chart } = chartOf(rows, cat)
    assert.ok(chart, JSON.stringify(rows))
    assert.equal(chart.category, 'shoes')
    assert.equal(chart.unit, 'mm')
    for (const [k, m] of Object.entries(chart.measures)) assert.equal(m.footLength, Number(k))
  }
  const fromOptions = chartOf([], 'shoes', ['블랙 / 240', '블랙 / 250'])
  assert.deepEqual(Object.keys(fromOptions.chart.measures), ['240', '250'])
  assert.equal(chartOf([[['사이즈', '230', '240']]], 'shoes').chart, null, '2개뿐이면 표로 보지 않음')
  assert.equal(chartOf([[['번호', '3', '2', '1', '9']]], 'shoes').chart, null, 'mm 범위 밖이거나 커지지 않으면 거부')
  assert.equal(chartOf([[['사이즈', '230', '240', '250']]], 'top', []).chart, null, '신발 근거가 없으면 일반 옷으로 오해하지 않음')
})

test('사이즈표: 옵션에 색상이 붙어도(블랙 / M) 영문 헤더(Size, Length, Chest)도 읽는다 (가짜 표)', () => {
  const { chart, meta } = analyzeSizeCharts([[['사이즈', '어깨', '가슴'], ['M', '45', '55'], ['L', '47', '58']]], 'top', ['블랙 / M', '블랙 / L'])
  assert.deepEqual(Object.keys(chart.measures), ['M', 'L'])
  assert.equal(meta.overlap, 2)
  const num = analyzeSizeCharts([[['사이즈', '어깨', '가슴'], ['0', '45', '55'], ['1', '47', '58']]], 'top', ['블랙 / 0 (S)', '블랙 / 1 (M)'])
  assert.deepEqual(Object.keys(num.chart.measures), ['0(S)', '1(M)'])
  const en = analyzeSizeCharts([[['Size', 'Length', 'Chest'], ['S', '70', '100'], ['M', '72', '104']]], 'top', [])
  assert.deepEqual(Object.keys(en.chart.measures), ['S', 'M'])
  assert.equal(en.chart.measures.M.chest, 104)
  const wrong = analyzeSizeCharts([[['사이즈', '어깨', '가슴'], ['M', '45', '55'], ['L', '47', '58']]], 'top', ['블랙 / XL'])
  assert.equal(wrong.chart, null, '옵션과 전혀 안 겹치면 여전히 거부')
})

test('리뷰 신발 사이즈: 265mm 구매, 270 신어요, 구매옵션 화이트 / 255, 평소 사이즈는 제외 (가짜 문장)', () => {
  const labels = ['250', '255', '260', '265', '270']
  for (const [text, want] of [
    ['265mm 구매했어요', '265'], ['270 신어요 딱 맞음', '270'], ['구매옵션 화이트 / 255 발볼 넓어요', '255'],
    ['평소 250 신는데 260 샀어요', '260'], ['250 신는데 265 구매했어요', '265'], ['260mm 사이즈 정사이즈', '260'],
  ]) {
    assert.equal(parseReviewText(text, labels).size, want, text)
    assert.equal(parseReviewText(text, []).size, want, `${text} (라벨 없음)`)
  }
  for (const text of ['굽 30mm 편해요', '평소 250 신어요', '두 켤레 샀어요 250 260']) assert.equal(parseReviewText(text, labels).size, null, text)
  assert.equal(parseReviewText('300 신어요', labels).size, null, '표에 없는 사이즈')
})

await atest('content.js(가짜 DOM, vm): 체형 비교는 키·몸무게를 한 묶음으로 보이고 유사도 막대는 후기마다 하나뿐이다', async () => {
  const { created } = await runContentInFakeDom(CMP_HTML())
  findCompareTab(created)._l.click()
  await new Promise((r) => setTimeout(r, 50))
  const rows = created.filter((e) => e.className === 'cr')
  assert.ok(rows.length >= 2)
  const mecard = created.filter((e) => e.className === 'mecard')
  assert.equal(mecard.length, 1, '탭 맨 위 큰 내 체형 카드 하나')
  assert.ok(created.filter((e) => e.className === 'men').every((e) => /^\d+$/.test(e.textContent)) && created.filter((e) => e.className === 'men').length === 2, '키·몸무게 큰 숫자')
  assert.ok(!created.some((e) => e.className === 'tiny' && /^내 체형:/.test(e.textContent)), '작은 한 줄 제거')
  const groups = created.filter((e) => e.className === 'cgrp')
  assert.equal(groups.length, rows.length, '후기마다 키·몸무게 묶음 하나')
  assert.ok(groups.every((g) => g.children.length === 1), '후기 체형 한 칸만')
  const labels = created.filter((e) => e.className === 'ccl').map((e) => e.textContent)
  assert.equal(labels.length, rows.length)
  assert.ok(labels.every((t) => t === '후기 체형'), '내 값 칸(나) 없이 후기 체형만')
  assert.ok(created.filter((e) => e.className === 'ccv').every((e) => /^\d+cm · \d+kg$/.test(e.textContent)), '후기 키·몸무게 값')
  const buys = created.filter((e) => e.className === 'cbuy')
  assert.equal(buys.length, rows.length, '후기마다 구매 사이즈 한 줄')
  assert.ok(buys.every((e) => /^(구매 .+|사이즈 못 읽음)$/.test(e.textContent)), '구매 사이즈 문구')
  assert.equal(created.filter((e) => e.className === 'cbf').length, rows.length, '퍼센트 막대는 후기마다 하나')
  assert.equal(created.filter((e) => /^cb (high|mid|low)$/.test(e.className)).length, rows.length, '구간 색 클래스')
  assert.ok(created.every((e) => e.className !== 'cbl' || e.children.length === 2))
})

test('가짜 데이터: buySizeText는 원문 라벨을 그대로 쓰고 못 읽으면 안내한다', () => {
  assert.equal(buySizeText('2 (L)'), '구매 2 (L)')
  assert.equal(buySizeText('L'), '구매 L')
  assert.equal(buySizeText('  2   (L) '), '구매 2 (L)')
  for (const v of [null, undefined, '', '   ', 5]) assert.equal(buySizeText(v), '사이즈 못 읽음')
  assert.equal(buySizeText('가'.repeat(100)), `구매 ${'가'.repeat(40)}`)
  const web = readFileSync(new URL('../src/components/SimilarityCompare.jsx', import.meta.url), 'utf8')
  assert.ok(web.includes('buySizeText(size)') && web.includes('size={r.size}'), '웹도 구매 사이즈 표시')
})

test('체형 비교: 유사도 구간과 차이 문구 (순수 함수, 가짜 값)', () => {
  assert.equal(similarityTier(BODY_SIM.threshold), 'high')
  assert.equal(similarityTier(BODY_SIM.threshold - 1), 'mid')
  assert.equal(similarityTier(BODY_SIM.threshold / 2), 'mid')
  assert.equal(similarityTier(BODY_SIM.threshold / 2 - 1), 'low')
  assert.equal(similarityTier(null), 'low')
  const c = compareBody({ gender: 'male', height: 175, weight: 70 }, { gender: 'male', height: 172, weight: 68 })
  assert.equal(diffText(c), '키 3cm · 몸무게 2kg 차이')
  assert.equal(diffText({ height: { diff: null }, weight: { diff: 1 } }), null)
  assert.ok(Object.keys(TIER_LABEL).length === 3)
  const web = readFileSync(new URL('../src/components/SimilarityCompare.jsx', import.meta.url), 'utf8')
  assert.ok(web.includes('<BodyPair') && web.includes('<SimBar') && !web.includes('<Bar '), '웹도 묶음 + 막대 하나')
  assert.ok(!web.includes('c.height.me') && !web.includes('c.weight.me'), '웹도 내 값 칸 없음')
  assert.ok(web.includes('me-card') && web.includes('me-num') && !web.includes('내 체형: {'), '웹도 큰 내 체형 카드')
})

test('사이즈표 회귀 방지: 95/100·S/M 같은 묶음 옵션은 표 줄 이름을 바꾸지 않고, 옵션만으로 의류를 신발로 만들지 않는다 (가짜 표)', () => {
  const num = [[['사이즈', '어깨', '가슴'], ['95', '45', '55'], ['100', '47', '58'], ['105', '49', '61']]]
  const alpha = [[['사이즈', '어깨', '가슴'], ['S', '45', '55'], ['M', '47', '58'], ['L', '49', '61']]]
  const a = analyzeSizeCharts(num, 'top', ['95/100', '105']).chart
  assert.deepEqual(Object.keys(a.measures), ['95', '100', '105'])
  assert.equal(a.display, undefined)
  const b = analyzeSizeCharts(alpha, 'top', ['S/M', 'L']).chart
  assert.deepEqual(Object.keys(b.measures), ['S', 'M', 'L'])
  assert.equal(b.display, undefined)
  const shoeLike = analyzeSizeCharts([], 'top', ['블랙 270', '블랙 280'])
  assert.equal(shoeLike.chart, null, '옵션 2개만으로는 신발 표를 만들지 않음')
  assert.equal(analyzeSizeCharts([], 'top', ['블랙 270', '블랙 275', '블랙 280']).chart.category, 'shoes')
  assert.equal(analyzeSizeCharts([], 'top', ['블랙 271', '블랙 272', '블랙 273']).chart, null, '5mm 단위가 아니면 거부')
  const kr = analyzeSizeCharts([[['KR', '230', '240', '250'], ['US', '5', '6', '7']]], 'top', []).chart
  assert.deepEqual(Object.keys(kr.measures), ['230', '240', '250'])
  assert.equal(kr.category, 'shoes')
})

test('리뷰 사이즈: 사이즈표가 없을 때 2024 주문 같은 연도·숫자를 사이즈로 읽지 않는다', () => {
  for (const t of ['2024 주문 후 만족', '12024 구매', '가격 3,250 구매했어요']) assert.equal(parseReviewText(t, []).size, null, t)
  assert.equal(parseReviewText('265 주문했어요', []).size, '265')
})

const SIZE_ROWS_0_3 = [['0', '66', '50', '56', '60', '48'], ['1', '68', '52', '58', '61', '50'], ['2', '70', '54', '60', '62', '52'], ['3', '72', '56', '62', '63', '54']]
const tableHtml = (head, second) => `<html><body><h1>오버핏 맨투맨</h1><table>${[head, second, ...SIZE_ROWS_0_3].filter(Boolean).map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table></body></html>`

test('가짜 HTML: 후보1 모양(머리글에 실측 항목, 첫 열 0~3, 구매 옵션 없음)에서 사이즈표 4행을 읽는다', () => {
  const heads = [['사이즈 기장', '총장', '어깨너비', '가슴단면', '소매길이', '밑단'], ['총장', '총장', '어깨너비', '가슴단면', '소매길이', '밑단']]
  for (const head of heads) {
    for (const second of [['cm', 'cm', 'cm', 'cm', 'cm', 'cm'], ['MY', '', '', '', '', ''], ['', '', '', '', '', ''], null]) {
      const page = parsePage(fakeDocument(tableHtml(head, second)), 'https://example.com/p/1')
      assert.equal(page.sizeChart?.rows.length, 4, `${head[0]}/${second?.[0]}`)
      assert.deepEqual(Object.keys(page.sizeChart.measures), ['0', '1', '2', '3'])
      assert.equal(page.sizeChartMeta.namesFrom, 'normal-retry')
    }
  }
  const rep = formatReport(collectDiagnostics(fakeDocument(tableHtml(heads[0], ['cm', 'cm', 'cm', 'cm', 'cm', 'cm'])), 'https://shop.example/p/1', '0.1.0'))
  assert.match(rep, /정상 표로 재시도/)
})

test('가짜 HTML: 옵션 \'0 (S)\' 변형은 표 \'0\'과 이어져 원문 라벨로 보인다', () => {
  const opts = '<select><option>블랙 / 0 (S)</option><option>블랙 / 1 (M)</option><option>블랙 / 2 (L)</option><option>블랙 / 3 (XL)</option></select>'
  const html = tableHtml(['사이즈 기장', '총장', '어깨너비', '가슴단면', '소매길이', '밑단'], ['cm', 'cm', 'cm', 'cm', 'cm', 'cm']).replace('<h1>', `${opts}<h1>`)
  const page = parsePage(fakeDocument(html), '')
  assert.deepEqual(page.optionLabels, ['0 (S)', '1 (M)', '2 (L)', '3 (XL)'])
  assert.deepEqual(Object.keys(page.sizeChart.measures), ['0(S)', '1(M)', '2(L)', '3(XL)'])
  const ld = `<script type="application/ld+json">{"@type":"Product","name":"x","offers":[{"name":"블랙 / 0 (S)"},{"name":"블랙 / 1 (M)"}]}</script>`
  assert.deepEqual(parsePage(fakeDocument(`<html><body>${ld}<h1>x</h1></body></html>`), '').optionLabels, ['0 (S)', '1 (M)'])
})

test('가짜 HTML: 총장 67처럼 첫 열이 치수값이고 머리글이 실측 항목이 아니면 정상 표로 오인하지 않는다', () => {
  const rows = [['총장', '67', '69', '71'], ['어깨', '50', '52', '54']]
  assert.equal(analyzeSizeCharts([rows], 'top', []).chart, null)
  const page = parsePage(fakeDocument('<html><body><h1>x</h1><table><tr><td>총장</td><td>67</td></tr><tr><td>69</td><td>50</td></tr><tr><td>71</td><td>52</td></tr></table></body></html>'), '')
  assert.equal(page.sizeChart, null)
})

test('리뷰 구매옵션: 상품 사이즈 목록이 비어 있어도 마지막 칸 숫자·FREE·250을 사이즈로 읽는다 (가짜 글)', () => {
  assert.equal(parseReviewText('구매 옵션 블랙 · 1 키 175 몸무게 70', []).size, '1')
  assert.equal(parseReviewText('구매 옵션 그레이 · 2 (L)', []).size, 'L')
  assert.equal(parseReviewText('구매 옵션 블랙 · FREE', []).size, 'FREE')
  assert.equal(parseReviewText('구매 옵션 화이트 / 250', []).size, '250')
  assert.equal(parseReviewText('평소 L 입는데 잘 맞아요', []).size, null, '평소 L은 계속 차단')
  assert.equal(parseReviewText('구매 옵션 2024 좋아요', []).size, null)
  assert.equal(parseReviewText('구매 옵션 블랙 · 1', ['S', 'M']).size, null, '사이즈 목록이 있으면 목록과 맞을 때만')
})

test('가짜 HTML: 신발 사이즈표 변형(사이즈(mm) 줄, 발길이 열, 옵션만)도 읽는다', () => {
  const shoe = (html) => parsePage(fakeDocument(`<html><body><h1>러닝화</h1>${html}</body></html>`), '')
  const a = shoe('<table><tr><th>사이즈</th><th>발길이</th><th>발볼</th></tr><tr><td>mm</td><td>mm</td><td>mm</td></tr><tr><td>230</td><td>230</td><td>95</td></tr><tr><td>240</td><td>240</td><td>98</td></tr></table>')
  assert.deepEqual(Object.keys(a.sizeChart.measures), ['230', '240'])
  const b = shoe('<table><tr><td>KR</td><td>230</td><td>240</td><td>250</td></tr><tr><td>US</td><td>5</td><td>6</td><td>7</td></tr></table>')
  assert.deepEqual(Object.keys(b.sizeChart.measures), ['230', '240', '250'])
  const c = shoe('<select><option>화이트 / 250</option><option>화이트 / 255</option><option>화이트 / 260</option></select>')
  assert.deepEqual(Object.keys(c.sizeChart?.measures || {}), ['250', '255', '260'])
})

const sysPage = (name, head, rows, opts = '') => parsePage(fakeDocument(`<html><body>${opts}<h1>${name}</h1><table>${[head, ...rows].map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table></body></html>`), '')
const SYS_HEAD = ['사이즈', '총장', '어깨너비', '가슴단면', '소매길이']
const sysRows = (names) => names.map((n, i) => [n, 66 + i * 2, 48 + i * 2, 54 + i * 2, 60 + i])

test('가짜 HTML: 숫자 0~3 사이즈와 S~XL 글자 사이즈 표가 같은 실측 항목(가슴단면·어깨너비·소매길이·총장)을 읽는다', () => {
  for (const names of [['0', '1', '2', '3'], ['S', 'M', 'L', 'XL']]) {
    const page = sysPage('오버핏 맨투맨', SYS_HEAD, sysRows(names))
    assert.deepEqual(Object.keys(page.sizeChart.measures), names, names.join())
    const m = page.sizeChart.measures[names[0]]
    assert.equal(m.shoulder, 48)
    assert.equal(m.chest, 108, '가슴단면 54 x 2')
    assert.equal(m.arm, 60)
    assert.equal(m.topLength, 66)
  }
})

test('가짜 HTML: 2XL·XXL·3XL·FREE, 여성 44/55/66/77, 90~110 사이즈를 표와 옵션에서 읽는다', () => {
  for (const names of [['L', 'XL', '2XL', '3XL'], ['M', 'L', 'XL', 'XXL'], ['FREE'], ['44', '55', '66', '77'], ['90', '95', '100', '105', '110']]) {
    const page = sysPage('코튼 셔츠', SYS_HEAD, sysRows(names))
    assert.deepEqual(Object.keys(page.sizeChart?.measures || {}), names.map((n) => n), names.join())
  }
  const opts = '<select><option>44</option><option>55</option><option>66</option><option>77</option></select>'
  assert.deepEqual(parsePage(fakeDocument(`<html><body>${opts}<h1>x</h1></body></html>`), '').optionLabels, ['44', '55', '66', '77'])
  const opts2 = '<select><option>3XL</option><option>FREE</option><option>XXL</option></select>'
  assert.deepEqual(parsePage(fakeDocument(`<html><body>${opts2}<h1>x</h1></body></html>`), '').optionLabels, ['3XL', 'FREE', 'XXL'])
})

test('가짜 HTML: 바지 인치 28~34 허리·허벅지 표는 하의이고 신발로 읽지 않는다', () => {
  const head = ['사이즈', '총장', '허리단면', '허벅지단면', '밑위']
  const rows = [['28', 100, 37, 30, 28], ['30', 101, 39, 31, 28.5], ['32', 102, 41, 32, 29], ['34', 103, 43, 33, 29.5]]
  const page = sysPage('와이드 팬츠', head, rows)
  assert.deepEqual(Object.keys(page.sizeChart.measures), ['28', '30', '32', '34'])
  assert.equal(page.category, 'bottom')
  assert.equal(page.sizeChart.measures['28'].waist, 74)
})

test('가짜 HTML: 230부터 시작하는 신발 표와 옵션만 있는 신발은 shoes와 발길이로 읽는다', () => {
  const sizes = ['230', '235', '240', '250', '260', '270', '280']
  const table = sysPage('캔버스 운동화', ['사이즈(mm)', '발길이'], sizes.map((n) => [n, n]))
  assert.equal(table.category, 'shoes')
  assert.equal(table.sizeChart.measures['230'].footLength, 230)
  assert.deepEqual(Object.keys(table.sizeChart.measures), sizes)
  // 상품명에 신발 단어가 없어도 JSON-LD category/빵부스러기 또는 mm 줄로 알아본다
  const ld = '<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[{"name":"신발"},{"name":"스니커즈"}]}</script>'
  const optHtml = sizes.slice(0, 4).map((n) => `<option>화이트 / ${n}</option>`).join('')
  for (const extra of ['', ld]) {
    const p = parsePage(fakeDocument(`<html><body>${extra}<h1>모델 A</h1><select>${optHtml}</select></body></html>`), '')
    assert.equal(p.category, 'shoes')
    assert.deepEqual(Object.keys(p.sizeChart.measures), ['230', '235', '240', '250'])
    assert.equal(p.sizeChart.measures['230'].footLength, 230)
  }
  const kr = parsePage(fakeDocument(`<html><body><h1>모델 B</h1><table><tr><td>KR</td><td>230</td><td>235</td><td>240</td></tr></table></body></html>`), '')
  assert.equal(kr.category, 'shoes')
  const cat = parsePage(fakeDocument('<html><body><script type="application/ld+json">{"@type":"Product","name":"모델 C","category":"신발 > 스니커즈"}</script><h1>모델 C</h1></body></html>'), '')
  assert.equal(cat.category, 'shoes')
})

test('가짜 HTML: 의류 옵션(95/100/105, 28~34, S~XL)과 총장 67은 신발로 오인하지 않는다', () => {
  for (const labels of [['95', '100', '105'], ['28', '30', '32', '34'], ['S', 'M', 'L', 'XL'], ['0', '1', '2', '3']]) {
    const o = labels.map((n) => `<option>${n}</option>`).join('')
    const p = parsePage(fakeDocument(`<html><body><h1>니트 가디건</h1><select>${o}</select></body></html>`), '')
    assert.notEqual(p.category, 'shoes', labels.join())
  }
  assert.equal(analyzeSizeCharts([[['총장', '67', '69', '71'], ['어깨', '50', '52', '54']]], 'top', []).chart, null)
})

test('발길이 범위: 210~310mm만 유효하고 230부터 시작하는 신발 사이즈는 모두 범위 안이다', async () => {
  const { inFieldRange, SHOE_SIZES } = await import('../src/data/measurements.js')
  assert.ok(inFieldRange('footLength', 230) && inFieldRange('footLength', 210) && inFieldRange('footLength', 310))
  assert.ok(!inFieldRange('footLength', 67) && !inFieldRange('footLength', 205) && !inFieldRange('footLength', 320))
  assert.ok(SHOE_SIZES.every((n) => inFieldRange('footLength', n)))
})

test('확장 카드 CSS: 근거 요약은 배경 박스 없이 12px, 글꼴은 한글 폰트 우선', () => {
  const js = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8')
  assert.ok(js.includes('.sum{margin:8px 0 0;color:#555;font-size:12px}'))
  assert.ok(js.includes("font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',-apple-system"))
})

test('색 대비: 제목·막대 색이 흰/연회색 배경에서 기준(글자 4.5:1, 막대 3:1) 이상이다 (계산, 실제 화면 확인 아님)', () => {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
  const v = (name) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))[1]
  for (const [name, bg] of [['tone-measure', '#ffffff'], ['tone-review', '#ffffff'], ['tone-chart', '#ffffff'], ['tone-tryon', '#ffffff'], ['tone-reco', '#f3faf6'], ['muted-2', '#ffffff']]) assert.ok(ratio(v(name), bg) >= 4.5, name)
  assert.ok(ratio(css.match(/\.tone-compare \{[^}]*--tone-text: (#[0-9a-f]{6})/i)[1], '#ffffff') >= 4.5, 'compare 제목')
  assert.ok(ratio(css.match(/\.tone-feedback \{[^}]*--tone-text: (#[0-9a-f]{6})/i)[1], '#ffffff') >= 4.5, 'feedback 제목')
  for (const c of ['#80808a', '#b8650a']) assert.ok(ratio(c, '#f4f4f5') >= 3, `막대 ${c}`)
})

// ---- FEAT-002: 실측 머리글 동의어, 부위별 비교(sizeCompare), 표 여러 개 중 실측표 선택 (직접 만든 가짜 HTML이며 실제 무신사 확인이 아니에요) ----
test('가짜 HTML: 머리글 동의어 변형이 같은 부위로 읽히고 단면은 둘레로, 길이는 그대로 읽는다', () => {
  const cases = [
    ['전체길이', 'topLength', 70, 70], ['기장', 'topLength', 70, 70], ['어깨', 'shoulder', 48, 48], ['가슴단면', 'chest', 54, 108], ['가슴둘레', 'chest', 108, 108],
    ['품', 'chest', 55, 110], ['화장', 'arm', 60, 60], ['팔길이', 'arm', 60, 60], ['소매통', 'sleeveWidth', 20, 40], ['암홀', 'sleeveWidth', 24, 48], ['소매단면', 'sleeveWidth', 18, 36],
    ['허리둘레', 'waist', 76, 76], ['힙', 'hip', 98, 98], ['엉덩이단면', 'hip', 50, 100], ['허벅지', 'thigh', 60, 60], ['밑위길이', 'rise', 29, 29],
    ['밑단단면', 'hem', 20, 40], ['무릎단면', 'knee', 22, 44],
  ]
  for (const [head, key, raw, expect] of cases) {
    const page = sysPage('티셔츠', ['사이즈', head], [['S', raw], ['M', raw + 1]])
    assert.equal(page.sizeChart?.measures?.S?.[key], expect, `${head} -> ${key}`)
  }
})

test('가짜 HTML: 하의 허리단면·허벅지단면·밑위·밑단·총장 + 인치 28~34는 둘레로 바꾸고 밑위·밑단을 따로 읽는다', () => {
  const head = ['사이즈', '총장', '허리단면', '허벅지단면', '밑위', '밑단단면']
  const rows = [['28', 100, 37, 30, 28, 18], ['30', 101, 39, 31, 28.5, 18.5], ['32', 102, 41, 32, 29, 19], ['34', 103, 43, 33, 29.5, 19.5]]
  const page = sysPage('와이드 팬츠', head, rows)
  assert.equal(page.category, 'bottom')
  assert.deepEqual(page.sizeChart.measures['30'], { inseam: 101, waist: 78, thigh: 62, rise: 28.5, hem: 37 })
  assert.deepEqual(page.sizeChart.view.keys, ['inseam', 'waist', 'thigh', 'rise', 'hem'])
  assert.ok(page.sizeChart.view.used.every(Boolean), '읽은 열이 모두 계산에 쓰이는 열로 표시돼요')
})

test('가짜 HTML: 신발 230~280 mm + 발볼은 발길이와 발볼(mm)로 읽는다', () => {
  const sizes = ['230', '240', '250', '260', '270', '280']
  const page = sysPage('캔버스 운동화', ['사이즈(mm)', '발길이', '발볼'], sizes.map((n, i) => [n, n, 95 + i * 2]))
  assert.equal(page.category, 'shoes')
  assert.equal(page.sizeChart.measures['230'].footLength, 230)
  assert.equal(page.sizeChart.measures['230'].footWidth, 95)
  const cm = sysPage('캔버스 운동화', ['사이즈(mm)', '발길이', '발볼(cm)'], sizes.map((n, i) => [n, n, 9.5 + i * 0.2]))
  assert.equal(cm.sizeChart.measures['230'].footWidth, 95, 'cm로 적힌 발볼은 mm로 바꿔요')
})

test('가짜 HTML: 1~4 수량 select는 사이즈 옵션으로 읽지 않는다', () => {
  const qty = fakeDocument(wrapBody('<select><option>1</option><option>2</option><option>3</option><option>4</option></select>'))
  assert.deepEqual(readOptionLabels(qty), [])
  const sized = fakeDocument(wrapBody('<select><option>M</option><option>L</option></select>'))
  assert.deepEqual(readOptionLabels(sized), ['M', 'L'])
})

test('가짜 HTML: 굽높이가 mm(50)로 적힌 표는 cm(5)로 읽고 cm 표기는 그대로 둔다', () => {
  const sizes = ['230', '240', '250']
  const mm = sysPage('앵클 부츠', ['사이즈(mm)', '발길이', '굽높이'], sizes.map((n, i) => [n, n, 50 + i * 5]))
  assert.equal(mm.sizeChart.measures['230'].heelHeight, 5)
  const cm = sysPage('앵클 부츠', ['사이즈(mm)', '발길이', '굽높이(cm)'], sizes.map((n, i) => [n, n, 4.5 + i]))
  assert.equal(cm.sizeChart.measures['230'].heelHeight, 4.5)
})

test('진단: 비교 표 생성 실패는 진단 줄에 남고, 확장 비교 값에는 쓰지 않는 필드가 없다', () => {
  const doc = fakeDocument('<html><body><h1>니트</h1></body></html>')
  assert.ok(diagnosticLines(collectDiagnostics(doc, '', '', { compareFailed: true })).some((l) => l.includes('비교 표')))
  assert.ok(!diagnosticLines(collectDiagnostics(doc, '', '')).some((l) => l.includes('비교 표')))
  const r = analyzePage(fakeDocument(EXT_HTML), 'https://shop.example/p/1', buildProfile({ gender: 'male', height: '175', weight: '70', preferredFit: 'regular', measurements: {} }).profile)
  assert.ok(!('measureOnlyLabel' in (r.compareView || {})))
})

test('웹 SizeChart: 사이즈 행 선택은 키보드로 누를 수 있는 버튼을 쓴다', () => {
  const src = readFileSync(resolvePath('src/components/SizeChart.jsx'), 'utf8')
  assert.ok(/<button type="button" className="row-select"/.test(src))
})

test('가짜 HTML: 표가 2개면 추천 키·몸무게 표나 부위가 적은 안내표보다 실측표를 고른다', () => {
  const guide = `<table><tr><td>사이즈</td><td>추천 키</td><td>추천 몸무게</td></tr><tr><td>S</td><td>165</td><td>55</td></tr><tr><td>M</td><td>175</td><td>65</td></tr><tr><td>L</td><td>180</td><td>75</td></tr></table>`
  const real = `<table>${[SYS_HEAD, ...sysRows(['S', 'M', 'L'])].map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`
  for (const html of [guide + real, real + guide]) {
    const { chart, meta } = analyzeSizeCharts([...fakeDocument(`<html><body>${html}</body></html>`).querySelectorAll('table')].map((t) => [...t.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td')].map((c) => c.textContent.trim()))), 'top', [])
    assert.equal(chart.measures.M.chest, 112)
    assert.equal(chart.view.ignored.length, 1)
    assert.equal(chart.view.ignored[0].kind, 'recommend')
    assert.ok(meta.candidates.some((c) => c.reason === 'selected'))
  }
  // 가슴만 있는 안내표(2열)와 실측표가 같이 있으면 읽을 수 있는 열이 많은 실측표를 골라요.
  const small = [['사이즈', '가슴'], ['S', '90'], ['M', '95'], ['L', '100']]
  const full = [SYS_HEAD, ...sysRows(['S', 'M', 'L']).map((r) => r.map(String))]
  assert.equal(analyzeSizeCharts([small, full], 'top', []).chart.view.headers.length, 4)
  // 상의 상품이면 상의 실측표를, 하의 상품이면 하의 실측표를 골라요.
  const bottom = [['사이즈', '총장', '허리단면', '허벅지단면'], ['S', '100', '37', '30'], ['M', '101', '39', '31'], ['L', '102', '41', '32']]
  assert.ok(analyzeSizeCharts([bottom, full], 'top', []).chart.measures.M.shoulder != null)
  assert.ok(analyzeSizeCharts([full, bottom], 'bottom', []).chart.measures.M.waist != null)
})

test('sizeCompare: 사이즈별 내 치수·옷 실측·여유·판정을 만들고 비교 기준 없는 부위는 실측만 표시한다', () => {
  const page = sysPage('와이드 팬츠', ['사이즈', '총장', '허리단면', '허벅지단면', '밑위', '밑단단면'], [['28', 100, 37, 30, 28, 18], ['32', 102, 41, 32, 29, 19]])
  const body = bodyValuesForProfile({ gender: 'male', height: 175, weight: 70, measurements: { waist: 76 } })
  const cmp = compareSizes({ chart: page.sizeChart, bodyValues: body.values, measured: body.measured, category: 'bottom' })
  assert.deepEqual(cmp.sizes.map((x) => x.size), ['28', '32'])
  const rows = Object.fromEntries(cmp.sizes[0].rows.map((r) => [r.part, r]))
  assert.equal(rows.waist.garment, 74)
  assert.equal(rows.waist.body, 76)
  assert.equal(rows.waist.bodyKind, 'measured')
  assert.equal(rows.waist.ease, -2)
  assert.ok(rows.waist.verdict)
  assert.equal(rows.thigh.bodyKind, 'estimated')
  assert.equal(rows.inseam.bodyKind, 'standard')
  assert.equal(rows.inseam.basis, 'heuristic')
  for (const part of ['rise', 'hem']) {
    assert.equal(rows[part].verdict, null)
    assert.equal(rows[part].body, null)
    assert.equal(rows[part].note, MEASURE_ONLY_LABEL)
  }
  assert.deepEqual(cmp.measureOnlyParts.sort(), ['hem', 'rise'])
  assert.equal(rows.hem.garment, 36)
  // 기존 판정과 같아요
  assert.equal(rows.waist.verdict, partVerdicts(body.values, page.sizeChart.measures['28'], 'bottom').find((v) => v.part === 'waist').verdict)
  assert.deepEqual(compareSizes({ chart: null }), { sizes: [], measureOnlyParts: [], hasComparable: false })
})

await atest('가짜 HTML + vm: 확장 카드에 사이즈 탭과 내 치수/옷 실측/여유/판정 비교 표가 그려지고 비교 기준 없는 부위는 실측만 표시로 나온다', async () => {
  const head = ['사이즈', '총장', '허리단면', '허벅지단면', '밑위', '밑단단면']
  const rows = [['28', 100, 37, 30, 28, 18], ['30', 101, 39, 31, 28.5, 18.5], ['32', 102, 41, 32, 29, 19], ['34', 103, 43, 33, 29.5, 19.5]]
  const html = `<html><head><meta property="og:title" content="와이드 팬츠"></head><body><h1>와이드 팬츠</h1><table>${[head, ...rows].map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>${VIEW_REVIEWS.map((t) => `<div class="review-item">${t}</div>`).join('')}</body></html>`
  const { texts, created } = await runContentInFakeDom(html)
  assert.ok(!texts.some((t) => t.includes('분석 중 문제가 생겼어요')))
  assert.ok(texts.includes('사이즈표 비교 (내 치수 vs 옷 실측)'), '비교 섹션')
  for (const h of ['부위', '내 치수', '옷 실측', '여유', '판정']) assert.ok(texts.includes(h), h)
  // 카드를 다시 그리는 경우가 있어 마지막으로 그린 4개 탭만 봅니다.
  const allTabs = created.filter((e) => e.tagName === 'BUTTON' && e.className.split(' ').includes('tab'))
  assert.ok(allTabs.length >= 4 && allTabs.length % 4 === 0)
  const tabs = allTabs.slice(-4)
  assert.ok(tabs.some((t) => t.className.includes('on')))
  assert.ok(texts.includes('실측만 표시(비교 기준 없음)'), '밑위·밑단은 비교 기준이 없다고 표시')
  assert.ok(texts.includes('밑위') && texts.includes('밑단') && texts.includes('허리'))
  // 탭을 누르면 그 사이즈의 표가 보여요
  const panels = created.filter((e) => e.tagName === 'DIV' && e.className === 'tw' && e.children[0]?.tagName === 'TABLE' && e.children[0].children[0]?.children[1]?._text === '내 치수')
  assert.ok(panels.length >= 4)
  const last = panels.slice(-4)
  assert.deepEqual(last.map((p) => p.hidden), [false, true, true, true])
  tabs[2]._l.click()
  assert.deepEqual(last.map((p) => p.hidden), [true, true, false, true])
})

// ---- 사이즈표 요약 (가짜 데이터) ----
const ssRow = (label, garment, extra = {}) => ({ label, unit: 'cm', garment, body: null, verdict: null, ...extra })
const ssSizes = (labels, rowsOf) => labels.map((l, i) => ({ size: l, label: l, rows: rowsOf(i) }))
const topRows = (i) => [ssRow('어깨', 44 + i * 2, { body: 45, verdict: '넉넉' }), ssRow('가슴', 52 + i * 4, { body: 53, verdict: '적당' }), ssRow('팔길이', 60), ssRow('총장', 67 + i * 2, { body: 68, verdict: '짧은 편' })]

test('sizeSummary: 상의는 어깨·가슴·소매·총장과 위·아래 사이즈 차이, 한 줄 판정을 준다', () => {
  const sm = summarizeSizeChart({ sizes: ssSizes(['S', 'M', 'L'], topRows), recommended: 'M', category: 'top' })
  assert.equal(sm.status, 'ok')
  assert.deepEqual(sm.sizes, ['S', 'M', 'L'])
  assert.equal(sm.recommended, 'M')
  assert.deepEqual(sm.keyParts.map((k) => k.label), ['어깨', '가슴', '팔길이', '총장'])
  assert.equal(sm.neighbors.lowerDiff, 'S보다 어깨 +2cm, 가슴 +4cm, 총장 +2cm')
  assert.equal(sm.neighbors.upperDiff, 'L보다 어깨 -2cm, 가슴 -4cm, 총장 -2cm')
  assert.equal(sm.verdictLine, '어깨 넉넉 · 가슴 적당 · 총장 짧은 편')
})

test('sizeSummary: 하의·신발은 각자 핵심 부위를 고르고 최대 4개다', () => {
  const bottom = summarizeSizeChart({ sizes: ssSizes(['28', '30'], (i) => [ssRow('총장', 100), ssRow('허리', 37 + i * 2), ssRow('엉덩이', 50), ssRow('허벅지', 30), ssRow('밑위', 28), ssRow('밑단', 18)]), recommended: '28', category: 'bottom' })
  assert.deepEqual(bottom.keyParts.map((k) => k.label), ['허리', '허벅지', '밑위', '총장'])
  assert.equal(bottom.neighbors.lowerDiff, null)
  assert.equal(bottom.neighbors.upperDiff, '30보다 허리 -2cm')
  const shoes = summarizeSizeChart({ sizes: ssSizes(['250', '260'], (i) => [{ ...ssRow('발길이', 250 + i * 10), unit: 'mm' }, { ...ssRow('발볼', 100), unit: 'mm' }]), recommended: '250', category: 'shoes' })
  assert.deepEqual(shoes.keyParts.map((k) => `${k.label}${k.value}${k.unit}`), ['발길이250mm', '발볼100mm'])
  assert.equal(shoes.neighbors.upperDiff, '260보다 발길이 -10mm')
})

test('sizeSummary: 맨 위 사이즈는 아래쪽만, 맨 아래 사이즈는 위쪽만 차이를 준다', () => {
  const sizes = ssSizes(['S', 'M', 'L'], topRows)
  const top = summarizeSizeChart({ sizes, recommended: 'L', category: 'top' })
  assert.ok(top.neighbors.lowerDiff && top.neighbors.upperDiff === null)
  const low = summarizeSizeChart({ sizes, recommended: 's', category: 'top' })
  assert.ok(low.neighbors.lowerDiff === null && low.neighbors.upperDiff)
})

test('sizeSummary: 같은 값은 차이에서 빼고, 모두 같으면 차이를 생략한다', () => {
  const same = summarizeSizeChart({ sizes: ssSizes(['M', 'L'], () => [ssRow('어깨', 50), ssRow('가슴', 57)]), recommended: 'M', category: 'top' })
  assert.deepEqual(same.neighbors, { lowerDiff: null, upperDiff: null })
  const part = summarizeSizeChart({ sizes: ssSizes(['M', 'L'], (i) => [ssRow('어깨', 50), ssRow('가슴', 57 + i * 3)]), recommended: 'M', category: 'top' })
  assert.equal(part.neighbors.upperDiff, 'L보다 가슴 -3cm')
})

test('sizeSummary: 내 치수가 없으면 판정 줄이 없고, 추천이 없으면 실측·차이도 없다', () => {
  const sizes = ssSizes(['M', 'L'], () => [ssRow('어깨', 50), ssRow('가슴', 57)])
  assert.equal(summarizeSizeChart({ sizes, recommended: 'M', category: 'top' }).verdictLine, null)
  const none = summarizeSizeChart({ sizes, recommended: null, category: 'top' })
  assert.equal(none.status, 'ok')
  assert.deepEqual([none.recommended, none.keyParts, none.verdictLine], [null, [], null])
})

test('sizeSummary: 표를 못 읽으면 none과 안내를 준다', () => {
  for (const input of [undefined, {}, { sizes: [] }, { sizes: [{ size: 'M', label: 'M', rows: [] }] }]) {
    const sm = summarizeSizeChart(input)
    assert.equal(sm.status, 'none')
    assert.equal(sm.message, NO_CHART_MESSAGE)
    assert.deepEqual(sm.sizes, [])
  }
})

test('sizeSummary: 사이즈 이름은 원문 라벨 그대로고, 직렬화해도 같다', () => {
  const sizes = [{ size: '1', label: '1 (M)', rows: [ssRow('어깨', 50)] }, { size: '2', label: '2 (L)', rows: [ssRow('어깨', 52)] }]
  const sm = summarizeSizeChart({ sizes, recommended: '1', category: 'top' })
  assert.deepEqual(sm.sizes, ['1 (M)', '2 (L)'])
  assert.equal(sm.recommended, '1 (M)')
  assert.equal(sm.neighbors.upperDiff, '2 (L)보다 어깨 -2cm')
  assert.deepEqual(JSON.parse(JSON.stringify(sm)), sm)
})

test('확장 분석: 사이즈표가 있으면 sizeSummary가 ok, 없으면 none이다', () => {
  const profile = buildProfile({ gender: 'male', height: '175', weight: '70' }).profile
  const r = analyzePage(fakeDocument(VIEW_HTML(chartTable(OPTION_LIST_LABELS()))), '', profile)
  assert.equal(r.sizeSummary.status, 'ok')
  assert.ok(r.sizeSummary.sizes.length >= 2 && r.sizeSummary.keyParts.length >= 1)
  assert.equal(r.sizeSummary.recommended !== null, r.recommendedSize != null)
  const nochart = analyzePage(fakeDocument(wrapBody(NOCHART_HTML)), '', profile)
  assert.equal(nochart.status, 'ok')
  assert.equal(nochart.sizeSummary.status, 'none')
})

await atest('content.js(가짜 DOM, vm): 사이즈표 요약 블록과 자세히 보기가 나오고 누르면 비교 구역이 열린다', async () => {
  const { texts, created } = await runContentInFakeDom(VIEW_HTML(chartTable(OPTION_LIST_LABELS())))
  assert.ok(!texts.some((t) => t.includes('분석 중 문제가 생겼어요')))
  assert.ok(texts.includes('사이즈표 요약'))
  assert.ok(texts.some((t) => /실측 .*\d+cm/.test(t) && t.length < 80), '추천 사이즈 실측 한 줄')
  const more = created.find((e) => e.className === 'lnk' && e.textContent === '자세히 보기')
  assert.ok(more, '자세히 보기 링크')
  const cp = created.find((e) => e.tagName === 'DETAILS' && e.children[0]?.textContent?.startsWith('사이즈표 비교'))
  cp.open = false
  more._l.click()
  assert.equal(cp.open, true)
})

await atest('content.js(가짜 DOM, vm): 표를 못 읽으면 안내와 사이즈표 직접 입력 링크가 나온다', async () => {
  const { texts, created } = await runContentInFakeDom(wrapBody(NOCHART_HTML))
  assert.ok(texts.includes('사이즈표 요약') && texts.includes(NO_CHART_MESSAGE))
  const link = created.find((e) => e.className === 'lnk' && e.textContent === '사이즈표 직접 입력')
  assert.ok(link, '직접 입력 링크')
  link._l.click()
  link._l.click()
  assert.equal(created.filter((e) => e.tagName === 'TEXTAREA').length, 1, '두 번 눌러도 양식은 하나예요')
  assert.equal(created.filter((e) => e.textContent === '이 표로 다시 분석').length, 1, '다시 분석 버튼도 하나예요')
})

test('content.js CSS(소스 분석): 사이즈표 요약 글자·칩 대비가 4.5:1 이상이다', () => {
  const src = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8')
  const hex = (c) => { const h = c.replace('#', ''); const f = h.length === 3 ? [...h].map((x) => x + x).join('') : h; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255) }
  const lum = (c) => { const [r, g, b] = hex(c).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
  const rule = (sel) => src.match(new RegExp(`^${sel.replace(/[.]/g, '\\.')}\\{([^}]*)\\}$`, 'm'))?.[1] || ''
  const col = (decl, name) => decl.match(new RegExp(`(?:^|;)${name}:(#[0-9a-fA-F]{3,6})`))?.[1]
  const on = rule('.ssc span.on')
  assert.ok(ratio(col(on, 'color'), col(on, 'background')) >= 4.5, '선택 칩')
  assert.ok(ratio(col(rule('.ssc span'), 'color'), '#ffffff') >= 4.5, '일반 칩')
  assert.ok(ratio(col(rule('.ss .sst'), 'color'), '#ffffff') >= 4.5, '제목')
  assert.ok(ratio(col(rule('.ss p'), 'color'), '#ffffff') >= 4.5, '본문')
  assert.ok(ratio(col(rule('.ss p.tiny'), 'color'), '#ffffff') >= 4.5, '보조 글')
})

console.log(`\n${passed}개 통과`)
