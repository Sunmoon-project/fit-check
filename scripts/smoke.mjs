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
} from '../src/lib/fitEngine.js'
import { PRODUCTS } from '../src/data/mockData.js'
import { parseProductHtml } from '../server/productParser.js'
import { findSimilar, describeDiff, categoryGroup, makeWardrobeItem } from '../src/lib/wardrobe.js'

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

console.log(`\n${passed}개 통과`)
