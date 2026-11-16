// 사이즈 표기(호칭) → 대표 치수 변환표. 후기·사이즈표·판매글 실측이 모두 없을 때만 보여주는 가장 낮은 우선순위의 참고값이에요.
//
// 중요: 이 표의 모든 값은 "근사 / 출처 확인 필요"예요.
// - 값은 의류 치수 체계(국내 KS 의류 치수 규격, ISO 8559, 미국 ASTM 의류 치수 표 등 공개 표준)가 정한 "호칭의 뜻"에 기댄 것이에요.
//   예: 국내 남성 상의 95/100/105는 가슴둘레(cm) 호칭, 하의 28/30은 허리둘레(인치) 호칭, 신발 260은 발 길이(mm) 호칭.
// - 이 환경에서는 외부에 접속할 수 없어 표준 원문을 열어 수치를 확인하지 못했어요. 규격 번호와 세부 수치는 docs/사이즈체계_출처확인.md의 확인 목록에 따라 확인해야 해요.
// - 호칭은 "몸 치수"에 가까운 값이고 옷 실측(단면×2)과 달라요. 그래서 추천 계산에는 쓰지 않고, 참고 문구로만 보여줘요.
// - 미국·유럽·일본 알파벳/숫자 사이즈의 대표 치수는 근거를 확인하지 못해 아직 넣지 않았어요(확인 목록에 있어요).

export const SIZE_SYSTEM_FLAG = '근사/출처 확인 필요'

export const SIZE_SYSTEM_SOURCES = Object.freeze([
  { id: 'ks-clothes', name: '국내 KS 의류 치수 규격(성인 남성복 등)', status: '규격 번호·수치 원문 미확인' },
  { id: 'iso-8559', name: 'ISO 8559 의류 치수 체계 및 인체 치수 측정', status: '원문 미확인' },
  { id: 'astm', name: '미국 ASTM 의류 치수 표 계열', status: '규격 번호·수치 원문 미확인' },
])

const base = { approximate: true, needsSource: true, flag: SIZE_SYSTEM_FLAG }

const KR_TOP_MALE = [90, 95, 100, 105, 110]
const BOTTOM_INCH_MIN = 24
const BOTTOM_INCH_MAX = 40
const SHOE_MM = /^(2[2-9]\d|3[01]\d)(?:\s*mm)?$/i
const SHOE_JP_CM = /^(2[2-9]|3[01])(?:\.[05])?\s*cm$/i

const round1 = (v) => Math.round(v * 10) / 10

/**
 * 사이즈 이름 하나의 대표 치수를 찾아요. 표에 없으면 null (없는 값을 만들어내지 않아요).
 * @param {{ category: string, gender?: string|null, label: string }} q
 * @returns {{ label:string, system:string, measures:Record<string,number>, basis:string, text:string, approximate:true, needsSource:true, flag:string, sources:string[] }|null}
 */
export function representativeMeasure({ category, gender = null, label } = {}) {
  const l = String(label ?? '').trim()
  if (!l) return null
  if (category === 'top' || category === 'outer') {
    const n = /^\d{2,3}$/.test(l) ? Number(l) : null
    // 95/100/105는 남성복 호칭이에요. 성별을 모르거나 여성이면 같은 숫자가 다른 뜻일 수 있어 값을 주지 않아요.
    if (n != null && gender === 'male' && KR_TOP_MALE.includes(n)) {
      return { ...base, label: l, system: 'kr-male-top', measures: { chest: n }, basis: '가슴둘레 호칭(cm)', text: `${l} → 가슴둘레 호칭 약 ${n}cm`, sources: ['ks-clothes', 'iso-8559'] }
    }
    return null
  }
  if (category === 'bottom') {
    const n = /^\d{2}$/.test(l) ? Number(l) : null
    if (n != null && n >= BOTTOM_INCH_MIN && n <= BOTTOM_INCH_MAX) {
      const cm = round1(n * 2.54)
      return { ...base, label: l, system: 'inch-bottom', measures: { waist: cm }, basis: '허리둘레 호칭(인치)', text: `${l} → 허리둘레 호칭 ${n}인치(약 ${cm}cm)`, sources: ['iso-8559', 'astm'] }
    }
    return null
  }
  if (category === 'shoes') {
    const mm = l.match(SHOE_MM)
    if (mm) return { ...base, label: l, system: 'kr-shoe-mm', measures: { footLength: Number(mm[1]) }, basis: '발 길이 호칭(mm)', text: `${l} → 발 길이 호칭 약 ${mm[1]}mm`, sources: ['ks-clothes'] }
    const cm = l.match(SHOE_JP_CM)
    if (cm) return { ...base, label: l, system: 'jp-shoe-cm', measures: { footLength: Math.round(parseFloat(l) * 10) }, basis: '발 길이 호칭(cm)', text: `${l} → 발 길이 호칭 약 ${Math.round(parseFloat(l) * 10)}mm`, sources: [] }
  }
  return null
}

/** 구매 옵션 이름들 → 표시용 줄. 하나도 못 찾으면 null. */
export function sizeSystemHint({ category, gender = null, optionLabels = [] } = {}) {
  const seen = new Set()
  const rows = []
  for (const o of optionLabels) {
    const key = String(o).trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    const m = representativeMeasure({ category, gender, label: key })
    if (m) rows.push(m)
  }
  if (rows.length === 0) return null
  return {
    flag: SIZE_SYSTEM_FLAG,
    title: `사이즈 표기 참고값(${SIZE_SYSTEM_FLAG})`,
    lines: rows.map((r) => r.text),
    note: '사이즈표·후기·판매글 실측이 없어 표기의 뜻만 보여드려요. 몸 치수 기준 호칭이라 옷 실측과 달라요. 추천 계산에는 쓰지 않았어요. 표준 원문은 아직 확인하지 못했어요.',
  }
}
