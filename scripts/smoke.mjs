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
import { parseReviewText, analyzeSizeCharts, stripColumnNumbers } from '../src/lib/productCore.js'
import { parseProductHtml } from '../server/productParser.js'
import { setRectProvider, readOptionLabels, parsePage, isProductPage, splitSentences, extractCardView, parseGender } from '../src/lib/pageParser.js'
import { analyzePage, manualChartRows } from '../src/lib/extAnalyze.js'
import { collectDiagnostics, diagnosticLines, formatReport, REPORT_MAX } from '../src/lib/diagnose.js'
import { buildExportEnvelope, parseEnvelopeData, parseImportText, sanitizeItem, addImportedItem, LIMITS as IMPORT_LIMITS } from '../src/lib/wardrobeImport.js'
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
import { isPrivateIp, decodeHtml, safeLookup } from '../server/safeFetch.js'
import { checkPostRequest } from '../server/api.js'
import {
  parseHeightCm, parseWeightKg, normalizeFit, normalizeRow, normalizeLines,
  confusionMatrix, accuracy, precisionRecall, neighborVotePredictions, trueRateByBucket, evaluate,
} from './lib/fitMetrics.mjs'
import { bodySimilarity, splitReviews, matchReviews, BODY_SIM } from '../src/lib/fitEngine.js'
import { runHfTryOn, parseSse, spaceBaseUrl, isValidSpaceId, clearTryOnCache, garmentDescription, isTryOnSupported, DEFAULT_SPACE } from '../server/hfTryOn.js'

import { toContribution, toBand, toDomain, contributionKey, ALLOWED_DOMAINS, SCHEMA_VERSION } from '../src/lib/contribution.js'
import { MAX_STEPS, MAX_MS, STALL_LIMIT, STOP_REASONS, AUTO_TARGET, MORE_STEP, shouldStop, isSafeMoreButton, isReviewTab, isInnerScroller, loadTarget, loadResultText, toReportStop } from '../src/lib/reviewLoader.js'
import { CONSENT_SUMMARY, CONSENT_VERSION } from '../src/data/consent.js'
import { loadConsent, purgeStaleConsent, saveConsent, enqueueContribution, loadContribQueue, recordsForUpload } from '../src/lib/storage.js'

import { toSamples, mergeSamples } from '../src/lib/learnSamples.js'
import { trainModel, validateModel, resolveLearned, learningStatus, emptyModel, LEARN, LEARN_SCHEMA_VERSION, brandKeyOf } from '../src/lib/learnedModel.js'
import { LEARN_KEY, localAdapter, chromeAdapter, loadLearning, addSamples, resetLearning, learnFromProduct } from '../src/lib/learnStore.js'
import { EASE_RULES, classifyEase } from '../src/lib/fitEngine.js'
import { classifyBrandRegion, regionLine, regionKeyOf, BRAND_REGION_DICT, REGION_SCORE, REGION_HYPOTHESIS_NOTE } from '../src/lib/brandRegion.js'
import { representativeMeasure, sizeSystemHint, SIZE_SYSTEM_FLAG } from '../src/lib/sizeSystems.js'
import { createSizeChartDb, SIZE_CHART_DB_KEY, SIZE_CHART_DB_VERSION, normalizeText, normalizeCode, brandKeyOfName, modelSimilarity, modelTokens, chartRecordFromProduct, toEntry } from '../src/lib/sizeChartDb.js'

import { USED_SITES, USED_SITES_NOTE, usedSiteOf, parseListingText, readListing, listingText, isUsedListingPage } from '../src/lib/usedListing.js'
import { analyzeUsedListing, findChartMatches, usedSearchQuery, usedVerdictFrom, USED_DB_MIN_SCORE, USED_NO_REVIEW_NOTE } from '../src/lib/usedAnalyze.js'
import { createImageSearcher, IMAGE_SEARCH_DISABLED_TEXT } from '../src/lib/imageSearch.js'
import { createLabelReader, LABEL_OCR_DISABLED_TEXT } from '../src/lib/labelOcr.js'
import {
  DEMO_NOTE, NO_DATA_MESSAGE, wilson, assignFolds, predictFromEase, withinSizes, sizeOrderOf, eligibleReview, parseEvalInput,
  summarizeLabels, summarizeSizes, judge, evaluateReviews, evaluateSamples, makeDemoDataset, formatReport as formatEvalReport,
} from './lib/fitEval.mjs'
import { runEvalCli } from './lib/evalCli.mjs'
import { buildLearnExport, EXPORT_KIND } from '../src/lib/learnExport.js'

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

