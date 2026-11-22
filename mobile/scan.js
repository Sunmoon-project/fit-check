// 아이폰 앱의 '내 체형' 시트에만 들어가요(확장에는 넣지 않아요): 전신 사진 한 장으로 어깨·가슴·허리·엉덩이를 재서 칸을 채워요.
// 웹의 BodyScan과 같은 계산(MediaPipe Pose + 내 키)을 써요. 사진은 휴대폰 안에서만 분석하고 어디로도 보내지 않아요.
// 처음 한 번 MediaPipe(JS·WASM·모델 약 9MB)를 jsDelivr·Google 저장소에서 내려받아요(웹 앱과 같은 버전).
import { detectPose, loadImage } from '../src/lib/poseRuntime.js'
import { measureFromPose } from '../src/lib/photoBody.js'
import { estimateBody } from '../src/lib/bodyEstimate.js'

const PARTS = [['shoulder', '어깨'], ['chest', '가슴'], ['waist', '허리'], ['hip', '엉덩이']]
const form = document.getElementById('form')
const box = document.createElement('div')
box.className = 'scan'
box.innerHTML = `<button type="button" class="scan-btn">사진으로 치수 재기</button>
<p class="scan-tip">머리부터 발끝까지 정면으로 나온 사진을 찍거나 골라 주세요. 몸에 붙는 옷, 팔은 살짝 벌리면 더 정확해요.</p>
<input type="file" accept="image/*" hidden />
<p class="scan-msg" role="status" aria-live="polite"></p>`
form.querySelector('details').before(box)
const btn = box.querySelector('.scan-btn')
const input = box.querySelector('input')
const msg = box.querySelector('.scan-msg')
const say = (t, err = false) => {
  msg.textContent = t
  msg.className = `scan-msg${err ? ' err' : ''}`
}

// 큰 사진은 1024px로 줄여요(분석 속도·메모리).
const shrink = (file) =>
  loadImage(URL.createObjectURL(file)).then((img) => {
    const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * k)
    c.height = Math.round(img.naturalHeight * k)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    URL.revokeObjectURL(img.src)
    return loadImage(c.toDataURL('image/jpeg', 0.9))
  })

btn.addEventListener('click', () => {
  const height = Number(form.elements.height.value)
  if (!(height >= 130 && height <= 220)) return say('키를 먼저 입력해 주세요. 사진 속 길이를 키로 cm로 바꿔요.', true)
  input.click()
})

input.addEventListener('change', async () => {
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  btn.disabled = true
  try {
    say('사진을 읽는 중이에요…')
    const img = await shrink(file)
    say('체형 분석 모델을 불러오는 중이에요 (처음 한 번 약 9MB)…')
    const pose = await detectPose(img)
    const f = form.elements
    const profile = { gender: f.gender.value || 'male', height: Number(f.height.value), weight: Number(f.weight.value) || 0 }
    const formula = profile.weight ? estimateBody(profile).values : {}
    const r = measureFromPose({ ...pose, heightCm: profile.height, formula })
    if (!r.ok) return say(r.reason, true)
    const got = PARTS.filter(([k]) => Number.isFinite(r.values[k]))
    for (const [k] of got) f[`m-${k}`].value = r.values[k]
    form.querySelector('details').open = true
    say(`${got.map(([k, n]) => `${n} ${r.values[k]}cm`).join(' · ')}로 채웠어요. 옷·자세에 따라 3~6cm 차이 날 수 있어요. 확인하고 저장하기를 눌러 주세요.${r.warnings.length ? ` ${r.warnings.join(' ')}` : ''}`)
  } catch {
    say('체형 분석 모델을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.', true)
  } finally {
    btn.disabled = false
  }
})
