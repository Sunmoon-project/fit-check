// 키·몸무게·체형 선택으로 신체 치수를 추정합니다.
// 같은 성별·키·몸무게의 평균값(src/data/bodyAverages.js, 공개 인체측정 자료 회귀식)에서 시작해요. 사람마다 ±2~5cm 차이가 나요.
// 사용자가 직접 잰 값이 있으면 항상 그 값을 우선합니다.

import { averageBody, SHOULDER_K } from '../data/bodyAverages.js'

const SHAPE_ADJUST = {
  shoulder: { narrow: { shoulder: -2, chest: -2 }, normal: {}, wide: { shoulder: 2, chest: 2 } },
  belly: { none: {}, some: { waist: 4, chest: 1 }, much: { waist: 9, chest: 3, hip: 2 } },
  lower: { slim: { hip: -3, thigh: -3 }, normal: {}, thick: { hip: 3, thigh: 4 } },
}

function base(gender, h, w) {
  const avg = averageBody(gender, h, w)
  return {
    shoulder: avg.biacromial * SHOULDER_K,
    chest: avg.chest,
    waist: avg.waist,
    hip: avg.hip,
    thigh: avg.thigh,
    arm: avg.arm,
    leg: 0.45 * h, // 안쪽 다리길이(가랑이~바닥): 한국인 평균 비율
    footLength: 1.5 * h, // mm. 미군 표본 식은 한국인보다 발이 10mm 안팎 크게 나와 쓰지 않아요.
  }
}

const round = (v, step = 0.5) => Math.round(v / step) * step
export const PHOTO_PARTS = ['shoulder', 'chest', 'waist', 'hip']

// 반환: { values: {부위: 값}, measured: Set(직접 입력한 부위), photo: Set(사진으로 추정한 부위) }
export function estimateBody(profile) {
  const { gender, height, weight, shape = {}, usual = {}, measurements = {} } = profile
  const v = base(gender, height, weight)

  for (const [axis, choice] of Object.entries(shape)) {
    const adj = SHAPE_ADJUST[axis]?.[choice] || {}
    for (const [k, d] of Object.entries(adj)) v[k] += d
  }
  // 평소 하의 인치(허리 표기)는 실제 허리둘레와 꽤 가까워서 추정값과 평균을 냅니다.
  if (usual.bottom) v.waist = (v.waist + Number(usual.bottom) * 2.54) / 2
  // 평소 신발 사이즈는 발길이보다 5~10mm 크게 신는 경우가 많아요.
  if (usual.shoes) v.footLength = Number(usual.shoes) - 7

  const values = {}
  for (const k of Object.keys(v)) values[k] = k === 'footLength' ? round(v[k], 5) : round(v[k])

  // 사진으로 추정한 둘레·어깨(profile.photoBody)는 공식값 대신 쓰고, 직접 잰 값이 있으면 그 값이 이겨요.
  const photo = new Set()
  for (const k of PHOTO_PARTS) {
    const val = Number(profile.photoBody?.[k])
    if (Number.isFinite(val) && val > 0) {
      values[k] = val
      photo.add(k)
    }
  }

  const measured = new Set()
  for (const [k, val] of Object.entries(measurements || {})) {
    if (val != null && val !== '' && !Number.isNaN(Number(val))) {
      values[k] = Number(val)
      measured.add(k)
      photo.delete(k)
    }
  }
  return { values, measured, photo }
}