await atest('safeLookup(DNS 리바인딩 방지): 접속 순간 내부 IP면 거부하고, 실제 요청이 이 lookup을 쓴다', async () => {
  const run = (opts) => new Promise((r) => safeLookup('localhost', opts, (e, a) => r(e ? e.code : a)))
  assert.equal(await run({}), 'BLOCKED')
  assert.equal(await run({ all: true }), 'BLOCKED')
  const code = readFileSync(new URL('../server/safeFetch.js', import.meta.url), 'utf8')
  assert.ok(/lookup:\s*safeLookup/.test(code), 'request()가 safeLookup으로 접속해야 해요')
  assert.ok(!/\bfetch\(/.test(code), '전역 fetch는 lookup을 고정하지 못해서 쓰지 않아요')
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
  // 쇼핑몰마다 한 줄씩 늘어나요. 너무 넓은 주소는 checkManifest가 따로 막아요.
  assert.ok(EXT_MANIFEST.content_scripts[0].matches.length <= 10)
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
  assert.ok(src.includes('count, total, target }') && !src.includes('total: null'))
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
  assert.equal(shouldStop({ count: 30, target: 30 }), 'reached-target')
  assert.equal(shouldStop({ count: 29, target: 30 }), null)
  assert.equal(toReportStop('reached-target'), 'limit')
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

test('reviewLoader: 자동은 30건까지, 더 불러오기는 누를 때마다 지금 + 10건이 목표다', () => {
  assert.equal(AUTO_TARGET, 30)
  assert.equal(MORE_STEP, 10)
  assert.equal(loadTarget(11, 'auto'), 30)
  assert.equal(loadTarget(11, 'more'), 21)
  assert.equal(loadTarget(30, 'more'), 40)
  assert.equal(loadTarget(null, 'more'), 10)
})

test('reviewLoader.isSafeMoreButton: 후기·리뷰 더보기, 다음, 바로 다음 쪽 번호만 허용하고 구매·쿠폰 같은 버튼은 막는다', () => {
  const inReview = { inReviewContainer: true, currentPage: 1 }
  for (const t of ['후기 더보기', '리뷰 더보기', '리뷰 더 보기', '더보기', '다음', '다음 페이지', '2'])
    assert.equal(isSafeMoreButton(t, inReview), true, t)
  for (const t of ['구매하기', '장바구니', '좋아요', '쿠폰 받기', '주문하기', '결제', '찜하기', '공유', '댓글 3', '3', '1', '0', '다음 쿠폰', '쿠폰 더보기', '이전', '후기 작성'])
    assert.equal(isSafeMoreButton(t, inReview), false, t)
  assert.equal(isSafeMoreButton('2', { inReviewContainer: true }), false, '지금 쪽을 모르면 쪽 번호는 누르지 않아요')
  assert.equal(isSafeMoreButton('2', { inReviewContainer: false, currentPage: 1 }), false, '리뷰 영역 밖 쪽 번호')
  assert.equal(isSafeMoreButton('다음', { inReviewContainer: false }), false, '리뷰 영역 밖 다음')
  assert.equal(isSafeMoreButton('4', { inReviewContainer: true, currentPage: 3 }), true)
})

test('reviewLoader.isReviewTab: 탭이라고 밝힌 아직 안 열린 리뷰 탭만 누른다', () => {
  for (const t of ['스냅·후기', '스냅 · 후기', '후기', '리뷰', '후기 1,234', '스냅·후기(733)', '리뷰 (12)'])
    assert.equal(isReviewTab(t, { role: 'tab' }), true, t)
  assert.equal(isReviewTab('스냅·후기', { inTablist: true, href: '#review' }), true)
  assert.equal(isReviewTab('스냅·후기', { role: null, inTablist: false }), false, '탭이라고 밝히지 않은 요소')
  assert.equal(isReviewTab('스냅·후기', { role: 'tab', selected: true }), false, '이미 열린 탭')
  assert.equal(isReviewTab('스냅·후기', { role: 'tab', href: '/review/goods/1' }), false, '다른 페이지 링크')
  for (const t of ['후기 작성', '리뷰 쓰고 쿠폰 받기', '상품정보', '구매후기 이벤트', '스냅', ''])
    assert.equal(isReviewTab(t, { role: 'tab' }), false, t)
  assert.equal(isReviewTab('후기', null), false)
})

test('reviewLoader.isInnerScroller: overflow-y가 auto/scroll이고 내용이 더 길 때만 안쪽 스크롤 상자다', () => {
  assert.equal(isInnerScroller({ overflowY: 'auto', scrollHeight: 2000, clientHeight: 500 }), true)
  assert.equal(isInnerScroller({ overflowY: 'scroll', scrollHeight: 2000, clientHeight: 500 }), true)
  assert.equal(isInnerScroller({ overflowY: 'visible', scrollHeight: 2000, clientHeight: 500 }), false)
  assert.equal(isInnerScroller({ overflowY: 'auto', scrollHeight: 500, clientHeight: 500 }), false)
  assert.equal(isInnerScroller({ overflowY: 'auto', scrollHeight: 500, clientHeight: 0 }), false)
  assert.equal(isInnerScroller(), false)
})

test('reviewLoader.loadResultText: 늘면 더 불러온 건수와 총 건수, 안 늘면 이유를 알려주고 "N건에서 N건으로"는 쓰지 않는다', () => {
  assert.equal(loadResultText({ before: 11, after: 21, reason: 'reached-target', clicked: true }), '리뷰 10건을 더 불러왔어요(총 21건)')
  assert.equal(loadResultText({ before: 11, after: 11, reason: 'no-more', clicked: true }), '더 불러올 리뷰가 없어요(현재 11건)')
  assert.equal(loadResultText({ before: 11, after: 11, reason: 'reached-total' }), '더 불러올 리뷰가 없어요(현재 11건)')
  assert.equal(loadResultText({ before: 11, after: 11, reason: 'no-more', clicked: false }), '리뷰를 더 불러오지 못했어요(현재 11건) — 리뷰 탭을 열고 다시 눌러 주세요')
  assert.equal(loadResultText({ before: 11, after: 11, reason: 'aborted' }), '불러오기를 중단했어요(현재 11건)')
  assert.ok(loadResultText({ before: 11, after: 11, reason: 'no-more', grewOnPage: true }).includes('현재 11건'))
  for (const a of [[11, 11], [11, 21], [0, 0], [5, 3]]) assert.ok(!/건에서 .*건으로/.test(loadResultText({ before: a[0], after: a[1], reason: 'no-more' })), String(a))
})

test('diagnose: 리뷰 불러오기 멈춘 이유(시간 한도·중단)가 리포트에 보인다', () => {
  for (const stop of ['limit-time', 'aborted']) {
    const rep = formatReport(collectDiagnostics(fakeDocument(wrapBody(NOCHART_HTML)), '', '', { scroll: { before: 2, after: 9, stop } }))
    assert.ok(rep.includes(stop), stop)
  }
})

// 확장 content.js를 임시 폴더에 IIFE로 빌드해 가짜 DOM(node:vm)에서 fab 클릭(run) 경로를 실행합니다. 실제 무신사·크롬이 아니에요.
async function runContentInFakeDom(pageHtml = null, extra = {}, measurements = {}, learnStore = null) {
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
    const asNode = (n) => {
      if (n && typeof n === 'object' && typeof n.tagName === 'string') return n
      const t = String(n)
      texts.push(t)
      return { nodeType: 3, textContent: t }
    }
    const makeEl = (tag) => {
      const e = {
        tagName: String(tag).toUpperCase(), children: [], className: '', hidden: false, disabled: false, style: {},
        set innerHTML(v) { throw new Error('innerHTML 사용 금지') }, set outerHTML(v) { throw new Error('outerHTML 사용 금지') }, insertAdjacentHTML() { throw new Error('insertAdjacentHTML 사용 금지') },
        _text: '', set textContent(v) { this._text = String(v); texts.push(this._text) }, get textContent() { return this._text },
        // 실제 DOM처럼 요소가 아닌 값은 String()으로 바꾼 글자 노드로 넣어요 (객체를 넣으면 '[object Object]'가 보여요).
        append(...n) { this.children.push(...n.map(asNode)) }, appendChild(n) { this.children.push(n); return n }, replaceChildren(...n) { this.children = n.map(asNode) },
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
    const pageDoc = typeof pageHtml === 'string' ? fakeDocument(pageHtml) : pageHtml || null
    const doc = {
      readyState: 'complete', body: makeEl('body'), documentElement: makeEl('html'),
      createElement(tag) { const e = makeEl(tag); created.push(e); return e },
      querySelectorAll(sel) { return pageDoc ? pageDoc.querySelectorAll(sel) : [] }, querySelector(sel) { return pageDoc ? pageDoc.querySelector(sel) : null }, execCommand() { return false },
    }
    const win = { scrollX: 0, scrollY: 0, scrollTo() {} }
    const profile = buildProfile({ gender: 'male', height: '175', weight: '70', preferredFit: 'regular', measurements }).profile
    const sandbox = {
      URL, document: doc, window: win, location: { href: 'https://shop.example/products/1' }, navigator: {},
      MutationObserver: class { observe() {} disconnect() {} },
      CSSStyleSheet: class { replaceSync() {} },
      setTimeout: (f) => setTimeout(f, 0), clearTimeout,
      ...extra,
      chrome: {
        runtime: { getManifest: () => ({ version: '0.0.0' }), onMessage: { addListener: (f) => { listeners.msg = f } } },
        // learnStore(Map)를 주면 학습값 키만 실제로 저장·삭제하는 가짜 chrome.storage.local이 돼요 (JSON 왕복으로 복사). 없으면 예전과 같아요.
        storage: { local: {
          get: (k, cb) => cb({ fitcheckProfile: profile, ...(learnStore ? Object.fromEntries([...learnStore].map(([key, v]) => [key, JSON.parse(v)])) : {}) }),
          set: (...a) => { storageCalls.push(['set', a]); if (learnStore && a[0] && typeof a[0] === 'object') for (const [key, v] of Object.entries(a[0])) learnStore.set(key, JSON.stringify(v)); a.find((x) => typeof x === 'function')?.() },
          remove: (...a) => { storageCalls.push(['remove', a]); if (learnStore && typeof a[0] === 'string') learnStore.delete(a[0]); a.find((x) => typeof x === 'function')?.() },
          clear: (...a) => storageCalls.push(['clear', a]),
        } },
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
  // 리뷰 자동 불러오기 진행 카드가 먼저 그려지므로, 마지막에 그린 결과 카드를 봐요.
  const card = created.findLast((e) => e.className.split(' ').includes('card'))
  assert.deepEqual(card.children.map((c) => c.className.split(' ')[0]), ['row', 'row', 'size', 'sum', 'tiny', 'fold'])
  // 최소화하면 fold가 숨겨지는 클래스가 붙고, 다시 누르면 풀린다
  const mini = created.findLast((e) => e.tagName === 'BUTTON' && e.textContent === '−')
  mini._l.click()
  assert.ok(card.className.split(' ').includes('min'))
  const plus = created.findLast((e) => e.tagName === 'BUTTON' && e.textContent === '+')
  plus._l.click()
  assert.ok(!card.className.split(' ').includes('min'))
  const close = created.findLast((e) => e.tagName === 'BUTTON' && e.textContent === '×')
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
  const stopBtn = created.findLast((e) => e.tagName === 'BUTTON' && e.textContent === '중단')
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

await atest('content.js(가짜 DOM, vm): 비슷한 체형 사진을 누르면 확대 오버레이가 뜨고 Esc·닫기·바깥 클릭으로 닫히며 http는 열리지 않는다', async () => {
  const { created } = await runContentInFakeDom(RB_FULL)
  const thumbs = created.filter((e) => e.tagName === 'IMG' && e.className === 'ph')
  assert.ok(thumbs.length >= 1, '비슷한 체형 탭의 작은 사진')
  const t = thumbs[0]
  assert.equal(t.tabIndex, 0, '키보드로 닿아요')
  const zooms = () => created.filter((e) => e.className === 'zoom')
  assert.equal(zooms().length, 0, '누르기 전에는 없어요')
  t._l.click()
  const ov = zooms()[0]
  assert.ok(ov, '확대 오버레이')
  const big = ov.children.find((c) => c.tagName === 'IMG')
  assert.ok(big.src.startsWith('https://') && big.referrerPolicy === 'no-referrer')
  let removed = 0
  ov.remove = () => { removed += 1 }
  const closeBtn = ov.children.find((c) => c.tagName === 'BUTTON' && c.className.includes('zx'))
  assert.ok(closeBtn, '닫기 버튼')
  ov._l.keydown({ key: 'Escape' })
  assert.equal(removed, 1, 'Esc로 닫혀요')
  closeBtn._l.click()
  assert.equal(removed, 2, '닫기 버튼')
  ov._l.click({ target: ov })
  assert.equal(removed, 3, '바깥 클릭')
  ov._l.click({ target: big })
  assert.equal(removed, 3, '사진 자체를 눌러도 닫히지 않아요')
  // 키보드: Enter로 열린다
  const before = zooms().length
  t._l.keydown({ key: 'Enter' })
  assert.equal(zooms().length, before + 1)
})

await atest('content.js(가짜 DOM, vm): http 사진은 확대하지 않는다', async () => {
  const html = RB_FULL.replace(new RegExp(RB_PHOTO.replace(/[.]/g, '\\.'), 'g'), 'http://img.example.com/insecure.jpg')
  const { created } = await runContentInFakeDom(html)
  const thumbs = created.filter((e) => e.tagName === 'IMG' && e.className === 'ph' && e.src.startsWith('http://'))
  for (const t of thumbs) {
    assert.ok(!t._l?.click, 'http 사진에는 클릭 핸들러가 없어요')
    assert.notEqual(t.tabIndex, 0)
  }
  assert.ok(!created.some((e) => e.className === 'zoom'))
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

// ---- 가짜 HTML(무신사 스크린샷 구조): 실제 무신사 페이지로 확인한 것이 아니라 스크린샷 화면 구조를 옮긴 가짜 HTML이에요.
const MS_HEADS = ['총장', '어깨너비', '가슴단면', '소매길이', '밑단단면', '소매부리단면', '암홀']
const MS_DATA = [['0 (S)', '67', '50.5', '59.5', '60.5'], ['1 (M)', '69', '52', '62', '62'], ['2 (L)', '71', '53.5', '64.5', '63.5'], ['3 (XL)', '73', '55', '67', '65'], ['4 (2XL)', '75', '56.5', '69.5', '66.5']]
const MS_HEAD_CELL = {
  span: (i, h, t) => `<${t}><span>${i + 1}</span><span>${h}</span></${t}>`,
  br: (i, h, t) => `<${t}>${i + 1}<br>${h}</${t}>`,
  div: (i, h, t) => `<${t}><div>${i + 1}</div><div>${h}</div></${t}>`,
}
const msHtml = (kind, { tag = 'th', mine = true, fit = true, opts = true } = {}) => {
  const head = `<tr><${tag}>cm</${tag}>${MS_HEADS.map((h, i) => MS_HEAD_CELL[kind](i, h, tag)).join('')}</tr>`
  const my = mine ? '<tr><td>내 사이즈</td><td colspan="7">사이즈를 직접 입력해주세요</td></tr>' : ''
  const body = MS_DATA.map((r) => `<tr>${[...r, '-', '-', '-'].map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
  const fitT = fit ? '<h3>핏/계절감</h3><table><tr><td>핏</td><td>스키니</td><td>슬림</td><td>레귤러</td><td>루즈</td><td>오버 사이즈</td></tr><tr><td>촉감</td><td>부드러움</td><td>약간 부드러움</td><td>보통</td><td>약간 뻣뻣함</td><td>뻣뻣함</td></tr><tr><td>신축성</td><td>없음</td><td>거의 없음</td><td>보통</td><td>약간 있음</td><td>있음</td></tr><tr><td>비침</td><td>있음</td><td>약간 있음</td><td>보통</td><td>거의 없음</td><td>없음</td></tr><tr><td>두께</td><td>얇음</td><td>약간 얇음</td><td>보통</td><td>약간 두꺼움</td><td>두꺼움</td></tr><tr><td>계절</td><td>봄</td><td>여름</td><td>가을</td><td>겨울</td></tr></table>' : ''
  const optH = opts ? MS_DATA.map((r) => `<button>${r[0]}</button>`).join('') : ''
  return `<html><body><h1>오버핏 맨투맨</h1>${optH}<table>${head}${my}${body}</table>${fitT}</body></html>`
}

test('가짜 HTML(무신사 스크린샷 구조): 열 번호+항목명 머리글, 내 사이즈 줄, - 열, 핏/계절감 표가 있어도 0 (S)~4 (2XL)의 정확한 값을 읽는다', () => {
  for (const kind of ['span', 'br', 'div'])
    for (const tag of ['th', 'td'])
      for (const opts of [true, false])
        for (const mine of [true, false]) {
          const page = parsePage(fakeDocument(msHtml(kind, { tag, opts, mine })), '')
          const id = `${kind}/${tag}/opts=${opts}/mine=${mine}`
          assert.deepEqual(Object.keys(page.sizeChart.measures), ['0(S)', '1(M)', '2(L)', '3(XL)', '4(2XL)'], id)
          assert.deepEqual(page.sizeChart.measures['0(S)'], { topLength: 67, shoulder: 50.5, chest: 119, arm: 60.5 }, id)
          assert.deepEqual(page.sizeChart.measures['4(2XL)'], { topLength: 75, shoulder: 56.5, chest: 139, arm: 66.5 }, id)
          assert.deepEqual(page.sizeChartMeta.candidates.filter((c) => c.reason === 'selected').map((c) => c.cols), [8], id)
        }
})

test('가짜 HTML(무신사 스크린샷 구조): 핏/계절감 표는 사이즈표 후보로 선택되지 않고 진단에 번호 접두·건너뛴 줄·- 열 수가 남는다', () => {
  const doc = fakeDocument(msHtml('span'))
  const meta = parsePage(doc, '').sizeChartMeta
  const fitCand = meta.candidates.find((c) => c.rows === 6 && c.cols === 6)
  assert.ok(!fitCand || fitCand.reason === 'no-measure-header')
  assert.equal(meta.headerPrefixStripped, 1)
  assert.equal(meta.skippedRows, 1)
  assert.equal(meta.dashColumns, 3)
  const d = collectDiagnostics(doc, '')
  assert.deepEqual([d.chart.headerPrefixStripped, d.chart.skippedRows, d.chart.dashColumns], [1, 1, 3])
  assert.ok(diagnosticLines(d).some((l) => l.includes('열 번호 접두 제거한 후보 1개') && l.includes('건너뛴 줄(내 사이즈 안내 등) 1개') && l.includes("전부 '-'인 열 3개")))
})

test('가짜 HTML(무신사 스크린샷 구조): 열 번호 접두 제거는 1부터 이어지는 번호일 때만 한다', () => {
  assert.deepEqual(stripColumnNumbers(['cm', '1 총장', '2 어깨너비', '3 가슴단면']), { headers: ['cm', '총장', '어깨너비', '가슴단면'], stripped: 3 })
  assert.equal(stripColumnNumbers(['사이즈', '총장', '어깨']).stripped, 0)
  assert.equal(stripColumnNumbers(['사이즈', '1 총장', '어깨']).stripped, 0, '한 칸만 번호면 건드리지 않음')
})

test('가짜 HTML(무신사 스크린샷 구조): 읽은 표로 추천·요약·비교가 동작하고 총장 67이 사이즈로 읽히지 않는다', () => {
  const profile = buildProfile({ gender: 'male', height: '175', weight: '70' }).profile
  const r = analyzePage(fakeDocument(msHtml('span')), '', profile)
  assert.equal(r.status, 'ok')
  assert.equal(r.sizeChartMissing, false)
  assert.equal(r.sizeSummary.status, 'ok')
  assert.deepEqual(r.sizeSummary.sizes, ['0 (S)', '1 (M)', '2 (L)', '3 (XL)', '4 (2XL)'])
  assert.ok(r.compareView.sizes.length === 5)
  assert.ok(!r.sizeSummary.sizes.some((x) => ['67', '69', '71'].includes(x)))
})

await atest('content.js(가짜 DOM, vm): 가짜 HTML(무신사 스크린샷 구조) 표는 못 읽었다는 안내 없이 요약이 나온다', async () => {
  const { texts } = await runContentInFakeDom(msHtml('span'))
  assert.ok(!texts.some((t) => t.includes('분석 중 문제가 생겼어요')))
  assert.ok(texts.includes('사이즈표 요약'))
  assert.ok(!texts.includes(NO_CHART_MESSAGE))
})

// ---- 자동 카테고리 분류 (전부 직접 만든 가짜 HTML·가짜 데이터예요. 실제 무신사·크롬에서 확인한 것이 아니에요) ----
import { classifyCategory, categoryEvidenceLine } from '../src/lib/categoryClassifier.js'
import { recategorizeProduct } from '../src/lib/recategorize.js'
import { shoeChartNotice, chartForNotice } from '../src/lib/shoeChartNotice.js'

const catHtml = ({ title = '', ld = null, options = [], table = null, reviews = true } = {}) => {
  const rv = reviews ? Array.from({ length: 3 }, (_, i) => ({ '@type': 'Review', reviewBody: `키 17${i} 몸무게 7${i} M 사이즈 구매 정사이즈로 잘 맞아요` })) : []
  const product = ld ? { '@type': 'Product', name: title, ...ld, review: rv } : { '@type': 'Product', name: title, review: rv }
  const graph = [product, ...(ld?.crumbs ? [{ '@type': 'BreadcrumbList', itemListElement: ld.crumbs.map((n, i) => ({ '@type': 'ListItem', position: i + 1, name: n })) }] : [])]
  delete product.crumbs
  const opt = options.length ? `<ul>${options.map((o) => `<li><span>${o}</span><span>11.11(수) 이내 발송 예정</span></li>`).join('')}</ul>` : ''
  return `<html><head><script type="application/ld+json">${JSON.stringify({ '@graph': graph })}</script></head><body><h1>${title}</h1>${opt}${table || ''}</body></html>`
}

test('가짜 데이터: 분류 매트릭스 - 상품명·breadcrumb·JSON-LD·옵션·머리글 조합', () => {
  const c = (input) => classifyCategory(input)
  const boots = c({ name: '[xYASE] braided moc boots (grunge taupe)', optionLabels: ['250 (250-255)', '240 (240-245)', '230 (230-235)'] })
  assert.equal(boots.category, 'shoes')
  assert.equal(boots.confidence, 'high')
  assert.equal(c({ name: '[xYASE] braided moc boots (grunge taupe)' }).category, 'shoes', '상품명만으로도 신발')
  assert.equal(c({ name: '와이드 데님 팬츠' }).category, 'bottom')
  assert.equal(c({ name: '오버사이즈 패딩 점퍼' }).category, 'outer')
  assert.equal(c({ name: '리넨 원피스' }).category, 'dress')
  assert.equal(c({ name: '베이직 맨투맨' }).category, 'top')
  assert.equal(c({ name: '', jsonLdCategory: '신발 > 스니커즈' }).category, 'shoes')
  assert.equal(c({ name: 'Daily', breadcrumb: '홈 하의 데님팬츠' }).category, 'bottom')
  assert.equal(c({ name: 'Daily', optionLabels: ['230', '240', '250', '260'] }).category, 'shoes')
  assert.equal(c({ name: 'Daily', optionLabels: ['28', '30', '32', '34'] }).category, 'bottom')
  assert.equal(c({ name: 'Daily', headers: ['사이즈', '발길이', '발볼'] }).category, 'shoes')
  assert.equal(c({ name: 'Daily', headers: ['사이즈', '허리', '허벅지', '밑위'] }).category, 'bottom')
  assert.equal(c({ name: 'Daily', headers: ['사이즈', '어깨', '가슴단면', '총장'] }).category, 'top')
  // 충돌·부족한 근거는 신뢰도 낮음
  assert.equal(c({ name: '슬랙스 팬츠 자켓 세트' }).confidence, 'low')
  assert.equal(c({ name: 'Daily item' }).confidence, 'low')
  assert.equal(c({ name: 'Daily item' }).category, 'top')
  assert.equal(c({ name: 'boots', headers: ['사이즈', '어깨'] }).confidence !== 'high', true)
  // 반환값에는 원문(상품명)이 없다
  assert.ok(!JSON.stringify(boots).includes('xYASE'))
  assert.ok(boots.evidences.every((e) => ['kind', 'category', 'score'].every((k) => k in e) && Object.keys(e).length === 3))
})

test('가짜 HTML: braided moc boots + 옵션 250 (250-255) 페이지는 신발로 분류된다', () => {
  const html = catHtml({ title: '[xYASE] braided moc boots (grunge taupe)', options: ['230 (230-235)', '240 (240-245)', '250 (250-255)'] })
  const p = parsePage(fakeDocument(html), '')
  assert.equal(p.category, 'shoes')
  assert.equal(p.categoryConfidence, 'high')
  assert.ok(p.categoryEvidence.some((e) => e.kind === 'option'))
  assert.ok(!JSON.stringify(p.categoryEvidence).includes('xYASE'))
})

test('가짜 HTML: JSON-LD category와 breadcrumb이 분류 근거로 쓰인다', () => {
  const p = parsePage(fakeDocument(catHtml({ title: 'Daily', ld: { category: '아우터', crumbs: ['홈', '아우터', '코트'] } })), '')
  assert.equal(p.category, 'outer')
  assert.ok(p.categoryEvidence.some((e) => e.kind === 'jsonld') && p.categoryEvidence.some((e) => e.kind === 'breadcrumb'))
  const srv = parseProductHtml(catHtml({ title: 'Daily', ld: { category: '신발' } }), 'https://shop.example/p/1')
  assert.equal(srv.category, 'shoes', '서버 파서도 같은 분류 함수를 쓴다')
  assert.ok(srv.categoryConfidence && srv.categoryEvidence.some((e) => e.kind === 'jsonld'))
})

test('가짜 HTML: 근거가 부족하면 confidence가 low이고 후보 목록과 override 재분석이 동작한다', () => {
  const profile = buildProfile({ gender: 'male', height: '175', weight: '70' }).profile
  const html = catHtml({ title: 'Daily piece' })
  const auto = analyzePage(fakeDocument(html), '', profile)
  assert.equal(auto.status, 'ok')
  assert.equal(auto.categoryConfidence, 'low')
  assert.equal(auto.categoryCandidates.length, 5)
  const forced = analyzePage(fakeDocument(html), '', profile, '', { categoryOverride: 'bottom' })
  assert.equal(forced.category, 'bottom')
  assert.equal(forced.categoryLabel, '하의')
  assert.equal(forced.categoryOverridden, true)
  assert.equal(forced.categoryConfidence, 'high')
  // 높은 신뢰도 분류도 사용자가 고른 값이 우선
  const boots = catHtml({ title: 'braided moc boots', options: ['230 (230-235)', '240 (240-245)'] })
  assert.equal(analyzePage(fakeDocument(boots), '', profile).category, 'shoes')
  assert.equal(analyzePage(fakeDocument(boots), '', profile, '', { categoryOverride: 'top' }).category, 'top')
})

test('가짜 데이터: 웹 결과 화면용 recategorizeProduct는 사이즈표를 새 카테고리로 다시 읽는다', () => {
  const base = parseProductHtml(`<html><head><title>Daily</title></head><body><table><tr><th>사이즈</th><th>총장</th><th>어깨</th></tr><tr><td>S</td><td>67</td><td>45</td></tr><tr><td>M</td><td>69</td><td>47</td></tr></table></body></html>`, 'https://shop.example/p/2')
  assert.equal(base.category, 'top')
  assert.equal(base.sizeChart.measures.S.topLength, 67)
  const re = recategorizeProduct(base, 'outer')
  assert.equal(re.category, 'outer')
  assert.equal(re.sizeChart.measures.S.outerLength, 67)
  assert.equal(re.categoryOverridden, true)
  assert.equal(base.category, 'top', '원본은 바꾸지 않는다')
})

test('가짜 HTML: 진단 리포트에 분류 근거 한 줄이 있고 상품명 원문은 없다', () => {
  const d = collectDiagnostics(fakeDocument(catHtml({ title: '[xYASE] braided moc boots (grunge taupe)', options: ['230 (230-235)', '240 (240-245)', '250 (250-255)'] })), '')
  const line = diagnosticLines(d).find((l) => l.startsWith('분류 근거:'))
  assert.ok(line, '분류 근거 줄')
  assert.ok(line.includes('상품명 +3') && line.includes('옵션 +3') && line.includes('신발'))
  assert.ok(!formatReport(d).includes('xYASE') && !formatReport(d).includes('braided'))
  assert.equal(categoryEvidenceLine({ category: 'evil', evidence: [] }), '')
  const forced = collectDiagnostics(fakeDocument(catHtml({ title: 'Daily' })), '', '', { categoryOverride: 'dress' })
  assert.ok(diagnosticLines(forced).some((l) => l.includes('직접 선택') && l.includes('원피스')))
})

await atest('content.js(가짜 DOM, vm): 가짜 HTML에서 분류 신뢰도가 낮으면 종류 칩이 나오고, 누르면 그 종류로 다시 분석한다', async () => {
  const { texts, created } = await runContentInFakeDom(catHtml({ title: 'Daily piece' }))
  assert.ok(texts.includes('종류가 확실하지 않아요'))
  const chips = created.filter((e) => /^cat( on)?$/.test(e.className))
  assert.deepEqual(chips.map((e) => e._text), ['상의', '신발', '원피스', '아우터', '하의'])
  assert.equal(chips.length, 5)
  const shoes = chips.find((e) => e._text === '신발')
  const before = texts.length
  shoes.click()
  for (let i = 0; i < 50 && !texts.slice(before).includes('종류(직접 선택)'); i++) await new Promise((r) => setTimeout(r, 10))
  assert.ok(texts.slice(before).includes('종류(직접 선택)'), '다시 분석한 카드에 직접 선택 표시')
  assert.ok(texts.slice(before).includes('신발'))
})

await atest('content.js(가짜 DOM, vm): 가짜 HTML에서 분류 신뢰도가 높으면 종류 칩이 나오지 않는다', async () => {
  const { texts, created } = await runContentInFakeDom(catHtml({ title: 'braided moc boots', options: ['230 (230-235)', '240 (240-245)', '250 (250-255)'] }))
  assert.ok(!texts.includes('종류가 확실하지 않아요'))
  assert.equal(created.filter((e) => /^cat( on)?$/.test(e.className)).length, 0)
})


// ---------- 신발 전용 사이즈 비교 ----------
import { parseShoeOption, parseShoeOptions, parseShoeFeel, aggregateShoeReviews, reviewAggregateLine, recommendShoe, shoeViewFor, withShoeRecommendation, chartWidthsByMm, shoeSizeToMm, resolveShoeSizeMm, shoeWardrobeFields, SHOE_UNSUPPORTED_NOTE, SHOE_NO_FOOT_NOTE } from '../src/lib/shoeFit.js'

const SHOE_NAME = '[xYASE] braided moc boots (grunge taupe)'
const shoeOpts = ['230 (230-235)', '240 (240-245)', '250 (250-255)']
const shoeCard = (i, opt, feel, nick) =>
  `<li class="sh-card"><div class="u1"><span class="n1">${nick}</span></div><span class="d1">26.10.0${i + 1}</span>` +
  `<div class="pr"><dl><span class="l">상품명</span><span class="v">${SHOE_NAME}</span></dl></div>` +
  `<div class="o1"><span class="l">구매옵션</span><span class="v">${opt}</span></div>` +
  `<div class="m1"><span class="l">만족도</span><span class="v">${feel}</span></div>` +
  `<p class="t1">발이 편하고 예뻐요 배송도 빨랐어요 ${nick}</p><button class="h">도움돼요 1</button></li>`
const SHOE_FEEL = (size, width) => `사이즈 ${size} · 발볼 넓이 ${width} · 착용감 아주 편함 · 발목·종아리 둘레 조금 넉넉 · 착용 편리성 아주 편함`
const shoePage = (cards = []) =>
  `<html><head><title>${SHOE_NAME}</title></head><body><h1>${SHOE_NAME}</h1>` +
  `<ul class="opts">${shoeOpts.map((o, i) => `<li><span>${o}</span><span>${['11.11(수) 이내 발송 예정', '5개 남음', '예약배송'][i]}</span></li>`).join('')}</ul>` +
  `<ul class="rvs">${cards.join('')}</ul></body></html>`
const SHOE_CARDS = [
  shoeCard(0, '250 (250-255)', SHOE_FEEL('정사이즈', '적당함'), '가나'),
  shoeCard(1, '250 (250-255)', SHOE_FEEL('정사이즈', '적당함'), '다라'),
  shoeCard(2, '250 (250-255)', SHOE_FEEL('반 사이즈 작아요', '좁음'), '마바'),
  shoeCard(3, '240 (240-245)', SHOE_FEEL('커요', '넓음'), '사아'),
]
const shoeProfile = (extra = {}) => ({ ...buildProfile({ gender: 'male', height: '175', weight: '70', measurements: { footLength: '245' } }).profile, ...extra })

test('가짜 HTML: 신발 옵션 "NNN (NNN-NNN)"은 라벨 원문·범위로 읽고 배송 문구는 무시한다', () => {
  const doc = fakeDocument(shoePage())
  assert.deepEqual(readOptionLabels(doc), ['230', '240', '250'])
  const p = parsePage(doc, '')
  assert.deepEqual(p.shoeOptionLabels, shoeOpts)
  assert.equal(p.category, 'shoes')
  const opts = parseShoeOptions(p.shoeOptionLabels)
  assert.deepEqual(opts.map((o) => [o.label, o.mm, o.lo, o.hi]), [['230 (230-235)', 230, 230, 235], ['240 (240-245)', 240, 240, 245], ['250 (250-255)', 250, 250, 255]])
  assert.equal(parseShoeOption('5개 남음'), null)
  assert.equal(parseShoeOption('예약배송'), null)
  assert.equal(parseShoeOption('250 (250-255)11.11(수) 이내 발송 예정').hi, 255)
})

test('가짜 데이터: 신발 만족도 문구 파싱 - 정사이즈/작아요/커요, 발볼 좁음·적당함·넓음, 여러 항목 "·"', () => {
  const f = parseShoeFeel(SHOE_FEEL('정사이즈', '적당함'))
  assert.equal(f.size, 'true')
  assert.equal(f.width, 'normal')
  assert.deepEqual(f.extras.map((e) => e.label), ['착용감', '발목·종아리 둘레', '착용 편리성'])
  assert.equal(f.extras[1].value, '조금 넉넉')
  assert.equal(parseShoeFeel('사이즈 작아요 · 발볼 넓이 좁음').size, 'small')
  assert.equal(parseShoeFeel('사이즈 반 사이즈 작아요').sizeStep, 0.5)
  assert.equal(parseShoeFeel('사이즈 커요 · 발볼 넓이 넓음').size, 'large')
  assert.equal(parseShoeFeel('사이즈 커요 · 발볼 넓이 넓음').width, 'wide')
  assert.equal(parseShoeFeel('사이즈 정사이즈').width, null)
  assert.equal(parseShoeFeel(''), null)
})

test('가짜 HTML: 신발 리뷰 카드(상품명/구매옵션/만족도, 체형정보 없음)를 읽는다', () => {
  const doc = fakeDocument(shoePage(SHOE_CARDS))
  const v = extractCardView(doc.querySelectorAll('li.sh-card')[0])
  assert.equal(v.structured, true)
  assert.equal(v.productName, SHOE_NAME)
  assert.equal(v.option, '250 (250-255)')
  assert.equal(v.sizePart, '250')
  assert.equal(v.bodyInfo, '')
  assert.equal(v.shoeFeel.size, 'true')
  assert.equal(v.shoeFeel.width, 'normal')
  assert.ok(!v.body.includes('만족도') && !v.body.includes('정사이즈 ·'), '만족도 문구는 본문에 섞이지 않는다')
  const p = parsePage(doc, '')
  assert.equal(p.reviews.length, 4)
  assert.equal(p.reviews[0].size, '250')
  assert.equal(p.reviews[0].view.shoeFeel.width, 'normal')
})

test('가짜 데이터: 신발 추천·리뷰 집계 - 발길이 여유 mm, 발볼 넓음이면 한 단계 위, 작아요 다수면 한 단계 위', () => {
  const options = parseShoeOptions(shoeOpts)
  const r = recommendShoe({ options, footLength: 245, preferredFit: 'regular' })
  assert.equal(r.recommended.label, '250 (250-255)')
  assert.deepEqual(r.rows.map((x) => x.ease), [-15, -5, 5])
  assert.ok(r.heuristicNote.includes('휴리스틱'))
  const wide = recommendShoe({ options, footLength: 235, footWidth: 'wide' })
  assert.equal(recommendShoe({ options, footLength: 235 }).recommended.mm, 240)
  // 새 규칙: 발 235의 허용 구간은 230~245mm라 250(+15)은 부적합이에요. 발볼이 넓어도 구간 밖으로는 올리지 않고 이유를 남겨요.
  assert.equal(wide.recommended.mm, 240)
  assert.ok(wide.notes.some((t) => t.includes('허용 구간(230~245mm) 밖이라 올리지 않았어요')))
  const noFoot = recommendShoe({ options, footLength: null })
  assert.equal(noFoot.recommended, null)
  assert.ok(noFoot.notes[0].includes('발길이'))
  // 리뷰 집계
  const mk = (size, fit, w) => ({ size, view: { shoeFeel: { size: fit, width: w, extras: [] } } })
  const reviews = [mk('250', 'true', 'normal'), mk('250', 'true', 'normal'), mk('250', 'small', 'narrow'), mk('240', 'large', 'wide')]
  const agg = aggregateShoeReviews(reviews)
  assert.equal(reviewAggregateLine(agg.find((a) => a.mm === 250)), '250 구매 리뷰 3건 중 정사이즈 2 · 작아요 1, 발볼 적당 2 · 좁음 1')
  const small = [mk('250', 'small'), mk('250', 'small'), mk('250', 'true')]
  // 새 규칙: 발 250의 허용 구간은 245~260mm. 250(0)이 기본 추천이고 260(+10, 여유)은 허용이라 올릴 수 있어요.
  const bumped = recommendShoe({ options: parseShoeOptions([...shoeOpts, '260 (260-265)']), footLength: 250, reviews: small })
  assert.equal(bumped.recommended.mm, 260)
  assert.ok(bumped.reasons.some((t) => t.includes('작다고')))
  // 발 245에서는 260(+15)이 구간 밖이라 리뷰가 작다고 해도 올리지 않아요.
  const blocked = recommendShoe({ options: parseShoeOptions([...shoeOpts, '260 (260-265)']), footLength: 245, reviews: small })
  assert.equal(blocked.recommended.mm, 250)
  assert.ok(blocked.notes.some((t) => t.includes('허용 구간(240~255mm) 밖')))
})

test('가짜 데이터: 신발 사이즈표(발길이/발볼) 변형을 shoeViewFor가 함께 쓴다', () => {
  const html = `<html><head><title>러닝화</title></head><body><h1>러닝 스니커즈</h1><table><tr><th>사이즈</th><th>발길이</th><th>발볼</th></tr><tr><td>240</td><td>240</td><td>95</td></tr><tr><td>250</td><td>250</td><td>98</td></tr><tr><td>260</td><td>260</td><td>100</td></tr></table></body></html>`
  const p = parsePage(fakeDocument(html), '')
  assert.equal(p.category, 'shoes')
  const v = shoeViewFor(p, shoeProfile())
  assert.deepEqual(v.rows.map((r) => r.mm), [240, 250, 260])
  assert.equal(v.recommended.mm, 250)
})

test('가짜 HTML: analyzePage는 신발이면 shoeView를 주고 옷 실측 비교·요약은 만들지 않는다', () => {
  const doc = fakeDocument(shoePage(SHOE_CARDS))
  const r = analyzePage(doc, '', shoeProfile({ footWidth: 'wide' }))
  assert.equal(r.status, 'ok')
  assert.equal(r.category, 'shoes')
  assert.equal(r.compareView, null)
  assert.equal(r.sizeSummary, null)
  assert.equal(r.reviewViews.isShoes, true)
  assert.equal(r.shoeView.footWidthLabel, '넓은 편')
  assert.equal(r.shoeView.footLengthEstimated, false)
  assert.equal(r.shoeView.rows.length, 3)
  assert.ok(r.shoeView.rows.find((x) => x.mm === 250).reviewLine.startsWith('250 구매 리뷰 3건'))
  assert.equal(r.recommendedLabel, r.shoeView.recommended.label)
  const rv = r.reviewViews.others.concat(r.reviewViews.matched).find((x) => x.shoe?.sizeFeel === '반 사이즈 작아요')
  assert.ok(rv, '리뷰 카드에 사이즈 체감이 담긴다')
  assert.equal(rv.shoe.width, '좁음')
})

test('가짜 데이터: 발볼이 없는 기존 프로필도 로딩되고 분석이 동작하며, 발볼은 선택 필드로 저장된다', () => {
  const old = { gender: 'male', height: 175, weight: 70, preferredFit: 'regular', usual: { top: '', bottom: '' }, measurements: {} }
  assert.equal(isUsableProfile(old), true)
  const r = analyzePage(fakeDocument(shoePage(SHOE_CARDS)), '', old)
  assert.equal(r.status, 'ok')
  assert.equal(r.shoeView.footLengthEstimated, true)
  assert.ok(r.shoeView.notes.some((t) => t.includes('추정')))
  assert.equal(r.shoeView.footWidthLabel, '')
  assert.equal('footWidth' in buildProfile({ gender: 'male', height: '175', weight: '70' }).profile, false)
  assert.equal(buildProfile({ gender: 'male', height: '175', weight: '70', footWidth: 'wide' }).profile.footWidth, 'wide')
  assert.equal('footWidth' in buildProfile({ gender: 'male', height: '175', weight: '70', footWidth: 'huge' }).profile, false)
})

await atest('content.js(가짜 DOM, vm): 가짜 HTML 신발 페이지는 신발 사이즈 비교와 발 정보 비교 탭을 그린다', async () => {
  const { texts } = await runContentInFakeDom(shoePage(SHOE_CARDS))
  assert.ok(texts.includes('신발 사이즈 비교'))
  assert.ok(texts.some((t) => t.includes('여유')))
  assert.ok(texts.some((t) => t.includes('휴리스틱')))
  assert.ok(texts.includes('발 정보 비교'))
  assert.ok(!texts.includes('체형 비교'))
})

await atest('content.js(가짜 DOM, vm): 신발 발 정보 비교 탭을 열어도 카드 어디에도 [object Object]가 없다', async () => {
  const { texts, created } = await runContentInFakeDom(shoePage(SHOE_CARDS))
  const tab = created.find((e) => e.tagName === 'BUTTON' && e.textContent === '발 정보 비교')
  assert.ok(tab, '발 정보 비교 탭이 있어야 해요')
  tab._l.click()
  assert.ok(!texts.some((t) => t.includes('[object Object]')), `[object Object]가 보여요: ${texts.filter((t) => t.includes('[object')).join('|')}`)
  assert.ok(texts.some((t) => t.startsWith('사이즈 ') && t.includes('작아요')), '사이즈 체감 줄')
  assert.ok(texts.some((t) => t.startsWith('발볼 ')), '발볼 줄')
})

await atest('content.js(가짜 DOM, vm): 신발 사이즈표에 발볼 열이 있으면 확장 신발 비교에 발볼 한 줄과 사이즈별 발볼이 나온다', async () => {
  // 이 가짜 DOM의 프로필은 발길이를 키로 추정(265mm)해서, 허용 구간(260~275mm)에 드는 옵션으로 바꿔 써요.
  const table = `<table><tr><th>사이즈</th><th>발길이</th><th>발볼</th></tr>${[[250, 92], [260, 98], [270, 104]].map(([m, w]) => `<tr><td>${m}</td><td>${m}</td><td>${w}</td></tr>`).join('')}</table>`
  const html = shoePage(SHOE_CARDS).replace('230 (230-235)', '250 (250-255)').replace('240 (240-245)', '260 (260-265)').replace('250 (250-255)</span>', '270 (270-275)</span>').replace('<ul class="opts">', `${table}<ul class="opts">`)
  const { texts } = await runContentInFakeDom(html)
  assert.ok(texts.includes('신발 사이즈 비교'))
  assert.ok(texts.some((t) => t.startsWith('발볼 ') && t.endsWith('mm')), '사이즈별 발볼')
  assert.ok(texts.some((t) => t.includes('휴리스틱') && t.includes('발볼') && t.includes('사이즈표')), '발볼 근거 한 줄')
})


// ---- 리뷰 자동 불러오기(30건)·더 불러오기(+10건): 가짜 HTML과 가짜 DOM이에요. 실제 무신사·크롬에서 확인한 것이 아니에요 ----
const LOAD_REVIEW = (i) => `<li>키 ${160 + (i % 25)} 몸무게 ${55 + (i % 20)} 1 (M) 사이즈로 구매 정사이즈예요 후기 번호 ${i}번 잘 맞아요</li>`
// 리뷰 n건과(리뷰 영역 = aria-label '상품 후기'), 있으면 '후기 더보기'(누르면 10건 추가)·'구매하기'·'스냅·후기' 탭을 둔 페이지
function loadPage(n, { more = true, tab = false } = {}) {
  const html = wrapBody(
    `${optionsHtml}${chartTable(OPTION_LIST_LABELS())}` +
      (tab ? `<div role="tablist"><button role="tab" aria-selected="true">상품정보</button><button role="tab" aria-selected="false" class="snap-tab">스냅·후기</button></div>` : '') +
      `<section aria-label="상품 후기"><ul class="rl">${Array.from({ length: n }, (_, i) => LOAD_REVIEW(i)).join('')}</ul>` +
      `${more ? '<button class="more">후기 더보기</button>' : ''}<button class="buy">구매하기</button></section>`,
  )
  const doc = fakeDocument(html)
  const clicks = { more: 0, buy: 0, tab: 0 }
  let added = n
  const moreBtn = doc.querySelector('button.more')
  if (moreBtn) moreBtn.click = () => {
    clicks.more += 1
    doc.$('ul.rl').append(Array.from({ length: 10 }, (_, k) => LOAD_REVIEW(added + k)).join(''))
    added += 10
  }
  doc.querySelector('button.buy').click = () => { clicks.buy += 1 }
  const tabBtn = doc.querySelector('button.snap-tab')
  if (tabBtn) tabBtn.click = () => { clicks.tab += 1 }
  return { doc, clicks }
}
const NO_FROM_TO = (texts) => !texts.some((t) => /건에서 .*건으로/.test(t))

await atest('content.js(가짜 DOM, vm): 내 사이즈 찾기는 리뷰를 30건까지 자동으로 불러오고 진행 건수와 결과 한 줄을 보여준다', async () => {
  const { doc, clicks } = loadPage(11)
  const { texts, created } = await runContentInFakeDom(doc)
  assert.equal(clicks.more, 2, '11 -> 21 -> 31건, 30건을 넘으면 멈춰요')
  assert.equal(clicks.buy, 0, '구매하기는 누르지 않아요')
  assert.ok(texts.includes('불러온 리뷰 11건') && texts.includes('불러온 리뷰 31건'), '진행 건수')
  assert.ok(created.some((e) => e.tagName === 'BUTTON' && e.textContent === '중단'), '자동 불러오기 중에도 중단 버튼')
  assert.ok(texts.includes('리뷰 20건을 더 불러왔어요(총 31건)'), texts.filter((t) => t.includes('불러')).join('|'))
  assert.ok(NO_FROM_TO(texts))
})

await atest('content.js(가짜 DOM, vm): 리뷰 더 불러오기는 누를 때마다 10건씩 더 불러온다', async () => {
  const { doc, clicks } = loadPage(11)
  const { texts, created } = await runContentInFakeDom(doc)
  const moreBtn = () => created.filter((e) => e.tagName === 'BUTTON' && e.textContent === '리뷰 더 불러오기').at(-1)
  await moreBtn()._l.click()
  assert.equal(clicks.more, 3, '한 번 누르면 더보기 한 번(10건)')
  assert.ok(texts.includes('리뷰 10건을 더 불러왔어요(총 41건)'), texts.filter((t) => t.includes('불러')).join('|'))
  await moreBtn()._l.click()
  assert.equal(clicks.more, 4)
  assert.ok(texts.includes('리뷰 10건을 더 불러왔어요(총 51건)'))
  assert.equal(clicks.buy, 0)
  assert.ok(NO_FROM_TO(texts))
})

await atest('content.js(가짜 DOM, vm): 더보기가 없어 늘지 않으면 "N건에서 N건으로" 대신 리뷰 탭을 열라고 안내하고, 리뷰 탭은 한 번만 누른다', async () => {
  const { doc, clicks } = loadPage(11, { more: false, tab: true })
  const { texts, created } = await runContentInFakeDom(doc)
  assert.equal(clicks.tab, 1, '아직 안 열린 role="tab" 스냅·후기 탭만 한 번 눌러요')
  assert.equal(clicks.buy, 0)
  const msg = '리뷰를 더 불러오지 못했어요(현재 11건) — 리뷰 탭을 열고 다시 눌러 주세요'
  assert.ok(texts.includes(msg), texts.filter((t) => t.includes('불러')).join('|'))
  const moreBtn = created.filter((e) => e.tagName === 'BUTTON' && e.textContent === '리뷰 더 불러오기').at(-1)
  await moreBtn._l.click()
  assert.equal(texts.filter((t) => t === msg).length, 2, '더 불러오기를 눌러도 같은 안내')
  assert.ok(NO_FROM_TO(texts))
})

await atest('content.js(가짜 DOM, vm): 리뷰가 이미 30건 이상이면 자동으로 불러오지 않는다', async () => {
  const { doc, clicks } = loadPage(31)
  const { texts } = await runContentInFakeDom(doc)
  assert.equal(clicks.more, 0)
  assert.ok(!texts.some((t) => t.startsWith('불러온 리뷰')))
})

// ---------- 신발 리뷰 수정 ----------
test('가짜 데이터: 발볼 보정 뒤 작아요 다수면 "큰 사이즈가 없다"가 아니라 이미 보정했다고 안내한다', () => {
  const options = parseShoeOptions(shoeOpts)
  const small = (mm, n) => Array.from({ length: n }, () => ({ size: String(mm), view: { shoeFeel: { size: 'small', sizeStep: 0, width: null } } }))
  // 새 규칙: 발 231의 허용 구간은 226~241mm라 230(-1, 애매)이 기본이고, 발볼로 올린 240(+9, 여유)도 허용이에요.
  const r = recommendShoe({ options, footLength: 231, footWidth: 'wide', reviews: small(240, 3) })
  assert.equal(r.recommended.mm, 240)
  assert.ok(r.notes.some((t) => t.includes('이미 한 단계 큰 사이즈')))
  assert.ok(!r.notes.some((t) => t.includes('한 단계 큰 사이즈가 없어')))
  const last = recommendShoe({ options, footLength: 245, reviews: small(250, 3) })
  assert.ok(last.notes.some((t) => t.includes('한 단계 큰 사이즈가 없어')))
})

test('가짜 데이터: 만족도 부정형("작지도 크지도 않음")은 정사이즈로 읽는다', () => {
  assert.equal(parseShoeFeel('사이즈 작지도 크지도 않음').size, 'true')
  assert.equal(parseShoeFeel('사이즈 크지 않아요').size, 'true')
  assert.equal(parseShoeFeel('사이즈 작지 않음').size, 'true')
  assert.equal(parseShoeFeel('사이즈 작아요').size, 'small')
  assert.equal(parseShoeFeel('사이즈 반 사이즈 커요').size, 'large')
})

test('가짜 HTML: 사이즈표·리뷰가 없어도 신발 옵션과 발길이가 있으면 no-data 없이 신발 비교를 만든다', () => {
  const r = analyzePage(fakeDocument(shoePage([])), '', shoeProfile())
  assert.equal(r.status, 'ok')
  assert.ok(r.shoeView && r.shoeView.rows.length === 3)
  assert.equal(r.recommendedSize, String(r.shoeView.recommended.mm))
  // 신발이 아니면 같은 조건에서 여전히 no-data
  const none = analyzePage(fakeDocument('<html><body><h1>Daily piece</h1></body></html>'), '', shoeProfile())
  assert.notEqual(none.status, 'ok')
})

test('가짜 데이터: 웹 신발 추천은 엔진 결과를 신발 추천 사이즈로 통일하고, 신발 값이 없으면 그대로 둔다', () => {
  const sv = shoeViewFor({ shoeOptionLabels: shoeOpts, reviews: [] }, shoeProfile({ footWidth: 'wide' }))
  const base = { recommendedSize: 'M', headline: 'h', body: 'b', perSize: [] }
  const out = withShoeRecommendation(base, sv)
  assert.equal(out.recommendedSize, String(sv.recommended.mm))
  // 헤드라인은 옷용 '추천해요' 문구 대신 '<mm>이 딱 맞아요' 형태라 옵션 라벨 전체가 아니라 mm 숫자로 확인한다 (FEAT-003)
  assert.ok(out.headline.includes(String(sv.recommended.mm)))
  assert.equal(withShoeRecommendation(base, null), base)
  // cm 단위 표(25.0)는 mm 옵션으로 읽을 수 없어 null: 웹은 기존 비교로 돌아간다
  assert.equal(shoeViewFor({ sizeChart: { measures: { '25.0': {}, '25.5': {} } }, reviews: [] }, shoeProfile()), null)
})

// ---- 신발 사이즈표 발볼 열 (명시적인 가짜 표) ----
const widthOpts = (mms) => parseShoeOptions(mms.map(String))
const mmWidths = (pairs) => chartWidthsByMm({ measures: Object.fromEntries(pairs.map(([mm, w]) => [String(mm), { footLength: mm, footWidth: w }])) })
const lvWidths = (pairs) => chartWidthsByMm({ measures: Object.fromEntries(pairs.map(([mm]) => [String(mm), { footLength: mm }])), widthLevels: Object.fromEntries(pairs.map(([mm, l]) => [String(mm), l])) })

// 새 규칙: 발 241의 허용 구간은 236~251mm라 240(-1, 애매)과 250(+9, 여유)이 허용이에요. 아래 발볼 테스트는 이 구간 안에서 한 단계 이동을 확인해요.
test('가짜 표: 발볼 mm 열 - 넓은 발이고 표 안에서 좁은 사이즈면 정확히 한 단계만 위로, 기본 규칙과 겹치지 않는다', () => {
  const options = widthOpts([240, 250, 260, 270])
  const sizeWidths = mmWidths([[240, 92], [250, 98], [260, 102], [270, 104]])
  const r = recommendShoe({ options, footLength: 241, footWidth: 'wide', sizeWidths })
  assert.equal(recommendShoe({ options, footLength: 241, sizeWidths }).recommended.mm, 240, '보통 발은 그대로')
  assert.equal(r.recommended.mm, 250, '한 단계만 올림(두 단계 아님)')
  assert.equal(r.widthBasis, 'chart')
  assert.ok(r.widthLine.includes('휴리스틱') && r.widthLine.includes('92mm'))
  assert.ok(!r.reasons.some((t) => t.includes('발볼이 넓은 편이라')), '기본 규칙 문구는 같이 나오지 않음')
  assert.equal(r.rows[0].widthText, '발볼 92mm')
  // 넓은 발이어도 표 안에서 좁지 않은 사이즈면 올리지 않음 (기본 규칙으로 되돌아가지도 않음)
  const keep = recommendShoe({ options, footLength: 243, footWidth: 'wide', sizeWidths })
  assert.equal(keep.recommended.mm, 250)
  assert.ok(keep.widthLine.includes('바꾸지 않았어요'))
  // 좁은 발 + 표 안에서 넓은 사이즈 + 아래 사이즈의 길이 여유가 충분하면 한 단계 아래
  const wideRow = mmWidths([[230, 90], [240, 92], [250, 104], [260, 106]])
  const dn = recommendShoe({ options: widthOpts([230, 240, 250, 260]), footLength: 240, preferredFit: 'relaxed', footWidth: 'narrow', sizeWidths: wideRow })
  assert.equal(dn.recommended.mm, 240) // 발 240(허용 235~250): 250(+10)이 기본 추천이고, 아래 240(0)이 허용이라 한 단계 내려가요
  assert.ok(dn.widthLine.includes('한 단계 작은'))
  // 길이 여유가 모자라면 내리지 않음
  const tight = recommendShoe({ options: widthOpts([230, 240, 250, 260]), footLength: 245, preferredFit: 'relaxed', footWidth: 'narrow', sizeWidths: wideRow })
  assert.ok(tight.recommended.mm >= 250)
})

test('가짜 표: 발볼 E/2E/3E/4E와 좁음/보통/넓음 단계도 같은 규칙으로 읽는다', () => {
  const options = widthOpts([240, 250, 260])
  const e = recommendShoe({ options, footLength: 241, footWidth: 'wide', sizeWidths: lvWidths([[240, -1], [250, 0], [260, 1]]) })
  assert.equal(e.recommended.mm, 250)
  assert.equal(e.rows[0].widthText, '발볼 D')
  assert.equal(e.rows[2].widthText, '발볼 2E')
  const e4 = recommendShoe({ options, footLength: 241, footWidth: 'wide', sizeWidths: lvWidths([[240, 0], [250, 2], [260, 3]]) })
  assert.equal(e4.recommended.mm, 250, 'E < 3E < 4E: 240은 표 안에서 좁음')
  const htmlOf = (cells) => `<html><head><title>러닝화</title></head><body><h1>러닝 스니커즈</h1><table><tr><th>사이즈</th><th>발길이</th><th>발볼</th></tr>${[240, 250, 260].map((mm, i) => `<tr><td>${mm}</td><td>${mm}</td><td>${cells[i]}</td></tr>`).join('')}</table></body></html>`
  for (const cells of [['D', 'E', '2E'], ['좁음', '보통', '넓음']]) {
    const p = parsePage(fakeDocument(htmlOf(cells)), '')
    assert.equal(p.category, 'shoes', cells.join())
    assert.equal(p.sizeChart.measures['240'].footWidth, undefined, '글자 발볼을 mm 숫자로 읽지 않음')
    assert.deepEqual(Object.values(p.sizeChart.widthLevels), [-1, 0, 1], cells.join())
    const v = shoeViewFor(p, shoeProfile({ footWidth: 'wide', measurements: { footLength: '241' } }))
    assert.equal(v.widthBasis, 'chart')
    assert.ok(v.rows.every((r) => r.widthText))
  }
  const mmPage = parsePage(fakeDocument(htmlOf(['92', '98', '104'])), '')
  assert.deepEqual(Object.values(mmPage.sizeChart.measures).map((m) => m.footWidth), [92, 98, 104])
  assert.equal(mmPage.sizeChart.widthLevels, undefined)
})

test('가짜 표: 발볼 열이 없으면 기존 규칙(넓은 발이면 한 단계 위) 그대로, 발볼 값이 한 개뿐이어도 기본 규칙', () => {
  const options = widthOpts([240, 250, 260])
  const none = recommendShoe({ options, footLength: 241, footWidth: 'wide', sizeWidths: {} })
  assert.equal(none.recommended.mm, 250)
  assert.equal(none.widthBasis, 'foot')
  assert.equal(none.widthLine, '')
  assert.ok(none.reasons.some((t) => t.includes('발볼이 넓은 편이라')))
  assert.equal(recommendShoe({ options, footLength: 241, footWidth: 'wide' }).recommended.mm, 250, 'sizeWidths 생략도 같음')
  assert.equal(recommendShoe({ options, footLength: 241, footWidth: 'wide', sizeWidths: mmWidths([[240, 90]]) }).widthBasis, 'foot')
  const normal = recommendShoe({ options, footLength: 241, footWidth: 'normal', sizeWidths: {} })
  assert.equal(normal.recommended.mm, 240)
  assert.equal(normal.widthBasis, null)
  // 발볼 열은 있지만 모든 사이즈가 같으면 기본 규칙을 겹쳐 쓰지 않음
  const flat = recommendShoe({ options, footLength: 241, footWidth: 'wide', sizeWidths: mmWidths([[240, 98], [250, 98], [260, 98]]) })
  assert.equal(flat.recommended.mm, 240)
  assert.equal(flat.widthBasis, 'chart')
  // 발볼 입력이 없으면 입력을 권하는 한 줄
  assert.ok(recommendShoe({ options, footLength: 241, sizeWidths: mmWidths([[240, 92], [250, 98], [260, 104]]) }).widthLine.includes('입력하면'))
})

test('가짜 표: 발볼로 올린 뒤 리뷰 "작아요"가 많아도 한 번 더 올리지 않고, 웹 본문에도 발볼 줄이 들어간다', () => {
  const options = widthOpts([240, 250, 260, 270])
  const sizeWidths = mmWidths([[240, 92], [250, 98], [260, 102], [270, 104]])
  const mk = (size, fit) => ({ size, view: { shoeFeel: { size: fit, extras: [] } } })
  const reviews = [mk('250', 'small'), mk('250', 'small'), mk('250', 'small')]
  const r = recommendShoe({ options, footLength: 241, footWidth: 'wide', sizeWidths, reviews })
  assert.equal(r.recommended.mm, 250)
  assert.ok(r.notes.some((t) => t.includes('이미 한 단계')))
  const out = withShoeRecommendation({ recommendedSize: 'M', headline: 'h', body: 'b' }, r)
  assert.ok(out.body.includes('사이즈표 발볼 기준'))
})

await atest('content.js(가짜 DOM, vm): 가짜 HTML에서 종류 칩으로 신발을 고르면 신발 사이즈 비교가 나온다 (사이즈표·리뷰 없음)', async () => {
  const { texts, created } = await runContentInFakeDom(catHtml({ title: 'Daily piece', options: ['230 (230-235)', '240 (240-245)', '250 (250-255)'] }))
  const chips = created.filter((e) => /^cat( on)?$/.test(e.className))
  const shoes = chips.find((e) => e._text === '신발')
  assert.ok(shoes, '신발 칩')
  const before = texts.length
  shoes.click()
  for (let i = 0; i < 50 && !texts.slice(before).includes('신발 사이즈 비교'); i++) await new Promise((r) => setTimeout(r, 10))
  assert.ok(texts.slice(before).includes('신발 사이즈 비교'))
})

test('신발: US/UK/EU 사이즈 이름을 대략적인 mm로 환산한다 (성별 필요, 휴리스틱)', () => {
  assert.equal(shoeSizeToMm('US 9', { gender: 'male' }).mm, 270)
  assert.equal(shoeSizeToMm('US 8', { gender: 'female' }).mm, 250)
  assert.equal(shoeSizeToMm('UK 8.5', { gender: 'male' }).mm, 275)
  assert.equal(shoeSizeToMm('EU 42').mm, 270)
  assert.equal(shoeSizeToMm('42').system, 'EU')
  assert.equal(shoeSizeToMm('9 US', { productName: "나이키 남성 에어맥스" }).mm, 270)
  assert.equal(shoeSizeToMm('US 9'), null, '성별을 모르면 환산하지 않는다')
  assert.equal(shoeSizeToMm('US 30', { gender: 'male' }), null)
  for (const n of ['S', 'M', 'L', 'FREE', 'F', '', null]) assert.equal(shoeSizeToMm(n, { gender: 'male' }), null)
  assert.equal(resolveShoeSizeMm('270 (270-275)').converted, false)
  assert.equal(resolveShoeSizeMm('EU 42').converted, true)
})

test('신발 옷장 항목: 판정이 조용히 비지 않고 이유(verdictStatus)가 남는다. 예전 항목 모양은 그대로', () => {
  const shoe = (size, extra = {}) => ({ name: '러닝화', mall: 'shop', category: 'shoes', url: 'https://shop.example/s', sizeChart: { measures: { [size]: { length: 1 } } }, ...extra })
  const prof = { gender: 'male', height: 175, weight: 70, footLength: 265 }
  const un = makeWardrobeItem({ product: shoe('M'), size: 'M', profile: prof })
  assert.equal(un.verdictStatus, 'unsupported')
  assert.equal(un.verdictNote, SHOE_UNSUPPORTED_NOTE)
  assert.deepEqual(un.verdicts, [])
  assert.equal(makeWardrobeItem({ product: shoe('FREE'), size: 'FREE' }).verdictStatus, 'unsupported')
  const us = makeWardrobeItem({ product: shoe('US 9'), size: 'US 9', profile: prof })
  assert.equal(us.verdictStatus, 'converted')
  assert.equal(us.measures.footLength, 270)
  assert.equal(us.verdicts[0].part, 'footLength')
  assert.ok(us.verdictNote.includes('270mm'))
  const mm = makeWardrobeItem({ product: shoe('270'), size: '270', profile: prof })
  assert.equal(mm.verdicts.length, 1)
  assert.equal(mm.verdictStatus, undefined)
  const noFoot = shoeWardrobeFields({ product: shoe('270'), size: '270', profile: null })
  assert.equal(noFoot.status, 'unsupported')
  // 신발이 아니면 새 필드가 없다 (예전 모양)
  const top = makeWardrobeItem({ product: { name: 't', mall: 'm', category: 'top', url: 'u' }, size: 'M' })
  assert.ok(!('verdictStatus' in top) && !('verdictNote' in top))
  // 예전에 저장된 항목(필드 없음)도 그대로 비교·표시에 쓰인다
  assert.equal(findSimilar({ id: 'x', category: 'shoes', measures: { footLength: 270 } }, [{ id: 'old', product: { category: 'shoes' }, measures: { footLength: 265 }, verdicts: [] }]).diffs[0].diff, 5)
})

test('신발 옷장 가져오기·자동 전달: verdictStatus를 검사하고 위조하지 않는다', () => {
  const env = (item) => ({ app: 'fitcheck', kind: 'wardrobe-item', v: 1, item: { product: { name: '남성 러닝화', mall: 'shop', category: 'shoes', url: 'https://shop.example/s' }, ...item } })
  const a = parseImportText(JSON.stringify(env({ size: 'M', verdicts: [] })))
  assert.equal(a.item.verdictStatus, 'unsupported')
  assert.equal(a.item.verdictNote, SHOE_UNSUPPORTED_NOTE)
  const b = parseImportText(JSON.stringify(env({ size: 'US 9', verdicts: [] })))
  assert.equal(b.item.verdictStatus, 'converted')
  assert.equal(b.item.measures.footLength, 270)
  // 받은 설명 글·잘못된 상태 값은 믿지 않는다
  const c = parseImportText(JSON.stringify(env({ size: 'M', verdicts: [], verdictStatus: 'unsupported', verdictNote: '<img src=x>' })))
  assert.equal(c.item.verdictNote, SHOE_UNSUPPORTED_NOTE)
  assert.equal(parseImportText(JSON.stringify(env({ size: 'M', verdicts: [], verdictStatus: 'hacked' }))).ok, false)
  // 판정이 있으면 unsupported를 붙이지 않는다
  const d = parseImportText(JSON.stringify(env({ size: '270', verdictStatus: 'unsupported', verdicts: [{ part: 'footLength', label: '발길이', verdict: '적당', key: 'regular', ease: 8 }] })))
  assert.ok(!('verdictStatus' in d.item))
  // 확장 → 웹 전달 봉투(왕복)에도 유지된다
  const out = buildExportEnvelope({ status: 'ok', name: '러닝화', exportData: { mall: 's', category: 'shoes', url: 'https://shop.example/s', size: 'FREE', measures: null, verdicts: [] }, reviewViews: {} })
  assert.equal(out.item.verdictStatus, 'unsupported')
  assert.equal(parseEnvelopeData(out).item.verdictStatus, 'unsupported')
  // 신발이 아닌 옷은 새 필드가 생기지 않는다
  assert.ok(!('verdictStatus' in sanitizeItem(fakeEnvelope().item)))
})


// ---- 신발 사이즈표 ↔ 사용자가 고른 종류 (직접 만든 가짜 HTML·가짜 DOM이에요. 실제 무신사·크롬에서 확인한 것이 아니에요) ----
const SC_REVIEWS = Array.from({ length: 3 }, (_, i) => ({ '@type': 'Review', reviewBody: `키 17${i} 몸무게 7${i} 250 사이즈 구매 정사이즈로 잘 맞아요` }))
const scPage = (title, opts, table = '') =>
  `<html><head><script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'Product', name: title, review: SC_REVIEWS }] })}</script></head><body><h1>${title}</h1><ul>${opts.map((o) => `<li><span>${o}</span></li>`).join('')}</ul>${table}</body></html>`
const SC_SHOE_OPTS = ['230 (230-235)', '240 (240-245)', '250 (250-255)']
const SC_FOOT_TABLE = '<table><tr><th>사이즈</th><th>발길이</th><th>가슴</th></tr><tr><td>230</td><td>230</td><td>50</td></tr><tr><td>240</td><td>240</td><td>52</td></tr><tr><td>250</td><td>250</td><td>54</td></tr></table>'
const scProfile = buildProfile({ gender: 'male', height: '175', weight: '70', preferredFit: 'regular', measurements: {} }).profile

test('shoeChartNotice: 신발 상품에서 신발이 아닌 종류를 고르면 안내와 되돌리기 칩, 옷 상품에서 신발을 고르면 설명, 같은 종류는 없음', () => {
  const shoe = { category: 'shoes', sizeChart: { unit: 'mm', measures: { 250: { footLength: 250 } } }, shoeOptionLabels: SC_SHOE_OPTS }
  const n = shoeChartNotice(shoe, 'top')
  assert.deepEqual(n, { kind: 'shoe-chart-not-shoes', message: '신발 사이즈표라 이 종류로는 실측 비교를 하지 않아요', actionCategory: 'shoes', actionLabel: '신발로 다시 보기' })
  assert.equal(shoeChartNotice(shoe, 'shoes'), null)
  assert.equal(shoeChartNotice(shoe, null), null)
  const cloth = { category: 'top', sizeChart: { unit: 'cm', measures: { M: { chest: 50 } } } }
  const c = shoeChartNotice(cloth, 'shoes')
  assert.equal(c.kind, 'clothing-chart-as-shoes')
  assert.equal(c.actionCategory, 'top')
  assert.ok(c.message.includes('옷 사이즈표'))
  assert.equal(shoeChartNotice(cloth, 'top'), null)
  // 발길이 열을 빼고, 남는 실측이 없으면 표를 쓰지 않는다
  assert.equal(chartForNotice({ unit: 'mm', category: 'shoes', measures: { 250: { footLength: 250 } } }, n), null)
  const mixed = chartForNotice({ unit: 'cm', measures: { M: { footLength: 250, chest: 50 } } }, n)
  assert.deepEqual(mixed.measures, { M: { chest: 50 } })
  assert.equal(chartForNotice({ unit: 'cm', measures: { M: { chest: 50 } } }, c), null)
})

test('가짜 HTML: 신발 상품을 상의로 고르면 발길이는 부위 판정에서 빠지고 안내가 나오며, 신발로 되돌리면 신발 비교로 돌아온다', () => {
  const doc = () => fakeDocument(scPage('Daily item', SC_SHOE_OPTS, SC_FOOT_TABLE))
  const auto = analyzePage(doc(), '', scProfile)
  assert.equal(auto.category, 'shoes')
  assert.equal(auto.categoryNotice, null)
  assert.ok(auto.shoeView, '신발이면 신발 비교')
  const top = analyzePage(doc(), '', scProfile, '', { categoryOverride: 'top' })
  assert.equal(top.category, 'top')
  assert.equal(top.categoryOverridden, true)
  assert.equal(top.categoryNotice.message, '신발 사이즈표라 이 종류로는 실측 비교를 하지 않아요')
  assert.equal(top.categoryNotice.actionLabel, '신발로 다시 보기')
  assert.equal(top.shoeView, null)
  assert.ok(!JSON.stringify(top.compareView).includes('발길이'), '비교 표에 발길이가 없다')
  assert.ok(!top.exportData.verdicts.some((v) => v.part === 'footLength'), '판정에 발길이가 없다')
  assert.ok(!(top.exportData.measures && 'footLength' in top.exportData.measures))
  const back = analyzePage(doc(), '', scProfile, '', { categoryOverride: top.categoryNotice.actionCategory })
  assert.equal(back.category, 'shoes')
  assert.equal(back.categoryNotice, null)
  assert.ok(back.shoeView)
  // 옵션만 있는 신발 페이지도 같다
  const optOnly = analyzePage(fakeDocument(scPage('Daily item', SC_SHOE_OPTS)), '', scProfile, '', { categoryOverride: 'outer' })
  assert.equal(optOnly.categoryNotice.kind, 'shoe-chart-not-shoes')
  assert.ok(!JSON.stringify(optOnly.compareView).includes('발길이'))
  assert.equal(optOnly.sizeChartMissing, true)
})

test('가짜 HTML: 옷 상품을 신발로 고르면 설명이 나오고 옷 사이즈표는 신발 비교에 쓰지 않는다', () => {
  const html = scPage('Daily item', [], '<table><tr><th>사이즈</th><th>가슴</th><th>총장</th></tr><tr><td>S</td><td>50</td><td>67</td></tr><tr><td>M</td><td>52</td><td>69</td></tr></table>')
  const auto = analyzePage(fakeDocument(html), '', scProfile)
  assert.equal(auto.category, 'top')
  const forced = analyzePage(fakeDocument(html), '', scProfile, '', { categoryOverride: 'shoes' })
  assert.equal(forced.category, 'shoes')
  assert.equal(forced.categoryNotice.kind, 'clothing-chart-as-shoes')
  assert.equal(forced.categoryNotice.actionCategory, 'top')
  assert.equal(forced.compareView, null)
})

test('웹 recategorizeProduct: 신발 상품을 상의로 고르면 발길이를 빼고 안내하며, 신발로 되돌리면 안내가 사라진다', () => {
  const base = parsePage(fakeDocument(scPage('Daily item', SC_SHOE_OPTS, SC_FOOT_TABLE)), '')
  assert.equal(base.category, 'shoes')
  const top = recategorizeProduct(base, 'top')
  assert.equal(top.category, 'top')
  assert.equal(top.categoryNotice.actionCategory, 'shoes')
  const cmp = compareSizes({ chart: top.sizeChart, bodyValues: {}, category: 'top' })
  assert.ok(!JSON.stringify(cmp).includes('footLength') && !JSON.stringify(cmp).includes('발길이'))
  assert.ok(!generateFitComment(scProfile, top).perSize.some((p) => p.verdicts.some((v) => v.part === 'footLength')))
  const back = recategorizeProduct(base, top.categoryNotice.actionCategory)
  assert.equal(back.category, 'shoes')
  assert.equal(back.categoryNotice, null)
  assert.equal(back.sizeChart.unit, base.sizeChart.unit)
  assert.ok(shoeViewFor(back, scProfile))
  const cloth = parsePage(fakeDocument(scPage('Daily item', [], '<table><tr><th>사이즈</th><th>가슴</th></tr><tr><td>S</td><td>50</td></tr><tr><td>M</td><td>52</td></tr></table>')), '')
  const asShoes = recategorizeProduct(cloth, 'shoes')
  assert.equal(asShoes.categoryNotice.kind, 'clothing-chart-as-shoes')
  assert.equal(asShoes.sizeChart, null)
})

await atest('content.js(가짜 DOM, vm): 신발 페이지를 상의로 바꾸면 안내와 되돌리기 칩이 보이고, 칩을 누르면 신발로 돌아간다', async () => {
  const { texts, created } = await runContentInFakeDom(scPage('Daily item', SC_SHOE_OPTS))
  const waitFor = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)) }
  const chip = (label) => created.filter((e) => e.tagName === 'BUTTON' && /^cat( on)?$/.test(e.className) && e._text === label).at(-1)
  const NOTICE = '신발 사이즈표라 이 종류로는 실측 비교를 하지 않아요'
  assert.ok(chip('신발'), '처음에는 신발로 분류')
  assert.ok(!texts.includes(NOTICE), '처음에는 안내가 없다')
  const topChip = created.find((e) => e.tagName === 'BUTTON' && /^cat( on)?$/.test(e.className) && e._text && e._text !== '신발')
  assert.ok(topChip, '신발이 아닌 종류 칩')
  const before = texts.length
  topChip.click()
  await waitFor(() => texts.slice(before).includes(NOTICE))
  const after = texts.slice(before)
  assert.ok(after.includes(NOTICE), '안내 한 줄')
  assert.ok(!after.some((t) => t.includes('발길이') && /적당|넉넉|타이트/.test(t)), '발길이 판정이 나오지 않는다')
  const revert = chip('신발로 다시 보기')
  assert.ok(revert, '되돌리기 칩')
  const mark = texts.length
  revert.click()
  await waitFor(() => texts.slice(mark).some((t) => t.includes('내 발길이') || t.includes('발길이를 알 수 없어요')))
  assert.ok(!texts.slice(mark).includes(NOTICE), '되돌린 뒤에는 안내가 없다')
  assert.ok(texts.slice(mark).some((t) => t.includes('발길이')), '신발 비교로 돌아왔다')
})

// ---- 웹 화면 서버 렌더 테스트: 컴포넌트를 실제로 그려 보고 핵심 글자·구조를 확인한다 (실제 브라우저·쇼핑몰 확인은 아님) ----
import { loadComponents, render, textOf } from './lib/renderJsx.mjs'

const WEB = await loadComponents()
const webProfile = shoeProfile({ footWidth: 'wide', measurements: { footLength: '233' } })
const WIDTH_TABLE = `<table><tr><th>사이즈</th><th>발길이</th><th>발볼</th></tr><tr><td>240</td><td>240</td><td>92</td></tr><tr><td>250</td><td>250</td><td>98</td></tr><tr><td>260</td><td>260</td><td>102</td></tr></table>`
const webShoeProduct = () => ({
  ...parsePage(fakeDocument(`<html><head><title>러닝 스니커즈</title></head><body><h1>러닝 스니커즈</h1>${WIDTH_TABLE}</body></html>`), ''),
  mall: 'shop', url: 'https://shop.example/shoe',
})
const noop = () => {}

test('웹 렌더: ShoeCompare - 발볼 근거 한 줄, 추천 배지, 행 구성', () => {
  const product = webShoeProduct()
  assert.equal(product.category, 'shoes')
  const view = shoeViewFor(product, webProfile)
  assert.ok(view.widthLine)
  const html = render(WEB.ShoeCompare, { view, selectedSize: null, onSelect: noop })
  const txt = textOf(html)
  assert.ok(html.includes('class="card tone-measure shoe-compare"'))
  assert.ok(txt.includes('신발 사이즈 비교') && txt.includes('내 발길이 233mm') && txt.includes('발볼 넓은 편'))
  assert.ok(html.includes('shoe-width-line') && txt.includes('사이즈표 발볼 기준, 휴리스틱'), '발볼 근거 한 줄')
  assert.ok(txt.includes(view.widthLine))
  assert.equal((html.match(/class="size-tab/g) || []).length, 3)
  assert.ok(html.includes('tab-badge') && txt.includes('추천'))
  assert.ok(txt.includes('휴리스틱'))
  assert.equal(render(WEB.ShoeCompare, { view: null }), '')
})

test('웹 렌더: ShoeCompare - 발길이를 모르면 안내, 발볼 근거 줄은 없다', () => {
  const view = { footLength: null, footWidthLabel: '', rows: [], reasons: [], notes: ['발길이를 입력하면 추천해요'], widthLine: '', heuristicNote: '휴리스틱 기준이에요' }
  const html = render(WEB.ShoeCompare, { view, selectedSize: null })
  assert.ok(textOf(html).includes('발길이를 알 수 없어요') && textOf(html).includes('발길이를 입력하면 추천해요'))
  assert.ok(!html.includes('shoe-width-line') && !html.includes('size-tab'))
})

test('웹 렌더: CategoryPicker - 안내 한 줄과 신발로 되돌리는 버튼', () => {
  const base = webShoeProduct()
  const top = recategorizeProduct(base, 'top')
  assert.ok(top.categoryNotice)
  const html = render(WEB.CategoryPicker, { product: top, onPick: noop })
  const txt = textOf(html)
  assert.ok(html.includes('category-notice') && txt.includes('신발 사이즈표라 이 종류로는 실측 비교를 하지 않아요'))
  assert.ok(/<button[^>]*class="chip small"[^>]*>신발로 다시 보기<\/button>/.test(html), '되돌리기 버튼')
  assert.ok(txt.includes('직접 고른 종류예요'))
  assert.ok(html.includes('aria-pressed="true"'))
  // 안내가 없으면(신발로 되돌린 뒤) 줄도 버튼도 없다
  const back = recategorizeProduct(base, 'shoes')
  const html2 = render(WEB.CategoryPicker, { product: back, onPick: noop })
  assert.ok(!html2.includes('category-notice') && !textOf(html2).includes('신발로 다시 보기'))
  // 신뢰도 높고 직접 고르지 않았으면 아무것도 그리지 않는다
  assert.equal(render(WEB.CategoryPicker, { product: { category: 'top', categoryConfidence: 'high' }, onPick: noop }), '')
})

test('웹 렌더: SizeSummary - 사이즈 칩, 추천 표시, 실측, 표가 없을 때 안내', () => {
  const clothing = { ...PRODUCTS['https://shop-a.example.com/goods/12345'] }
  const result = generateFitComment(profile, clothing, {})
  const compare = compareSizes({ chart: clothing.sizeChart, bodyValues: bodyValuesForProfile(profile).values, measured: result.measured, category: 'top', calibration: {} })
  const html = render(WEB.SizeSummary, { compare, recommendedSize: result.recommendedSize, category: 'top' })
  const txt = textOf(html)
  assert.ok(txt.includes('사이즈표 요약'))
  assert.equal((html.match(/class="ss-chip( on)?"/g) || []).length, 3)
  assert.ok(html.includes('ss-chip on') && txt.includes(`${result.recommendedSize} 추천`))
  assert.ok(txt.includes(`${result.recommendedSize} 실측`) && txt.includes('cm'))
  const none = textOf(render(WEB.SizeSummary, { compare: { sizes: [] }, recommendedSize: null, category: 'top' }))
  assert.ok(none.includes(NO_CHART_MESSAGE) && none.includes('아래 사이즈표를 확인해 주세요'))
})

test('웹 렌더: SimilarityCompare - 후기 체형이 있을 때만 카드를 그리고 접힌 상태 구조', () => {
  const reviews = [
    { id: 1, nick: '구매자A', height: 176, weight: 72, gender: 'male', size: 'L' },
    { id: 2, nick: '구매자B', height: null, weight: null, size: 'M' },
  ]
  const html = render(WEB.SimilarityCompare, { profile, reviews })
  const txt = textOf(html)
  assert.ok(html.includes('card tone-compare') && txt.includes('체형 비교') && txt.includes('내 체형과 비교하기'))
  assert.ok(html.includes('aria-expanded="false"') && html.includes('aria-controls="sim-compare-panel"'))
  assert.ok(!html.includes('sim-compare-panel"') || !html.includes('id="sim-compare-panel"'), '접힌 상태에서는 본문이 없다')
  assert.equal(render(WEB.SimilarityCompare, { profile, reviews: [reviews[1]] }), '', '체형 후기가 없으면 그리지 않는다')
})

test('웹 렌더: Wardrobe - 지원하지 않는 신발 사이즈는 이유를 보여주고, mm 신발과 옷은 판정을 보여준다', () => {
  const mk = (size, extra = {}) => makeWardrobeItem({
    product: { name: '러닝화', mall: 'shop', category: 'shoes', url: `https://shop.example/s-${size}`, sizeChart: { measures: { [size]: { length: 1 } } } },
    size, profile: { gender: 'male', height: 175, weight: 70, footLength: 265 }, now: 1, ...extra,
  })
  const un = mk('M')
  assert.equal(un.verdictStatus, 'unsupported')
  const html = render(WEB.Wardrobe, { items: [{ ...un, id: 'a' }], onDelete: noop, onBack: noop })
  const txt = textOf(html)
  assert.ok(html.includes('wd-unsupported'))
  assert.ok(txt.includes(SHOE_UNSUPPORTED_NOTE), '이유 문구')
  assert.ok(txt.includes('사이즈 이름이 mm가 아니라서 내 발길이와 비교하지 못했어요'))
  assert.ok(!txt.includes('부위별 판정 없음'))
  // 비슷한 옷 카드(결과 화면용)에서도 같은 이유가 보인다
  const peer = { ...un, id: 'p', measures: { footLength: 265 }, product: { ...un.product, url: 'https://shop.example/other' } }
  const target = { ...mk('L'), id: 'current', measures: { footLength: 270 }, product: { ...un.product, url: 'https://shop.example/cur' } }
  const sim = textOf(render(WEB.SimilarInWardrobe, { target, wardrobe: [peer] }))
  assert.ok(sim.includes('내 옷장 속 비슷한 옷') && sim.includes(SHOE_UNSUPPORTED_NOTE), '비슷한 옷 카드에도 이유가 보인다')
  // 빈 옷장
  assert.ok(textOf(render(WEB.Wardrobe, { items: [], onDelete: noop, onBack: noop })).includes('아직 담은 옷이 없어요'))
})

test('웹 렌더: ResultView(옷) - 요약·체형 비교·사이즈표가 나오고 신발 비교는 없다', () => {
  const clothing = { ...PRODUCTS['https://shop-a.example.com/goods/12345'], source: 'demo' }
  const html = render(WEB.ResultView, { product: clothing, profile, calibration: {}, feedbackCount: 0, onFeedback: noop, onRestart: noop, wardrobe: [], onSaveWardrobe: noop })
  const txt = textOf(html)
  assert.ok(txt.includes(clothing.name) && txt.includes('A몰') && txt.includes('데모'))
  assert.ok(txt.includes('사이즈표 요약'))
  assert.ok(txt.includes('체형 비교'), '옷은 체형 비교가 있다')
  assert.ok(!html.includes('shoe-compare') && !txt.includes('신발 사이즈 비교'))
  assert.ok(/옷장에 담기 \((S|M|L)\)/.test(txt) && txt.includes('다른 옷 찾기'))
})

test('웹 렌더: ResultView(신발) - 신발 비교와 발볼 근거, 옷 전용 카드는 없다', () => {
  const product = webShoeProduct()
  const html = render(WEB.ResultView, { product, profile: webProfile, calibration: {}, feedbackCount: 0, onFeedback: noop, onRestart: noop, wardrobe: [], onSaveWardrobe: noop })
  const txt = textOf(html)
  assert.ok(html.includes('shoe-compare') && txt.includes('신발 사이즈 비교') && txt.includes('내 발길이 233mm'))
  assert.ok(html.includes('shoe-width-line'), '발볼 근거 한 줄')
  assert.ok(!txt.includes('사이즈표 요약') && !txt.includes('체형 비교'), '신발에는 옷 전용 카드가 없다')
  assert.ok(/옷장에 담기 \(\d{3}\)/.test(txt), '추천 mm가 담기 버튼에 들어간다')
  assert.ok(txt.includes('다른 옷 찾기'))
})


// ---- 신발 후속 리뷰 수정 (v1) ----
test('리뷰 수정: 렌더 도우미는 가짜 window/localStorage를 남기지 않는다', () => {
  assert.equal(typeof window, 'undefined')
  assert.equal(typeof localStorage, 'undefined')
})

test('리뷰 수정: esbuild는 devDependencies에 고정되어 있다', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.devDependencies.esbuild, /^\d+\.\d+\.\d+$/)
})

test('리뷰 수정: 발볼로 내린 뒤 "작아요" 리뷰가 많아도 다시 올리지 않고 안내만 한다', () => {
  const sizeWidths = mmWidths([[230, 90], [240, 92], [250, 104], [260, 106]])
  const mkR = (size, fit) => ({ size, view: { shoeFeel: { size: fit, width: 'normal', extras: [] } } })
  const reviews = [mkR('240', 'small'), mkR('240', 'small'), mkR('240', 'small')]
  // 새 규칙: 발 240(허용 235~250)에서 relaxed 기본 추천 250(+10)이 발볼로 240(0)까지 내려가요.
  const r = recommendShoe({ options: widthOpts([230, 240, 250, 260]), footLength: 240, preferredFit: 'relaxed', footWidth: 'narrow', sizeWidths, reviews })
  assert.equal(r.recommended.mm, 240)
  assert.ok(r.widthLine.includes('한 단계 작은'))
  assert.ok(r.notes.some((t) => t.includes('작다는 의견이 많지만') && t.includes('다시 올리지 않았어요')))
  assert.ok(!r.reasons.some((t) => t.includes('한 단계 큰')))
})

test('리뷰 수정: 가져오기에서 mm 신발은 발길이 모름 이유, 읽을 수 없는 이름은 미지원 이유', () => {
  const env = (item) => ({ app: 'fitcheck', kind: 'wardrobe-item', v: 1, item: { product: { name: '남성 러닝화', mall: 'shop', category: 'shoes', url: 'https://shop.example/s' }, verdicts: [], ...item } })
  const mm = parseImportText(JSON.stringify(env({ size: '250' })))
  assert.equal(mm.item.verdictStatus, 'unsupported')
  assert.equal(mm.item.verdictNote, SHOE_NO_FOOT_NOTE)
  const un = parseImportText(JSON.stringify(env({ size: 'FREE' })))
  assert.equal(un.item.verdictNote, SHOE_UNSUPPORTED_NOTE)
})

const wardrobeShoe = (size, profile, extra = {}) => makeWardrobeItem({
  product: { name: '러닝화', mall: 'shop', category: 'shoes', url: `https://shop.example/f-${size}`, sizeChart: { measures: { [size]: { length: 1 } } } },
  size, profile, now: 1, ...extra,
})

test('웹 렌더: Wardrobe - 발길이를 모르는 mm 신발에는 "mm가 아니라서" 문구가 붙지 않는다', () => {
  const item = { ...wardrobeShoe('250', null), id: 'n' }
  assert.equal(item.verdictNote, SHOE_NO_FOOT_NOTE)
  const txt = textOf(render(WEB.Wardrobe, { items: [item], onDelete: noop, onBack: noop }))
  assert.ok(txt.includes(SHOE_NO_FOOT_NOTE))
  assert.ok(!txt.includes('mm가 아니라서'))
})

test('웹 렌더: Wardrobe - 환산한 사이즈는 판정과 함께 환산 안내가 보인다', () => {
  const item = { ...wardrobeShoe('US 9', { gender: 'male', height: 175, weight: 70, footLength: 265 }), id: 'c' }
  assert.equal(item.verdictStatus, 'converted')
  assert.ok(item.verdicts.length > 0)
  const html = render(WEB.Wardrobe, { items: [item], onDelete: noop, onBack: noop })
  const txt = textOf(html)
  assert.ok(html.includes('wd-converted'))
  assert.ok(txt.includes('발길이') && txt.includes(item.verdictNote) && txt.includes('휴리스틱'))
})

test('웹 렌더: TryOnPanel 신발 분기 - 미지원/발길이 모름/환산 안내를 구분해 보여준다', () => {
  const shoe = { name: '러닝화', mall: 'shop', category: 'shoes', url: 'https://shop.example/t', sizeChart: { measures: {} } }
  const tx = (selectedSize, profile) => textOf(render(WEB.TryOnPanel, { product: shoe, profile, verdicts: [], selectedSize, captureRef: { current: null } }))
  const base = tx('270', null)
  assert.ok(base.includes('신발은 사진 합성') && !base.includes('AI 합성하기'))
  const un = tx('M', { gender: 'male', height: 175, weight: 70, footLength: 265 })
  assert.ok(un.includes(SHOE_UNSUPPORTED_NOTE) && un.includes('mm로 읽거나 환산하지 못해'))
  const nf = tx('270', null)
  assert.ok(nf.includes(SHOE_NO_FOOT_NOTE) && nf.includes('발길이를 몰라') && !nf.includes('환산하지 못해'))
  const cv = tx('US 9', { gender: 'male', height: 175, weight: 70, footLength: 265 })
  assert.ok(cv.includes('약 270mm') && !cv.includes('환산하지 못해'))
})

// ---------- 신발 허용 구간 (발 기준 -5 ~ +10mm, 휴리스틱) ----------
import { classifyEase as classifyEaseShoe, EASE_RULES as EASE_RULES_SHOE, SHOE_WINDOW } from '../src/lib/fitEngine.js'
import { shoeOptionVerdict, shoeCardText, shoeComment } from '../src/lib/shoeFit.js'

const winOpts = (mms) => parseShoeOptions(mms.map(String))
const verdictsOf = (r) => Object.fromEntries(r.rows.map((x) => [x.mm, x.verdict]))
const MIXED_MSG_RE = /^이 상품에는 내 발\(\d+mm\)에 맞는 사이즈가 없어요\. 가장 가까운 사이즈 \d+도 [\d.]+mm (작아요|커요)\.$/

test('신발 구간: 발 270에서 260 부적합, 265 애매, 270·275 딱 맞음, 280 여유, 285 이상 부적합, 추천 270', () => {
  const r = recommendShoe({ options: winOpts([260, 265, 270, 275, 280, 285, 290]), footLength: 270 })
  assert.deepEqual(verdictsOf(r), { 260: '부적합', 265: '애매', 270: '딱 맞음', 275: '딱 맞음', 280: '여유', 285: '부적합', 290: '부적합' })
  assert.deepEqual(r.rows.map((x) => x.verdictKey), ['unfit', 'iffy', 'fit', 'fit', 'roomy', 'unfit', 'unfit'])
  assert.deepEqual(r.rows.map((x) => x.level), [0, 1, 2, 2, 3, 4, 4])
  assert.deepEqual(r.rows.map((x) => x.fit), [false, true, true, true, true, false, false])
  assert.deepEqual(r.rows.map((x) => x.unfit), ['small', null, null, null, null, 'large', 'large'])
  assert.equal(r.recommended.mm, 270)
  assert.equal(r.noFit, null)
  assert.deepEqual(r.window, { min: 265, max: 280 })
  assert.ok(r.windowText.includes('265~280mm') && r.windowText.includes('휴리스틱'))
  assert.ok(!r.reasons.some((t) => t.includes('가장 가까워요')))
})

test('신발 구간: 선호 핏 목표 여유 slim 0 / regular 2 / relaxed 8, 동률이면 더 큰 사이즈', () => {
  const options = winOpts([265, 270, 275, 280])
  assert.equal(recommendShoe({ options, footLength: 270, preferredFit: 'slim' }).recommended.mm, 270)
  assert.equal(recommendShoe({ options, footLength: 270, preferredFit: 'regular' }).recommended.mm, 270)
  assert.equal(recommendShoe({ options, footLength: 270, preferredFit: 'relaxed' }).recommended.mm, 280)
  // 발 272.5, slim(목표 0): 270(-2.5)과 275(+2.5)가 동률이면 큰 쪽(275)을 골라요 (발가락 공간이 남는 쪽).
  assert.equal(recommendShoe({ options: winOpts([270, 275]), footLength: 272.5, preferredFit: 'slim' }).recommended.mm, 275)
})

test('신발 구간: 발 270 + 230/240/250은 전부 부적합, 추천 없음, 안내문이 정확히 같다', () => {
  const r = recommendShoe({ options: parseShoeOptions(shoeOpts), footLength: 270 })
  assert.deepEqual(r.rows.map((x) => x.verdict), ['부적합', '부적합', '부적합'])
  assert.equal(r.recommended, null)
  assert.ok(r.rows.every((x) => !x.recommended))
  assert.equal(r.noFit.direction, 'small')
  assert.equal(r.noFit.message, '이 상품에는 내 발(270mm)에 맞는 사이즈가 없어요. 가장 큰 사이즈 250도 20mm 작아요.')
  assert.deepEqual(r.rows.map((x) => x.ease), [-40, -30, -20])
  const txt = JSON.stringify([r.reasons, r.notes])
  assert.ok(!txt.includes('가장 가까워요') && !txt.includes('추천해요'))
  const out = withShoeRecommendation({ recommendedSize: 'M', headline: 'h', body: 'b' }, r)
  assert.equal(out.recommendedSize, null)
  assert.equal(out.headline, '맞는 사이즈가 없어요')
  assert.ok(out.body.includes(r.noFit.message))
  // 카드 글도 옷용 문구('무난해요', '슬림 핏 기준') 없이 신발 판정에서 만든다
  const t = shoeCardText(r)
  assert.equal(t.summary, r.noFit.message)
  assert.ok(!JSON.stringify(t).includes('무난'))
})

test('신발 구간: 모두 너무 큰 경우와 섞인 경우의 안내문', () => {
  const big = recommendShoe({ options: winOpts([290, 300, 310]), footLength: 270 })
  assert.equal(big.recommended, null)
  assert.equal(big.noFit.direction, 'large')
  assert.equal(big.noFit.message, '이 상품에는 내 발(270mm)에 맞는 사이즈가 없어요. 가장 작은 사이즈 290도 20mm 커요.')
  // 작은 쪽과 큰 쪽만 있고 사이가 비면 가장 가까운 쪽을 알려요: 발 270, 255(-15) / 290(+20)
  const mixed = recommendShoe({ options: winOpts([255, 290]), footLength: 270 })
  assert.equal(mixed.recommended, null)
  assert.equal(mixed.noFit.direction, 'mixed')
  assert.equal(mixed.noFit.message, '이 상품에는 내 발(270mm)에 맞는 사이즈가 없어요. 가장 가까운 사이즈 255도 15mm 작아요.')
  assert.ok(MIXED_MSG_RE.test(mixed.noFit.message))
  assert.equal(withShoeRecommendation({ recommendedSize: 'M' }, big).recommendedSize, null)
})

test('신발 구간: 범위 옵션은 허용 구간과 겹치면 허용(대표값 lo, 구간 아래면 구간 하한으로 판정)', () => {
  const o265 = parseShoeOption('265 (265-270)')
  const a = shoeOptionVerdict(o265, 270)
  assert.equal(a.verdict.label, '애매')
  assert.equal(a.ease, -5)
  assert.equal(a.fit, true)
  // 250 (250-255) vs 발 258: 구간 253~268과 겹침 -> 하한 253으로 판정(애매)
  const o250 = parseShoeOption('250 (250-255)')
  const b = shoeOptionVerdict(o250, 258)
  assert.equal(b.verdict.label, '애매')
  assert.equal(b.ease, -5)
  assert.equal(b.fit, true)
  // 발 270이면 구간 265~280과 겹치지 않아 부적합, 표시 여유는 lo - foot = -20
  const c = shoeOptionVerdict(o250, 270)
  assert.equal(c.verdict.label, '부적합')
  assert.equal(c.ease, -20)
  assert.equal(c.fit, false)
  assert.equal(c.unfit, 'small')
  const r = recommendShoe({ options: [o250, o265, parseShoeOption('280 (280-285)')], footLength: 270 })
  assert.deepEqual(verdictsOf(r), { 250: '부적합', 265: '애매', 280: '여유' })
  assert.equal(r.rows[0].fit, false)
})

test('신발 구간: 발볼·리뷰 보정은 한 단계 이동한 결과가 허용 사이즈일 때만 적용하고, 막히면 이유를 남긴다', () => {
  const options = winOpts([270, 275, 280, 285])
  // 발 270: 275(+5)가 기본(목표 2에서 270과 275 중 270이 가깝지만 relaxed로 8에 가까운 280을 고르게 함)
  const base = recommendShoe({ options, footLength: 270, preferredFit: 'relaxed' })
  assert.equal(base.recommended.mm, 280)
  // 발볼 넓음: 285(+15)는 구간 밖이라 올리지 않는다
  const wide = recommendShoe({ options, footLength: 270, preferredFit: 'relaxed', footWidth: 'wide' })
  assert.equal(wide.recommended.mm, 280)
  assert.ok(wide.notes.some((t) => t.includes('허용 구간(265~280mm) 밖이라 올리지 않았어요')))
  // 리뷰 '작아요' 과반도 285로 올리지 않는다
  const mk = (size, fit) => ({ size, view: { shoeFeel: { size: fit, extras: [] } } })
  const small = recommendShoe({ options, footLength: 270, preferredFit: 'relaxed', reviews: [mk('280', 'small'), mk('280', 'small'), mk('280', 'true')] })
  assert.equal(small.recommended.mm, 280)
  assert.ok(small.notes.some((t) => t.includes('허용 구간(265~280mm) 밖이라 올리지 않았어요')))
  assert.ok(!small.reasons.some((t) => t.includes('작다고')))
  // 구간 안이면 올린다: 270 -> 275
  const up = recommendShoe({ options, footLength: 270, preferredFit: 'slim', footWidth: 'wide' })
  assert.equal(up.recommended.mm, 275)
  // 리뷰 '커요' 과반: 한 단계 아래가 구간 밖이면 내리지 않는다 (발 270 옵션 260/270: 260은 부적합)
  const large = recommendShoe({ options: winOpts([260, 270]), footLength: 270, reviews: [mk('270', 'large'), mk('270', 'large'), mk('270', 'large')] })
  assert.equal(large.recommended.mm, 270)
  assert.ok(large.notes.some((t) => t.includes('내리지 않았어요')))
})

test('신발 구간: 같은 판정 함수를 fitEngine·옷장·사이즈표 추천이 함께 쓴다', () => {
  assert.deepEqual(EASE_RULES_SHOE.footLength, { tight: -5, snug: 0, regular: 5, relaxed: 10 })
  assert.deepEqual({ ...SHOE_WINDOW }, { minEase: -5, fitMaxEase: 5, maxEase: 10 })
  const labels = [-6, -5, -0.1, 0, 5, 5.1, 10, 10.1].map((e) => classifyEaseShoe('footLength', e).label)
  assert.deepEqual(labels, ['부적합', '애매', '애매', '딱 맞음', '딱 맞음', '여유', '여유', '부적합'])
  // 보정 오프셋은 ease에서 빼서 적용
  assert.equal(classifyEaseShoe('footLength', 3, 4).label, '애매')
  // 옷 사이즈표 경로(partVerdicts)도 같은 판정
  const pv = partVerdicts({ footLength: 270 }, { footLength: 280 }, 'shoes')
  assert.equal(pv[0].verdict, '여유')
  assert.equal(pv[0].key, 'roomy')
  assert.equal(partVerdicts({ footLength: 270 }, { footLength: 250 }, 'shoes')[0].key, 'unfit')
  const chart = { measures: { 250: { footLength: 250 }, 270: { footLength: 270 }, 290: { footLength: 290 } } }
  const rs = recommendSize({ footLength: 270 }, chart, 'shoes', 'regular')
  assert.equal(rs.bestSize, '270')
  assert.deepEqual(rs.perSize.map((x) => x.verdicts[0].verdict), ['부적합', '딱 맞음', '부적합'])
  // 옷장 판정
  const prof = { gender: 'male', height: 175, weight: 70, measurements: { footLength: 270 } }
  const wf = (size) => shoeWardrobeFields({ product: { name: '러닝화' }, size, profile: prof }).verdicts[0]
  assert.equal(wf('265').verdict, '애매')
  assert.equal(wf('270').verdict, '딱 맞음')
  assert.equal(wf('280').verdict, '여유')
  assert.equal(wf('250 (250-255)').verdict, '부적합')
  assert.equal(wf('250 (250-255)').key, 'unfit')
  assert.equal(wf('250 (250-255)').ease, -20)
})

test('신발 구간: US/EU 환산 후 옷장 판정도 같은 구간을 쓴다', () => {
  const prof = { gender: 'male', height: 175, weight: 70, measurements: { footLength: 270 } }
  const mk = (size) => makeWardrobeItem({ product: { name: '러닝화', mall: 'm', category: 'shoes', url: 'https://shop.example/u', sizeChart: { measures: { [size]: { length: 1 } } } }, size, profile: prof })
  assert.equal(mk('US 9').verdicts[0].verdict, '딱 맞음') // 270
  assert.equal(mk('US 10').verdicts[0].verdict, '여유') // 280 (+10)
  assert.equal(mk('US 11').verdicts[0].verdict, '부적합') // 290
  assert.equal(mk('US 7').verdicts[0].verdict, '부적합') // 250
  assert.equal(mk('EU 42').verdicts[0].verdict, '딱 맞음') // 270
  assert.equal(mk('EU 40').verdicts[0].verdict, '부적합') // 255
})

test('신발 구간: 옷장 담기 시 맞는 사이즈가 없는 신발은 판정이 부적합', () => {
  const product = { name: '러닝화', mall: 'm', category: 'shoes', url: 'https://shop.example/n', sizeChart: { measures: { 250: { footLength: 250 } } } }
  const item = makeWardrobeItem({ product, size: '250 (250-255)', profile: { gender: 'male', height: 175, weight: 70, measurements: { footLength: 270 } } })
  assert.equal(item.verdicts[0].verdict, '부적합')
  assert.equal(item.verdicts[0].key, 'unfit')
  // 가져오기도 새 키를 거부하지 않는다
  const imp = parseImportText(JSON.stringify({ app: 'fitcheck', kind: 'wardrobe-item', v: 1, item: { product: { name: '러닝화', mall: 'm', category: 'shoes', url: 'https://shop.example/n' }, size: '250', verdicts: item.verdicts } }))
  assert.equal(imp.ok, true)
  assert.equal(imp.item.verdicts[0].key, 'unfit')
})

test('신발 구간: analyzePage 카드 글은 옷용 문구 대신 신발 판정에서 만든다 (맞는 사이즈 없음 / 있음)', () => {
  const noFit = analyzePage(fakeDocument(shoePage([])), '', shoeProfile({ measurements: { footLength: '270' } }))
  assert.equal(noFit.status, 'ok')
  assert.equal(noFit.recommendedSize, null)
  assert.equal(noFit.shoeView.recommended, null)
  assert.equal(noFit.summary, '이 상품에는 내 발(270mm)에 맞는 사이즈가 없어요. 가장 큰 사이즈 250도 20mm 작아요.')
  assert.equal(noFit.headline, '맞는 사이즈가 없어요')
  const all = JSON.stringify([noFit.summary, noFit.reasons, noFit.headline, noFit.body])
  assert.ok(!all.includes('무난') && !all.includes('슬림 핏 기준') && !all.includes('가장 가까워요'))
  assert.ok(noFit.reasons.some((t) => t.includes('265~280mm')))
  const ok = analyzePage(fakeDocument(shoePage([])), '', shoeProfile({ measurements: { footLength: '245' } }))
  assert.equal(ok.recommendedSize, '250')
  // 요약 한 줄은 '<라벨> 추천' 대신 신발 근거 한 줄(발길이 출처 · 옵션 수 · 리뷰 수)로 바뀌었다 (FEAT-003). 추천 사이즈는 recommendedLabel/큰 사이즈 칸이 보여준다.
  assert.ok(ok.summary.includes('발길이 직접 입력 · 사이즈 옵션 3개 · 리뷰 '))
  assert.equal(ok.recommendedLabel, '250 (250-255)')
  assert.ok(!ok.reasons.some((t) => t.includes('무난')))
})

test('웹 렌더: ShoeCompare - 판정 색 클래스, 부적합 흐리게, 구간 안내, 맞는 사이즈 없음 안내(추천 배지 없음)', () => {
  const view = recommendShoe({ options: winOpts([260, 265, 270, 280, 285]), footLength: 270 })
  const html = render(WEB.ShoeCompare, { view, selectedSize: null, onSelect: noop })
  const txt = textOf(html)
  for (const c of ['v-unfit', 'v-iffy', 'v-fit', 'v-roomy']) assert.ok(html.includes(c), c)
  assert.equal((html.match(/row-unfit/g) || []).length, 2)
  for (const l of ['부적합', '애매', '딱 맞음', '여유']) assert.ok(txt.includes(l), l)
  assert.ok(txt.includes('265~280mm') && txt.includes('휴리스틱'))
  assert.equal((html.match(/tab-badge/g) || []).length, 1)
  const none = recommendShoe({ options: parseShoeOptions(shoeOpts), footLength: 270 })
  const h2 = render(WEB.ShoeCompare, { view: none, selectedSize: null, onSelect: noop })
  const t2 = textOf(h2)
  assert.ok(t2.includes('이 상품에는 내 발(270mm)에 맞는 사이즈가 없어요. 가장 큰 사이즈 250도 20mm 작아요.'))
  assert.ok(h2.includes('shoe-nofit'))
  assert.ok(!h2.includes('tab-badge') && !t2.includes('가장 가까워요') && !t2.includes('추천해요'))
})

await atest('content.js(가짜 DOM, vm): 맞는 사이즈가 없으면 안내문을 보여주고 추천/가장 가까워요 문구를 쓰지 않는다 (가짜 데이터)', async () => {
  // 이 가짜 DOM 프로필은 발길이를 키 175로 추정(265mm)하고, 옵션 230/240/250은 모두 구간(260~275) 밖이에요.
  const { texts } = await runContentInFakeDom(shoePage(SHOE_CARDS))
  assert.ok(texts.includes('이 상품에는 내 발(265mm)에 맞는 사이즈가 없어요. 가장 큰 사이즈 250도 15mm 작아요.'))
  assert.ok(texts.some((t) => t.includes('허용 구간은 260~275mm')))
  assert.ok(texts.includes('부적합'))
  assert.ok(!texts.some((t) => t.includes('가장 가까워요') || t.includes('무난') || (/추천$/.test(t) && t !== '핏체크 · 내 체형 추천')))
  assert.ok(texts.includes('맞는 사이즈가 없어요'))
})

// ---------- 신발 추천 이유 글 (FEAT-003) ----------
// 가짜 상품 페이지: 사이즈는 선택 목록(select/option)으로 둬요 (li 안의 맨 숫자는 '리뷰 250' 오인 방지로 읽지 않아요)
const OPT_PAGE = (name, opts) => `<html><head><title>${name}</title></head><body><h1>${name}</h1><select class="opts">${opts.map((o) => `<option>${o}</option>`).join('')}</select></body></html>`
const CLOTHING_PHRASES = ['슬림 핏 기준', '비슷한 체형의 후기가 없어요', '무난해요']

test('신발 글: shoeComment 헤드라인(딱 맞음/여유/애매)·확신도·옷용 문구 없음', () => {
  const mk = (opts, foot, extra = {}) => recommendShoe({ options: winOpts(opts), footLength: foot, ...extra })
  const fit = shoeComment(mk([260, 270, 290], 270))
  assert.equal(fit.headline, '270이 딱 맞아요')
  assert.equal(fit.confidence, 'medium')
  assert.ok(fit.summary.startsWith('발길이 직접 입력 · 사이즈 옵션 3개 · 리뷰 0건'))
  assert.ok(fit.reasons.some((t) => t.includes('265~280mm')))
  assert.equal(shoeComment(mk([280], 270)).headline, '280이 여유 있게 맞아요')
  assert.equal(shoeComment(mk([265], 270)).headline, '265가 작게 맞을 수 있어요(애매)')
  // 키로 추정한 발길이는 확신도 낮음 + 추정 안내
  const est = shoeComment(mk([270], 270, { footLengthEstimated: true }))
  assert.equal(est.confidence, 'low')
  assert.ok(est.reasons.some((t) => t.includes('키로 추정')))
  // 맞는 사이즈가 없으면 해당 없음
  const none = shoeComment(mk([230, 240, 250], 270))
  assert.equal(none.headline, '맞는 사이즈가 없어요')
  assert.equal(none.confidenceLabel.text, '해당 없음')
  assert.equal(none.confidence, 'low')
  for (const c of [fit, est, none]) assert.ok(!CLOTHING_PHRASES.some((p) => JSON.stringify(c).includes(p)))
  // withShoeRecommendation은 옷용 근거(evidence)와 추천을 신발 결과로 덮어쓴다
  const out = withShoeRecommendation({ recommendedSize: 'M', headline: 'h', body: 'b', evidence: { x: 1 }, confidence: 'high', note: 'n', perSize: [] }, mk([230, 240, 250], 270))
  assert.equal(out.recommendedSize, null)
  assert.equal(out.evidence, null)
  assert.equal(out.confidence, 'low')
  assert.equal(out.headline, '맞는 사이즈가 없어요')
})

test('신발 글: analyzePage 확신도·요약이 신발 결과이고 옷 카드 글은 그대로다', () => {
  const ok = analyzePage(fakeDocument(OPT_PAGE('러닝 스니커즈', ['260', '270', '290'])), '', shoeProfile({ measurements: { footLength: '270' } }))
  assert.equal(ok.headline, '270이 딱 맞아요')
  assert.equal(ok.confidence, 'medium')
  assert.equal(ok.recommendedSize, '270')
  assert.ok(!CLOTHING_PHRASES.some((p) => JSON.stringify([ok.summary, ok.reasons, ok.headline, ok.body, ok.note]).includes(p)))
  assert.equal(ok.reviewViews.isShoes, true)
  const none = analyzePage(fakeDocument(OPT_PAGE('러닝 스니커즈', ['230', '240', '250'])), '', shoeProfile({ measurements: { footLength: '270' } }))
  assert.equal(none.confidenceLabel.text, '해당 없음')
  assert.equal(none.recommendedSize, null)
  // 옷 상품은 기존 옷용 판정 글을 그대로 쓴다 (회귀)
  const cloth = analyzePage(fakeDocument(EXT_HTML), 'https://shop.example/p/1', profile)
  assert.equal(cloth.status, 'ok')
  assert.ok(!cloth.reviewViews.isShoes)
  assert.ok(cloth.confidenceLabel.text.startsWith('확신도'))
})

await atest('content.js(가짜 DOM, vm): 발 270 + 옵션 230/240/250이면 옷용 문구 없이 맞는 사이즈가 없어요 안내, 큰 사이즈 칸 없음 (가짜 데이터)', async () => {
  const { texts, created } = await runContentInFakeDom(OPT_PAGE('러닝 스니커즈', ['230', '240', '250']), {}, { footLength: '270' })
  assert.ok(texts.includes('맞는 사이즈가 없어요'))
  assert.ok(texts.includes('해당 없음'))
  assert.ok(!texts.some((t) => CLOTHING_PHRASES.some((p) => t.includes(p))))
  assert.ok(!created.some((e) => e.className === 'size'), '추천이 없으면 큰 사이즈 칸을 만들지 않는다')
})

await atest('content.js(가짜 DOM, vm): 발 270 + 옵션 260/270/290이면 270이 딱 맞아요 헤드라인과 신발 근거 한 줄 (가짜 데이터)', async () => {
  const { texts } = await runContentInFakeDom(OPT_PAGE('러닝 스니커즈', ['260', '270', '290']), {}, { footLength: '270' })
  assert.ok(texts.includes('270이 딱 맞아요'))
  assert.ok(texts.some((t) => t.startsWith('발길이 직접 입력 · 사이즈 옵션 3개')))
  assert.ok(!texts.some((t) => CLOTHING_PHRASES.some((p) => t.includes(p))))
})

test('웹 렌더: ResultView(신발) 추천 이유 글은 신발 결과이고, 맞는 사이즈가 없으면 사이즈 칸 없이 안내 + 옷장 판정 부적합', () => {
  const mkProduct = (opts) => ({ ...parsePage(fakeDocument(OPT_PAGE('러닝 스니커즈', opts)), ''), mall: 'shop', url: 'https://shop.example/s' })
  const prof = shoeProfile({ measurements: { footLength: '270' } })
  const props = { calibration: {}, feedbackCount: 0, onFeedback: noop, onRestart: noop, wardrobe: [], onSaveWardrobe: noop }
  const okHtml = render(WEB.ResultView, { product: mkProduct(['260', '270', '290']), profile: prof, ...props })
  const okTxt = textOf(okHtml)
  assert.ok(okTxt.includes('270이 딱 맞아요'))
  assert.ok(okHtml.includes('reco-size'))
  assert.ok(!CLOTHING_PHRASES.some((p) => okTxt.includes(p)))
  const noHtml = render(WEB.ResultView, { product: mkProduct(['230', '240', '250']), profile: prof, ...props })
  const noTxt = textOf(noHtml)
  assert.ok(noTxt.includes('맞는 사이즈가 없어요') && noTxt.includes('해당 없음'))
  assert.ok(!noHtml.includes('reco-size'), '추천이 없으면 추천 사이즈 칸이 없다')
  assert.ok(!CLOTHING_PHRASES.some((p) => noTxt.includes(p)))
  // 옷장에 담으면 판정은 부적합 (FEAT-001의 같은 구간 판정)
  const item = makeWardrobeItem({ product: mkProduct(['230', '240', '250']), size: '250', profile: prof })
  assert.equal(item.verdicts[0].verdict, '부적합')
})

// ---------- 상품 대상 성별 ----------
import { classifyTargetGender, targetGenderNotice, genderFromText } from '../src/lib/targetGender.js'
import { shoeGender } from '../src/lib/shoeFit.js'

const tgOpts = (a) => a.map(String)
const tgPage = (name, opts, extraHead = '') =>
  `<html><head><title>${name}</title>${extraHead}</head><body><h1>${name}</h1>` +
  // 가짜 상품 페이지: 사이즈는 선택 목록(select/option)으로 둬요 (li 안의 맨 숫자는 '리뷰 250' 오인 방지로 읽지 않아요)
  `<select class="opts">${opts.map((o) => `<option>${o}</option>`).join('')}</select></body></html>`
const SHOE_ISH = '러닝 스니커즈'

test('대상 성별: 여성 표기 이름 → female, 남성 → male, Unisex/공용/남녀 → unisex', () => {
  assert.equal(classifyTargetGender({ name: '우먼스 에어 스니커즈' }).gender, 'female')
  assert.equal(classifyTargetGender({ name: 'W Air Max (WMNS)' }).gender, 'female')
  assert.equal(classifyTargetGender({ name: '남성 데님 팬츠' }).gender, 'male')
  assert.equal(classifyTargetGender({ name: 'Men Classic Shirt' }).gender, 'male')
  assert.equal(classifyTargetGender({ name: 'Unisex Hoodie' }).gender, 'unisex')
  assert.equal(classifyTargetGender({ name: '남녀공용 후드' }).gender, 'unisex')
  assert.equal(classifyTargetGender({ name: '공용 러닝화' }).gender, 'unisex')
  assert.equal(classifyTargetGender({ name: '남성 여성 겸용 티셔츠' }).gender, 'unisex')
  assert.equal(classifyTargetGender({ name: 'Men & Women Tee' }).gender, 'unisex')
})

test('대상 성별: women이 men을 포함해도 혼동하지 않는다', () => {
  assert.equal(genderFromText("Women's Runner"), 'female')
  assert.equal(genderFromText("Men's Runner"), 'male')
  assert.equal(genderFromText('womens sneaker'), 'female')
  assert.equal(genderFromText('mens sneaker'), 'male')
  assert.equal(genderFromText('Fitment Element Cement'), null)
  assert.equal(classifyTargetGender({ name: 'Women Jacket' }).scores.male, 0)
})

test('대상 성별: 신발 옵션 220~250 → 여성, 260~290 → 남성, 옷은 옵션 범위를 근거로 쓰지 않는다', () => {
  const f = classifyTargetGender({ isShoes: true, optionLabels: tgOpts([220, 230, 240, 250]) })
  assert.equal(f.gender, 'female')
  assert.equal(f.optionRangeText, '220~250')
  assert.deepEqual(f.evidences.map((e) => e.kind), ['option'])
  const m = classifyTargetGender({ isShoes: true, optionLabels: tgOpts([260, 270, 280, 290]) })
  assert.equal(m.gender, 'male')
  assert.equal(classifyTargetGender({ isShoes: true, optionLabels: tgOpts([230, 240, 250, 260, 270]) }).gender, null, '넓은 범위는 모름')
  assert.equal(classifyTargetGender({ isShoes: false, optionLabels: tgOpts([220, 230, 240, 250]) }).gender, null)
  assert.equal(classifyTargetGender({ isShoes: true, optionLabels: ['250 (250-255)'] }).gender, null, '옵션 1개는 범위 근거가 아니다')
})

test('대상 성별: 근거가 충돌하면 모름, 근거가 없으면 null, 결과에 상품명 원문은 없다', () => {
  const conflict = classifyTargetGender({ name: '남성 스니커즈', isShoes: true, optionLabels: tgOpts([230, 240, 250]) })
  assert.equal(conflict.gender, null)
  assert.equal(conflict.confidence, null)
  assert.ok(conflict.evidences.length === 2)
  const none = classifyTargetGender({ name: '클래식 스니커즈', isShoes: true, optionLabels: [] })
  assert.equal(none.gender, null)
  assert.equal(classifyTargetGender().gender, null)
  // 이름 + 옵션이 같은 쪽이면 더 높은 확신
  const both = classifyTargetGender({ name: '여성용 스니커즈', isShoes: true, optionLabels: tgOpts([230, 240, 250]) })
  assert.equal(both.gender, 'female')
  assert.equal(both.confidence, 'high')
  const secret = '아주특별한상품명여성'
  const r = classifyTargetGender({ name: secret, breadcrumb: '신발 여성', jsonLdGender: 'female' })
  assert.ok(!JSON.stringify(r).includes(secret) && !JSON.stringify(r).includes('신발 여성'))
  assert.deepEqual(r.evidences.map((e) => `${e.kind}:${e.score}`), ['name:3', 'breadcrumb:2', 'jsonld:3'])
})

test('대상 성별: parsePage가 이름·옵션·JSON-LD로 product.targetGender를 채운다 (가짜 HTML)', () => {
  const f = parsePage(fakeDocument(tgPage(SHOE_ISH, ['230', '240', '250'])), '')
  assert.equal(f.category, 'shoes')
  assert.equal(f.targetGender.gender, 'female')
  assert.equal(f.targetGender.optionRangeText, '230~250')
  const ld = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: '빈티지 자켓', audience: { '@type': 'PeopleAudience', suggestedGender: 'female' } })}</script>`
  const j = parsePage(fakeDocument(tgPage('빈티지 자켓', [], ld)), '')
  assert.equal(j.targetGender.gender, 'female')
  assert.equal(j.targetGender.isShoes, false)
  const u = parsePage(fakeDocument(tgPage('Unisex 러닝 스니커즈', ['230', '240', '250'])), '')
  assert.equal(u.targetGender.gender, 'unisex')
  const n = parsePage(fakeDocument(tgPage('빈티지 자켓', [])), '')
  assert.equal(n.targetGender.gender, null)
})

test('대상 성별: 프로필 성별과 다를 때만 안내 문구, 신발은 mm 기준 문구 포함', () => {
  const tg = { gender: 'female', optionRangeText: '230~250', isShoes: true }
  const n = targetGenderNotice(tg, 'male')
  assert.equal(n.mismatch, true)
  assert.equal(n.gender, 'female')
  assert.ok(n.text.startsWith('여성용으로 보이는 상품이에요(옵션 230~250)'))
  assert.ok(n.text.includes('판정은 발길이(mm) 기준이에요'))
  assert.equal(targetGenderNotice(tg, 'female'), null)
  assert.equal(targetGenderNotice({ gender: 'unisex' }, 'male'), null)
  assert.equal(targetGenderNotice({ gender: null }, 'male'), null)
  assert.equal(targetGenderNotice(tg, ''), null)
  const clothes = targetGenderNotice({ gender: 'male', optionRangeText: '', isShoes: false }, 'female')
  assert.equal(clothes.text, '남성용으로 보이는 상품이에요.')
  // shoeViewFor: 프로필 남성 + 여성용 상품
  const prod = parsePage(fakeDocument(tgPage(SHOE_ISH, ['230', '240', '250'])), '')
  const v = shoeViewFor(prod, shoeProfile())
  assert.equal(v.targetGender.mismatch, true)
  assert.ok(v.targetGender.text.includes('여성용으로 보이는 상품이에요(옵션 230~250)'))
  assert.equal(shoeViewFor(prod, shoeProfile({ gender: 'female' })).targetGender, null)
  // 판정은 성별과 무관: 같은 발길이면 같은 추천/판정
  const a = shoeViewFor(prod, shoeProfile({ gender: 'male' }))
  const b = shoeViewFor(prod, shoeProfile({ gender: 'female' }))
  assert.deepEqual(a.rows, b.rows)
})

test('대상 성별: US/UK 환산은 상품 대상 성별을 우선 쓴다', () => {
  assert.equal(shoeGender('male', '', 'female'), 'female')
  assert.equal(shoeGender('female', '', 'male'), 'male')
  assert.equal(shoeGender('male', '', 'unisex'), 'male')
  assert.equal(shoeGender('male', '', null), 'male')
  assert.equal(shoeGender(null, '여성 부츠', null), 'female')
  assert.equal(shoeSizeToMm('US 8', { gender: 'male', targetGender: 'female' }).mm, 250)
  assert.equal(shoeSizeToMm('US 8', { gender: 'male' }).mm, 260)
  const w = shoeWardrobeFields({ product: { name: 'x', targetGender: { gender: 'female' } }, size: 'US 8', profile: shoeProfile({ gender: 'male' }) })
  assert.equal(w.measures.footLength, 250)
})

test('웹 렌더: ShoeCompare·ResultView(옷)에 대상 성별 안내 한 줄이 나온다', () => {
  const product = { ...parsePage(fakeDocument(tgPage(SHOE_ISH, ['230', '240', '250'])), ''), mall: 'shop', url: 'https://shop.example/s' }
  const view = shoeViewFor(product, shoeProfile())
  const html = render(WEB.ShoeCompare, { view, selectedSize: null, onSelect: noop })
  assert.ok(html.includes('target-gender'))
  assert.ok(textOf(html).includes('여성용으로 보이는 상품이에요(옵션 230~250)'))
  const same = render(WEB.ShoeCompare, { view: shoeViewFor(product, shoeProfile({ gender: 'female' })), selectedSize: null, onSelect: noop })
  assert.ok(!same.includes('target-gender'))
  const clothing = { ...PRODUCTS['https://shop-a.example.com/goods/12345'], source: 'demo', name: '여성 크롭 니트', targetGender: classifyTargetGender({ name: '여성 크롭 니트' }) }
  const rv = render(WEB.ResultView, { product: clothing, profile: shoeProfile({ gender: 'male' }), calibration: {}, feedbackCount: 0, onFeedback: noop, onRestart: noop, wardrobe: [], onSaveWardrobe: noop })
  assert.ok(rv.includes('target-gender') && textOf(rv).includes('여성용으로 보이는 상품이에요.'))
  assert.ok(!textOf(rv).includes('판정은 발길이'))
  const rv2 = render(WEB.ResultView, { product: clothing, profile: shoeProfile({ gender: 'female' }), calibration: {}, feedbackCount: 0, onFeedback: noop, onRestart: noop, wardrobe: [], onSaveWardrobe: noop })
  assert.ok(!rv2.includes('target-gender'))
})

await atest('content.js(가짜 DOM, vm): 프로필 남성 + 여성용 신발이면 카드 상단에 안내 한 줄이 나온다 (가짜 데이터)', async () => {
  const { texts } = await runContentInFakeDom(tgPage(SHOE_ISH, ['230', '240', '250']))
  assert.ok(texts.some((t) => t.startsWith('여성용으로 보이는 상품이에요(옵션 230~250)') && t.includes('판정은 발길이(mm) 기준이에요')))
  const unisex = await runContentInFakeDom(tgPage('Unisex 러닝 스니커즈', ['230', '240', '250']))
  assert.ok(!unisex.texts.some((t) => t.includes('로 보이는 상품이에요')))
})


// ---------- 사이즈표: 머리글 표와 본문 표가 나뉜 구조 (무신사 스크린샷 모양의 가짜 HTML, 실제 무신사 DOM이 아님) ----------
{
  const th2 = (n, name) => `<th><span>${n}</span><br><span>${name}</span></th>`
  const td = (c) => `<td>${c}</td>`
  const clothHead = `<tr><th>cm</th>${['총장', '어깨너비', '가슴단면', '소매길이', '밑단단면', '소매부리단면', '암홀'].map((n, i) => th2(i + 1, n)).join('')}</tr>`
  const clothData = [['0 (S)', 67, 50.5, 59.5, 60.5], ['1 (M)', 69, 52, 62, 62], ['2 (L)', 71, 53.5, 64.5, 63.5], ['3 (XL)', 73, 55, 67, 65], ['4 (2XL)', 75, 56.5, 69.5, 66.5]]
    .map((r) => `<tr>${[...r, '-', '-', '-'].map(td).join('')}</tr>`)
    .join('')
  const myRow = '<tr><td colspan="1">내 사이즈</td><td colspan="7">사이즈를 직접 입력해주세요</td></tr>'
  const fitTable = '<table><tr><th>핏</th><td>오버사이즈</td></tr><tr><th>계절감</th><td>봄 가을</td></tr></table>'
  const clothOpts = `<ul>${['0 (S)', '1 (M)', '2 (L)', '3 (XL)', '4 (2XL)'].map((o) => `<li>${o}</li>`).join('')}</ul>`
  const readCloth = (inner) => parsePage(fakeDocument(wrapBody(`<h1>코튼 재킷 아우터</h1>${clothOpts}${inner}`)), '')
  const splitCloth = `<div class="sz"><div class="head"><table><thead>${clothHead}</thead></table></div><div class="body"><table><tbody>${myRow}${clothData}</tbody></table></div></div>${fitTable}`
  const expectCloth = (p) => {
    assert.ok(p.sizeChart, '사이즈표를 읽어야 해요')
    assert.deepEqual(p.sizeChart.rows.map((r) => r[0]), ['0(S)', '1(M)', '2(L)', '3(XL)', '4(2XL)'])
    assert.equal(p.sizeChart.measures['0(S)'].outerLength ?? p.sizeChart.measures['0(S)'].topLength, 67)
    assert.equal(p.sizeChart.measures['0(S)'].shoulder, 50.5)
    assert.equal(p.sizeChart.measures['0(S)'].chest, 119) // 가슴단면 59.5 -> 둘레 119
    assert.equal(p.sizeChart.measures['0(S)'].arm, 60.5)
    assert.equal(p.sizeChart.measures['4(2XL)'].outerLength ?? p.sizeChart.measures['4(2XL)'].topLength, 75)
    assert.equal(p.sizeChartMeta.flipped, 0)
    assert.notEqual(p.sizeChartMeta.namesFrom, 'options')
  }

  test('가짜 HTML(무신사 스크린샷 구조): 머리글 표와 본문 표가 따로 있어도 하나로 이어 옷 사이즈표를 읽는다', () => {
    expectCloth(readCloth(splitCloth))
  })
  test('가짜 HTML(무신사 스크린샷 구조): <th><span>1</span><span>총장</span></th> 열 번호를 떼고, 내 사이즈 줄이 없어도 읽는다', () => {
    const noMy = `<table>${clothHead}</table><table>${clothData}</table>`
    expectCloth(readCloth(noMy))
  })
  test('가짜 HTML(무신사 스크린샷 구조): 한 표에 모두 있고 내 사이즈 줄이 끼어 있어도 읽는다', () => {
    expectCloth(readCloth(`<table>${clothHead}${myRow}${clothData}</table>${fitTable}`))
  })
  test('가짜 HTML(무신사 스크린샷 구조): 뒤에 오는 핏/계절감 표는 사이즈표로 오인하지 않는다', () => {
    const p = readCloth(splitCloth)
    assert.ok(!p.sizeChart.headers.some((h) => /계절|오버/.test(h)))
  })

  const shoeHead = `<tr><th>cm</th>${[['신발 길이'], ['신발 너비'], ['발 길이'], ['굽/솔 높이']].map(([n], i) => th2(i + 1, n)).join('')}</tr>`
  const shoeData = [['230 (230-235)', 25.3, 8, '-', 2], ['240 (240-245)', 26.3, 8.3, '-', 2], ['250 (250-255)', 27.3, 8.6, '-', 2]].map((r) => `<tr>${r.map(td).join('')}</tr>`).join('')
  const shoeMy = '<tr><td>내 사이즈</td><td colspan="4">사이즈를 직접 입력해주세요</td></tr>'
  const shoeOpts = `<ul>${['230 (230-235)', '240 (240-245)', '250 (250-255)'].map((o) => `<li>${o}</li>`).join('')}</ul>`
  const readShoe = (inner) => parsePage(fakeDocument(wrapBody(`<h1>러닝화 스니커즈</h1>${shoeOpts}${inner}`)), '')
  const expectShoe = (p) => {
    assert.ok(p.sizeChart, '신발 사이즈표를 읽어야 해요')
    assert.equal(p.category, 'shoes')
    const m = p.sizeChart.measures
    const key = Object.keys(m)
    assert.equal(key.length, 3)
    assert.deepEqual(key.map((k) => m[k].shoeLength), [253, 263, 273])
    assert.deepEqual(key.map((k) => m[k].footWidth), [80, 83, 86])
    assert.deepEqual(key.map((k) => m[k].heelHeight), [2, 2, 2])
    assert.ok(key.every((k) => m[k].footLength == null), '신발 길이는 발길이로 쓰지 않아요')
    assert.ok(key.every((k) => k.startsWith('230') || k.startsWith('240') || k.startsWith('250')))
    assert.notEqual(p.sizeChartMeta.namesFrom, 'options')
    assert.equal(p.sizeChartMeta.flipped, 0)
  }
  test('가짜 HTML(무신사 스크린샷 구조): 신발 cm 표(머리글 표 + 본문 표)를 신발 길이 253/263/273, 너비 80/83/86mm로 읽는다', () => {
    expectShoe(readShoe(`<div><table>${shoeHead}</table><table>${shoeMy}${shoeData}</table></div>`))
  })
  test('가짜 HTML(무신사 스크린샷 구조): 신발 표 한 개일 때도 같은 값, 뒤집어 읽지 않는다', () => {
    const p = readShoe(`<table>${shoeHead}${shoeMy}${shoeData}</table>`)
    expectShoe(p)
    const rep = formatReport(collectDiagnostics(fakeDocument(wrapBody(`<h1>러닝화</h1>${shoeOpts}<table>${shoeHead}${shoeMy}${shoeData}</table>`)), ''))
    assert.ok(!rep.includes('뒤집어 읽음'))
  })
  test('가짜 HTML(무신사 스크린샷 구조): 진단 리포트에 표별 줄/칸/colspan, 이어 붙이기 결과, 칸 글자가 있고 페이지의 다른 글은 없다', () => {
    const secret = 'ZZ비밀리뷰글'
    const html = wrapBody(`<h1>러닝화</h1>${shoeOpts}<table>${shoeHead}</table><table>${shoeMy}${shoeData}</table><p>${secret} 닉네임 키 170</p>`)
    const d = collectDiagnostics(fakeDocument(html), '')
    assert.equal(d.chartShape.merged, 1)
    assert.equal(d.chartShape.tables[1].colspan, 3)
    const rep = formatReport(d)
    assert.match(rep, /표 1: 1줄 x 5칸, thead (?:예|아니요), tbody (?:예|아니요), colspan 0개/)
    assert.match(rep, /이어 붙이기: 시도 1회, 성공 1회/)
    assert.match(rep, /신발 길이/)
    assert.ok(!rep.includes(secret))
  })
  test('가짜 HTML(무신사 스크린샷 구조): 표 구조가 아닌 div 나열도 화면 위치(가짜 rect)로 줄·칸을 맞춰 읽는다', () => {
    const cellsH = ['cm', '1', '신발 길이', '2', '신발 너비', '3', '발 길이', '4', '굽/솔 높이']
    const doc = fakeDocument(
      wrapBody(`<h1>러닝화 스니커즈</h1>${shoeOpts}<div id="g">${[...cellsH, '230 (230-235)', '25.3', '8', '-', '2', '240 (240-245)', '26.3', '8.3', '-', '2', '250 (250-255)', '27.3', '8.6', '-', '2'].map((t) => `<span>${t}</span>`).join('')}</div>`),
    )
    const spans = doc.querySelectorAll('#g span')
    const pos = new Map()
    // 머리글: 5열, 번호(y=0)와 이름(y=14)이 두 줄. 본문은 y=40, 60, 80
    const xs = [0, 100, 200, 300, 400]
    pos.set(spans[0], { left: xs[0], top: 7, width: 30, height: 14 })
    ;[1, 3, 5, 7].forEach((i, c) => {
      pos.set(spans[i], { left: xs[c + 1] + 20, top: 0, width: 10, height: 14 })
      pos.set(spans[i + 1], { left: xs[c + 1], top: 14, width: 50, height: 14 })
    })
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) pos.set(spans[9 + r * 5 + c], { left: xs[c], top: 40 + r * 20, width: 50, height: 14 })
    const withRects = (fn) => {
      setRectProvider((el) => pos.get(el) || { left: 0, top: 0, width: 0, height: 0 })
      try {
        return fn()
      } finally {
        setRectProvider(null)
      }
    }
    // 위치 제공자가 없으면 위치 기반 후보는 만들지 않는다
    assert.notEqual(parsePage(doc, '').sizeChartMeta?.selectedKind, 'geometry')
    const p = withRects(() => parsePage(doc, ''))
    expectShoe(p)
    assert.equal(p.sizeChartMeta.selectedKind, 'geometry')
  })
}

// ---- 후기 이상치 자동 제외 (직접 만든 가짜 데이터·가짜 HTML이에요. 실제 사이트·후기에서 확인한 것이 아니고 정확도를 잰 것도 아니에요) ----
import { screenReviews, aggregateFit } from '../src/lib/fitEngine.js'
import { OUTLIER, REASON_LABEL, hasContradiction } from '../src/lib/reviewOutliers.js'

const OUT_CHART = {
  rows: [['S'], ['M'], ['L']],
  measures: { S: { shoulder: 44, chest: 100 }, M: { shoulder: 46, chest: 106 }, L: { shoulder: 48, chest: 112 } },
}
const OUT_PRODUCT = { sizeChart: OUT_CHART, optionLabels: [], category: 'top' }
const outRv = (id, extra = {}) => ({ id, nick: `n${id}`, gender: 'male', height: 175, weight: 70, size: 'M', fit: 'true', text: '무난해요', ...extra })
const reasonOf = (res, id) => res.excluded.find((r) => r.id === id)?.excluded.reasons

test('이상치: 불가능한 값(키·몸무게·BMI 범위 밖)은 제외되고 경계값은 남는다', () => {
  const res = screenReviews(
    [
      outRv(1, { height: 230 }), outRv(2, { height: 130 }), outRv(3, { weight: 20 }), outRv(4, { weight: 180 }),
      outRv(5, { height: 150, weight: 100 }), // BMI 44.4
      outRv(6, { height: 200, weight: 50 }), // BMI 12.5
      outRv(7, { height: 140, weight: 35 }), outRv(8, { height: 210, weight: 150 }), // 경계값(BMI 17.9 / 34.0)
    ],
    OUT_PRODUCT,
  )
  assert.deepEqual(reasonOf(res, 1), ['height'])
  assert.deepEqual(reasonOf(res, 2), ['height'])
  assert.deepEqual(reasonOf(res, 3), ['weight'])
  assert.deepEqual(reasonOf(res, 4), ['weight'])
  assert.deepEqual(reasonOf(res, 5), ['bmi'])
  assert.deepEqual(reasonOf(res, 6), ['bmi'])
  assert.deepEqual(res.kept.map((r) => r.id), [7, 8])
  assert.deepEqual([res.counts.height, res.counts.weight, res.counts.bmi], [2, 2, 2])
  assert.equal(res.excluded[0].excluded.text, `제외됨(${REASON_LABEL.height})`)
  assert.equal(res.excludedTotal, 6)
})

test('이상치: 한 후기에 작아요·커요가 같이 있거나 구매 사이즈가 상품에 없으면 제외, 안 작아요·표에 있는 이름은 남는다', () => {
  assert.equal(hasContradiction({ text: '어깨는 작아요 그런데 기장은 커요' }), true)
  assert.equal(hasContradiction({ text: '안 작아요 커요' }), false, '"안 작아요"는 반대 뜻이라 모순이 아니다')
  assert.equal(hasContradiction({ text: '작아요' }), false)
  assert.equal(hasContradiction({ text: '어깨가 넉넉하고 기장은 짧아요' }), false, '부위 말(넉넉·짧아요)은 세지 않는다')
  assert.equal(hasContradiction({ view: { body: '크게 나오는데 작은 편이에요' } }), true, 'view.body도 읽는다')
  const res = screenReviews(
    [outRv(1, { text: '작아요 근데 커요', fit: 'small' }), outRv(2, { size: 'XXL' }), outRv(3, { size: 'm' }), outRv(4, { size: null })],
    OUT_PRODUCT,
  )
  assert.deepEqual(reasonOf(res, 1), ['contradiction'])
  assert.deepEqual(reasonOf(res, 2), ['unknownSize'])
  assert.deepEqual(res.kept.map((r) => r.id), [3, 4])
  // 사이즈표도 옵션도 모르면 이름 비교를 하지 않는다
  assert.equal(screenReviews([outRv(1, { size: 'XXL' })], { sizeChart: null, optionLabels: [], category: 'top' }).excludedTotal, 0)
  // FREE/F, 신발 옵션 범위 안의 mm는 같은 사이즈로 본다
  assert.equal(screenReviews([outRv(1, { size: 'F' })], { optionLabels: ['FREE'] }).excludedTotal, 0)
  assert.equal(screenReviews([outRv(1, { size: '252' }), outRv(2, { size: '260' })], { optionLabels: ['250 (250-255)'], category: 'shoes' }).excludedTotal, 1)
})

test('이상치: 같은 사이즈 5건 이상이면 여유분이 중앙값 ± 3×MAD 밖인 후기를 제외한다 (MAD가 0이어도 동작)', () => {
  // 몸이 같은 4명(MAD=0) + 마르고 큰 1명: 가슴 여유분이 14cm쯤 달라진다
  const same = [1, 2, 3, 4].map((i) => outRv(i))
  const res = screenReviews([...same, outRv(5, { height: 185, weight: 48 })], OUT_PRODUCT)
  assert.deepEqual(reasonOf(res, 5), ['statistical'])
  assert.equal(res.statApplied, true)
  assert.equal(res.kept.length, 4)
  assert.equal(res.counts.statistical, 1)
  // MAD가 0이어도 작은 차이(허용 3×최소 MAD 안)는 남는다
  const near = screenReviews([...same, outRv(5, { height: 176, weight: 70 })], OUT_PRODUCT)
  assert.equal(near.excludedTotal, 0)
  // MAD가 있는 분포: 몸무게 63~77kg가 고르게 퍼진 5명은 모두 남고, 150kg에 가까운 사람만 걸린다
  const spread = [63, 67, 70, 73, 77].map((w, i) => outRv(10 + i, { weight: w }))
  assert.equal(screenReviews(spread, OUT_PRODUCT).excludedTotal, 0)
  const withBig = screenReviews([...spread, outRv(99, { height: 175, weight: 120 })], OUT_PRODUCT)
  assert.deepEqual(reasonOf(withBig, 99), ['statistical'])
  assert.equal(withBig.kept.length, 5)
  // 사이즈가 다르면 따로 센다: M 4건 + L 1건이면 어느 쪽도 5건이 안 된다
  const split = screenReviews([...same, outRv(5, { size: 'L', height: 185, weight: 48 })], OUT_PRODUCT)
  assert.equal(split.excludedTotal, 0)
  assert.equal(split.statApplied, false)
})

test('이상치: 같은 사이즈 후기가 5건 미만이면 통계 필터를 쓰지 않는다 (불가능한 값은 그대로 적용)', () => {
  const four = [1, 2, 3].map((i) => outRv(i)).concat([outRv(4, { height: 185, weight: 48 })])
  const res = screenReviews(four, OUT_PRODUCT)
  assert.equal(res.excludedTotal, 0)
  assert.equal(res.statApplied, false)
  assert.equal(OUTLIER.minSample, 5)
  const withImpossible = screenReviews([...four, outRv(5, { height: 300 })], OUT_PRODUCT)
  assert.deepEqual(withImpossible.excluded.map((r) => r.id), [5], '5건이어도 통계가 아니라 불가능한 값으로만 제외된다(M 4건 + 불가능 1건)')
  assert.deepEqual(reasonOf(withImpossible, 5), ['height'])
})

test('이상치: 성별을 모르거나 신발이거나 사이즈표가 없으면 통계 필터를 건너뛴다', () => {
  const group = (extra) => [1, 2, 3, 4].map((i) => outRv(i, extra)).concat([outRv(5, { height: 185, weight: 48, ...extra })])
  assert.equal(screenReviews(group({ gender: null }), OUT_PRODUCT).excludedTotal, 0)
  assert.equal(screenReviews(group({}), { ...OUT_PRODUCT, category: 'shoes' }).excludedTotal, 0)
  assert.equal(screenReviews(group({}), { sizeChart: null, optionLabels: ['S', 'M', 'L'], category: 'top' }).excludedTotal, 0)
  assert.equal(screenReviews(group({}), OUT_PRODUCT).excludedTotal, 1, '같은 데이터가 조건을 갖추면 걸린다(위 세 건의 비교 기준)')
})

test('이상치: 비슷한 체형·같은 사이즈 다수와 반대 평가인 후기는 제외하지 않고 가중치만 줄인다 (5건 미만이면 생략)', () => {
  const crowd = [1, 2, 3, 4, 5].map((i) => outRv(i, { fit: 'small' }))
  const odd = outRv(6, { fit: 'large' })
  const res = screenReviews([...crowd, odd], OUT_PRODUCT)
  assert.equal(res.excludedTotal, 0, '제외는 아니다')
  assert.equal(res.labelReduced, 1)
  const kept = res.kept.find((r) => r.id === 6)
  assert.equal(kept.labelReduced, true)
  assert.equal(kept.labelWeight, OUTLIER.labelWeight)
  assert.ok(res.kept.filter((r) => r.id !== 6).every((r) => r.labelWeight == null))
  // 집계에서 그 후기의 몫이 줄어든다
  const bySize = aggregateFit(res.kept.map((r) => ({ ...r, similarity: 100 })))
  assert.equal(bySize.M.large, OUTLIER.labelWeight)
  assert.equal(bySize.M.small, 5)
  // 5건 미만이면 생략
  const few = screenReviews([...crowd.slice(0, 3), odd], OUT_PRODUCT)
  assert.equal(few.labelReduced, 0)
  assert.ok(few.kept.every((r) => r.labelWeight == null))
  // 정사이즈 평가는 '반대'가 아니다
  const tru = screenReviews([...crowd, outRv(7, { fit: 'true' })], OUT_PRODUCT)
  assert.equal(tru.labelReduced, 0)
  // 몸이 많이 다른 후기끼리는 이웃이 아니므로 반대여도 줄이지 않는다
  const far = screenReviews([...crowd, outRv(8, { fit: 'large', height: 160, weight: 52 })], OUT_PRODUCT)
  assert.equal(far.labelReduced, 0)
})

test('이상치: 추천·후기 집계(generateFitComment)에서 제외되고, 제외된 후기는 excludedReviews에 사유와 함께 남는다', () => {
  const base = PRODUCTS['https://shop-a.example.com/goods/12345']
  const good = [1, 2, 3, 4, 5].map((i) => ({ id: i, nick: `g${i}`, gender: 'male', height: 175, weight: 70, size: 'M', fit: 'true', text: '딱 맞아요' }))
  const bogus = [
    { id: 91, nick: '모순', gender: 'male', height: 175, weight: 70, size: 'L', fit: 'large', text: '어깨는 작아요 팔은 커요' },
    { id: 92, nick: '없는사이즈', gender: 'male', height: 175, weight: 70, size: 'XXL', fit: 'large', text: '엄청 커요' },
    { id: 93, nick: '키이상', gender: 'male', height: 99, weight: 70, size: 'L', fit: 'large', text: '커요' },
  ]
  const withBogus = generateFitComment(profile, { ...base, reviews: [...good, ...bogus] })
  const clean = generateFitComment(profile, { ...base, reviews: good })
  assert.equal(withBogus.evidence.reviewExcluded, 3)
  assert.equal(withBogus.evidence.reviewMatched, 5, '제외된 후기는 비슷한 체형 수에 들어가지 않는다')
  assert.deepEqual(withBogus.matched.map((r) => r.id).sort(), [1, 2, 3, 4, 5])
  assert.ok(![...withBogus.matched, ...withBogus.otherReviews].some((r) => r.id >= 90), '유사도·다른 후기 목록에도 없다')
  assert.deepEqual(withBogus.excludedReviews.map((r) => r.id), [91, 92, 93])
  assert.ok(withBogus.excludedReviews.every((r) => /^제외됨\(.+\)$/.test(r.excluded.text)))
  assert.equal(withBogus.recommendedSize, clean.recommendedSize)
  assert.equal(withBogus.evidence.reviewVotes, clean.evidence.reviewVotes)
  assert.equal(withBogus.confidence, clean.confidence)
  assert.deepEqual(withBogus.outliers.counts, { height: 1, weight: 0, bmi: 0, contradiction: 1, unknownSize: 1, statistical: 0 })
  assert.equal(clean.evidence.reviewExcluded, 0)
  assert.equal(clean.excludedReviews.length, 0)
  assert.ok(describeEvidence(withBogus.evidence, withBogus.confidence).summary.includes('제외한 후기 3건'))
  assert.ok(!describeEvidence(clean.evidence, clean.confidence).summary.includes('제외한 후기'))
})

// 가짜 HTML: 리뷰 3건 중 1건이 '작아요'와 '커요'를 함께 말한다
const OUT_BAD_BODY = '어깨는 작아요 기장은 커요 애매합니다 엄청 가볍고 따뜻해서 만족해요 겨울에 입기 좋아요.'
const OUT_HTML = RB_HTML([rbCard(0), rbCard(1), rbCard(2)].map((c, i) => c.replace('26.10.08', `26.10.0${i + 1}`).replace('지루한플럼반바지', `닉${'abc'[i]}`).split(RB_BODY).join(i === 1 ? OUT_BAD_BODY : `${RB_BODY} ${'정말 만족'.repeat(i)}`)).join(''))

test('이상치: 진단 리포트에 사유별 제외 수가 있고 후기 글·닉네임은 없다 (가짜 HTML)', () => {
  const doc = fakeDocument(OUT_HTML)
  const d = collectDiagnostics(doc, 'https://shop.example/products/1', '0.1.0')
  assert.equal(d.outliers.excludedTotal, 1)
  assert.equal(d.outliers.counts.contradiction, 1)
  assert.equal(d.outliers.statApplied, false)
  const rep = formatReport(d)
  assert.match(rep, /후기 이상치: 제외 1건\(키가 범위 밖 0, 몸무게가 범위 밖 0, BMI가 범위 밖 0, 작아요·커요 동시 언급 1, 구매 사이즈가 상품에 없음 0, 같은 사이즈 후기와 체형 차이가 큼 0\), 가중치 낮춤 0건, 통계 필터 생략/)
  assert.ok(!rep.includes('애매합니다') && !rep.includes('닉b') && !rep.includes('지루한플럼'))
  const clean = collectDiagnostics(fakeDocument(RB_FULL), '', '')
  assert.equal(clean.outliers.excludedTotal, 0)
  assert.ok(formatReport(clean).includes('후기 이상치: 제외 0건'))
})

await atest('이상치: 확장 카드(가짜 DOM, vm)의 전체 리뷰 탭에 제외됨(사유)가 보이고, 제외된 후기는 비슷한 체형 목록에 없다', async () => {
  const analyzed = analyzePage(fakeDocument(OUT_HTML), 'https://shop.example/products/1', buildProfile({ gender: 'male', height: '175', weight: '70', preferredFit: 'regular' }).profile, '0.1.0')
  assert.equal(analyzed.status, 'ok')
  assert.equal(analyzed.reviewViews.excludedTotal, 1)
  assert.equal(analyzed.reviewViews.excluded[0].excluded.text, '제외됨(작아요·커요 동시 언급)')
  assert.ok(![...analyzed.reviewViews.matched, ...analyzed.reviewViews.others].some((r) => r.excluded))
  const { texts, created } = await runContentInFakeDom(OUT_HTML)
  assert.ok(!texts.some((t) => t.includes('분석 중 문제가 생겼어요')))
  assert.ok(texts.some((t) => t.includes('제외 1건')), '리뷰 원문 제목에 제외 수')
  const tabs = created.filter((e) => e.className.split(' ').includes('rtab'))
  const panel = created.find((e) => e.className === 'tp')
  tabs[1]._l.click()
  const flat = (n) => [n._text, ...(n.children || []).flatMap(flat)]
  const shown = flat(panel).join('|')
  assert.ok(shown.includes('제외됨(작아요·커요 동시 언급)'), '전체 리뷰 탭에 제외됨(사유)')
  assert.ok(created.some((e) => e.className === 'tag excl' && e.textContent === '제외됨(작아요·커요 동시 언급)'))
  assert.ok(created.some((e) => e.className === 'rv excl'), '제외된 리뷰 카드는 구분 클래스')
  tabs[0]._l.click()
  assert.ok(!flat(panel).join('|').includes('제외됨('), '비슷한 체형 탭에는 제외된 후기가 없다')
})

test('이상치: 웹 결과 화면(서버 렌더)에 제외된 후기가 사유와 함께 표시되고 유사도 비교에는 쓰이지 않는다', () => {
  const clothing = { ...PRODUCTS['https://shop-a.example.com/goods/12345'], source: 'demo' }
  const bad = { id: 91, nick: '모순닉', gender: 'male', height: 175, weight: 70, size: 'M', fit: 'small', text: '어깨는 작아요 팔은 커요' }
  const html = render(WEB.ResultView, { product: { ...clothing, reviews: [...clothing.reviews, bad] }, profile, calibration: {}, feedbackCount: 0, onFeedback: noop, onRestart: noop, wardrobe: [], onSaveWardrobe: noop })
  const txt = textOf(html)
  assert.ok(txt.includes('제외된 후기 1건') && txt.includes('제외됨(작아요·커요 동시 언급)') && txt.includes('모순닉'), '숨기지 않고 사유와 함께 보여준다')
  assert.ok(html.includes('class="excluded-tag"') && html.includes('review-excluded'))
  assert.ok(/전체 7건/.test(txt), '전체 건수에는 제외된 후기도 센다')
  const plain = textOf(render(WEB.ResultView, { product: clothing, profile, calibration: {}, feedbackCount: 0, onFeedback: noop, onRestart: noop, wardrobe: [], onSaveWardrobe: noop }))
  assert.ok(!plain.includes('제외된 후기') && !plain.includes('제외됨('))
})

// ---- 후기 학습 (FEAT-002): 가짜 데이터만 씁니다. 실제 쇼핑몰·실측 정확도 확인이 아니에요 ----
const LRN_CHART = {
  measures: {
    S: { shoulder: 44, chest: 95, arm: 60 },
    M: { shoulder: 46, chest: 105, arm: 61 },
    L: { shoulder: 48, chest: 120, arm: 62 },
  },
}
const LRN_BODIES = [[172, 68], [174, 70], [175, 70], [176, 72], [178, 74]]
// M(가슴 여유 4~10cm)을 산 10명은 '작아요', L(여유 19~25cm)을 산 10명은 '잘 맞아요'. 닉네임·본문·사진은 개인정보 검사용 표식이에요.
const lrnReviews = () => [
  ...LRN_BODIES.flatMap(([h, w], i) => [0, 1].map((k) => ({ id: `m${i}${k}`, nick: `닉네임M${i}${k}`, gender: 'male', height: h, weight: w, size: 'M', fit: 'small', text: `SECRETTEXT-M-${i}-${k}`, view: { photos: [`https://img.example/p-m${i}${k}.jpg`], body: `SECRETBODY-M-${i}-${k}` } }))),
  ...LRN_BODIES.flatMap(([h, w], i) => [0, 1].map((k) => ({ id: `l${i}${k}`, nick: `닉네임L${i}${k}`, gender: 'male', height: h, weight: w, size: 'L', fit: 'true', text: `SECRETTEXT-L-${i}-${k}`, view: { photos: [`https://img.example/p-l${i}${k}.jpg`], body: `SECRETBODY-L-${i}-${k}` } }))),
]
const lrnProduct = (extra = {}) => ({ name: '학습용 가짜 상품', category: 'top', sizeChart: LRN_CHART, reviews: lrnReviews(), optionLabels: ['S', 'M', 'L'], url: 'https://www.musinsa.com/products/1', ...extra })
const memAdapter = (map = new Map(), limit = Infinity) => ({
  async get(k) { return map.has(k) ? JSON.parse(map.get(k)) : null },
  async set(k, v) { const t = JSON.stringify(v); if (t.length > limit) return false; map.set(k, t); return true },
  async remove(k) { map.delete(k) },
})
// 직접 만든 샘플: 라벨 small/true/large별 가슴 여유분
const synth = (cat, brand, label, n, chest, day = 20000, tag = '') => Array.from({ length: n }, (_, i) => ({ id: `${cat}-${brand}-${label}-${tag}${i}`, cat, brand, label, w: 1, e: { chest }, d: day }))
const chestVerdictKey = (r, size) => r.perSize.find((p) => p.size === size).verdicts.find((v) => v.part === 'chest').key

