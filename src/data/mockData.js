// 14일 검증용 데모 데이터
// 문서 컨셉: "쇼핑몰을 가리지 않고 상품 링크 하나로" → 상품 URL을 키로 사용
// 실제 서비스에서는 사용자가 붙여넣은 페이지를 파싱하지만, 프로토타입에서는 수작업 수집한 샘플을 담았습니다.

export const SAMPLE_URLS = [
  'https://shop-a.example.com/goods/12345',
  'https://zigzag.example.com/catalog/88211',
  'https://used-market.example.com/item/5f3a7',
  'https://shop-b.example.com/outer/77120',
  'https://sneaker.example.com/p/aj-990',
]

// 체형 후기: 작성자의 키/몸무게/평소핏과 "이 사이즈에서 어땠는지"를 담음
// fit: 'small' | 'true' | 'large' (내 체형 기준 작게/딱맞게/크게)
const reviews = {
  'https://shop-a.example.com/goods/12345': [
    { id: 1, nick: '민지', height: 162, weight: 50, size: 'S', fit: 'true', text: '55 입는데 S 딱 맞아요. 기장은 살짝 긴 편.', rating: 5 },
    { id: 2, nick: '하늘', height: 170, weight: 58, size: 'M', fit: 'small', text: '어깨가 조금 끼어서 한 치수 올릴 걸 그랬어요.', rating: 3 },
    { id: 3, nick: '수아', height: 158, weight: 47, size: 'S', fit: 'large', text: '마른 편인데 S도 품이 넉넉해서 루즈하게 입어요.', rating: 4 },
    { id: 4, nick: '지원', height: 165, weight: 55, size: 'M', fit: 'true', text: '표준 체형인데 M이 딱 좋아요. 신축성 있어요.', rating: 5 },
    { id: 5, nick: '예림', height: 172, weight: 64, size: 'L', fit: 'true', text: 'L로 넉넉하게. 허리는 여유 있고 기장 적당.', rating: 4 },
    { id: 6, nick: '보라', height: 160, weight: 62, size: 'M', fit: 'small', text: '허벅지 쪽이 끼어요. 하체 있으면 L 추천.', rating: 3 },
  ],
  'https://zigzag.example.com/catalog/88211': [
    { id: 1, nick: 'yuna', height: 168, weight: 54, size: 'FREE', fit: 'true', text: '프리사이즈인데 저한텐 적당했어요.', rating: 4 },
    { id: 2, nick: 'dori', height: 174, weight: 60, size: 'FREE', fit: 'small', text: '키 크면 기장이 좀 짧게 느껴질 수 있어요.', rating: 3 },
    { id: 3, nick: 'mimi', height: 155, weight: 45, size: 'FREE', fit: 'large', text: '작은 편이라 많이 큽니다. 오버핏 좋아하면 OK.', rating: 4 },
    { id: 4, nick: 'jin', height: 163, weight: 52, size: 'FREE', fit: 'true', text: '딱 평균 체형, 핏 예쁘게 떨어져요.', rating: 5 },
  ],
  'https://used-market.example.com/item/5f3a7': [
    { id: 1, nick: '거래자A', height: 178, weight: 72, size: '32', fit: 'true', text: '32인치 허리 딱 맞고 기장 롱.', rating: 4 },
    { id: 2, nick: '거래자B', height: 182, weight: 80, size: '32', fit: 'small', text: '허벅지 있는 편이라 조금 타이트했어요.', rating: 3 },
    { id: 3, nick: '거래자C', height: 175, weight: 68, size: '32', fit: 'large', text: '마른 체형엔 살짝 헐렁. 벨트 필수.', rating: 4 },
  ],
  'https://shop-b.example.com/outer/77120': [
    { id: 1, nick: '도윤', height: 176, weight: 70, size: 'M', fit: 'true', text: '안에 니트 입어도 여유 있어요. 어깨 적당.', rating: 5 },
    { id: 2, nick: '서준', height: 183, weight: 78, size: 'L', fit: 'small', text: '팔 길이가 살짝 짧게 느껴져요. 팔 긴 편.', rating: 3 },
    { id: 3, nick: '하준', height: 170, weight: 63, size: 'M', fit: 'large', text: '오버핏이라 M도 크게 떨어져요.', rating: 4 },
    { id: 4, nick: '지안', height: 179, weight: 74, size: 'L', fit: 'true', text: 'L로 두껍게 레이어드 가능. 총기장 롱.', rating: 5 },
  ],
  'https://sneaker.example.com/p/aj-990': [
    { id: 1, nick: 'runner', height: 172, weight: 65, size: '260', fit: 'true', text: '발볼 보통인데 260 딱 맞아요.', rating: 5 },
    { id: 2, nick: 'walker', height: 180, weight: 76, size: '270', fit: 'small', text: '발볼 넓은 편이라 반 치수 크게 샀어요.', rating: 3 },
    { id: 3, nick: 'daily', height: 165, weight: 58, size: '250', fit: 'large', text: '정사이즈보다 살짝 커서 깔창 넣었어요.', rating: 4 },
    { id: 4, nick: 'hiker', height: 168, weight: 60, size: '255', fit: 'true', text: '255 정사이즈 좋아요.', rating: 5 },
  ],
}

