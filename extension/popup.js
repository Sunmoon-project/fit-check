// 팝업: 체형 정보를 chrome.storage.local에 저장하고, 현재 탭에서 분석을 시작합니다.
// 네트워크 호출은 없습니다.
import { EXT_PROFILE_KEY, buildProfile } from '../src/lib/extProfile.js'
import { GUIDE, FIGURE } from '../src/data/measureGuide.js'

const form = document.getElementById('form')
const statusEl = document.getElementById('status')
const MEASURE_KEYS = ['shoulder', 'chest', 'waist', 'hip', 'thigh', 'arm', 'leg', 'footLength']

function say(text, isErr = false) {
  statusEl.textContent = text
  statusEl.className = isErr ? 'err' : ''
}

function readForm() {
  const fd = new FormData(form)
  const measurements = {}
  for (const k of MEASURE_KEYS) measurements[k] = fd.get(`m-${k}`)
  return { gender: fd.get('gender'), height: fd.get('height'), weight: fd.get('weight'), preferredFit: fd.get('preferredFit'), footWidth: fd.get('footWidth'), measurements }
}

function fillForm(p) {
  if (!p) return
  const radio = form.querySelector(`input[name="gender"][value="${p.gender}"]`)
  if (radio) radio.checked = true
  form.elements.height.value = p.height ?? ''
  form.elements.weight.value = p.weight ?? ''
  form.elements.preferredFit.value = p.preferredFit || 'regular'
  form.elements.footWidth.value = p.footWidth || ''
  for (const k of MEASURE_KEYS) form.elements[`m-${k}`].value = p.measurements?.[k] ?? ''
}

function save() {
  const { profile, error } = buildProfile(readForm())
  if (error) {
    say(error, true)
    return Promise.resolve(false)
  }
  return new Promise((resolve) => chrome.storage.local.set({ [EXT_PROFILE_KEY]: profile }, () => resolve(true)))
}

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  if (await save()) say('저장했어요. 이 브라우저에만 보관돼요.')
})

document.getElementById('run').addEventListener('click', async () => {
  if (!(await save())) return
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return say('현재 탭을 찾지 못했어요.', true)
  try {
    // 클릭한 탭에만 content.js를 넣습니다(activeTab). 이미 들어 있으면 다시 실행돼도 한 번만 동작해요.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
    await chrome.tabs.sendMessage(tab.id, { type: 'fitcheck-run' })
    window.close()
  } catch {
    say('이 페이지에서는 실행할 수 없어요. 일반 쇼핑몰 상품 페이지에서 눌러주세요.', true)
  }
})


// 치수 재는 법: 칸에 커서를 두거나 부위 버튼을 누르면 그림에 잴 곳을 그려요 (DOM으로만 만들어요).
const guideEl = document.getElementById('guide')
const NS = 'http://www.w3.org/2000/svg'
const svgEl = (tag, attrs, cls) => {
  const n = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
  if (cls) n.setAttribute('class', cls)
  return n
}
function showGuide(key) {
  const part = GUIDE.find((g) => g.key === key) || GUIDE[0]
  const svg = svgEl('svg', { viewBox: '0 0 200 410', role: 'img', 'aria-label': `${part.label} 재는 위치` })
  const body = svgEl('g', {}, 'gb')
  body.append(svgEl('circle', { cx: FIGURE.head[0], cy: FIGURE.head[1], r: FIGURE.head[2] }), svgEl('rect', { x: FIGURE.neck[0], y: FIGURE.neck[1], width: FIGURE.neck[2], height: FIGURE.neck[3], rx: 4 }), svgEl('path', { d: FIGURE.body }), svgEl('path', { d: FIGURE.arms }, 'ga'))
  const mark = svgEl('g', {}, 'gm')
  if (part.draw.back) mark.append(svgEl('path', { d: part.draw.back }, 'gk'))
  mark.append(svgEl('path', { d: part.draw.front || part.draw.line, pathLength: 1 }))
  for (const [cx, cy] of part.draw.dots) mark.append(svgEl('circle', { cx, cy, r: 3.6 }))
  svg.append(body, mark)
  const chips = document.createElement('div')
  chips.className = 'gchips'
  for (const g of GUIDE) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = g.label.replace(/둘레|너비$/, '')
    b.className = g.key === part.key ? 'on' : ''
    b.addEventListener('click', () => showGuide(g.key))
    chips.append(b)
  }
  const text = document.createElement('div')
  text.className = 'gt'
  const h = document.createElement('b')
  h.textContent = part.label
  const how = document.createElement('p')
  how.textContent = part.how
  const tip = document.createElement('p')
  tip.className = 'gtip'
  tip.textContent = part.tip
  text.append(h, how, tip)
  const side = document.createElement('div')
  side.append(chips, text)
  guideEl.replaceChildren(svg, side)
}
showGuide('shoulder')
form.addEventListener('focusin', (e) => {
  const k = e.target.name?.startsWith('m-') && e.target.name.slice(2)
  if (k && GUIDE.some((g) => g.key === k)) showGuide(k)
})

chrome.storage.local.get(EXT_PROFILE_KEY, (v) => fillForm(v?.[EXT_PROFILE_KEY]))