test('학습: 후기가 샘플로 바뀌고 개인 식별 정보(닉네임·본문·사진·키·몸무게)는 담기지 않는다', () => {
  const samples = toSamples(lrnProduct())
  assert.equal(samples.length, 20)
  assert.deepEqual(Object.keys(samples[0]).sort(), ['brand', 'cat', 'd', 'e', 'id', 'label', 'w'])
  assert.equal(samples[0].cat, 'top')
  assert.equal(samples[0].brand, 'musinsa.com')
  assert.equal(samples.filter((x) => x.label === 'small').length, 10)
  assert.ok(samples.every((x) => x.w === 1 && Object.values(x.e).every((v) => Number.isInteger(v * 2))), '가중치 1, 여유분은 0.5cm 단위')
  const json = JSON.stringify(samples)
  for (const bad of ['닉네임', 'SECRETTEXT', 'SECRETBODY', 'img.example', '학습용 가짜 상품', 'musinsa.com/products', 'height', 'weight', 'gender', 'size']) assert.ok(!json.includes(bad), `${bad} 없음`)
  assert.equal(new Set(samples.map((x) => x.id)).size, 20, '중복 방지 id는 후기마다 다르다')
  assert.deepEqual(toSamples({ ...lrnProduct(), category: 'shoes' }), [], '신발은 만들지 않는다')
  assert.deepEqual(toSamples({ ...lrnProduct(), sizeChart: null }), [], '사이즈표가 없으면 만들지 않는다')
})

