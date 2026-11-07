// 신체 치수 항목 정의 (온보딩 상세 입력 + 핏 판정 라벨에 공통 사용)
export const BODY_FIELDS = [
  { key: 'shoulder', label: '어깨너비', unit: 'cm', min: 30, max: 60, step: 0.5 },
  { key: 'chest', label: '가슴둘레', unit: 'cm', min: 70, max: 140, step: 1 },
  { key: 'waist', label: '허리둘레', unit: 'cm', min: 55, max: 120, step: 1 },
  { key: 'hip', label: '엉덩이둘레', unit: 'cm', min: 75, max: 130, step: 1 },
  { key: 'thigh', label: '허벅지둘레', unit: 'cm', min: 40, max: 80, step: 1 },
  { key: 'arm', label: '팔길이', unit: 'cm', min: 45, max: 75, step: 0.5 },
  { key: 'footLength', label: '발길이', unit: 'mm', min: 210, max: 310, step: 5 },
]

export const PART_LABEL = Object.fromEntries(BODY_FIELDS.map((f) => [f.key, f.label.replace(/둘레|너비|길이$/, '')]))
PART_LABEL.footLength = '발길이'
PART_LABEL.arm = '팔길이'

export const CATEGORY_LABEL = { top: '상의', outer: '아우터', bottom: '하의', dress: '원피스', shoes: '신발' }

// 카테고리마다 핏을 판정할 신체 부위
export const CATEGORY_PARTS = {
  top: ['shoulder', 'chest', 'arm'],
  outer: ['shoulder', 'chest', 'arm'],
  bottom: ['waist', 'hip', 'thigh'],
  dress: ['shoulder', 'chest', 'waist', 'hip'],
  shoes: ['footLength'],
}

export const TOP_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
export const BOTTOM_SIZES = [24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 36, 38, 40]
export const SHOE_SIZES = Array.from({ length: 17 }, (_, i) => 220 + i * 5)

/** 신체 치수 값이 BODY_FIELDS 범위 안인지 (발길이는 210~310mm, 신발 사이즈는 230부터 시작해도 포함됨) */
export function inFieldRange(key, value) {
  const f = BODY_FIELDS.find((x) => x.key === key)
  return !!f && Number.isFinite(value) && value >= f.min && value <= f.max
}
