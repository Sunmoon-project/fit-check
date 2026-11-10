// 키·몸무게 → 평균 신체 치수 회귀식 (성별별): 값 = a + b·키(cm) + c·몸무게(kg) + d·ln(몸무게)
// 출처: ANSUR II (2012 미 육군 인체측정, 공개 자료, 남 4,082명·여 1,986명) https://www.openlab.psu.edu/ansur2/
//  - 사이즈코리아 원자료는 회원 신청이 필요해 바로 쓰지 못했어요. 같은 키·몸무게에서 부위 사이의 관계를 이 공개 자료로 맞췄어요.
//  - 미군 표본이라 한국인과 비율이 다를 수 있어요: 다리길이(키×0.45)와 발길이(키×1.5mm)는 이 식 대신 한국인 비율을 써요.
//  - 허리는 배꼽 높이 둘레, 어깨는 어깨뼈 사이 직선 너비(biacromial)라 옷 어깨너비로 쓸 때 SHOULDER_K를 곱해요.
//  - RMSE는 이 표본 안에서의 오차예요(한국인 실측으로 검증하지 않음).
export const SHOULDER_K = 1.1

export const BODY_AVERAGE = {
  male: {
    chest: [-7.2555, -0.2959, 0.2504, 32.3947], // RMSE 3.2cm, R² 0.87
    waist: [16.1482, -0.4396, 0.5058, 25.2215], // RMSE 4.4cm, R² 0.85
    hip: [-9.0099, -0.1442, 0.2324, 26.2464], // RMSE 2.6cm, R² 0.89
    thigh: [-25.0067, -0.1874, 0.1283, 24.6778], // RMSE 2.2cm, R² 0.86
    biacromial: [13.6446, 0.0914, 0.0356, 1.9905], // RMSE 1.4cm, R² 0.43
    arm: [-0.9122, 0.3548, 0.0154, -0.5393], // RMSE 1.8cm, R² 0.67
    footLength: [-10.7437, 1.2013, -0.0138, 16.2630], // RMSE 8.8mm, R² 0.54
  },
  female: {
    chest: [24.9834, -0.3364, 0.3909, 23.3178], // RMSE 4.2cm, R² 0.74
    waist: [10.5000, -0.4807, 0.4950, 28.6274], // RMSE 4.8cm, R² 0.77
    hip: [-15.9593, -0.1883, 0.2293, 31.6932], // RMSE 2.9cm, R² 0.85
    thigh: [-20.3788, -0.2020, 0.1567, 24.8071], // RMSE 2.2cm, R² 0.84
    biacromial: [-7.6487, 0.1263, -0.0585, 6.5647], // RMSE 1.5cm, R² 0.36
    arm: [-5.7108, 0.3467, 0.0202, 0.7448], // RMSE 1.7cm, R² 0.66
    footLength: [-10.8656, 1.1756, 0.0182, 15.3416], // RMSE 8.3mm, R² 0.55
  },
}

/** 성별·키·몸무게 → 부위 평균값 (cm, 발길이만 mm). 성별을 모르면 남녀 평균. */
export function averageBody(gender, height, weight) {
  const one = (g) => {
    const out = {}
    for (const [k, [a, b, c, d]] of Object.entries(BODY_AVERAGE[g])) out[k] = a + b * height + c * weight + d * Math.log(weight)
    return out
  }
  if (gender === 'male' || gender === 'female') return one(gender)
  const m = one('male')
  const f = one('female')
  return Object.fromEntries(Object.keys(m).map((k) => [k, (m[k] + f[k]) / 2]))
}