test('학습: 이상치로 제외된 후기는 샘플이 되지 않고, 가중치 낮춘 후기는 labelWeight를 쓴다', () => {
  const base = lrnProduct()
  const bad = { gender: 'male', height: 300, weight: 70, size: 'M', fit: 'small', text: '불가능한 키' }
  const contra = { gender: 'male', height: 175, weight: 70, size: 'M', fit: 'small', text: '어깨는 작아요 기장은 커요' }
  assert.equal(toSamples({ ...base, reviews: [...base.reviews, bad, contra] }).length, 20, '제외된 후기 2건은 쓰지 않는다')
  // M 사이즈 비슷한 체형 다수가 '작아요'인데 혼자 '커요'인 후기: 제외는 아니고 가중치만 줄어든다
  const odd = { id: 'odd', gender: 'male', height: 175, weight: 70, size: 'M', fit: 'large', text: '라벨 이상치' }
  const withOdd = toSamples({ ...base, reviews: [...base.reviews, odd] })
  assert.equal(withOdd.length, 21)
  assert.deepEqual(withOdd.filter((x) => x.w !== 1).map((x) => [x.label, x.w]), [['large', 0.4]])
})

test('학습: 표본 0건이면 prior 그대로, 라벨당 3건 미만이면 유지, 표본이 늘수록 prior에서 더 멀어지고 한계를 넘지 않는다', () => {
  assert.deepEqual(trainModel([], EASE_RULES).categories, {})
  assert.equal(resolveLearned(trainModel([], EASE_RULES), 'top').applied, false)
  const few2 = [...synth('top', null, 'small', 2, 12), ...synth('top', null, 'true', 2, 20)]
  assert.deepEqual(trainModel(few2, EASE_RULES).categories.top.rules, {}, '라벨당 2건은 추정하지 않는다')
  const snug = (n) => trainModel([...synth('top', null, 'small', n, 8), ...synth('top', null, 'true', n, 14)], EASE_RULES).categories.top.rules.chest.snug
  const [s3, s10, s100] = [snug(3), snug(10), snug(100)]
  assert.ok(s3 > EASE_RULES.chest.snug && s3 < s10 && s10 < s100, `${s3} < ${s10} < ${s100}`)
  assert.ok(s100 <= EASE_RULES.chest.snug + LEARN.maxShift, '이동 한계')
  const rule = trainModel([...synth('top', null, 'small', 10, 8), ...synth('top', null, 'true', 10, 14)], EASE_RULES).categories.top.rules.chest
  assert.ok(rule.tight < rule.snug && rule.snug < rule.regular && rule.regular < rule.relaxed, '경계 순서 유지')
  assert.equal(EASE_RULES.chest.snug, 6, 'EASE_RULES 원본은 바뀌지 않는다')
})

