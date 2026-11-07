// 상품 페이지에 "내 사이즈 찾기" 버튼과 결과 카드를 띄웁니다.
// 페이지 데이터는 이 브라우저 안에서만 읽고, 어디로도 보내지 않아요. 네트워크 호출이 없습니다.
import { isProductPage } from '../src/lib/pageParser.js'
import { analyzePage } from '../src/lib/extAnalyze.js'
import { EXT_PROFILE_KEY, isUsableProfile } from '../src/lib/extProfile.js'

const WAIT_MS = 4000 // 늦게 그려지는 표·리뷰를 기다리는 최대 시간
const QUIET_MS = 500 // 이 시간 동안 화면 변화가 없으면 다 그려졌다고 봅니다

const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif}
.wrap{position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:8px;color:#111}
.fab{border:0;border-radius:999px;background:#111;color:#fff;padding:12px 18px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25)}
.fab:disabled{opacity:.6;cursor:default}
.card{width:300px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #d4d4d4;border-radius:12px;padding:16px;box-shadow:0 8px 28px rgba(0,0,0,.2);font-size:13px;line-height:1.5}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.eyebrow{font-size:11px;color:#8a8a8e}
.close{border:0;background:none;font-size:18px;line-height:1;cursor:pointer;color:#555}
.badge{font-size:12px;font-weight:600}
.size{font-size:30px;font-weight:700;margin:6px 0 2px}
.sum{margin:8px 0 0;color:#555;font-size:12px}
.why{margin:6px 0 0;padding-left:16px;color:#555;font-size:12px}
h3{margin:10px 0 2px;font-size:14px}
p{margin:0}
.note{margin-top:10px;font-size:11px;color:#8a8a8e}
`

let host = null
let shadow = null
let panel = null
let fab = null
let busy = false

function ensureUi() {
  if (host) return
  host = document.createElement('div')
  host.id = 'fitcheck-root'
  shadow = host.attachShadow({ mode: 'closed' })
  // 페이지 CSP에 막히지 않도록 가능하면 adoptedStyleSheets를 씁니다.
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(CSS)
    shadow.adoptedStyleSheets = [sheet]
  } catch {
    const st = document.createElement('style')
    st.textContent = CSS
    shadow.appendChild(st)
  }
  const wrap = document.createElement('div')
  wrap.className = 'wrap'
  panel = document.createElement('div')
  fab = document.createElement('button')
  fab.className = 'fab'
  fab.type = 'button'
  fab.textContent = '내 사이즈 찾기'
  fab.addEventListener('click', run)
  wrap.append(panel, fab)
  shadow.appendChild(wrap)
  document.documentElement.appendChild(host)
}

// 페이지 글은 모두 textContent로만 넣습니다 (HTML로 해석하지 않음).
function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

function showCard(build) {
  panel.replaceChildren()
  const card = el('div', 'card')
  const head = el('div', 'row')
  head.append(el('span', 'eyebrow', '핏체크 · 내 체형 추천'))
  const close = el('button', 'close', '×')
  close.type = 'button'
  close.setAttribute('aria-label', '닫기')
  close.addEventListener('click', () => panel.replaceChildren())
  head.append(close)
  card.append(head)
  build(card)
  card.append(el('p', 'note', '참고용이에요. 최종 선택은 상품 상세의 실측을 꼭 확인해주세요. 입력한 정보는 이 브라우저 밖으로 나가지 않아요.'))
  panel.append(card)
}

function renderResult(r) {
  showCard((card) => {
    if (r.status !== 'ok') {
      card.append(el('p', null, r.message))
      return
    }
    const conf = el('span', 'badge', r.confidenceLabel.text)
    conf.style.color = r.confidenceLabel.color
    const row = el('div', 'row')
    row.append(el('span', 'eyebrow', r.categoryLabel), conf)
    card.append(row)
    if (r.recommendedSize) card.append(el('div', 'size', r.recommendedSize))
    card.append(el('p', 'sum', r.summary))
    if (r.reasons.length) {
      const ul = el('ul', 'why')
      for (const t of r.reasons) ul.append(el('li', null, t))
      card.append(ul)
    }
    card.append(el('h3', null, r.headline), el('p', null, r.body))
    card.append(el('p', 'note', '확신도는 후기·사이즈표 근거가 얼마나 있는지로 나눈 참고 단계예요. 정확도를 측정한 값이 아니에요.'))
  })
}

function readProfile() {
  return new Promise((resolve) => chrome.storage.local.get(EXT_PROFILE_KEY, (v) => resolve(v?.[EXT_PROFILE_KEY] || null)))
}

// 표나 리뷰가 늦게 그려지는 사이트를 위해, 화면 변화가 잠잠해질 때까지 짧게 기다립니다 (최대 WAIT_MS).
function waitForRender() {
  return new Promise((resolve) => {
    let quiet = setTimeout(done, QUIET_MS)
    const limit = setTimeout(done, WAIT_MS)
    const mo = new MutationObserver(() => {
      clearTimeout(quiet)
      quiet = setTimeout(done, QUIET_MS)
    })
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true })
    function done() {
      mo.disconnect()
      clearTimeout(quiet)
      clearTimeout(limit)
      resolve()
    }
  })
}

async function run() {
  if (busy) return
  busy = true
  ensureUi()
  fab.disabled = true
  fab.textContent = '분석 중…'
  try {
    const profile = await readProfile()
    if (!isUsableProfile(profile)) {
      renderResult({ status: 'no-profile', message: '먼저 확장 프로그램 아이콘을 눌러 키·몸무게 등 체형 정보를 저장해주세요.' })
      return
    }
    await waitForRender()
    renderResult(analyzePage(document, location.href, profile))
  } catch {
    renderResult({ status: 'error', message: '분석 중 문제가 생겼어요. 페이지를 새로고침한 뒤 다시 눌러주세요.' })
  } finally {
    fab.disabled = false
    fab.textContent = '내 사이즈 찾기'
    busy = false
  }
}

// 같은 페이지에 두 번 주입돼도 한 번만 동작하게 합니다 (팝업에서 누른 경우 포함).
if (!window.__fitcheckLoaded) {
  window.__fitcheckLoaded = true
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'fitcheck-run') run()
  })
  // 상품 페이지로 보일 때만 버튼을 띄웁니다. 늦게 그려지는 페이지는 몇 번 다시 확인해요.
  // 팝업에서 직접 실행한 경우(메시지)에는 어느 페이지든 버튼과 결과를 보여줘요.
  let tries = 0
  const maybeShow = () => {
    if (host) return
    if (isProductPage(document)) ensureUi()
    else if (++tries < 4) setTimeout(maybeShow, 1500)
  }
  maybeShow()
}
