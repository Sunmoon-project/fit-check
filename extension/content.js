// 상품 페이지에 "내 사이즈 찾기" 버튼과 결과 카드를 띄웁니다.
// 페이지 데이터는 이 브라우저 안에서만 읽고, 어디로도 보내지 않아요. 네트워크 호출이 없습니다.
import { isProductPage } from '../src/lib/pageParser.js'
import { analyzePage, manualChartRows } from '../src/lib/extAnalyze.js'
import { collectDiagnostics, formatReport } from '../src/lib/diagnose.js'
import { EXT_PROFILE_KEY, isUsableProfile } from '../src/lib/extProfile.js'

const WAIT_MS = 4000 // 늦게 그려지는 표·리뷰를 기다리는 최대 시간
const RETRY_DELAYS = [1500, 2500] // 못 찾았을 때 다시 읽기 전 기다림. 전체 대기는 약 8초 이내
const EXT_VERSION = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.().version) || ''
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
.det{margin:8px 0 0;padding-left:16px;color:#555;font-size:11px}
.btn{margin-top:8px;border:1px solid #111;border-radius:8px;background:#fff;color:#111;padding:6px 10px;font-size:12px;cursor:pointer}
.ok{margin-top:6px;font-size:12px;color:#0a7a3c}
.inp{width:100%;margin-top:6px;border:1px solid #d4d4d4;border-radius:6px;padding:6px;font-size:12px;font-family:inherit}
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

// 진단 리포트 복사: 클립보드 API가 막히면 textarea + execCommand로 대신해요. 어디로도 전송하지 않습니다.
function copyText(text) {
  const fallback = () => {
    const ta = document.createElement('textarea')
    ta.value = text
    shadow.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => fallback())
  return Promise.resolve(fallback())
}

function reportBlock(report) {
  const box = el('div')
  const btn = el('button', 'btn', '진단 리포트 복사')
  btn.type = 'button'
  const done = el('p', 'ok')
  btn.addEventListener('click', async () => {
    done.textContent = (await copyText(report)) ? '복사했어요' : '복사하지 못했어요. 브라우저 권한을 확인해주세요.'
  })
  box.append(btn, done)
  box.append(el('p', 'note', '리포트에는 주소 경로(쿼리·해시 제외, 주소에 상품명이 있으면 같이 들어가요), 확장 버전, 찾은 개수, 화면 구조 모양(글자는 L/N/T 기호)만 들어 있어요. 키·몸무게 등 체형 정보, 리뷰 글, 페이지 본문은 들어 있지 않아요.'))
  return box
}

// 사이즈표를 직접 입력하는 작은 양식 (상의·하의, cm). 저장하지 않고 이번 분석에만 써요.
function manualForm(r) {
  const box = el('div')
  const open = el('button', 'btn', '사이즈표 직접 입력')
  open.type = 'button'
  open.addEventListener('click', () => {
    open.remove()
    const cols = el('input', 'inp')
    cols.placeholder = '열 순서 예: 어깨 가슴 총장'
    cols.setAttribute('aria-label', '열 순서')
    const lines = el('textarea', 'inp')
    lines.rows = 4
    lines.placeholder = '줄마다 사이즈와 숫자 예:\nM 50 57 68\nL 52 60 70'
    lines.setAttribute('aria-label', '사이즈별 실측 (cm)')
    const go = el('button', 'btn', '이 표로 다시 분석')
    go.type = 'button'
    const msg = el('p', 'ok')
    go.addEventListener('click', async () => {
      const extraRows = manualChartRows(cols.value, lines.value)
      if (!extraRows.length) {
        msg.textContent = '열 순서와 줄의 숫자 개수가 맞는지 확인해주세요.'
        return
      }
      try {
        const profile = await readProfile()
        if (!isUsableProfile(profile)) {
          msg.textContent = '먼저 확장 프로그램 아이콘을 눌러 체형 정보를 저장해주세요.'
          return
        }
        renderResult({ ...analyzePage(document, location.href, profile, EXT_VERSION, { extraRows }), manual: true })
      } catch {
        msg.textContent = '직접 입력한 표로 분석하지 못했어요. 입력 형식을 확인하고 다시 눌러주세요.'
      }
    })
    box.append(cols, lines, go, msg, el('p', 'note', '입력한 표는 저장하거나 전송하지 않고 이번 분석에만 써요.'))
  })
  box.append(open)
  return box
}

function renderResult(r) {
  showCard((card) => {
    if (r.status !== 'ok') {
      card.append(el('p', null, r.message))
      if (r.details?.length) {
        const ul = el('ul', 'det')
        for (const t of r.details) ul.append(el('li', null, t))
        card.append(ul)
      }
      if (r.diagnostics) {
        card.append(manualForm(r))
        card.append(reportBlock(formatReport(r.diagnostics)))
      }
      return
    }
    if (r.manual) card.append(el('p', 'note', '직접 입력한 사이즈표 값으로 계산한 결과예요. 페이지에서 읽은 값이 아니에요.'))
    const conf = el('span', 'badge', r.confidenceLabel.text)
    conf.style.color = r.confidenceLabel.color
    const row = el('div', 'row')
    row.append(el('span', 'eyebrow', r.categoryLabel), conf)
    card.append(row)
    if (r.recommendedSize) card.append(el('div', 'size', r.recommendedLabel || r.recommendedSize))
    card.append(el('p', 'sum', r.summary))
    if (r.reasons.length) {
      const ul = el('ul', 'why')
      for (const t of r.reasons) ul.append(el('li', null, t))
      card.append(ul)
    }
    card.append(el('h3', null, r.headline), el('p', null, r.body))
    card.append(el('p', 'note', '이 페이지에 불러와진 리뷰만 읽어요. 더 많은 리뷰를 반영하려면 리뷰 영역을 직접 스크롤해 불러온 뒤 버튼을 다시 눌러 주세요(자동으로 스크롤하지 않아요).'))
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
    // 사이즈표를 못 찾으면 짧게 기다렸다가 다시 읽어요. 클릭·스크롤은 하지 않고 화면 글만 읽습니다.
    let result = analyzePage(document, location.href, profile, EXT_VERSION)
    for (const delay of RETRY_DELAYS) {
      if (result.status !== 'no-data') break
      await new Promise((r) => setTimeout(r, delay))
      result = analyzePage(document, location.href, profile, EXT_VERSION)
    }
    renderResult(result)
  } catch (err) {
    // 오류는 이름만 리포트에 넣습니다 (메시지에 페이지 글이 섞일 수 있어 제외).
    let diagnostics = null
    try {
      diagnostics = collectDiagnostics(document, location.href, EXT_VERSION)
      diagnostics.errorName = String(err?.name || 'Error')
    } catch {
      diagnostics = null
    }
    renderResult({ status: 'error', message: '분석 중 문제가 생겼어요. 페이지를 새로고침한 뒤 다시 눌러주세요.', diagnostics })
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