test('학습: 견고 통계 - 라벨 묶음의 극단값 한 건이 경계를 크게 흔들지 않는다', () => {
  const clean = [...synth('top', null, 'small', 9, 12), ...synth('top', null, 'true', 9, 20)]
  const dirty = [...clean, { ...synth('top', null, 'small', 1, 90, 20000, 'x')[0] }]
  const a = trainModel(clean, EASE_RULES).categories.top.rules.chest.snug
  const b = trainModel(dirty, EASE_RULES).categories.top.rules.chest.snug
  assert.ok(Math.abs(a - b) < 0.3, `${a} vs ${b}`)
})

test('학습: 브랜드 오프셋은 표본 수로 축소되고, 표본이 모자란 브랜드는 0이다', () => {
  const rows = (n, brand) => synth('top', brand, 'small', n, 14, 20000, brand)
  const m = trainModel([...rows(3, 'few'), ...rows(30, 'many'), ...rows(2, 'tiny')], EASE_RULES)
  const b = m.brands.top
  assert.ok(b.many.offset > b.few.offset && b.few.offset > 0, `${b.many.offset} > ${b.few.offset} > 0`)
  assert.ok(b.many.offset <= LEARN.maxBrandOffset)
  assert.equal(b.tiny, undefined, '2건은 오프셋을 만들지 않는다')
  assert.equal(resolveLearned(m, 'top', 'tiny').offset, 0)
  assert.equal(resolveLearned(m, 'top', 'many').offset, b.many.offset)
  // 같은 여유분에서 '작아요'가 몰리면(오프셋 +) 같은 여유분이 더 타이트하게 판정된다
  assert.ok(classifyEase('chest', 9, b.many.offset).level < classifyEase('chest', 9, 0).level)
})

test('학습: 스키마 버전이 다른 학습값 묶음은 쓰이지 않고, 저장된 다른 버전은 폐기된다', async () => {
  const m = trainModel([...synth('top', null, 'small', 10, 12), ...synth('top', null, 'true', 10, 20)], EASE_RULES)
  assert.ok(validateModel(m))
  assert.equal(validateModel({ ...m, schemaVersion: LEARN_SCHEMA_VERSION + 1 }), null)
  assert.equal(resolveLearned({ ...m, schemaVersion: 0 }, 'top'), null)
  const baseline = generateFitComment(profile, lrnProduct())
  const stale = generateFitComment(profile, lrnProduct(), {}, { ...m, schemaVersion: 0 })
  assert.deepEqual(stale, baseline, '버전이 다른 묶음은 무시하고 기존 결과와 같다')
  // 저장소: 샘플 스키마가 다르면 전부 폐기
  const map = new Map([[LEARN_KEY, JSON.stringify({ schemaVersion: 0, samples: synth('top', null, 'small', 5, 12), model: m })]])
  const st = await loadLearning(memAdapter(map))
  assert.deepEqual([st.samples.length, st.model], [0, null])
  assert.ok(!map.has(LEARN_KEY), '폐기하면 저장소에서도 지운다')
  // 모델만 다른 버전이면 샘플로 다시 만든다
  const map2 = new Map([[LEARN_KEY, JSON.stringify({ schemaVersion: LEARN_SCHEMA_VERSION, samples: [...synth('top', null, 'small', 10, 12), ...synth('top', null, 'true', 10, 20)], model: { ...m, schemaVersion: 0 } })]])
  const st2 = await loadLearning(memAdapter(map2))
  assert.equal(st2.samples.length, 20)
  assert.ok(st2.model.categories.top.rules.chest, '샘플로 다시 학습')
})

await atest('학습 저장: 중복 후기는 한 번만 쌓이고, 저장 내용에 개인 식별 정보가 없다', async () => {
  const map = new Map()
  const ad = memAdapter(map)
  const r1 = await learnFromProduct(ad, lrnProduct())
  assert.deepEqual([r1.added, r1.total], [20, 20])
  const r2 = await learnFromProduct(ad, lrnProduct())
  assert.deepEqual([r2.added, r2.total], [0, 20], '같은 상품을 다시 분석해도 늘지 않는다')
  const stored = map.get(LEARN_KEY)
  for (const bad of ['닉네임', 'SECRETTEXT', 'SECRETBODY', 'img.example', '학습용 가짜 상품']) assert.ok(!stored.includes(bad), `${bad} 저장 안 됨`)
  assert.equal(JSON.parse(stored).schemaVersion, LEARN_SCHEMA_VERSION)
  await resetLearning(ad)
  assert.equal((await loadLearning(ad)).samples.length, 0, '초기화하면 샘플이 없다')
  assert.equal(map.size, 0)
})

await atest('학습 저장: 샘플 상한을 넘으면 오래된 샘플부터 버리고, 용량이 모자라면 줄여서 저장한다', async () => {
  const ad = memAdapter()
  const old = synth('top', null, 'small', 300, 12, 100, 'old')
  const mid = synth('top', null, 'true', 300, 20, 200, 'new')
  await addSamples(ad, old)
  const r = await addSamples(ad, mid)
  assert.equal(r.samples.length, LEARN.maxSamples)
  assert.equal(r.dropped, 100)
  assert.ok(r.samples.every((x) => x.d === 200 || x.id.includes('old')))
  assert.equal(r.samples.filter((x) => x.d === 100).length, 200, '날짜가 오래된 것부터 100건 빠졌다')
  assert.equal(mergeSamples([{ id: 'a', d: 1 }], [{ id: 'a', d: 2 }, { id: 'b', d: 3 }], 10).samples.length, 2, '같은 id는 합쳐진다')
  // 저장소 용량 제한(쓰기 실패)이 있으면 절반으로 줄여 다시 시도
  const tiny = memAdapter(new Map(), 30000)
  const big = synth('top', null, 'small', 300, 12, 300, 'q')
  const t = await addSamples(tiny, big)
  assert.ok(t.saved && t.samples.length < 300 && t.samples.length > 0, `저장됨 ${t.samples.length}`)
  assert.ok(t.dropped > 0)
  // 글자 수 상한
  const sized = await addSamples(memAdapter(), Array.from({ length: 400 }, (_, i) => ({ id: `z${i}`, cat: 'top', brand: null, label: i % 2 ? 'small' : 'true', w: 1, e: { shoulder: 1.5, chest: 12, waist: 8, hip: 9, thigh: 7, arm: 2, topLength: 2, outerLength: 2, inseam: 2, dressLength: 2, pad: 'x'.repeat(300) }, d: i })))
  assert.ok(JSON.stringify(sized).length <= LEARN.maxBytes + 2000 && sized.samples.length < 400, '글자 수 상한')
})

