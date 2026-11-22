// KREAM(kream.co.kr) 상품 페이지 읽기 (순수 함수, 화면 글 줄만 봐요).
// KREAM은 사이즈표가 없고, 후기에 리뷰어 키·몸무게도 없어요. 대신
//   - 위쪽 요약 칩: '정사이즈예요 181' 같은 전체 후기의 사이즈 감 집계
//   - 후기 카드: 별점 / 산 사이즈 / '구매' / '∙' / 사이즈 감 / 본문
//   - 거래 내역: 사이즈 / 거래가 줄 (이 상품에 있는 사이즈 이름)
// 을 읽어서, 기준 사이즈(평소 사이즈 또는 키·몸무게)에서 후기 다수 의견만큼 옮겨 추천해요.
// 2026-11-22 KREAM 상품 페이지(상의 후드)로 확인했어요. 화면 구조가 바뀌면 못 읽을 수 있어요.

export const isKreamUrl = (url) => {
  try {
    return /(?:^|\.)kream\.co\.kr$/.test(new URL(url).hostname)
  } catch {
    return false
  }
}

// 사이즈 감 문구 → small(작게 나옴) / true(정사이즈) / large(크게 나옴)
// 옷: 작아요 / 정사이즈예요 / 커요 / 오버핏이에요, 신발: (반 사이즈) 작게 나왔어요 / 정사이즈로 나왔어요 / 크게 나왔어요
// '정사이즈로 구매했어요'처럼 산 방식을 말하는 칩은 체감이 아니라서 세지 않아요.
const FEEL = [
  [/^(?:(?:반\s?|한\s?)?사이즈\s?)?(?:작아요|작게\s?나(?:와요|왔어요)|타이트해요)$|^(?:반|한)\s?사이즈\s?작/, 'small'],
  [/^(?:정사이즈(?:예요|에요|로\s?나왔어요)?|딱\s?맞아요)$/, 'true'],
  [/^(?:(?:반\s?|한\s?)?사이즈\s?)?(?:커요|크게\s?나(?:와요|왔어요)|오버핏이에요|넉넉해요)$|^(?:반|한)\s?사이즈\s?크/, 'large'],
]
const feelOf = (t) => {
  const v = String(t).trim()
  return v.length > 16 || /구매했/.test(v) ? null : (FEEL.find(([re]) => re.test(v)) || [])[1] || null
}
const SIZE_RE = /^(?:XXS|XS|S|M|L|XL|XXL|XXXL|[2-4]XL|F|FREE|ONE ?SIZE|\d{2,3}(?:\.5)?|[0-6])$/i
const PRICE_RE = /^\d{1,3}(?:,\d{3})+원$/

/** lines: innerText 줄 → { feel:{small,true,large,total}, reviews:[{size,fit,text}], sizes:[...] } */
export function readKream(lines = []) {
  const all = lines.map((l) => String(l).trim()).filter(Boolean).slice(0, 4000)
  const feel = { small: 0, true: 0, large: 0, total: 0 }
  const reviews = []
  const sizes = []
  const addSize = (s) => {
    const k = s.toUpperCase()
    if (!sizes.includes(k)) sizes.push(k)
  }
  let reviewCount = 0
  for (let i = 0; i < all.length; i++) {
    const l = all[i]
    // '일반 리뷰 240': 요약 칩은 상위 의견만 보여서, 비율은 전체 후기 수로 나눠요.
    const rc = l.match(/^일반\s?리뷰\s+([\d,]{1,8})$/)
    if (rc) {
      reviewCount = Math.max(reviewCount, Number(rc[1].replace(/,/g, '')))
      continue
    }
    // 요약 칩 '정사이즈예요 181'
    const chip = l.match(/^(.+?)\s+(\d{1,6})$/)
    const chipFeel = chip && feelOf(chip[1])
    if (chipFeel) {
      feel[chipFeel] += Number(chip[2])
      continue
    }
    // 후기 카드: '5' / 'M' / '구매' / '∙' / '정사이즈예요' / 본문
    if (/^[1-5]$/.test(l) && SIZE_RE.test(all[i + 1] || '') && all[i + 2] === '구매') {
      let j = i + 3
      if (all[j] === '∙' || all[j] === '·') j++
      const fit = feelOf(all[j])
      if (fit) {
        reviews.push({ size: all[i + 1].toUpperCase(), fit, text: String(all[j + 1] || '').slice(0, 300) })
        addSize(all[i + 1])
      }
      continue
    }
    // 거래 내역: 'L' / '127,000원'
    if (SIZE_RE.test(l) && PRICE_RE.test(all[i + 1] || '')) addSize(l)
  }
  // 요약 칩이 없으면 보이는 후기 카드로 세요.
  const fromChips = feel.small + feel.true + feel.large > 0
  if (!fromChips) for (const r of reviews) feel[r.fit]++
  feel.total = fromChips ? Math.max(feel.small + feel.true + feel.large, reviewCount) : reviews.length
  return { feel, reviews: reviews.slice(0, 50), sizes: sizes.slice(0, 20) }
}
