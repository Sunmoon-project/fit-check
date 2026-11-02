// 카테고리별 신체 치수 정의
// 각 치수는 사용자가 "자기 몸 또는 평소 잘 맞는 옷"의 실측을 적는 항목.
// key: 저장 키, label: 표시명, unit: 단위, min/max/step: 입력 범위, default: 기본값
// chartKey: 상품 사이즈표 헤더와 매칭할 때 쓰는 키워드(핏 대조용)

export const CATEGORY_MEASUREMENTS = {
  top: {
    label: '상의',
    fields: [
      { key: 'shoulder', label: '어깨너비', unit: 'cm', min: 34, max: 55, step: 0.5, default: 42, chartKey: '어깨' },
      { key: 'chest', label: '가슴둘레', unit: 'cm', min: 76, max: 130, step: 1, default: 92, chartKey: '가슴' },
      { key: 'arm', label: '팔길이', unit: 'cm', min: 50, max: 70, step: 0.5, default: 58, chartKey: '팔' },
      { key: 'topLength', label: '총기장', unit: 'cm', min: 55, max: 85, step: 1, default: 66, chartKey: '총장' },
    ],
  },
  outer: {
    label: '아우터',
    fields: [
      { key: 'shoulder', label: '어깨너비', unit: 'cm', min: 36, max: 58, step: 0.5, default: 44, chartKey: '어깨' },
      { key: 'chest', label: '가슴둘레', unit: 'cm', min: 80, max: 140, step: 1, default: 96, chartKey: '가슴' },
      { key: 'arm', label: '팔길이', unit: 'cm', min: 52, max: 72, step: 0.5, default: 60, chartKey: '팔' },
      { key: 'outerLength', label: '총기장', unit: 'cm', min: 60, max: 110, step: 1, default: 72, chartKey: '총장' },
    ],
  },
  bottom: {
    label: '하의',
    fields: [
      { key: 'waist', label: '허리둘레', unit: 'cm', min: 60, max: 110, step: 1, default: 78, chartKey: '허리' },
      { key: 'hip', label: '엉덩이둘레', unit: 'cm', min: 80, max: 120, step: 1, default: 94, chartKey: '엉덩이' },
      { key: 'thigh', label: '허벅지둘레', unit: 'cm', min: 44, max: 72, step: 1, default: 54, chartKey: '허벅지' },
      { key: 'inseam', label: '기장(총장)', unit: 'cm', min: 85, max: 115, step: 1, default: 100, chartKey: '총장' },
    ],
  },
  dress: {
    label: '원피스',
    fields: [
      { key: 'chest', label: '가슴둘레', unit: 'cm', min: 76, max: 120, step: 1, default: 88, chartKey: '가슴' },
      { key: 'waist', label: '허리둘레', unit: 'cm', min: 58, max: 100, step: 1, default: 70, chartKey: '허리' },
      { key: 'dressLength', label: '총기장', unit: 'cm', min: 80, max: 140, step: 1, default: 110, chartKey: '총장' },
    ],
  },
  shoes: {
    label: '신발',
    fields: [
      { key: 'footLength', label: '발 사이즈', unit: 'mm', min: 220, max: 300, step: 5, default: 250, chartKey: '발길이' },
      { key: 'footWidth', label: '발볼', unit: '', min: 1, max: 3, step: 1, default: 2, chartKey: '발볼', options: ['좁음', '보통', '넓음'] },
    ],
  },
}

// 카테고리 기본값으로 치수 객체 생성
export function defaultMeasurements(category) {
  const def = CATEGORY_MEASUREMENTS[category]
  if (!def) return {}
  const out = {}
  for (const f of def.fields) out[f.key] = f.default
  return out
}