await atest('학습 저장: localStorage 어댑터와 chrome.storage.local 어댑터가 같은 함수로 같은 결과를 낸다', async () => {
  const ls = new Map()
  const localLike = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => void ls.set(k, String(v)), removeItem: (k) => void ls.delete(k) }
  const cs = new Map()
  const area = {
    get: (k, cb) => cb(cs.has(k) ? { [k]: JSON.parse(cs.get(k)) } : {}),
    set: (o, cb) => { for (const [k, v] of Object.entries(o)) cs.set(k, JSON.stringify(v)); cb() },
    remove: (k, cb) => { cs.delete(k); cb() },
  }
  const a = localAdapter(localLike)
  const b = chromeAdapter(area, {})
  const ra = await learnFromProduct(a, lrnProduct())
  const rb = await learnFromProduct(b, lrnProduct())
  assert.deepEqual(ra, rb)
  assert.equal(ls.get(LEARN_KEY), cs.get(LEARN_KEY), '저장 내용이 같다')
  await resetLearning(a)
  await resetLearning(b)
  assert.deepEqual([ls.size, cs.size], [0, 0])
  // 쓰기 실패(용량 초과)는 예외 없이 false
  assert.equal(await localAdapter({ setItem() { throw new Error('quota') } }).set('k', 1), false)
})

await atest('학습 판정: 학습값이 없으면 기존 결과와 같고, 있으면 같은 여유분의 판정이 달라진다', async () => {
  const product = lrnProduct()
  const baseline = generateFitComment(profile, product, {})
  assert.deepEqual(generateFitComment(profile, product, {}, null), baseline)
  assert.deepEqual(generateFitComment(profile, product, {}, emptyModel()), baseline, '빈 묶음도 같다')
  assert.equal('learning' in baseline, false)
  const ad = memAdapter()
  const { model } = await learnFromProduct(ad, product)
  const learned = generateFitComment(profile, product, {}, model)
  const keyOf = (r) => r.perSize.find((p) => p.size === 'M').verdicts.find((v) => v.part === 'chest')
  assert.equal(chestVerdictKey(baseline, 'M'), 'regular')
  assert.equal(chestVerdictKey(learned, 'M'), 'tight', '같은 여유분(+7.5cm)이 학습값으로 더 타이트하게 판정')
  assert.equal(keyOf(baseline).ease, keyOf(learned).ease, '여유분 계산 자체는 같다')
  assert.equal(learned.learning.used, true)
  assert.equal(learned.learning.text, '학습값 사용 중(샘플 20건)')
  assert.ok(learned.note.includes('이 브라우저에 모은 후기'))
  // 다른 종류의 학습값은 이 상품에 적용되지 않는다
  const other = generateFitComment(profile, { ...product, category: 'bottom' }, {}, model)
  assert.equal(other.learning.used, false)
  assert.deepEqual(other.perSize.map((p) => p.score), generateFitComment(profile, { ...product, category: 'bottom' }, {}).perSize.map((p) => p.score))
  // 브랜드 오프셋: 같은 종류라도 브랜드 오프셋이 있는 브랜드만 달라진다
  const bm = trainModel([...synth('top', 'brand-a', 'small', 20, 14, 20000, 'a'), ...synth('top', 'brand-b', 'true', 20, 8, 20000, 'b')], EASE_RULES)
  const withBrand = (brand) => generateFitComment(profile, lrnProduct({ url: '', brand }), {}, bm)
  assert.notEqual(withBrand('brand-a').perSize.map((p) => p.score).join(), withBrand('brand-c').perSize.map((p) => p.score).join(), '브랜드 오프셋이 점수에 반영')
  assert.equal(brandKeyOf({ brand: ' Brand A ' }), 'branda')
})

test('학습 표시: 학습값이 있을 때만 상태 한 줄이 나온다', () => {
  assert.equal(learningStatus(null, 'top'), null)
  assert.equal(learningStatus(emptyModel(), 'top'), null)
  const m = trainModel([...synth('top', null, 'small', 10, 12), ...synth('top', null, 'true', 10, 20)], EASE_RULES)
  assert.equal(learningStatus(m, 'top').text, '학습값 사용 중(샘플 20건)')
  assert.ok(learningStatus(m, 'bottom').text.startsWith('학습값 모으는 중'))
})

await atest('학습 표시: 확장 카드(가짜 DOM, vm)에 학습값 사용 중 표시가 있고 초기화 버튼이 저장된 학습값을 지운다', async () => {
  const html = VIEW_HTML(chartTable(OPTION_LIST_LABELS()))
  const first = analyzePage(fakeDocument(html), 'https://shop.example/products/1', buildProfile({ gender: 'male', height: '175', weight: '70', preferredFit: 'regular' }).profile, '0.1.0')
  assert.equal(first.status, 'ok')
  assert.equal(first.learning, null, '학습값이 없으면 표시도 없다')
  const cat = first.category
  const samples = [...synth(cat, null, 'small', 10, 12), ...synth(cat, null, 'true', 10, 20)]
  const store = new Map([[LEARN_KEY, JSON.stringify({ schemaVersion: LEARN_SCHEMA_VERSION, samples, model: trainModel(samples, EASE_RULES) })]])
  const { texts, created } = await runContentInFakeDom(html, {}, {}, store)
  assert.ok(!texts.some((t) => t.includes('분석 중 문제가 생겼어요')))
  assert.ok(texts.includes('학습값 사용 중(샘플 20건)'), '사용 중 표시')
  assert.ok(texts.some((t) => t.includes('이 브라우저에만 저장돼요')))
  const btn = created.find((e) => e.className === 'btn' && e.textContent === '학습값 초기화')
  assert.ok(btn, '초기화 버튼')
  btn.click()
  for (let i = 0; i < 50 && !texts.some((t) => t.includes('학습값과 모은 샘플을 모두 지웠어요')); i++) await new Promise((r) => setTimeout(r, 10))
  assert.equal(store.has(LEARN_KEY), false, '저장된 학습값이 지워졌다')
  assert.ok(texts.some((t) => t.includes('학습값과 모은 샘플을 모두 지웠어요')))
  // 학습값 없이 실행하면 표시도 버튼도 없다
  const plain = await runContentInFakeDom(html)
  assert.ok(!plain.texts.some((t) => t.includes('학습값 사용 중')) && !plain.created.some((e) => e.textContent === '학습값 초기화'))
})

test('학습 표시: 웹 결과 화면(서버 렌더)에 학습값 사용 중 표시와 초기화 버튼이 있고, 없으면 나오지 않는다', () => {
  const clothing = { ...PRODUCTS['https://shop-a.example.com/goods/12345'], source: 'demo' }
  const samples = [...synth(clothing.category, null, 'small', 10, 12), ...synth(clothing.category, null, 'true', 10, 20)]
  const props = { product: clothing, profile, calibration: {}, feedbackCount: 0, onFeedback: noop, onRestart: noop, wardrobe: [], onSaveWardrobe: noop }
  const withModel = textOf(render(WEB.ResultView, { ...props, learningModel: trainModel(samples, EASE_RULES), onResetLearning: noop }))
  assert.ok(withModel.includes('학습값 사용 중(샘플 20건)') && withModel.includes('학습값 초기화') && withModel.includes('이 브라우저에만 저장돼요'))
  const without = textOf(render(WEB.ResultView, props))
  assert.ok(!without.includes('학습값'))
})


// ---- 사이즈표 모음 DB (전부 직접 만든 가짜 데이터예요. 실제 쇼핑몰 데이터가 아니고 검색 점수의 정확도는 측정하지 않았어요) ----
const chartMemAdapter = (initial = {}) => {
  const m = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]))
  return {
    m,
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null },
    async set(k, v) { m.set(k, JSON.stringify(v)); return true },
    async remove(k) { m.delete(k) },
  }
}
const CHART = { unit: 'cm', headers: ['사이즈', '가슴단면'], rows: [['S', 50], ['M', 53]], measures: { S: { chest: 100 }, M: { chest: 106 } } }
const rec = (o = {}) => ({ brand: 'Nike', model: 'Nike Club Fleece Hoodie 후드 티셔츠', code: 'BV2654-010', category: 'top', gender: 'male', url: 'https://shop.example/p/1?utm=a#x', sizeChart: CHART, ...o })

test('사이즈표 DB: 정규화(대소문자·공백·특수문자)와 브랜드 별칭(한글/영문)', () => {
  assert.equal(normalizeText('  Club-Fleece_HOODIE!! '), 'club fleece hoodie')
  assert.equal(normalizeCode(' bv2654-010 '), 'BV2654010')
  assert.equal(brandKeyOfName('나이키'), brandKeyOfName('NIKE'))
  assert.equal(brandKeyOfName('뉴발란스'), brandKeyOfName('New  Balance'))
  assert.equal(brandKeyOfName('The North Face'), brandKeyOfName('노스페이스'))
  assert.notEqual(brandKeyOfName('나이키'), brandKeyOfName('아디다스'))
  assert.equal(brandKeyOfName(''), null)
  assert.ok(modelSimilarity(modelTokens('후드 티셔츠'), modelTokens('후드  티셔츠!')) === 1)
  assert.equal(modelSimilarity(modelTokens('모델 1000'), modelTokens('모델 2000')), 0.5, '숫자 토큰은 같아야만 겹쳐요')
})

await atest('사이즈표 DB: 한글 브랜드로 저장하고 영문 별칭으로 찾는다 (점수·근거 포함)', async () => {
  const db = createSizeChartDb(chartMemAdapter())
  await db.put(rec({ brand: '나이키' }))
  const r = await db.search({ brand: 'nike', model: 'club fleece hoodie' })
  assert.equal(r.length, 1)
  assert.ok(r[0].score >= 60 && r[0].score < 90)
  assert.ok(r[0].reasons.some((x) => x.includes('브랜드 일치')) && r[0].reasons.some((x) => x.includes('모델명 유사도')))
  assert.deepEqual(r[0].entry.sizeChart.rows, CHART.rows)
  assert.deepEqual(await db.search({}), [], '질의가 비면 빈 배열')
})

await atest('사이즈표 DB: 품번 정확 일치가 최고 점수, 유사 모델명은 그보다 낮다', async () => {
  const db = createSizeChartDb(chartMemAdapter())
  await db.put(rec({ url: 'https://shop.example/p/1' }))
  await db.put(rec({ model: 'Nike Club Fleece Hoodie Black', code: 'ZZ9999-001', url: 'https://shop.example/p/2' }))
  await db.put(rec({ brand: 'Adidas', model: '삼선 트랙 팬츠', code: 'AD1234', category: 'bottom', url: 'https://shop.example/p/3' }))
  const byCode = await db.search({ code: 'bv2654 010' })
  assert.equal(byCode.length, 1)
  assert.ok(byCode[0].score >= 90 && byCode[0].reasons[0] === '품번 정확 일치')
  const byModel = await db.search({ brand: '나이키', model: 'Nike Club Fleece Hoodie Black', category: 'top', gender: 'male' })
  assert.equal(byModel[0].entry.code, 'ZZ9999-001', '모델명이 더 가까운 쪽이 먼저')
  assert.ok(byModel.length === 2 && byModel[0].score > byModel[1].score)
  const both = await db.search({ brand: 'nike', model: 'Nike Club Fleece Hoodie Black', code: 'BV2654-010' })
  assert.equal(both[0].entry.code, 'BV2654-010', '품번 일치가 모델명 일치보다 앞')
  assert.ok(both[0].score > both[1].score)
  assert.ok(!(await db.search({ brand: 'nike', model: 'Club Fleece Hoodie' })).some((x) => x.entry.brandKey === brandKeyOfName('adidas')), '다른 브랜드·모델은 후보에서 빠짐')
})

await atest('사이즈표 DB: 카테고리·성별이 다르면 점수가 내려간다', async () => {
  const db = createSizeChartDb(chartMemAdapter())
  await db.put(rec({ url: 'https://shop.example/p/1', code: '' }))
  const q = { brand: 'nike', model: 'Club Fleece Hoodie' }
  const base = (await db.search({ ...q, category: 'top', gender: 'male' }))[0].score
  const catBad = await db.search({ ...q, category: 'shoes', gender: 'male' })
  const genBad = await db.search({ ...q, category: 'top', gender: 'female' })
  assert.ok(catBad[0].score <= base - 30, `카테고리 불일치 ${catBad[0].score} vs ${base}`)
  assert.ok(genBad[0].score <= base - 20, `성별 불일치 ${genBad[0].score} vs ${base}`)
  assert.ok(catBad[0].reasons.some((x) => x.includes('카테고리 불일치')) && genBad[0].reasons.some((x) => x.includes('성별 불일치')))
  // 품번이 맞아도 카테고리·성별이 다르면 같은 품번의 일치 상품보다 낮다
  await db.put(rec({ url: 'https://shop.example/p/9', code: 'KEEP-123', category: 'shoes', gender: 'female' }))
  const c = await db.search({ code: 'KEEP-123', category: 'top', gender: 'male' })
  assert.ok(c[0].score >= 90 && c[0].score < 100)
})

await atest('사이즈표 DB: 같은 상품(주소 또는 브랜드+품번)은 중복 저장하지 않고 갱신한다', async () => {
  const db = createSizeChartDb(chartMemAdapter())
  const a = await db.put(rec(), 1000)
  assert.deepEqual([a.saved, a.updated], [true, false])
  // 같은 주소(쿼리·해시만 다름) -> 갱신
  const b = await db.put(rec({ url: 'https://shop.example/p/1?other=1', sizeChart: { ...CHART, rows: [['S', 51], ['M', 54], ['L', 57]] } }), 2000)
  assert.deepEqual([b.saved, b.updated, b.total], [true, true, 1])
  // 주소가 달라도 브랜드(별칭)+품번이 같으면 같은 상품
  const c = await db.put(rec({ brand: '나이키', url: 'https://other.example/x', code: 'bv2654 010' }), 3000)
  assert.deepEqual([c.updated, c.total], [true, 1])
  const l = await db.list()
  assert.equal(l.length, 1)
  assert.equal(l[0].updatedAt, 3000)
  assert.equal(l[0].url, 'https://other.example/x', '주소는 쿼리 없이 저장')
  // 다른 상품은 따로
  await db.put(rec({ url: 'https://shop.example/p/2', code: 'OTHER1' }), 4000)
  assert.equal((await db.list()).length, 2)
})

await atest('사이즈표 DB: 건수·글자 수 상한을 넘으면 오래 갱신되지 않은 항목부터 정리한다', async () => {
  const db = createSizeChartDb(chartMemAdapter(), { limits: { maxEntries: 5 } })
  for (let i = 0; i < 8; i++) await db.put(rec({ url: `https://shop.example/p/${i}`, code: `C${i}XYZ`, model: `모델 ${i}` }), 1000 + i)
  const l = await db.list()
  assert.equal(l.length, 5)
  assert.deepEqual(l.map((e) => e.code), ['C7XYZ', 'C6XYZ', 'C5XYZ', 'C4XYZ', 'C3XYZ'], '가장 오래된 3건이 빠짐')
  const small = createSizeChartDb(chartMemAdapter(), { limits: { maxBytes: 1500 } })
  for (let i = 0; i < 10; i++) await small.put(rec({ url: `https://shop.example/p/${i}`, code: `C${i}XYZ` }), 1000 + i)
  const sl = await small.list()
  assert.ok(sl.length >= 1 && sl.length < 10 && sl[0].code === 'C9XYZ')
})

await atest('사이즈표 DB: 스키마 버전이 다르면 폐기하고, 비우기는 저장값을 지운다', async () => {
  const ad = chartMemAdapter({ [SIZE_CHART_DB_KEY]: { schemaVersion: SIZE_CHART_DB_VERSION + 1, entries: [{ id: 'x', sizeChart: CHART, model: 'old' }] } })
  const db = createSizeChartDb(ad)
  assert.deepEqual(await db.list(), [])
  assert.equal(ad.m.has(SIZE_CHART_DB_KEY), false, '버전이 다른 값은 저장소에서도 지움')
  await db.put(rec())
  assert.equal(ad.m.has(SIZE_CHART_DB_KEY), true)
  await db.clear()
  assert.equal(ad.m.has(SIZE_CHART_DB_KEY), false)
  assert.deepEqual(await db.search({ brand: 'nike', model: 'hoodie' }), [])
})

await atest('사이즈표 DB: 어댑터만 바꿔도 같은 인터페이스로 동작한다 (localStorage / chrome.storage / 직접 만든 어댑터)', async () => {
  const mem = new Map()
  const ls = localAdapter({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) })
  const area = { d: {}, get(k, cb) { cb({ [k]: this.d[k] }) }, set(o, cb) { Object.assign(this.d, JSON.parse(JSON.stringify(o))); cb() }, remove(k, cb) { delete this.d[k]; cb() } }
  const custom = (() => { const calls = []; const a = chartMemAdapter(); return { calls, get: (k) => (calls.push('get'), a.get(k)), set: (k, v) => (calls.push('set'), a.set(k, v)), remove: (k) => (calls.push('remove'), a.remove(k)) } })()
  for (const adapter of [ls, chromeAdapter(area, {}), custom]) {
    const db = createSizeChartDb(adapter)
    assert.deepEqual(Object.keys(db).sort(), ['clear', 'list', 'put', 'search'])
    assert.equal((await db.put(rec())).saved, true)
    assert.equal((await db.search({ code: 'BV2654-010' }))[0].score >= 90, true)
    await db.clear()
    assert.equal((await db.list()).length, 0)
  }
  assert.ok(mem.size === 0 && !('x' in area.d) && custom.calls.includes('set'))
})

test('사이즈표 DB: 사이즈표가 없거나 상품 단서가 없으면 저장 입력이 되지 않고, 후기·체형 필드는 버린다', () => {
  assert.equal(chartRecordFromProduct({ name: 'x', category: 'top', sizeChart: null }), null)
  assert.equal(toEntry(rec({ sizeChart: { rows: [] } })), null)
  assert.equal(toEntry({ sizeChart: CHART }), null, '주소·품번·모델명이 없음')
  const withExtra = chartRecordFromProduct({ name: '재킷', category: 'outer', url: 'https://shop.example/p/5', reviews: [{ text: 'SECRETREVIEW' }], height: 175, sizeChart: CHART, targetGender: { gender: 'male' } })
  const e = toEntry({ ...withExtra, reviews: [{ text: 'SECRETREVIEW' }], profile: { height: 175 } })
  const json = JSON.stringify(e)
  assert.ok(!json.includes('SECRETREVIEW') && !json.includes('175') && !/reviews|profile/.test(json))
  assert.equal(e.gender, 'male')
})

test('가짜 HTML: JSON-LD Product의 브랜드와 품번을 사이즈표 모음용으로 읽는다 (학습의 brand와는 별개)', () => {
  const ld = '<script type="application/ld+json">{"@type":"Product","name":"x","brand":{"name":"스투시"},"mpn":"ST-1234"}</script>'
  const p = parsePage(fakeDocument(wrapBody(ld + chartTable(OPTION_LIST_LABELS()))), 'https://shop.example/products/7')
  assert.deepEqual([p.chartBrand, p.chartCode], ['스투시', 'ST-1234'])
  assert.equal(p.brand, undefined)
  const none = parsePage(fakeDocument(wrapBody(chartTable(OPTION_LIST_LABELS()))), 'https://shop.example/products/7')
  assert.deepEqual([none.chartBrand, none.chartCode], ['', ''])
})

await atest('사이즈표 DB: 확장(가짜 DOM, vm)이 사이즈표를 읽은 상품만 저장하고 후기 글은 저장하지 않으며 비우기 버튼이 지운다', async () => {
  const html = VIEW_HTML(chartTable(OPTION_LIST_LABELS()))
  const store = new Map()
  const { texts, created } = await runContentInFakeDom(html, {}, {}, store)
  assert.ok(!texts.some((t) => t.includes('분석 중 문제가 생겼어요')))
  assert.ok(store.has(SIZE_CHART_DB_KEY), '사이즈표를 읽었으니 저장')
  const saved = JSON.parse(store.get(SIZE_CHART_DB_KEY))
  assert.equal(saved.schemaVersion, SIZE_CHART_DB_VERSION)
  assert.equal(saved.entries.length, 1)
  assert.deepEqual(saved.entries[0].sizeChart.headers.slice(1), ['총장', '어깨', '가슴', '소매'])
  const raw = store.get(SIZE_CHART_DB_KEY)
  for (const piece of ['ZQOTHER', '소재가 부드럽고', 'onerror', '"height"', '"weight"']) assert.ok(!raw.includes(piece), piece)
  assert.ok(texts.some((t) => t.includes('이 브라우저에만 저장돼요')))
  const btn = created.find((e) => e.className === 'btn' && e.textContent === '사이즈표 모음 비우기')
  assert.ok(btn, '비우기 버튼')
  btn.click()
  for (let i = 0; i < 50 && store.has(SIZE_CHART_DB_KEY); i++) await new Promise((r) => setTimeout(r, 10))
  assert.equal(store.has(SIZE_CHART_DB_KEY), false)
  // 사이즈표를 못 읽은 상품은 저장하지 않고 버튼도 없다
  const noChartStore = new Map()
  const nc = await runContentInFakeDom(wrapBody(NOCHART_HTML), {}, {}, noChartStore)
  assert.equal(noChartStore.has(SIZE_CHART_DB_KEY), false)
  assert.ok(!nc.created.some((e) => e.textContent === '사이즈표 모음 비우기'))
})

test('사이즈표 DB: 웹 화면(서버 렌더)에 목록·점수 근거·저장 위치 안내·비우기 버튼이 있다', async () => {
  const db = createSizeChartDb(chartMemAdapter())
  await db.put(rec({ brand: '나이키' }), 1000)
  const entries = await db.list()
  const html = render(WEB.SizeChartLibrary, { db, initialEntries: entries, onBack: noop })
  const text = textOf(html)
  assert.ok(text.includes('사이즈표 모음 1') && text.includes('Nike Club Fleece Hoodie') && text.includes('BV2654-010'))
  assert.ok(text.includes('이 브라우저에만 저장돼요') && text.includes('사이즈표 모음 비우기') && text.includes('검색'))
  assert.ok(!text.includes('아직 저장된 사이즈표가 없어요'))
  const empty = textOf(render(WEB.SizeChartLibrary, { db, initialEntries: [], onBack: noop }))
  assert.ok(empty.includes('아직 저장된 사이즈표가 없어요'))
  assert.ok(/<button[^>]*disabled[^>]*>사이즈표 모음 비우기/.test(render(WEB.SizeChartLibrary, { db, initialEntries: [], onBack: noop })))
})

// ---- 브랜드 지역 · 사이즈 체계 · 지역 오프셋 · 자세한 근거 (모두 직접 만든 가짜 입력이에요. 실제 사이트/규격 원문 확인이나 정확도 측정이 아니에요) ----
test('브랜드 지역: 근거별로 점수를 합산하고, 근거가 없거나 엇갈리면 unknown', () => {
  const kinds = (r) => r.evidence.map((e) => e.kind)
  const dict = classifyBrandRegion({ brand: '유니클로' })
  assert.deepEqual([dict.region, kinds(dict)], ['jp', ['brandDict']])
  assert.equal(dict.estimated, true)
  assert.equal(classifyBrandRegion({ name: 'Nike Club Fleece Hoodie' }).region, 'us', '브랜드 칸이 비면 상품명 앞쪽 별칭')
  assert.equal(classifyBrandRegion({ originLabel: '일본 브랜드' }).region, 'jp')
  assert.equal(classifyBrandRegion({ optionLabels: ['US 8', 'US 9'] }).region, 'us')
  assert.equal(classifyBrandRegion({ optionLabels: ['JP 26', 'JP 27'] }).region, 'jp')
  assert.equal(classifyBrandRegion({ optionLabels: ['EU 40', 'EU 41'] }).region, 'eu')
  assert.equal(classifyBrandRegion({ optionLabels: ['250', '260', '270'] }).evidence[0].kind, 'sizeNotation')
  assert.equal(classifyBrandRegion({ priceCurrency: 'jpy', url: 'https://shop.example/p/1' }).evidence[0].kind, 'currency')
  const both = classifyBrandRegion({ priceCurrency: 'JPY', url: 'https://item.example.co.jp/p/1' })
  assert.deepEqual([both.region, both.scores.jp], ['jp', REGION_SCORE.currency + REGION_SCORE.domain])
  assert.equal(classifyBrandRegion({ priceText: '12,000엔' }).evidence[0].region, 'jp')
  // 합산: 브랜드 사전(미국 3) + 사이즈 표기(미국 2) → 미국, 근거 2개
  const sum = classifyBrandRegion({ brand: 'Nike', optionLabels: ['US 9'] })
  assert.deepEqual([sum.region, sum.scores.us, sum.evidence.length, sum.confidence], ['us', 5, 2, 'high'])
  // 근거 없음 / 약한 근거 하나(도메인만) / 동점 → unknown
  const none = classifyBrandRegion({ brand: '무명브랜드', name: '아무 상품', url: 'https://shop.example/p/1' })
  assert.deepEqual([none.region, none.evidence.length], ['unknown', 0])
  assert.equal(classifyBrandRegion({}).region, 'unknown')
  assert.equal(classifyBrandRegion({ url: 'https://shop.example.co.kr/p/1' }).region, 'unknown', '도메인만으로는 판단하지 않아요')
  assert.equal(classifyBrandRegion({ brand: 'Nike', originLabel: '일본 브랜드' }).region, 'jp', '쇼핑몰 표시가 사전보다 높은 점수')
  assert.equal(classifyBrandRegion({ brand: 'Nike', priceCurrency: 'JPY', optionLabels: ['JP 26'], originLabel: '' }).region, 'unknown', '3점 대 3점이면 판단하지 않아요')
  // 사전의 모든 항목은 추정 표시를 달고 있어요
  assert.ok(Object.values(BRAND_REGION_DICT).every((v) => v.estimated === true))
})

test('브랜드 지역: 화면 한 줄에 (추정)과 근거가 들어가고, 키는 판단 못 하면 null', () => {
  const line = regionLine(classifyBrandRegion({ brand: '유니클로', url: 'https://www.uniqlo.co.jp/p/1' }))
  assert.ok(line.startsWith('브랜드 지역: 일본(추정) 근거: ') && line.includes('브랜드 사전(추정)') && line.includes('도메인'), line)
  assert.ok(regionLine(classifyBrandRegion({})).includes('알 수 없음'))
  assert.equal(regionKeyOf({ brand: 'Nike' }), 'us')
  assert.equal(regionKeyOf({ brand: '무명' }), null)
  assert.ok(REGION_HYPOTHESIS_NOTE.includes('검증 전 가설') && !/\d+\s*cm/.test(REGION_HYPOTHESIS_NOTE), '가설 문구에 고정 수치가 없다')
})

test('사이즈 체계 변환표: 모든 값에 근사/출처 확인 필요 플래그가 있고, 없는 값은 만들지 않는다', () => {
  const kr = representativeMeasure({ category: 'top', gender: 'male', label: '100' })
  assert.deepEqual(kr.measures, { chest: 100 })
  assert.deepEqual([kr.approximate, kr.needsSource, kr.flag], [true, true, SIZE_SYSTEM_FLAG])
  assert.equal(SIZE_SYSTEM_FLAG, '근사/출처 확인 필요')
  assert.equal(representativeMeasure({ category: 'top', gender: null, label: '100' }), null, '성별을 모르면 숫자 호칭을 풀지 않는다')
  assert.equal(representativeMeasure({ category: 'top', gender: 'female', label: '100' }), null)
  assert.equal(representativeMeasure({ category: 'top', gender: 'male', label: 'M' }), null, '알파벳은 근거를 확인하지 못해 비워 둔다')
  assert.equal(representativeMeasure({ category: 'top', gender: 'male', label: '97' }), null)
  assert.deepEqual(representativeMeasure({ category: 'bottom', label: '30' }).measures, { waist: 76.2 })
  assert.deepEqual(representativeMeasure({ category: 'shoes', label: '260' }).measures, { footLength: 260 })
  assert.ok([representativeMeasure({ category: 'bottom', label: '30' }), representativeMeasure({ category: 'shoes', label: '260' })].every((m) => m.approximate && m.needsSource && m.flag === SIZE_SYSTEM_FLAG))
  const hint = sizeSystemHint({ category: 'top', gender: 'male', optionLabels: ['95', '100', '100', 'XL'] })
  assert.deepEqual(hint.lines.length, 2)
  assert.ok(hint.title.includes(SIZE_SYSTEM_FLAG) && hint.note.includes('추천 계산에는 쓰지 않았어요'))
  assert.equal(sizeSystemHint({ category: 'top', gender: 'male', optionLabels: ['S', 'M'] }), null)
  assert.ok(readFileSync(resolvePath(import.meta.dirname, '../docs/사이즈체계_출처확인.md'), 'utf8').includes('확인 TODO'), '출처 확인 문서가 있다')
})

test('지역 오프셋: 같은 지역 표본이 충분하면 모델에 쌓이고, 부족하면 0, 브랜드 오프셋이 있으면 브랜드가 우선', () => {
  const reg = (region, n, tag, label = 'small') => Array.from({ length: n }, (_, i) => ({ id: `r-${region}-${tag}${i}`, cat: 'top', brand: `${tag}${i % 10}`, region, label, w: 1, e: { chest: 14 }, d: 20000 }))
  const few = trainModel(reg('us', LEARN.regionMin - 1, 'f'), EASE_RULES)
  assert.equal(few.regions, undefined, '표본이 모자라면 지역 오프셋을 만들지 않는다')
  assert.equal(resolveLearned(few, 'top', null, 'us').offset, 0)
  const some = trainModel(reg('us', 10, 'a'), EASE_RULES)
  const many = trainModel(reg('us', 60, 'b'), EASE_RULES)
  const o10 = some.regions.top.us.offset
  const o60 = many.regions.top.us.offset
  assert.ok(o10 > 0 && o60 > o10 && o60 <= LEARN.maxRegionOffset, `0 < ${o10} < ${o60} <= ${LEARN.maxRegionOffset}`)
  const r = resolveLearned(many, 'top', 'nobrand', 'us')
  assert.deepEqual([r.offset, r.offsetSource, r.regionSamples], [o60, 'region', 60])
  assert.deepEqual([resolveLearned(many, 'top', null, 'jp').offset, resolveLearned(many, 'top', null, null).offset], [0, 0], '다른 지역·지역 모름은 보정 0')
  assert.equal(resolveLearned(many, 'bottom', null, 'us').offset, 0, '다른 종류에는 적용 안 됨')
  // 브랜드 오프셋(3건 이상 브랜드)이 있으면 지역 값을 더하지 않고 브랜드 값을 쓴다
  const mixed = trainModel([...reg('us', 30, 'c'), ...synth('top', 'zbrand', 'true', 6, 8, 20000, 'zb').map((x) => ({ ...x, region: 'us' }))], EASE_RULES)
  const m = resolveLearned(mixed, 'top', 'zbrand', 'us')
  assert.equal(m.offset, m.brandOffset)
  assert.notEqual(m.offset, m.regionOffset)
  assert.ok(m.regionOffset > 0, '지역 값은 따로 계산돼 있다')
  // 지역을 모르는 샘플은 지역 집계에 들어가지 않는다
  assert.equal(trainModel(synth('top', 'q', 'small', 30, 14), EASE_RULES).regions, undefined)
})

await atest('지역 오프셋: 샘플에 지역이 담기고, 지역 학습값이 같은 지역 상품의 판정만 바꾼다 (되돌리면 실패)', async () => {
  const withNike = toSamples(lrnProduct({ brand: 'Nike' }))
  assert.ok(withNike.length > 0 && withNike.every((x) => x.region === 'us'))
  assert.ok(toSamples(lrnProduct()).every((x) => !('region' in x)), '지역을 모르면 담지 않는다')
  const model = trainModel(Array.from({ length: 40 }, (_, i) => ({ id: `u${i}`, cat: 'top', brand: `b${i % 20}`, region: 'us', label: 'small', w: 1, e: { chest: 16 }, d: 20000 })), EASE_RULES)
  const us = generateFitComment(profile, lrnProduct({ brand: 'Nike', url: '' }), {}, model)
  const none = generateFitComment(profile, lrnProduct({ brand: '무명', url: 'https://shop.example/p/1' }), {}, model)
  const baseline = generateFitComment(profile, lrnProduct({ brand: 'Nike', url: '' }), {}, null)
  assert.equal(us.evidence.offsetSource, 'region')
  assert.ok(us.evidence.offsetValue > 0)
  assert.equal(none.evidence.offsetSource, null)
  assert.equal(none.evidence.offsetValue, 0)
  assert.notEqual(us.perSize.map((p) => p.score).join(), none.perSize.map((p) => p.score).join(), '같은 지역 상품만 점수가 달라진다')
  assert.equal(baseline.evidence.offsetSource, null)
  assert.equal(us.regionInfo.region, 'us')
})

await atest('자세한 근거 줄: 후기 건수·제외, 학습값 샘플 수, 브랜드/지역 보정, 부위별 여유분, 브랜드 지역이 나오고 정확도처럼 보이는 문구는 없다', async () => {
  const model = trainModel([...synth('top', null, 'small', 10, 12), ...synth('top', null, 'true', 10, 20)], EASE_RULES)
  const base = lrnProduct()
  const bad = { gender: 'male', height: 300, weight: 70, size: 'M', fit: 'small', text: '불가능한 키' }
  const r = generateFitComment(profile, { ...base, brand: 'Nike', reviews: [...base.reviews, bad] }, {}, model)
  const d = describeEvidence(r.evidence, r.confidence).details
  const all = d.join('\n')
  assert.ok(d.some((l) => l.startsWith('후기 근거: 불러온 후기 21건 중 이상치 제외 1건')), all)
  assert.ok(d.includes('학습값: 사용(이 종류 샘플 20건, 이 브라우저에 모은 후기 기준)'), all)
  assert.ok(d.some((l) => l.startsWith('브랜드·지역 보정: 없음(0cm')), all)
  assert.ok(d.some((l) => l.startsWith('브랜드 지역: 미국(추정) 근거: ')), all)
  assert.ok(d.some((l) => l.startsWith('부위별 여유분 판정: ') && /가슴 \+?-?\d/.test(l)), all)
  assert.ok(d[d.length - 1].includes('정확도를 측정한 값은 아니에요'))
  assert.ok(!/정확도 \d|\d+\s*%\s*정확/.test(all))
  // 학습값이 없으면 학습 줄은 나오지 않고 후기·부위·지역 줄은 나온다
  const plain = describeEvidence(generateFitComment(profile, base, {}, null).evidence, 'low').details.join('\n')
  assert.ok(plain.includes('후기 근거') && plain.includes('부위별 여유분 판정') && !plain.includes('학습값'))
  assert.deepEqual(describeEvidence({}, 'low').details, [])
})