// 상품 정보 + 사이즈표
// sizeChart.measures: 사이즈별 실측 치수 맵. 핏 엔진이 사용자 상세 치수와 직접 대조.
export const PRODUCTS = {
  'https://shop-a.example.com/goods/12345': {
    url: 'https://shop-a.example.com/goods/12345',
    mall: 'A몰',
    name: '베이식 코튼 반팔 티셔츠',
    category: 'top',
    price: '19,900원',
    emoji: '👕',
    sizeChart: {
      unit: 'cm',
      headers: ['사이즈', '어깨', '가슴단면', '팔길이', '총장'],
      rows: [
        ['S', 42, 48, 19, 64],
        ['M', 44, 51, 20, 67],
        ['L', 46, 54, 21, 70],
      ],
      // 둘레형 치수는 단면*2로 환산해 비교(가슴둘레 등). 어깨/팔/기장은 그대로.
      measures: {
        S: { shoulder: 42, chest: 96, arm: 57, topLength: 64 },
        M: { shoulder: 44, chest: 102, arm: 58, topLength: 67 },
        L: { shoulder: 46, chest: 108, arm: 59, topLength: 70 },
      },
    },
    reviews: reviews['https://shop-a.example.com/goods/12345'],
  },
  'https://zigzag.example.com/catalog/88211': {
    url: 'https://zigzag.example.com/catalog/88211',
    mall: 'Z몰',
    name: '플리츠 롱 원피스',
    category: 'dress',
    price: '38,000원',
    emoji: '👗',
    sizeChart: {
      unit: 'cm',
      headers: ['사이즈', '가슴단면', '허리단면', '총장'],
      rows: [
        ['FREE', 46, 36, 118],
      ],
      measures: {
        FREE: { chest: 92, waist: 72, dressLength: 118 },
      },
    },
    reviews: reviews['https://zigzag.example.com/catalog/88211'],
  },
  'https://used-market.example.com/item/5f3a7': {
    url: 'https://used-market.example.com/item/5f3a7',
    mall: '중고마켓',
    name: '빈티지 데님 팬츠 (32)',
    category: 'bottom',
    price: '25,000원',
    emoji: '👖',
    sizeChart: {
      unit: 'cm',
      headers: ['사이즈', '허리둘레', '엉덩이둘레', '허벅지둘레', '총장'],
      rows: [
        ['30', 76, 94, 56, 101],
        ['32', 82, 98, 58, 102],
        ['34', 88, 102, 60, 103],
      ],
      measures: {
        30: { waist: 76, hip: 94, thigh: 56, inseam: 101 },
        32: { waist: 82, hip: 98, thigh: 58, inseam: 102 },
        34: { waist: 88, hip: 102, thigh: 60, inseam: 103 },
      },
    },
    reviews: reviews['https://used-market.example.com/item/5f3a7'],
  },
  'https://shop-b.example.com/outer/77120': {
    url: 'https://shop-b.example.com/outer/77120',
    mall: 'B몰',
    name: '오버핏 코치 자켓',
    category: 'outer',
    price: '89,000원',
    emoji: '🧥',
    sizeChart: {
      unit: 'cm',
      headers: ['사이즈', '어깨', '가슴단면', '팔길이', '총장'],
      rows: [
        ['M', 48, 58, 63, 70],
        ['L', 50, 61, 65, 73],
        ['XL', 52, 64, 67, 76],
      ],
      measures: {
        M: { shoulder: 48, chest: 116, arm: 63, outerLength: 70 },
        L: { shoulder: 50, chest: 122, arm: 65, outerLength: 73 },
        XL: { shoulder: 52, chest: 128, arm: 67, outerLength: 76 },
      },
    },
    reviews: reviews['https://shop-b.example.com/outer/77120'],
  },
  'https://sneaker.example.com/p/aj-990': {
    url: 'https://sneaker.example.com/p/aj-990',
    mall: '스니커샵',
    name: '데일리 러닝 스니커즈',
    category: 'shoes',
    price: '119,000원',
    emoji: '👟',
    sizeChart: {
      unit: 'mm',
      headers: ['사이즈', '발길이', '권장 발볼'],
      rows: [
        ['250', 250, '보통'],
        ['255', 255, '보통'],
        ['260', 260, '보통'],
        ['270', 270, '넓음'],
      ],
      measures: {
        250: { footLength: 250, footWidth: 2 },
        255: { footLength: 255, footWidth: 2 },
        260: { footLength: 260, footWidth: 2 },
        270: { footLength: 270, footWidth: 3 },
      },
    },
    reviews: reviews['https://sneaker.example.com/p/aj-990'],
  },
}

export function findProductByUrl(input) {
  const trimmed = (input || '').trim()
  if (!trimmed) return null
  // 정확히 일치하거나, 입력에 샘플 URL이 포함되면 매칭
  for (const key of Object.keys(PRODUCTS)) {
    if (trimmed === key || trimmed.includes(key) || key.includes(trimmed)) {
      return PRODUCTS[key]
    }
  }
  return null
}
