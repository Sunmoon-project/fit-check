// 팝업: 체형 정보를 chrome.storage.local에 저장하고, 현재 탭에서 분석을 시작합니다.
// 네트워크 호출은 없습니다.
import { EXT_PROFILE_KEY, buildProfile } from '../src/lib/extProfile.js'

const form = document.getElementById('form')
const statusEl = document.getElementById('status')
const MEASURE_KEYS = ['shoulder', 'chest', 'waist', 'hip', 'thigh', 'footLength']

function say(text, isErr = false) {
  statusEl.textContent = text
  statusEl.className = isErr ? 'err' : ''
}

function readForm() {
  const fd = new FormData(form)
  const measurements = {}
  for (const k of MEASURE_KEYS) measurements[k] = fd.get(`m-${k}`)
  return { gender: fd.get('gender'), height: fd.get('height'), weight: fd.get('weight'), preferredFit: fd.get('preferredFit'), measurements }
}

function fillForm(p) {
  if (!p) return
  const radio = form.querySelector(`input[name="gender"][value="${p.gender}"]`)
  if (radio) radio.checked = true
  form.elements.height.value = p.height ?? ''
  form.elements.weight.value = p.weight ?? ''
  form.elements.preferredFit.value = p.preferredFit || 'regular'
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

chrome.storage.local.get(EXT_PROFILE_KEY, (v) => fillForm(v?.[EXT_PROFILE_KEY]))