await atest('지역·근거 표시: 확장 카드(가짜 DOM, vm)에 브랜드 지역(추정)과 자세한 근거가 나오고, 사이즈표가 없으면 변환표 참고값이 플래그와 함께 나온다', async () => {
  const ld = '<script type="application/ld+json">{"@type":"Product","name":"x","brand":{"name":"나이키"},"offers":{"priceCurrency":"USD"}}</script>'
  const { texts } = await runContentInFakeDom(wrapBody(ld + VIEW_HTML(chartTable(OPTION_LIST_LABELS()))))
  assert.ok(!texts.some((t) => t.includes('분석 중 문제가 생겼어요')))
  assert.ok(texts.some((t) => t.startsWith('브랜드 지역: 미국(추정) 근거: ') && t.includes('브랜드 사전(추정)') && t.includes('통화 USD')), '지역 근거 줄')
  assert.ok(texts.includes('추천에 쓰인 근거 (자세히)'))
  assert.ok(texts.some((t) => t.startsWith('후기 근거: 불러온 후기 ')))
  assert.ok(texts.some((t) => t.startsWith('부위별 여유분 판정: ')))
  assert.ok(texts.some((t) => t.includes('검증 전 가설')))
  const unknown = await runContentInFakeDom(VIEW_HTML(chartTable(OPTION_LIST_LABELS())))
  assert.ok(unknown.texts.some((t) => t.startsWith('브랜드 지역: 알 수 없음')), '근거가 없으면 알 수 없음')
  // 판단 결과 자체는 analyzePage에도 담겨요
  const out = analyzePage(fakeDocument(wrapBody(ld + VIEW_HTML(chartTable(OPTION_LIST_LABELS())))), 'https://shop.example/products/1', buildProfile({ gender: 'male', height: '175', weight: '70', preferredFit: 'regular' }).profile, '0.1.0')
  assert.equal(out.regionInfo.region, 'us')
  assert.ok(out.details.length >= 3)
})

test('지역·근거 표시: 웹 결과 화면(서버 렌더)에 브랜드 지역(추정)·자세한 근거·가설 안내가 나오고, 사이즈표가 없으면 변환표 참고값이 나온다', () => {
  const clothing = { ...PRODUCTS['https://shop-a.example.com/goods/12345'], source: 'demo', brand: 'Nike' }
  const props = { product: clothing, profile, calibration: {}, feedbackCount: 0, onFeedback: noop, onRestart: noop, wardrobe: [], onSaveWardrobe: noop }
  const text = textOf(render(WEB.ResultView, props))
  assert.ok(text.includes('브랜드 지역: 미국(추정) 근거: 브랜드 사전(추정): 미국'), '지역 줄')
  assert.ok(text.includes('후기 근거: 불러온 후기') && text.includes('부위별 여유분 판정:'))
  assert.ok(text.includes('검증 전 가설'))
  const noChart = textOf(render(WEB.FitComment, { result: generateFitComment(profile, { name: '셔츠', category: 'top', optionLabels: ['95', '100'], reviews: [], sizeChart: null, targetGender: { gender: 'male' } }, {}, null) }))
  assert.ok(noChart.includes('사이즈 표기 참고값(근사/출처 확인 필요)') && noChart.includes('100 → 가슴둘레 호칭 약 100cm'))
})

import { reviewBodyEstimate } from '../src/lib/reviewBodyEstimate.js'

test('후기 보정 추정: 비슷한 체형이 산 사이즈·핏 평가로 직접 재지 않은 둘레만 옮기고, 후기가 1건이거나 직접 잰 부위는 그대로 둔다 (가짜 데이터)', () => {
  const chart = { L: { shoulder: 48, chest: 112 } }
  const reviews = [{ size: 'L', fit: 'true', similarity: 100 }, { size: 'L', fit: 'true', similarity: 100 }]
  const base = { shoulder: 45.5, chest: 97.5, topLength: 68 }
  const r = reviewBodyEstimate({ values: base, measured: new Set(), reviews, measuresOf: (s) => chart[s], rules: EASE_RULES })
  // 정사이즈 가슴 여유 (6+14)/2=10 → 역산 102. 공식 97.5(가중 2)와 후기 2건(가중 2) 평균 = 99.75 → 0.5 단위 100
  assert.equal(r.values.chest, 100)
  assert.equal(r.reviewParts.chest.n, 2)
  assert.equal(r.values.topLength, 68, '기장은 건드리지 않아요')
  const measured = reviewBodyEstimate({ values: base, measured: new Set(['chest']), reviews, measuresOf: (s) => chart[s], rules: EASE_RULES })
  assert.equal(measured.values.chest, 97.5, '직접 잰 가슴은 그대로')
  assert.ok(!measured.reviewParts.chest)
  const one = reviewBodyEstimate({ values: base, measured: new Set(), reviews: reviews.slice(0, 1), measuresOf: (s) => chart[s], rules: EASE_RULES })
  assert.deepEqual(one.reviewParts, {}, '후기 1건이면 보정하지 않아요')
  // '작아요'는 더 큰 몸으로 역산해요
  const small = reviewBodyEstimate({ values: base, measured: new Set(), reviews: reviews.map((x) => ({ ...x, fit: 'small' })), measuresOf: (s) => chart[s], rules: EASE_RULES })
  assert.ok(small.values.chest > r.values.chest)
  // 아무리 많아도 공식값에서 6cm 넘게 옮기지 않아요
  const far = reviewBodyEstimate({ values: base, measured: new Set(), reviews: Array.from({ length: 20 }, () => ({ size: 'L', fit: 'small', similarity: 100 })), measuresOf: (s) => ({ L: { chest: 140 } })[s], rules: EASE_RULES })
  assert.equal(far.values.chest, 103.5)
})

test('단계형 추천: 키·몸무게만이면 비슷한 체형 후기 2건을 우선하고, 가슴을 직접 재면 실측 비교를 우선한다 (가짜 데이터)', () => {
  const product = {
    name: '스웻셔츠', mall: 'shop', category: 'top',
    sizeChart: { measures: { M: { shoulder: 47, chest: 104 }, L: { shoulder: 49, chest: 112 } } },
    reviews: [
      { id: 1, nick: 'a', rating: 5, text: '정사이즈', gender: 'male', height: 175, weight: 70, size: 'L', fit: 'true' },
      { id: 2, nick: 'b', rating: 5, text: '정사이즈', gender: 'male', height: 176, weight: 70, size: 'L', fit: 'true' },
    ],
    notes: [],
  }
  const simple = { gender: 'male', height: 175, weight: 70, preferredFit: 'regular', usual: { top: '', bottom: '' }, measurements: {} }
  const r = generateFitComment(simple, product)
  assert.equal(r.detailed, false)
  assert.equal(r.recommendedSize, 'L', '키·몸무게만이면 후기 우선')
  assert.ok(r.reviewParts.chest, '가슴은 후기로 보정')
  assert.ok(r.note.includes('비슷한 체형 후기를 우선'))
  const cmp = compareSizes({ chart: product.sizeChart, bodyValues: r.bodyValues, measured: r.measured, category: 'top', reviewParts: r.reviewParts })
  assert.equal(cmp.sizes[0].rows.find((x) => x.part === 'chest').bodyKind, 'review', '비교 표에 (후기 추정)')
  const det = generateFitComment({ ...simple, measurements: { chest: 96 } }, product)
  assert.equal(det.detailed, true)
  assert.equal(det.recommendedSize, 'M', '가슴을 재면 실측 비교 우선')
  assert.equal(det.bodyValues.chest, 96)
})


// ---- 중고 판매글 분석 (번개장터·후르츠패밀리). 아래 글·HTML은 전부 직접 만든 가짜예요. 실제 사이트에서 확인한 것이 아니에요 ----
const usedProfile = buildProfile({ gender: 'male', height: '175', weight: '70', preferredFit: 'regular' }).profile
const U_TITLE = '[M] 나이키 Club Fleece Hoodie 후드 티셔츠'

test('중고 판매글 파서: 사이즈 표기(알파벳·숫자·FREE·신발 mm·허리 인치)와 브랜드·모델·품번을 읽는다', () => {
  const a = parseListingText('사이즈: L\n품번: BV2654-010', { title: '나이키 Club Fleece 후드 L' })
  assert.deepEqual(a.sizes.map((x) => x.label), ['L'])
  assert.equal(a.brand.key, 'nike')
  assert.equal(a.code, 'BV2654-010')
  assert.ok(a.model.includes('Club Fleece') && !/\bL$/.test(a.model))
  assert.deepEqual(parseListingText('셔츠 100사이즈').sizes.map((x) => [x.label, x.kind]), [['100', 'kr-top']])
  assert.deepEqual(parseListingText('프리사이즈 FREE size 가디건').sizes.map((x) => x.label), ['FREE'])
  const shoe = parseListingText('뉴발란스 530 270mm 새상품', { title: '뉴발란스 530 270' })
  assert.equal(shoe.category, 'shoes')
  assert.ok(shoe.sizes.some((x) => x.label === '270' && x.kind === 'mm'))
  const jeans = parseListingText('리바이스 501 청바지 W32 허리 40 허벅지 30')
  assert.ok(jeans.sizes.some((x) => x.label === '32' && x.kind === 'inch') && jeans.category === 'bottom')
  assert.ok(!parseListingText('S급 상태 좋아요 직거래').sizes.length, 'S급은 사이즈가 아니라 상태')
  assert.equal(parseListingText('번호: 없음').code, '')
})

test('중고 판매글 파서: 실측 줄(가슴·총장·어깨·소매), 단면이면 ×2, cm 생략, 둘레는 그대로', () => {
  const p = parseListingText('가슴단면 55cm 총장 70 어깨 47 소매 60', { title: '후드 티셔츠' }).measuresBySize.default
  assert.equal(p.chest.cm, 110)
  assert.equal(p.chest.kind, 'section')
  assert.equal(p.topLength.cm, 70, 'cm 생략도 읽어요')
  assert.equal(p.shoulder.cm, 47)
  assert.equal(p.arm.cm, 60)
  const circ = parseListingText('가슴둘레 108 어깨 46', { title: '셔츠' }).measuresBySize.default
  assert.equal(circ.chest.cm, 108)
  assert.equal(circ.chest.kind, 'circ')
  const trail = parseListingText('가슴 55(단면) 총장 70', { title: '티셔츠' }).measuresBySize.default
  assert.equal(trail.chest.cm, 110, '뒤에 붙은 (단면)도 인식')
  const bare = parseListingText('단면 55 총장 70', { title: '맨투맨' }).measuresBySize.default
  assert.equal(bare.chest.cm, 110)
  assert.equal(bare.chest.inferred, true, '부위 없는 단면은 가슴으로 짐작한 값이라 표시')
  const bottom = parseListingText('허리 40 밑위 30 허벅지 30 총장 100', { title: '청바지' }).measuresBySize.default
  assert.equal(bottom.waist.cm, 80)
  assert.equal(bottom.thigh.cm, 60)
  assert.equal(bottom.rise.cm, 30)
  assert.equal(bottom.inseam.cm, 100)
  assert.equal(parseListingText('허리 30인치', { title: '청바지' }).measuresBySize.default.waist.cm, 76.2)
})

test('중고 판매글 파서: 비현실적인 값은 버리고 단면/둘레가 애매한 값도 버리며 건수를 센다', () => {
  const r = parseListingText('가슴 5 어깨 200 소매 999 총장 3 허리 72 가슴단면 55', { title: '티셔츠' })
  const d = r.measuresBySize.default
  assert.deepEqual(Object.keys(d).sort(), ['chest', 'waist'].sort())
  assert.equal(d.chest.cm, 110)
  assert.equal(d.waist.cm, 72, '72는 허리 둘레로만 가능한 값')
  assert.ok(r.counts.droppedCount >= 4)
  const amb = parseListingText('가슴 72', { title: '티셔츠' })
  assert.deepEqual(amb.measuresBySize, {}, '72는 단면(×2=144)일 수도 둘레일 수도 있어 쓰지 않아요')
  assert.equal(amb.counts.ambiguousCount, 1)
  assert.deepEqual(parseListingText('상품 가격 100 제품 55', { title: '티셔츠' }).measuresBySize, {}, '상품·제품의 "품"은 가슴으로 읽지 않아요')
})

test('중고 판매글 파서: 사이즈별 실측(M: …, L: …)은 사이즈별로 나눠 읽는다', () => {
  const r = parseListingText('M 가슴 55 총장 70\nL 가슴 58 총장 72', { title: '후드 티셔츠' })
  assert.deepEqual(r.namedSizes, ['M', 'L'])
  assert.equal(r.measuresBySize.M.chest.cm, 110)
  assert.equal(r.measuresBySize.L.chest.cm, 116)
  assert.equal(r.measuresBySize.L.topLength.cm, 72)
})

const dbWith = async (...recs) => {
  const db = createSizeChartDb(chartMemAdapter())
  for (const r of recs) await db.put(r)
  return db
}

test('중고 분석 판정 규칙: 핵심 부위가 없으면 판정하지 않고, 선호 핏에 따라 타이트/넉넉을 다르게 본다', () => {
  assert.equal(usedVerdictFrom([], 'regular'), null)
  assert.equal(usedVerdictFrom([{ part: 'topLength', level: 0 }], 'regular'), null, '총장만으로는 판정 안 함')
  assert.equal(usedVerdictFrom([{ part: 'chest', level: 0 }], 'regular'), 'small')
  assert.equal(usedVerdictFrom([{ part: 'chest', level: 1 }], 'regular'), 'small')
  assert.equal(usedVerdictFrom([{ part: 'chest', level: 1 }], 'slim'), 'fit')
  assert.equal(usedVerdictFrom([{ part: 'chest', level: 4 }], 'regular'), 'large')
  assert.equal(usedVerdictFrom([{ part: 'chest', level: 4 }], 'relaxed'), 'fit')
  assert.equal(usedVerdictFrom([{ part: 'chest', level: 2 }, { part: 'shoulder', level: 3 }], 'regular'), 'fit')
})

await atest('중고 분석 우선순위 1: 판매글 실측이 있으면 사이즈표 DB가 있어도 실측을 쓴다 (후기 없음 카드)', async () => {
  const db = await dbWith(rec({ brand: '나이키', model: 'Nike Club Fleece Hoodie 후드 티셔츠', sizeChart: { ...CHART, measures: { S: { chest: 80 }, M: { chest: 82 } } } }))
  const listing = { title: U_TITLE, text: `${U_TITLE}\n품번 BV2654-010\n가슴단면 55 총장 70 어깨 47 소매 60` }
  const matches = await findChartMatches(db, usedSearchQuery(listing))
  assert.ok(matches[0].score >= 90, '품번이 같아 DB 후보도 있음')
  const r = analyzeUsedListing(listing, usedProfile, { chartMatches: matches })
  assert.equal(r.status, 'used')
  assert.equal(r.basis, 'listing')
  assert.equal(r.verdict, 'fit')
  assert.equal(r.verdictLabel, '맞음')
  assert.equal(r.approx, false)
  assert.ok(['low', 'medium'].includes(r.confidence), '확신도 높음은 주지 않아요')
  assert.equal(r.confidence, 'medium')
  assert.equal(r.noReviewNote, USED_NO_REVIEW_NOTE)
  assert.equal(r.priority.find((x) => x.id === 'chart-db').state, 'skipped')
  assert.ok(r.details.some((l) => l.startsWith('판매글에서 읽은 실측: 가슴 55(단면→둘레 110)')))
  assert.ok(r.details.some((l) => l.startsWith('가슴: 옷 110cm − 내 ')))
  assert.ok(r.reasons.includes(USED_NO_REVIEW_NOTE))
  // 작은 실측이면 '작음', 큰 실측이면 '큼'
  assert.equal(analyzeUsedListing({ title: '티셔츠', text: '티셔츠 가슴단면 44 어깨 40' }, usedProfile).verdictLabel, '작음')
  assert.equal(analyzeUsedListing({ title: '티셔츠', text: '티셔츠 가슴단면 66 어깨 58' }, usedProfile).verdictLabel, '큼')
})

await atest('중고 분석 우선순위 2: 판매글 실측이 없고 DB 점수가 기준 이상이면 DB 사이즈표를 쓰고 근사로 표시한다', async () => {
  const db = await dbWith(rec({ brand: '나이키', model: 'Nike Club Fleece Hoodie 후드 티셔츠' }))
  const listing = { title: U_TITLE, text: `${U_TITLE}\n품번 BV2654-010\n상태 좋아요` }
  const r = analyzeUsedListing(listing, usedProfile, { chartMatches: await findChartMatches(db, usedSearchQuery(listing)) })
  assert.equal(r.basis, 'chart-db')
  assert.equal(r.approx, true)
  assert.equal(r.verdictLabel, '맞음', 'M 가슴 106 vs 내 97.5')
  assert.ok(r.basisLabel.includes('근사'))
  assert.ok(r.details.some((l) => l.startsWith('사이즈표 DB(근사/추정): 점수 ') && l.includes('품번 정확 일치')))
  assert.equal(r.priority.find((x) => x.id === 'listing').state, 'none')
  // 점수가 기준 아래면 쓰지 않아요
  const weak = [{ score: USED_DB_MIN_SCORE - 1, reasons: ['모델명 유사도 40%(+24)'], entry: { id: 'x', brand: 'a', model: 'b', category: 'top', sizeChart: CHART } }]
  const r2 = analyzeUsedListing({ title: U_TITLE, text: U_TITLE }, usedProfile, { chartMatches: weak })
  assert.notEqual(r2.basis, 'chart-db')
  assert.ok(r2.priority.find((x) => x.id === 'chart-db').text.includes('기준'))
  // 판매 사이즈를 모르면 DB 기준 추천 사이즈만 알려주고 판정은 하지 않아요
  const r3 = analyzeUsedListing({ title: '나이키 Club Fleece Hoodie 후드 티셔츠', text: '나이키 Club Fleece Hoodie 후드 티셔츠 품번 BV2654-010' }, usedProfile, { chartMatches: await findChartMatches(db, usedSearchQuery({ title: '나이키 Club Fleece Hoodie 후드 티셔츠', text: '나이키 Club Fleece Hoodie 후드 티셔츠 품번 BV2654-010' })) })
  assert.equal(r3.verdict, null)
  assert.ok(r3.recommended)
  assert.equal(r3.confidence, 'low')
})

test('중고 분석 우선순위 3: 실측도 DB도 없으면 사이즈 표기 기본값으로만 가늠하고 확신도는 낮음·근사/추정으로 표시한다', () => {
  const r = analyzeUsedListing({ title: '뉴발란스 530 270', text: '뉴발란스 530 270mm 사이즈' }, usedProfile)
  assert.equal(r.basis, 'default')
  assert.equal(r.approx, true)
  assert.equal(r.confidence, 'low')
  assert.equal(r.verdictLabel, '맞음')
  assert.ok(r.details.some((l) => l.startsWith('사이즈 표기 참고값(근사/출처 확인 필요)')))
  assert.ok(r.details.some((l) => l.startsWith('브랜드 지역: 미국(추정)')))
  const small = analyzeUsedListing({ title: '뉴발란스 530 250', text: '뉴발란스 530 250mm' }, usedProfile)
  assert.equal(small.verdictLabel, '작음')
  const big = analyzeUsedListing({ title: '뉴발란스 530 290', text: '뉴발란스 530 290mm' }, usedProfile)
  assert.equal(big.verdictLabel, '큼')
  // 국내 호칭(95/100/105)은 미국 브랜드로 추정되면 쓰지 않고, 근거가 없으면 판정하지 않아요
  assert.equal(analyzeUsedListing({ title: '나이키 후드티 100', text: '나이키 후드티 100사이즈' }, usedProfile).basis, 'none')
  const kr = analyzeUsedListing({ title: '무신사 스탠다드 셔츠 100', text: '셔츠 100사이즈 남성' }, usedProfile)
  assert.equal(kr.basis, 'default')
  const none = analyzeUsedListing({ title: '후드티', text: '후드티 상태 좋아요' }, usedProfile)
  assert.equal(none.basis, 'none')
  assert.equal(none.verdict, null)
  assert.equal(none.verdictLabel, null)
  assert.ok(none.headline.includes('근거가 부족'))
})

const BUNJANG_HTML = `<html><head><meta property="og:title" content="[L] 나이키 후드 티셔츠 ">
<meta property="og:description" content="새상품 직거래 가능"><meta property="og:image" content="https://img.example.com/a.jpg"></head>
<body><div class="product-description"><p>가슴단면 55</p><p>총장 70 어깨 47 소매 60</p></div><div class="comments">댓글 영역</div>
<img src="https://img.example.com/b.jpg"><img src="data:image/png;base64,AAA"><img src="http://insecure.example/c.jpg"></body></html>`
const FRUITS_HTML = `<html><head><script type="application/ld+json">{"@type":"Product","name":"Stussy 스투시 후드 M","description":"M 사이즈\\n가슴 단면 56 총장 71","image":["https://cdn.example.com/f1.jpg"],"offers":{"price":"85000","priceCurrency":"KRW"}}</script></head><body><h1>Stussy 후드</h1></body></html>`

test('중고 판매글 읽기: 번개장터·후르츠패밀리 주소를 알아보고, og 태그·JSON-LD·본문 영역에서 제목·본문·가격·사진을 읽는다 (가짜 HTML)', () => {
  assert.equal(usedSiteOf('https://m.bunjang.co.kr/products/1').id, 'bunjang')
  assert.equal(usedSiteOf('https://bunjang.co.kr/products/1').id, 'bunjang')
  assert.equal(usedSiteOf('https://www.fruitsfamily.com/products/1').id, 'fruitsfamily')
  assert.equal(usedSiteOf('https://www.musinsa.com/products/1'), null)
  assert.equal(usedSiteOf('https://evil-bunjang.co.kr.example.com/'), null, '비슷한 이름의 다른 도메인은 거부')
  assert.ok(USED_SITES_NOTE.includes('추정') && USED_SITES_NOTE.includes('확인하지 못했어요'))
  const b = readListing(fakeDocument(BUNJANG_HTML))
  assert.equal(b.title, '[L] 나이키 후드 티셔츠')
  assert.equal(b.description, '새상품 직거래 가능')
  assert.ok(b.bodyText.includes('가슴단면 55') && b.bodyText.includes('총장 70'))
  assert.ok(!b.bodyText.includes('댓글'))
  assert.deepEqual(b.photos, ['https://img.example.com/a.jpg', 'https://img.example.com/b.jpg'], 'https 사진만, data:·http는 버림')
  const f = readListing(fakeDocument(FRUITS_HTML))
  assert.equal(f.title, 'Stussy 스투시 후드 M')
  assert.equal(f.price.amount, 85000)
  assert.equal(f.price.currency, 'KRW')
  assert.deepEqual(f.photos, ['https://cdn.example.com/f1.jpg'])
  assert.ok(listingText(f).includes('가슴 단면 56'))
  assert.equal(isUsedListingPage(fakeDocument(BUNJANG_HTML), 'https://m.bunjang.co.kr/products/1'), true)
  assert.equal(isUsedListingPage(fakeDocument(BUNJANG_HTML), 'https://shop.example/p/1'), false)
  assert.equal(isUsedListingPage(fakeDocument('<html><body>x</body></html>'), 'https://m.bunjang.co.kr/'), false, '제목이 없으면 판매글로 보지 않아요')
})

test('중고 판매글: analyzePage가 중고 사이트 주소면 판매글 결과 카드를 만들고, 진단에는 건수만 담는다', () => {
  const out = analyzePage(fakeDocument(BUNJANG_HTML), 'https://m.bunjang.co.kr/products/1', usedProfile, '0.1.0')
  assert.equal(out.status, 'used')
  assert.equal(out.site.name, '번개장터')
  assert.equal(out.basis, 'listing')
  assert.equal(out.verdictLabel, '맞음')
  assert.equal(out.reviewViews, undefined, '후기 구역 없음')
  assert.deepEqual(out.counts, { measureCount: 4, sizeCount: 1, droppedCount: 0, ambiguousCount: 0, photoCount: 2 })
  const report = formatReport(out.diagnostics)
  assert.ok(report.includes('중고 판매글 읽기: 실측 4개, 사이즈 표기 1개, 버린 값 0개, 사진 2개, 사용한 근거 판매글 실측, 알려진 중고 사이트 주소 예'))
  for (const secret of ['나이키', '후드', '가슴단면', 'img.example.com', '직거래']) assert.ok(!report.includes(secret), `리포트에 판매글 글이 없어야 해요: ${secret}`)
  // 읽을 글이 없으면 no-data(진단 포함, 리뷰 불러오기 대상 아님 표시)
  const empty = analyzePage(fakeDocument('<html><body>x</body></html>'), 'https://fruitsfamily.com/x', usedProfile, '0.1.0')
  assert.equal(empty.status, 'no-data')
  assert.equal(empty.usedSite, true)
  assert.ok(formatReport(empty.diagnostics).includes('사용한 근거 없음'))
  // 중고 사이트가 아닌 주소에서는 기존 흐름 그대로
  assert.notEqual(analyzePage(fakeDocument(BUNJANG_HTML), 'https://shop.example/p/1', usedProfile, '0.1.0').status, 'used')
  // 중고 분석이 아닐 때 진단 리포트에는 중고 줄이 없다
  assert.ok(!formatReport(collectDiagnostics(fakeDocument(BUNJANG_HTML), 'https://shop.example/p/1', '0.1.0')).includes('중고 판매글 읽기'))
})

await atest('중고 판매글 content.js(가짜 DOM, vm): 번개장터·후르츠패밀리 가짜 HTML이 결과 카드로 그려지고 후기 불러오기는 하지 않는다', async () => {
  const b = await runContentInFakeDom(BUNJANG_HTML, { location: { href: 'https://m.bunjang.co.kr/products/1' } })
  assert.ok(!b.texts.some((t) => t.includes('분석 중 문제가 생겼어요')), b.texts.join('|'))
  assert.ok(b.texts.includes('맞음'), '판정 글자')
  assert.ok(b.texts.some((t) => t.includes('후기 없이 계산했어요')))
  assert.ok(b.texts.some((t) => t.startsWith('근거: 판매글 실측')))
  assert.ok(b.texts.some((t) => t.startsWith('판매글에서 읽은 실측: 가슴 55(단면→둘레 110)')))
  assert.ok(b.texts.includes('문제가 있나요? 진단 리포트'))
  assert.ok(!b.texts.some((t) => t.includes('리뷰 불러오는 중')), '중고 판매글은 후기 불러오기를 하지 않아요')
  assert.ok(!b.texts.some((t) => t.includes('리뷰 원문')))
  const f = await runContentInFakeDom(FRUITS_HTML, { location: { href: 'https://www.fruitsfamily.com/products/9' } })
  assert.ok(f.texts.includes('맞음') || f.texts.includes('작음') || f.texts.includes('큼'))
  assert.ok(f.texts.some((t) => t.startsWith('후르츠패밀리')) || f.texts.some((t) => t.includes('후르츠패밀리')))
  assert.ok(!f.texts.some((t) => t.includes('분석 중 문제가 생겼어요')))
  // 같은 HTML이라도 중고 사이트 주소가 아니면 중고 카드가 아니에요
  const other = await runContentInFakeDom(BUNJANG_HTML)
  assert.ok(!other.texts.some((t) => t.includes('후기 없이 계산했어요')))
})

await atest('중고 판매글 content.js(가짜 DOM, vm): 이 브라우저의 사이즈표 모음에 비슷한 상품이 있으면 DB 근거로 쓴다', async () => {
  const store = new Map([[SIZE_CHART_DB_KEY, JSON.stringify({ schemaVersion: SIZE_CHART_DB_VERSION, entries: [toEntry(rec({ brand: '나이키', model: 'Nike Club Fleece Hoodie 후드 티셔츠' }))].map((e) => ({ ...e, id: 'e1' })) })]])
  const html = `<html><head><meta property="og:title" content="[M] 나이키 Club Fleece Hoodie 후드 티셔츠"><meta property="og:description" content="품번 BV2654-010 새상품"></head><body></body></html>`
  const { texts } = await runContentInFakeDom(html, { location: { href: 'https://bunjang.co.kr/products/5' } }, {}, store)
  assert.ok(texts.some((t) => t.startsWith('근거: 사이즈표 DB(근사) (근사/추정)')), texts.filter((t) => t.includes('근거')).join('|'))
  assert.ok(texts.some((t) => t.startsWith('사이즈표 DB(근사/추정): 점수 ')))
})

await atest('중고 판매글 웹: 중고 상품 분석 화면이 후기 없는 결과, 우선순위 근거, 사진 역검색·라벨 인식 준비 중 안내를 보여주고 App에 연결돼 있다', async () => {
  const result = analyzeUsedListing({ title: U_TITLE, text: `${U_TITLE}\n가슴단면 55 총장 70 어깨 47` }, usedProfile)
  const html = render(WEB.UsedListing, { profile: usedProfile, db: null, imageSearcher: createImageSearcher(null), onBack: noop, initialResult: result })
  const text = textOf(html)
  assert.ok(text.includes('중고 상품 분석') && text.includes('번개장터·후르츠패밀리'))
  assert.ok(text.includes('맞음') && text.includes('근거: 판매글 실측'))
  assert.ok(text.includes(USED_NO_REVIEW_NOTE) && text.includes('근거 우선순위: ① 판매글 실측'))
  assert.ok(text.includes('사진 역검색') && text.includes(IMAGE_SEARCH_DISABLED_TEXT) && text.includes(LABEL_OCR_DISABLED_TEXT))
  assert.ok(text.includes('추정이고 실제 사이트에서 확인하지 못했어요'))
  assert.ok(html.includes('<textarea') && /aria-label="사진 주소"[^>]*disabled/.test(html), '사진 주소 입력은 공급자가 없으면 비활성')
  const noResult = textOf(render(WEB.UsedListing, { profile: usedProfile, db: null, imageSearcher: createImageSearcher(null), onBack: noop }))
  assert.ok(!noResult.includes('추천 이유'))
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.ok(app.includes('<UsedListing') && app.includes('중고 상품 분석') && app.includes('createImageSearcher(null)'))
})

test('중고 판매글 manifest: 번개장터·후르츠패밀리가 content_scripts matches에 있고 검사를 통과한다 (도메인은 추정)', () => {
  const m = EXT_MANIFEST.content_scripts.find((c) => c.js.includes('content.js')).matches
  for (const x of ['*://bunjang.co.kr/*', '*://www.bunjang.co.kr/*', '*://m.bunjang.co.kr/*', '*://fruitsfamily.com/*', '*://www.fruitsfamily.com/*']) assert.ok(m.includes(x), x)
  assert.deepEqual(checkManifest(EXT_MANIFEST), [])
  for (const s of USED_SITES) for (const h of s.hosts) assert.ok(m.includes(`*://${h}/*`), `${h}가 usedListing 사이트 목록과 manifest에 둘 다 있어야 해요`)
  const build = readFileSync(new URL('./buildExtension.mjs', import.meta.url), 'utf8')
  assert.ok(build.includes('번개장터') && build.includes('추정'), '도메인이 추정이라는 설명이 빌드 스크립트에 있어요')
})

await atest('사진 역검색·라벨 글자 인식 자리: 기본은 비활성이고, 공급자를 꽂으면 후보가 사이즈표 DB 검색에 쓰인다 (가짜 공급자)', async () => {
  const off = createImageSearcher(null)
  assert.equal(off.enabled, false)
  assert.deepEqual(await off.search(['https://a.example/1.jpg']), { status: 'disabled', candidates: [], message: IMAGE_SEARCH_DISABLED_TEXT })
  const calls = []
  const fake = createImageSearcher({ async searchByImage(arg) { calls.push(arg); return [{ brand: '나이키', model: 'Nike Club Fleece Hoodie 후드 티셔츠', code: 'BV2654-010', extra: 'x'.repeat(500) }, {}] } })
  const found = await fake.search(['https://a.example/1.jpg', 'http://insecure.example/2.jpg', 'https://a.example/1.jpg'])
  assert.deepEqual(calls[0].urls, ['https://a.example/1.jpg'], 'https 중복 없는 주소만 공급자에 보내요')
  assert.equal(found.status, 'ok')
  assert.equal(found.candidates.length, 1)
  assert.deepEqual(Object.keys(found.candidates[0]).sort(), ['brand', 'code', 'model'])
  assert.equal((await fake.search([])).status, 'no-photo')
  assert.equal((await createImageSearcher({ searchByImage: async () => { throw new Error('x') } }).search(['https://a.example/1.jpg'])).status, 'error')
  // 글에는 단서가 없고 사진 후보만 있어도 DB에서 찾고 '사진 검색 후보'로 표시해요
  const db = await dbWith(rec({ brand: '나이키', model: 'Nike Club Fleece Hoodie 후드 티셔츠' }))
  const listing = { title: '후드티 M', text: '후드티 M 사이즈' }
  assert.equal((await findChartMatches(db, usedSearchQuery(listing))).length, 0)
  const matches = await findChartMatches(db, usedSearchQuery(listing), found.candidates)
  assert.equal(matches[0].viaPhoto, true)
  const r = analyzeUsedListing(listing, usedProfile, { chartMatches: matches })
  assert.equal(r.basis, 'chart-db')
  assert.ok(r.details.some((l) => l.includes('사진 검색 후보로 찾음')))
  // 라벨 글자 인식
  const reader = createLabelReader(null)
  assert.equal(reader.enabled, false)
  assert.equal((await reader.read('https://a.example/tag.jpg')).status, 'disabled')
  const on = createLabelReader({ textFromImage: async () => 'SIZE M\nSTYLE NO BV2654-010' })
  const read = await on.read('https://a.example/tag.jpg')
  assert.equal(read.status, 'ok')
  assert.deepEqual(read.fields.sizes, ['M'])
  assert.equal(read.fields.code, 'BV2654-010')
  assert.equal((await createLabelReader({ textFromImage: async () => '' }).read('x')).status, 'empty')
  assert.equal((await createLabelReader({ textFromImage: async () => { throw new Error('x') } }).read('x')).status, 'error')
})

test('중고 판매글: 읽기·분석 모듈은 네트워크를 쓰지 않는다 (소스 검사)', () => {
  for (const f of ['usedListing.js', 'usedAnalyze.js', 'imageSearch.js', 'labelOcr.js']) {
    const src = readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8')
    assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\b\s*\(/.test(src), f)
  }
})

// ---- 성공 기준 지표 측정 (eval:fit). 전부 직접 만든 가짜·합성 데이터이고, 실제 정확도를 잰 것이 아니에요 ----
const recs = (spec) => spec.flatMap(([n, actual, predicted, high]) => Array.from({ length: n }, () => ({ actual, predicted, high, priorPredicted: 'true', priorHigh: false, learnedApplied: true })))

test('평가 지표: Wilson 구간은 알려진 값과 맞고 경계(0건, 전부 적중)를 처리한다', () => {
  const w = wilson(9, 10)
  assert.ok(Math.abs(w.lo - 0.5958) < 0.002 && Math.abs(w.hi - 0.9821) < 0.002, `${w.lo} ${w.hi}`)
  assert.equal(wilson(0, 0), null)
  assert.equal(wilson(20, 20).hi, 1)
  assert.ok(wilson(0, 20).lo === 0 && wilson(0, 20).hi > 0)
  assert.ok(wilson(90, 100).hi - wilson(90, 100).lo < wilson(9, 10).hi - wilson(9, 10).lo, '표본이 많을수록 구간이 좁다')
})

test('평가 지표: 확신 높음 적중률과 적용 범위, 기준선(항상 정사이즈), 혼동행렬', () => {
  // 확신 높음 5건(4건 적중), 그 밖 5건. 실제 라벨: true 5건
  const L = summarizeLabels(recs([
    [3, 'true', 'true', true], [1, 'small', 'true', true], [1, 'large', 'large', true], // 높음 5건 중 4건 적중
    [1, 'true', 'true', false], [2, 'small', 'small', false], [1, 'true', 'large', false], [1, 'large', 'small', false],
  ]))
  assert.equal(L.n, 10)
  assert.equal(L.high.k, 4)
  assert.equal(L.high.n, 5)
  assert.equal(L.high.rate, 0.8)
  assert.equal(L.coverage.rate, 0.5)
  assert.equal(L.accuracy.rate, 0.7)
  assert.equal(L.baselineAll.rate, 0.5) // 실제 true가 5건
  assert.equal(L.baselineHigh.rate, 0.6) // 높음 5건 중 true 3건
  assert.equal(L.matrix.small.true, 1)
  assert.equal(L.matrix.large.small, 1)
  assert.equal(L.precisionRecall.small.support, 3)
  assert.ok(L.high.ci.lo < 0.8 && L.high.ci.hi > 0.8)
})

test('평가 지표: 확신 높음 판정 기준(경계에서 떨어진 정도, 부위 수)과 라벨 예측', () => {
  assert.equal(predictFromEase({ chest: 2, shoulder: -1 }).label, 'small')
  assert.equal(predictFromEase({ chest: 12, shoulder: 3 }).label, 'true')
  assert.equal(predictFromEase({ chest: 30, shoulder: 9 }).label, 'large')
  assert.equal(predictFromEase({ chest: 12, shoulder: 3 }).high, true)
  assert.equal(predictFromEase({ chest: 7, shoulder: 3 }).high, false, '경계(snug 6)에서 1cm라 확신 낮음')
  assert.equal(predictFromEase({ chest: 12 }).high, false, '비교 부위가 1개면 확신 높음이 아님')
  assert.equal(predictFromEase({ chest: 30, shoulder: 3 }).label, 'true', '한 부위만 크면 large가 아님')
  assert.equal(predictFromEase({}).label, null)
  // 학습값(rules·offset)이 판정 경계를 옮긴다
  assert.equal(predictFromEase({ chest: 9, shoulder: 3 }).label, 'true')
  assert.equal(predictFromEase({ chest: 9, shoulder: 3 }, { rules: {}, offset: 5 }).label, 'small')
})

test('평가 지표: ±1 사이즈 판정 (이름 표기 차이, 순서에 없는 사이즈, 경계)', () => {
  const order = ['S', 'M', 'L', 'XL']
  assert.equal(withinSizes(order, 'M', 'L'), true)
  assert.equal(withinSizes(order, 'M', 'M'), true)
  assert.equal(withinSizes(order, 'S', 'L'), false)
  assert.equal(withinSizes(order, 'S', 'M', 0), false)
  assert.equal(withinSizes(['1(S)', '2(M)', '3(L)'], '2(M)', 'L'), true)
  assert.equal(withinSizes(order, 'XXL', 'M'), null)
  assert.equal(withinSizes(order, null, 'M'), null)
  assert.deepEqual(sizeOrderOf({ rows: [['s'], ['m']], measures: { M: {}, L: {} } }), ['S', 'M', 'L'])
  const S = summarizeSizes([{ hit: true, exact: true, priorHit: true, baselineHit: false }, { hit: true, exact: false, priorHit: false, baselineHit: true }, { hit: false, exact: false, priorHit: false, baselineHit: false }])
  assert.equal(S.within1.k, 2)
  assert.equal(S.exact.k, 1)
  assert.equal(S.baselineWithin1.k, 1)
})

test('평가 분할: 시드 고정, 모든 단위가 정확히 한 묶음에만 들어가고 크기가 고르다', () => {
  const a = assignFolds(103, 5, 7)
  assert.deepEqual(a, assignFolds(103, 5, 7))
  assert.notDeepEqual(a, assignFolds(103, 5, 8))
  assert.equal(a.length, 103)
  const sizes = [0, 1, 2, 3, 4].map((f) => a.filter((x) => x === f).length)
  assert.equal(sizes.reduce((x, y) => x + y, 0), 103)
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, sizes.join())
  const data = makeDemoDataset(5, { products: 6, reviewsPer: 20 })
  const r = evaluateReviews(data.products, { folds: 4, seed: 5 })
  const all = r.folds.flatMap((f) => f.test)
  assert.equal(new Set(all).size, all.length, '떼어 둔 후기가 겹치지 않는다')
  assert.equal(all.length, r.eligible, '모든 후기가 한 번씩 평가된다')
  assert.equal(r.label.n, r.eligible)
  assert.ok(r.folds.every((f) => f.trainSamples < 120), '떼어 둔 후기는 학습에서 빠진다')
  // 상품 단위 분할: 한 상품의 후기는 한 묶음에만 있다
  const byProduct = evaluateReviews(data.products, { folds: 3, seed: 5, groupBy: 'product' })
  const foldOfProduct = new Map()
  for (const f of byProduct.folds) {
    for (const key of f.test) {
      const pi = key.split(':')[0]
      assert.ok(!foldOfProduct.has(pi) || foldOfProduct.get(pi) === f.fold, '상품이 두 묶음에 걸침')
      foldOfProduct.set(pi, f.fold)
    }
  }
})

test('평가 입력: 평가할 수 없는 후기(라벨·체형·성별·사이즈 없음)는 걸러낸다', () => {
  const p = { category: 'top', sizeChart: { measures: { M: { chest: 100 } } } }
  const ok = { size: 'M', fit: 'true', height: 175, weight: 70, gender: 'male' }
  assert.equal(eligibleReview(p, ok), true)
  assert.equal(eligibleReview(p, { ...ok, fit: undefined }), false)
  assert.equal(eligibleReview(p, { ...ok, gender: undefined }), false)
  assert.equal(eligibleReview(p, { ...ok, height: null }), false)
  assert.equal(eligibleReview(p, { ...ok, size: 'XL' }), false, '사이즈표에 없는 사이즈')
  assert.equal(eligibleReview({ ...p, category: 'shoes' }, ok), false)
  assert.equal(eligibleReview({ category: 'top' }, ok), false)
  assert.ok(parseEvalInput({ foo: 1 }).error)
  assert.equal(parseEvalInput({ products: [] }).mode, 'reviews')
  assert.equal(parseEvalInput({ samples: [{ cat: 'top', label: 'true', e: { chest: 1 } }, { bad: 1 }] }).samples.length, 1)
})

test('평가 판정: 달성·미달·보류 (표본 부족이면 판정 보류)', () => {
  const mk = (highHit, highN, sizeHit, sizeN) => {
    const rows = [
      [highHit, 'small', 'small', true], [highN - highHit, 'small', 'true', true], // 확신 높음
      [30, 'true', 'true', false], [20, 'large', 'large', false], [20, 'small', 'small', false],
    ]
    const size = sizeN ? summarizeSizes(Array.from({ length: sizeN }, (_, i) => ({ hit: i < sizeHit, exact: false, priorHit: false, baselineHit: false }))) : { n: 0, reason: '없음' }
    return { label: summarizeLabels(recs(rows)), size }
  }
  assert.equal(judge(mk(57, 60, 57, 60)).status, 'met') // 95%, 95%
  assert.equal(judge(mk(50, 60, 57, 60)).status, 'unmet') // 확신 높음 83%
  assert.equal(judge(mk(57, 60, 50, 60)).status, 'unmet') // ±1 83%
  const fewHigh = judge(mk(9, 10, 57, 60))
  assert.equal(fewHigh.status, 'hold', '확신 높음 판정이 10건이면 보류')
  assert.ok(fewHigh.checks.find((c) => c.id === 'high').text.includes('판정 보류'))
  const noSize = judge(mk(57, 60, 0, 0))
  assert.equal(noSize.status, 'hold', '사이즈 평가가 없으면 보류')
  assert.ok(noSize.checks.find((c) => c.id === 'size').text.includes('판정 보류'))
  // 90% 이상이어도 ‘항상 정사이즈’ 기준선을 못 넘으면 달성이 아님
  const baselineHeavy = { label: summarizeLabels(recs([[95, 'true', 'true', true], [5, 'true', 'small', true], [30, 'true', 'true', false]])), size: summarizeSizes(Array.from({ length: 40 }, () => ({ hit: true, exact: false, priorHit: false, baselineHit: false }))) }
  assert.equal(judge(baselineHeavy).checks.find((c) => c.id === 'baseline').state, 'fail')
  assert.equal(judge(baselineHeavy).status, 'unmet')
  // 후기 50건 미만이면 경고
  assert.ok(judge({ label: summarizeLabels(recs([[10, 'true', 'true', true]])), size: { n: 0, reason: 'x' } }).warnings.some((w) => w.includes('적어요')))
})

test('평가 샘플 모드(여유분 기반): 경계가 뚜렷한 샘플은 확신 높음이 모두 적중하고 ±1은 평가하지 않는다', () => {
  const mk = (label, e, n) => Array.from({ length: n }, () => ({ cat: 'top', brand: null, label, w: 1, e }))
  const samples = [...mk('small', { chest: 2, shoulder: -1 }, 20), ...mk('true', { chest: 12, shoulder: 3 }, 20), ...mk('large', { chest: 30, shoulder: 9 }, 20)]
  const r = evaluateSamples(samples, { folds: 5 })
  assert.equal(r.label.n, 60)
  assert.equal(r.label.high.rate, 1)
  assert.equal(r.label.high.n, r.label.coverage.k)
  assert.ok(r.label.coverage.rate > 0.9)
  assert.equal(r.size.within1, undefined)
  const j = judge(r)
  assert.equal(j.status, 'hold')
  assert.ok(j.checks.find((c) => c.id === 'size').text.includes('판정 보류'))
  const text = formatEvalReport(r).join('\n')
  assert.ok(text.includes('평가할 수 없어요') && text.includes('여유분 기반 평가'))
})

test('eval:fit --demo: 맨 위와 맨 아래에 합성 표시, 판정 문구에도 실제 달성이 아님을 적고, 같은 시드면 결과가 같다', () => {
  const a = runEvalCli(['--demo'])
  assert.equal(a.code, 0)
  assert.ok(a.lines[0].includes(DEMO_NOTE), '맨 위')
  assert.ok(a.lines[a.lines.length - 1].includes(DEMO_NOTE), '맨 아래')
  const verdict = a.lines.find((l) => l.startsWith('[3] 목표 판정'))
  assert.ok(verdict.includes('실제 달성이 아님'), verdict)
  assert.deepEqual(a.lines, runEvalCli(['--demo']).lines)
  assert.notDeepEqual(a.lines, runEvalCli(['--demo', '--seed', '3']).lines)
  const text = a.lines.join('\n')
  for (const key of ['확신 높음', '적용 범위', '전체 정확도', '혼동행렬', 'precision', '±1', '항상 정사이즈', '학습값 없는 현재 규칙', '95% 구간']) assert.ok(text.includes(key), key)
  // 합성이 아닌 입력의 보고서에는 합성 문구가 붙지 않는다
  const real = runEvalCli(['--file', 'x.json'], { readFile: () => JSON.stringify({ products: makeDemoDataset(2, { products: 4, reviewsPer: 20 }).products }) })
  assert.ok(!real.lines.join('\n').includes('합성'))
  assert.ok(!real.lines.join('\n').includes('실제 달성'))
  // 파일에 synthetic 표시가 있으면 합성 문구를 붙인다
  const marked = runEvalCli(['--file', 'x.json'], { readFile: () => JSON.stringify(makeDemoDataset(2, { products: 4, reviewsPer: 20 })) })
  assert.ok(marked.lines[0].includes(DEMO_NOTE) && marked.lines[marked.lines.length - 1].includes(DEMO_NOTE))
})

test('eval:fit: 데이터가 없으면 측정하지 않았다고 말하고 사용법을 보여준다, 잘못된 입력은 오류', () => {
  const none = runEvalCli([])
  assert.equal(none.code, 0)
  assert.equal(none.lines[0], NO_DATA_MESSAGE)
  assert.ok(none.lines[0].includes('측정하지 않았어요'))
  assert.ok(none.lines.join('\n').includes('--file') && none.lines.join('\n').includes('--demo'))
  assert.ok(!none.lines.join('\n').includes('%'), '수치를 지어내지 않는다')
  assert.equal(runEvalCli(['--file', 'nope.json'], { readFile: () => { throw new Error('ENOENT') } }).code, 1)
  assert.equal(runEvalCli(['--file', 'x'], { readFile: () => '{"a":1}' }).code, 1)
  assert.equal(runEvalCli(['--file', 'x'], { readFile: () => 'not json' }).code, 1)
  assert.equal(runEvalCli(['--folds', '1']).code, 1)
  assert.equal(runEvalCli(['--bogus']).code, 1)
  const empty = runEvalCli(['--file', 'x'], { readFile: () => '{"products":[]}' })
  assert.ok(empty.lines[0].includes('측정하지 않았어요'))
})

test('eval:fit: 표본이 적은 실제(가짜) 파일은 판정 보류와 경고를 출력한다', () => {
  const tiny = makeDemoDataset(1, { products: 2, reviewsPer: 8 })
  const r = runEvalCli(['--file', 'x'], { readFile: () => JSON.stringify({ products: tiny.products }) })
  const text = r.lines.join('\n')
  assert.ok(text.includes('판정 보류'), text)
  assert.ok(text.includes('적어요'))
  assert.ok(text.includes('[95% 구간'))
  assert.ok(!text.includes('목표 달성'))
})

test('학습 샘플 내보내기: 허용 목록 필드만 담고 키·몸무게·성별·사이즈·본문·주소·id는 없다', () => {
  const dirty = [{
    id: 'abc', cat: 'top', brand: 'musinsa.com', region: 'kr', label: 'true', w: 1, e: { chest: 12.5, shoulder: 'x' }, d: 20000,
    height: 175, weight: 70, gender: 'male', size: 'M', text: '키 175 몸무게 70 후기 본문', url: 'https://shop.example/p/1', name: '상품명', nickname: '닉',
  }, { cat: 'top', label: 'bogus', e: { chest: 1 } }, { cat: 'top', label: 'small', e: {} }]
  const out = buildLearnExport(dirty)
  assert.equal(out.kind, EXPORT_KIND)
  assert.equal(out.count, 1)
  assert.deepEqual(out.samples[0], { cat: 'top', brand: 'musinsa.com', region: 'kr', label: 'true', w: 1, e: { chest: 12.5 }, d: 20000 })
  const json = JSON.stringify(out)
  for (const bad of ['height', 'weight', 'gender', '"size"', '"text"', 'url', 'nickname', '"id"', '175', '후기 본문', 'shop.example', '상품명']) assert.ok(!json.includes(bad), bad)
  // 실제 학습 샘플 변환 결과를 내보내도 같다
  const clothing = PRODUCTS['https://shop-a.example.com/goods/12345']
  const exported = buildLearnExport(toSamples(clothing, { now: 0 }))
  const allowed = new Set(['cat', 'brand', 'region', 'label', 'w', 'e', 'd'])
  assert.ok(exported.samples.every((s) => Object.keys(s).every((k) => allowed.has(k))))
  assert.equal(buildLearnExport(null).count, 0)
  // 내보낸 파일은 그대로 평가 입력이 된다
  assert.equal(parseEvalInput(JSON.parse(json)).mode, 'samples')
})

test('학습 샘플 내보내기: 웹 결과 화면에는 내보내기 연결이 있을 때만 버튼이 나온다', () => {
  const clothing = { ...PRODUCTS['https://shop-a.example.com/goods/12345'], source: 'demo' }
  const samples = [...synth(clothing.category, null, 'small', 10, 12), ...synth(clothing.category, null, 'true', 10, 20)]
  const props = { product: clothing, profile, calibration: {}, feedbackCount: 0, onFeedback: noop, onRestart: noop, wardrobe: [], onSaveWardrobe: noop, learningModel: trainModel(samples, EASE_RULES), onResetLearning: noop }
  assert.ok(textOf(render(WEB.ResultView, { ...props, onExportLearning: noop })).includes('학습 샘플 내보내기(JSON)'))
  assert.ok(!textOf(render(WEB.ResultView, props)).includes('학습 샘플 내보내기'))
})

test('평가 모듈: 네트워크를 쓰지 않고, README·문서는 실제 측정 수치가 없다고 밝힌다', () => {
  for (const f of ['../scripts/lib/fitEval.mjs', '../scripts/lib/evalCli.mjs', '../scripts/evalFit.mjs', '../src/lib/learnExport.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\b\s*\(/.test(src) && !/node:https?|node:net/.test(src), f)
  }
  assert.equal(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts['eval:fit'], 'node scripts/evalFit.mjs')
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  // README는 프로그램 소개만 담고, 측정 수치가 없다는 고지는 링크된 평가 문서(아래 검사)에 있어요.
  assert.ok(readme.includes('eval:fit') && readme.includes('docs/평가_핏정확도.md'))
  const doc = readFileSync(new URL('../docs/평가_핏정확도.md', import.meta.url), 'utf8')
  for (const key of ['라벨 잡음', '표본 수', '편향', 'Wilson', '합성 데이터, 실제 정확도 아님', '확장 내보내기는 추후', '실제 데이터로 측정한 수치는 아직 없']) assert.ok(doc.includes(key), key)
})

import { TRYON_MODELS } from '../server/hfTryOn.js'

await atest('hfTryOn(Leffa, 가짜 fetch): 하의는 dress_code·lower_body로 leffa_predict_vt를 부르고, 이유 없는 거절(null)은 토큰 안내로 바꾼다', async () => {
  clearTryOnCache()
  const LB = 'https://franciszzj-leffa.hf.space'
  const api = `${LB}/gradio_api`
  const calls = []
  const mk = (sse) => async (url, opts = {}) => {
    calls.push({ url, opts })
    if (url === `${LB}/config`) return resp({ api_prefix: '/gradio_api' })
    if (url === `${api}/upload`) return resp([`/tmp/gradio/up${calls.length}.png`])
    if (url === `${api}/call/leffa_predict_vt`) return resp({ event_id: 'lf1' })
    if (url === `${api}/call/leffa_predict_vt/lf1`) return resp(sse, { type: 'text/event-stream' })
    if (url === `${api}/file=/tmp/gradio/lf.png`) return resp(new Uint8Array([9]), { type: 'image/png' })
    return resp('nf', { status: 404, type: 'text/plain' })
  }
  assert.equal(isTryOnSupported('bottom'), false, '기본(IDM-VTON)은 하의 미지원 그대로')
  assert.equal(isTryOnSupported('bottom', 'leffa') && isTryOnSupported('dress', 'leffa'), true)
  assert.equal(isTryOnSupported('shoes', 'leffa'), false)
  assert.equal(TRYON_MODELS.leffa.space, 'franciszzj/Leffa')
  const ok = `event: complete\ndata: ${JSON.stringify([{ path: '/tmp/gradio/lf.png' }, { path: '/tmp/m.png' }, { path: '/tmp/d.png' }])}\n\n`
  const r = await runHfTryOn({ personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'bottom', model: 'leffa', fetchImpl: mk(ok) })
  assert.equal(r.image, 'data:image/png;base64,CQ==')
  assert.ok(r.model.startsWith('Leffa'))
  const { data } = JSON.parse(calls.find((c) => c.url === `${api}/call/leffa_predict_vt`).opts.body)
  assert.deepEqual(data.slice(2), ['False', 30, 2.5, 42, 'dress_code', 'lower_body', 'False'])
  assert.ok(data[0].path && data[1].path, '두 사진을 먼저 올린 경로')
  await assert.rejects(
    runHfTryOn({ personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'top', model: 'leffa', fetchImpl: mk('event: error\ndata: null\n\n') }),
    (e) => e.code === 'LEFFA_REJECTED' && e.message.includes('IDM-VTON'),
  )
  // 운영자의 HF_TOKEN은 제3자 Space(Leffa)로 보내지 않아요
  calls.length = 0
  clearTryOnCache()
  await runHfTryOn({ personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'dress', model: 'leffa', token: 'hf_secret', fetchImpl: mk(ok) })
  assert.ok(calls.length > 0 && calls.every((c) => !c.opts.headers?.Authorization), 'Leffa 요청에는 Authorization이 없어요')
  await assert.rejects(runHfTryOn({ personImage: PNG_1PX, garmentImage: PNG_1PX, category: 'shoes', model: 'leffa', fetchImpl: mk(ok) }), (e) => e.code === 'UNSUPPORTED')
})

test('웹 렌더: 확장에서 담은 옷장 항목은 부위별 여유 게이지·실측·후기 핏 분포·리뷰를 자세히 보기에 그린다 (가짜 데이터)', () => {
  const item = {
    id: 'x1', savedAt: 1, product: { name: '스웻셔츠', mall: 'musinsa', category: 'top', image: null, url: 'https://shop.example/x1' },
    size: 'L', measures: { shoulder: 49, chest: 112, topLength: 70 },
    verdicts: [{ part: 'chest', label: '가슴', verdict: '적당', key: 'regular', ease: 10.5 }, { part: 'shoulder', label: '어깨', verdict: '넉넉', key: 'relaxed', ease: 3.5 }],
    reviews: [
      { nick: 'a', text: '좋아요', photos: ['https://img.example.com/1.jpg'], height: 175, weight: 70, size: 'L', fitLabel: '잘 맞아요', similarity: 95 },
      { nick: 'b', text: '커요', photos: [], height: 176, weight: 71, size: 'L', fitLabel: '커요', similarity: 90 },
    ],
  }
  const html = render(WEB.Wardrobe, { items: [item], onDelete: noop, onBack: noop })
  const txt = textOf(html)
  assert.ok(txt.includes('자세히 보기 · 리뷰 2건'))
  assert.ok(html.includes('fv-gauge') && txt.includes('+10.5cm') && txt.includes('+3.5cm'), '여유 게이지')
  assert.ok(html.includes('class="on l2"') && html.includes('class="on l3"'), '판정 칸 위치')
  assert.ok(txt.includes('L 실측') && txt.includes('가슴 112cm') && txt.includes('총장 70cm'), '실측 칩')
  assert.ok(txt.includes('담은 후기 핏 평가') && txt.includes('정사이즈 50%') && txt.includes('커요 50%'), '핏 분포(확장 fitLabel 기준)')
  assert.ok(txt.includes('사진 모아보기'), '리뷰 탭')
})

test('웹 렌더: 결과 화면은 onTryOn이 있으면 사진 합성 대신 가상 피팅 바로가기를, TryOnPanel은 모델 선택을 보여준다', () => {
  const clothing = { ...PRODUCTS['https://shop-a.example.com/goods/12345'], source: 'demo' }
  const props = { product: clothing, profile, calibration: {}, feedbackCount: 0, onFeedback: noop, onRestart: noop, wardrobe: [], onSaveWardrobe: noop }
  const linked = textOf(render(WEB.ResultView, { ...props, onTryOn: noop }))
  assert.ok(linked.includes('가상 피팅') && linked.includes('내 사진에 이 옷'))
  assert.ok(!linked.includes('AI로 합성하기'), '패널은 탭으로 옮겨요')
  const inline = textOf(render(WEB.ResultView, props))
  assert.ok(inline.includes('AI로 합성하기'), 'onTryOn이 없으면 예전처럼 패널')
  const panel = textOf(render(WEB.TryOnPanel, { product: { ...clothing, category: 'bottom' }, profile, verdicts: [], selectedSize: 'M', captureRef: { current: null } }))
  assert.ok(panel.includes('IDM-VTON') && panel.includes('Leffa (실험적)') && panel.includes('상의·하의·원피스'))
})

import { measureFromPose, anchorLayout, ellipseCircumference, rowWidth } from '../src/lib/photoBody.js'

// 가짜 정면 전신: 400×1000 사진, 키 175cm. 눈 y=100, 발뒤꿈치 y=900 → 사진 속 키 800/0.935 ≈ 855.6px → 0.2045cm/px
function fakePose({ shoulderPx = 170, chestPx = 230, waistPx = 200, hipPx = 250, vis = 1, armGap = 600 } = {}) {
  const W = 400
  const H = 1000
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: vis }))
  const set = (i, x, y) => { lm[i] = { x: x / W, y: y / H, visibility: vis } }
  set(2, 190, 100); set(5, 210, 100)
  set(11, 200 - shoulderPx / 2, 250); set(12, 200 + shoulderPx / 2, 250)
  set(23, 160, 550); set(24, 240, 550)
  set(27, 170, 880); set(28, 230, 880); set(29, 170, 900); set(30, 230, 900)
  // 팔: 기본은 몸통에서 멀리(잘라내지 않음). armGap을 주면 팔 중심선 사이 거리를 그만큼으로
  const ax = armGap / 2
  set(13, 200 - ax, 400); set(14, 200 + ax, 400); set(15, 200 - ax, 560); set(16, 200 + ax, 560)
  const mask = new Float32Array(W * H)
  // 몸통 높이별 너비: 가슴(어깨~골반 33%), 허리(62%), 엉덩이(108%) 근처를 그 너비로 칠해요
  const widthAt = (y) => { const t = (y - 250) / 300; return t < 0.47 ? chestPx : t < 0.85 ? waistPx : hipPx }
  for (let y = 250; y < 600; y++) { const w = widthAt(y); for (let x = Math.round(200 - w / 2); x < Math.round(200 + w / 2); x++) mask[y * W + x] = 1 }
  return { landmarks: lm, width: W, height: H, mask, maskW: W, maskH: H }
}

test('사진 체형 추정(가짜 관절·윤곽): 키로 축척을 잡아 어깨·둘레를 재고 공식값과 섞어 ±12% 안으로 묶는다', () => {
  assert.ok(Math.abs(ellipseCircumference(30, 1) - Math.PI * 30) < 0.01, '원이면 πd')
  const m = new Float32Array([0, 1, 1, 1, 0, 0, 1, 0])
  assert.equal(rowWidth(m, 8, 1, 0, 2), 3)
  assert.equal(rowWidth(m, 8, 1, 0, 4), null, '사람 밖')
  const formula = { shoulder: 45.5, chest: 97.5, waist: 80, hip: 94 }
  const r = measureFromPose({ ...fakePose(), heightCm: 175, formula })
  assert.equal(r.ok, true)
  const cmPerPx = 175 / (800 / 0.935)
  assert.ok(Math.abs(r.raw.shoulder - 170 * cmPerPx * 1.27) <= 0.5, `어깨 ${r.raw.shoulder}`)
  assert.ok(Math.abs(r.raw.chest - ellipseCircumference(230 * cmPerPx, 0.72) * 1.08) <= 0.5, `가슴 ${r.raw.chest}`)
  assert.ok(r.raw.waist < r.raw.chest && r.raw.hip > r.raw.waist, '허리는 가장 좁고 엉덩이는 넓게')
  for (const k of ['shoulder', 'chest', 'waist', 'hip']) {
    assert.ok(r.values[k] >= formula[k] * 0.88 - 0.5 && r.values[k] <= formula[k] * 1.12 + 0.5, `${k} ±12%`)
  }
  assert.deepEqual(r.warnings, [])
  // 넓은 사람은 공식보다 크게, 좁은 사람은 작게
  const big = measureFromPose({ ...fakePose({ shoulderPx: 190, chestPx: 190 }), heightCm: 175, formula })
  const small = measureFromPose({ ...fakePose({ shoulderPx: 150, chestPx: 150 }), heightCm: 175, formula })
  assert.ok(big.values.shoulder > r.values.shoulder && small.values.shoulder < r.values.shoulder)
  assert.ok(big.values.chest > small.values.chest)
  // 팔이 붙어 몸통이 너무 넓으면 가슴·허리는 빼고 안내
  const arms = measureFromPose({ ...fakePose({ chestPx: 300, waistPx: 290 }), heightCm: 175, formula })
  assert.equal(arms.values.chest, undefined)
  assert.ok(arms.warnings.some((w) => w.includes('팔을 몸에서')))
  // 팔이 허리 옆에 붙어 윤곽에 섞이면(허리 윤곽 280px) 두 팔 중심선 안쪽까지만 몸통으로 봐요
  const merged = measureFromPose({ ...fakePose({ waistPx: 250, armGap: 260 }), heightCm: 175, formula })
  const armHalfCm = (0.055 * (800 / 0.935) / 2) * cmPerPx
  assert.ok(Math.abs(merged.raw.waist - ellipseCircumference(260 * cmPerPx - 2 * armHalfCm, 0.75)) <= 0.5, `허리 ${merged.raw.waist}`)
  // 팔에 20% 넘게 가리면 그 부위는 빼고, 허리가 가슴·엉덩이보다 넓으면(헐렁한 옷) 허리를 빼요
  const hidden = measureFromPose({ ...fakePose({ waistPx: 280, armGap: 200 }), heightCm: 175, formula })
  assert.equal(hidden.raw.waist, undefined)
  assert.ok(hidden.warnings.some((w) => w.includes('팔')))
  const loose = measureFromPose({ ...fakePose({ chestPx: 200, waistPx: 240, hipPx: 220 }), heightCm: 175, formula })
  assert.equal(loose.raw.waist, undefined)
  assert.ok(loose.warnings.some((w) => w.includes('헐렁한 옷')))
  // 발이 안 보이면 실패, 키가 없으면 실패
  assert.equal(measureFromPose({ ...fakePose({ vis: 0.2 }), heightCm: 175, formula }).ok, false)
  assert.equal(measureFromPose({ ...fakePose(), heightCm: 0, formula }).ok, false)
  // 미리보기 배치: 상의는 어깨 사이 가운데, 하의는 골반 기준
  const top = anchorLayout(r.anchors, 'top')
  assert.ok(Math.abs(top.leftPct + top.widthPct / 2 - 50) < 0.01 && top.widthPct > (170 / 400) * 100)
  const bottom = anchorLayout(r.anchors, 'bottom')
  assert.ok(bottom.topPct > top.topPct)
})

test('사진 추정값 반영: 직접 잰 값 > 사진 추정 > 키·몸무게 공식 순서로 쓰고 비교 표에 (사진 추정)으로 표시한다 (가짜 데이터)', () => {
  const base = { gender: 'male', height: 175, weight: 70, preferredFit: 'regular', usual: { top: '', bottom: '' }, measurements: {} }
  const plain = estimateBody(base)
  const withPhoto = estimateBody({ ...base, photoBody: { shoulder: 48, chest: 102, at: 1 } })
  assert.equal(withPhoto.values.shoulder, 48)
  assert.equal(withPhoto.values.chest, 102)
  assert.equal(withPhoto.values.waist, plain.values.waist, '사진에 없는 부위는 공식값')
  assert.deepEqual([...withPhoto.photo].sort(), ['chest', 'shoulder'])
  const both = estimateBody({ ...base, photoBody: { chest: 102 }, measurements: { chest: 96 } })
  assert.equal(both.values.chest, 96, '직접 잰 값이 이겨요')
  assert.ok(!both.photo.has('chest') && both.measured.has('chest'))
  const product = { name: '셔츠', mall: 'shop', category: 'top', sizeChart: { measures: { M: { shoulder: 47, chest: 104 }, L: { shoulder: 49, chest: 112 } } }, reviews: [], notes: [] }
  const r = generateFitComment({ ...base, photoBody: { shoulder: 48, chest: 102 } }, product)
  assert.deepEqual([...r.photoParts].sort(), ['chest', 'shoulder'])
  assert.equal(r.detailed, false, '사진 추정은 직접 잰 치수로 치지 않아요')
  const cmp = compareSizes({ chart: product.sizeChart, bodyValues: r.bodyValues, measured: r.measured, category: 'top', reviewParts: r.reviewParts, photoParts: r.photoParts })
  assert.equal(cmp.sizes[0].rows.find((x) => x.part === 'chest').bodyKind, 'photo')
  assert.equal(cmp.sizes[0].rows.find((x) => x.part === 'chest').body, 102)
})

test('치수 재는 법: 입력 칸 부위마다 안내가 있고, 그림과 설명을 보여준다', () => {
  const html = textOf(render(WEB.MeasureGuide, {}))
  for (const f of BODY_FIELDS) if (f.key !== 'footLength') assert.ok(html.includes(f.label), `${f.label} 안내 없음`)
  assert.ok(html.includes('다리길이'), '다리길이')
  assert.ok(html.includes('어깨 끝 뼈'), '처음엔 어깨 설명')
})

import { bodyValuesForProfile as bvLeg } from '../src/lib/fitEngine.js'
test('다리길이: 직접 재면 바지 총장 기준이 키 대신 다리길이로 바뀌고 (다리길이로 계산)으로 표시, 확장 프로필에도 저장된다', () => {
  const base = { gender: 'male', height: 175, weight: 70, measurements: {} }
  assert.equal(bvLeg(base).values.inseam, 101.5, '안 재면 키 × 0.58')
  const long = bvLeg({ ...base, measurements: { leg: 85 } })
  assert.equal(long.values.inseam, Math.round(85 * (0.58 / 0.45) * 10) / 10)
  const chart = { category: 'bottom', rows: [['30']], measures: { 30: { waist: 80, inseam: 104 } } }
  const row = (r) => compareSizes({ chart, bodyValues: r.values, measured: r.measured, category: 'bottom' }).sizes[0].rows.find((x) => x.part === 'inseam')
  assert.equal(row(bvLeg(base)).bodyKind, 'standard')
  assert.equal(row(long).bodyKind, 'leg')
  assert.ok(row(long).ease < row(bvLeg(base)).ease, '다리가 길면 같은 바지가 더 짧게 판정')
  assert.equal(buildProfile({ gender: 'male', height: '175', weight: '70', measurements: { leg: '82', arm: '60' } }).profile.measurements.leg, 82)
  assert.ok(readFileSync('extension/popup.html', 'utf8').includes('name="m-leg"'), '팝업에 다리길이 칸')
})

console.log(`\n${passed}개 통과`)
