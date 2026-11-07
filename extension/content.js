// 상품 페이지에 "내 사이즈 찾기" 버튼과 결과 카드를 띄웁니다.
// 페이지 데이터는 이 브라우저 안에서만 읽고, 어디로도 보내지 않아요. 네트워크 호출이 없습니다.
import { isProductPage, REVIEW_SELECTOR, readReviewTotal, readReviewCardEls } from '../src/lib/pageParser.js'
import { analyzePage, manualChartRows } from '../src/lib/extAnalyze.js'
import { collectDiagnostics, formatReport } from '../src/lib/diagnose.js'
import { shouldStop, isSafeMoreButton, toReportStop, STOP_LABEL } from '../src/lib/reviewLoader.js'
import { EXT_PROFILE_KEY, isUsableProfile } from '../src/lib/extProfile.js'

const WAIT_MS = 4000 // 늦게 그려지는 표·리뷰를 기다리는 최대 시간
const RETRY_DELAYS = [1500, 2500] // 못 찾았을 때 다시 읽기 전 기다림. 전체 대기는 약 8초 이내
const EXT_VERSION = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.().version) || ''
const QUIET_MS = 500 // 이 시간 동안 화면 변화가 없으면 다 그려졌다고 봅니다
const STEP_QUIET_MS = 600 // 리뷰 더 불러오기 한 단계 뒤 화면이 잠잠해질 때까지 기다리는 시간
const STEP_WAIT_MS = 2500 // 한 단계에서 기다리는 최대 시간
const REVIEW_BOX = '[class*="review" i],[id*="review" i],[data-testid*="review" i]' // 리뷰 영역으로 보는 조상

const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif}
.wrap{position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:8px;color:#111}
.fab{border:0;border-radius:999px;background:#111;color:#fff;padding:12px 18px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25)}
.fab:disabled{opacity:.6;cursor:default}
.card{width:320px;max-width:calc(100vw - 32px);max-height:min(80vh,560px);overflow-y:auto;background:#fff;border:1px solid #d4d4d4;border-radius:12px;padding:12px 14px;box-shadow:0 8px 28px rgba(0,0,0,.2);font-size:13px;line-height:1.5}
.card.min .fold{display:none}
.hd{position:sticky;top:-12px;background:#fff;z-index:1;padding-bottom:2px}
.hd .close{margin-left:6px}
.tiny{margin:2px 0 0;font-size:11px;color:#8a8a8e}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.eyebrow{font-size:11px;color:#8a8a8e}
.close{border:0;background:none;font-size:18px;line-height:1;cursor:pointer;color:#555}
.badge{font-size:12px;font-weight:600}
.size{font-size:28px;font-weight:700;margin:2px 0 0}
.sum{margin:8px 0 0;color:#555;font-size:12px}
.why{margin:6px 0 0;padding-left:16px;color:#555;font-size:12px}
h3{margin:10px 0 2px;font-size:14px}
p{margin:0}
.det{margin:8px 0 0;padding-left:16px;color:#555;font-size:11px}
.btn{margin-top:8px;border:1px solid #111;border-radius:8px;background:#fff;color:#111;padding:6px 10px;font-size:12px;cursor:pointer}
.ok{margin-top:6px;font-size:12px;color:#0a7a3c}
.inp{width:100%;margin-top:6px;border:1px solid #d4d4d4;border-radius:6px;padding:6px;font-size:12px;font-family:inherit}
.prog{margin-top:6px;font-size:12px;color:#555}
.note{margin-top:6px;font-size:11px;color:#8a8a8e}
.sec{margin-top:8px;border-top:1px solid #ececec;padding-top:6px}
.sec>summary{cursor:pointer;font-size:12px;font-weight:600;color:#111}
.secbody{margin-top:6px}
.tw{overflow-x:auto;margin-top:6px}
table{border-collapse:collapse;font-size:11px;width:100%}
th,td{border:1px solid #e3e3e3;padding:3px 5px;text-align:center;white-space:nowrap}
th{background:#f6f6f6;font-weight:600}
th.dim,td.dim{color:#a0a0a5}
tr.rec th,tr.rec td{background:#111;color:#fff}
.cv{display:block;font-size:10px;color:#0a7a3c}
tr.rec .cv{color:#9fe0ba}
.flag{margin-top:6px;font-size:11px;color:#8a5a00}
.rvl{list-style:none;margin:6px 0 0;padding:0}
.rv{border:1px solid #ececec;border-radius:8px;padding:6px 8px;margin-top:6px}
.rvm{display:flex;flex-wrap:wrap;gap:4px}
.tag{font-size:10px;border-radius:999px;background:#f1f1f1;padding:1px 7px;color:#333}
.tag.miss{background:#fff;border:1px dashed #c8c8c8;color:#8a8a8e}
.tag.sim{background:#111;color:#fff}
.rvt{margin-top:4px;font-size:12px;color:#222;white-space:pre-wrap;word-break:break-word}
.lnk{border:0;background:none;padding:0;margin-left:4px;font-size:11px;color:#555;text-decoration:underline;cursor:pointer}
`

let host = null
let shadow = null
let panel = null
let fab = null
let busy = false
let loader = null // 리뷰 더 불러오기 진행 상태 { aborted }

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
  const head = el('div', 'row hd')
  head.append(el('span', 'eyebrow', '핏체크 · 내 체형 추천'))
  const ctl = el('span')
  const mini = el('button', 'close', '−')
  mini.type = 'button'
  mini.setAttribute('aria-label', '접기')
  mini.addEventListener('click', () => {
    const on = !card.classList.contains('min')
    card.classList.toggle('min', on)
    mini.textContent = on ? '+' : '−'
    mini.setAttribute('aria-label', on ? '펼치기' : '접기')
  })
  const close = el('button', 'close', '×')
  close.type = 'button'
  close.setAttribute('aria-label', '닫기')
  close.addEventListener('click', () => panel.replaceChildren())
  ctl.append(mini, close)
  head.append(ctl)
  card.append(head)
  build(card)
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
  box.append(el('p', 'tiny', '주소 경로(상품명이 있으면 포함)·개수·화면 구조 기호만 담겨요. 체형 정보와 리뷰 글은 없어요.'))
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
    box.append(cols, lines, go, msg, el('p', 'tiny', '저장·전송하지 않고 이번 분석에만 써요.'))
  })
  box.append(open)
  box.openForm = () => open.click()
  return box
}

// ---------- 접을 수 있는 구역 / 읽은 그대로 보여주기 (페이지 글은 전부 textContent로만 넣어요) ----------
function section(title, open = false) {
  const det = el('details', 'sec')
  det.open = open
  det.append(el('summary', null, title))
  const body = el('div', 'secbody')
  det.append(body)
  return { det, body }
}

const NAMES_FROM_NOTE = {
  'other-table': '사이즈 이름은 다른 표에서 가져왔어요.',
  options: '표에 사이즈 이름이 없어 구매 옵션 순서대로 이름을 붙였어요. 맞는지 확인해 주세요.',
}

// 읽어낸 사이즈표를 행=사이즈, 열=실측 항목으로 그대로 보여줍니다. 계산에 쓴 값이 원문과 다르면(단면→둘레) 따로 표시해요.
function chartTable(v) {
  const box = el('div')
  if (v.manual) box.append(el('p', 'flag', '직접 입력한 표예요. 페이지에서 읽은 값이 아니에요.'))
  if (v.flipped) box.append(el('p', 'flag', '뒤집어 읽음: 원본은 가로가 사이즈, 세로가 실측 항목이었어요.'))
  if (NAMES_FROM_NOTE[v.namesFrom]) box.append(el('p', 'flag', NAMES_FROM_NOTE[v.namesFrom]))
  const table = el('table')
  const head = el('tr')
  head.append(el('th', null, '사이즈'))
  v.headers.forEach((h, i) => {
    const th = el('th', v.used[i] ? null : 'dim', h)
    if (!v.used[i]) th.setAttribute('title', '계산에 쓰지 않은 열')
    head.append(th)
  })
  table.append(head)
  let converted = false
  for (const row of v.rows) {
    const tr = el('tr', row.label === v.recommended ? 'rec' : null)
    tr.append(el('th', null, row.label === v.recommended ? `${row.shown} (추천)` : row.shown))
    row.cells.forEach((c, i) => {
      const td = el('td', v.used[i] ? null : 'dim')
      td.append(el('span', null, c.raw))
      if (c.converted) {
        converted = true
        td.append(el('span', 'cv', `→ ${c.value}`))
      }
      tr.append(td)
    })
    table.append(tr)
  }
  const wrap = el('div', 'tw')
  wrap.append(table)
  box.append(wrap)
  const legend = []
  if (converted) legend.push('→ 단면 값을 둘레(×2)로 바꿔 계산한 값')
  if (v.used.some((u) => !u)) legend.push('흐린 열은 계산에 쓰지 않았어요')
  if (legend.length) box.append(el('p', 'note', legend.join(' · ')))
  return box
}

const REVIEW_PREVIEW = 120

function reviewItem(rv) {
  const li = el('li', 'rv')
  const meta = el('div', 'rvm')
  const tag = (label, value, text) => meta.append(el('span', value == null ? 'tag miss' : 'tag', value == null ? `${label} 못 읽음` : `${label} ${text}`))
  if (rv.similarity != null) meta.append(el('span', 'tag sim', `체형 유사도 ${rv.similarity}`))
  tag('키', rv.height, `${rv.height}cm`)
  tag('몸무게', rv.weight, `${rv.weight}kg`)
  tag('구매 사이즈', rv.size, rv.size)
  tag('핏 평가', rv.fitLabel, rv.fitLabel)
  li.append(meta)
  const full = rv.text
  const p = el('p', 'rvt', full.length > REVIEW_PREVIEW ? `${full.slice(0, REVIEW_PREVIEW)}…` : full)
  li.append(p)
  if (full.length > REVIEW_PREVIEW) {
    const more = el('button', 'lnk', '더보기')
    more.type = 'button'
    let openText = false
    more.addEventListener('click', () => {
      openText = !openText
      p.textContent = openText ? full : `${full.slice(0, REVIEW_PREVIEW)}…`
      more.textContent = openText ? '접기' : '더보기'
    })
    li.append(more)
  }
  return li
}

function reviewList(list) {
  const ul = el('ul', 'rvl')
  for (const rv of list) ul.append(reviewItem(rv))
  return ul
}

// 추천 근거가 된 리뷰를 페이지에서 읽은 그대로. 비슷한 체형 리뷰를 먼저, 나머지는 접어 둡니다. 저장·전송하지 않아요.
function reviewsBlock(rvs) {
  const box = el('div')
  if (rvs.matched.length) box.append(reviewList(rvs.matched))
  else box.append(el('p', 'note', '비슷한 체형(키·몸무게를 읽은) 리뷰가 없어요.'))
  if (rvs.matchedTotal > rvs.matched.length) box.append(el('p', 'note', `비슷한 체형 ${rvs.matchedTotal - rvs.matched.length}건은 표시하지 않았어요.`))
  if (rvs.others.length) {
    const rest = section(`나머지 리뷰 ${rvs.othersTotal}건 (체형 정보가 없거나 다른 리뷰)`)
    let built = false
    rest.det.addEventListener('toggle', () => {
      if (built || !rest.det.open) return
      built = true
      rest.body.append(reviewList(rvs.others))
      if (rvs.othersTotal > rvs.others.length) rest.body.append(el('p', 'note', `${rvs.othersTotal - rvs.others.length}건은 표시하지 않았어요.`))
    })
    box.append(rest.det)
  }
  return box
}

// 리뷰 요소 개수 (스크롤 대상을 찾는 데만 씁니다)
function reviewElements() {
  const cards = readReviewCardEls(document)
  return cards.length > 0 ? cards : Array.from(document.querySelectorAll(REVIEW_SELECTOR))
}

// 리뷰 영역 안의 '더보기' 버튼 중 허용 목록에 맞는 것 하나만 찾습니다.
function findMoreButton() {
  const cands = document.querySelectorAll('button, [role="button"]')
  for (const b of cands) {
    if (b.disabled || b.getAttribute('aria-disabled') === 'true') continue
    if (isSafeMoreButton(b.textContent, { inReviewContainer: !!b.closest(REVIEW_BOX) })) return b
  }
  return null
}

function quietWait(quietMs, maxMs, state) {
  return new Promise((resolve) => {
    let quiet = setTimeout(done, quietMs)
    const limit = setTimeout(done, maxMs)
    const mo = new MutationObserver(() => {
      clearTimeout(quiet)
      quiet = setTimeout(done, quietMs)
    })
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true })
    if (state) state.wake = done // 중단하면 기다리던 것을 바로 끝냅니다
    function done() {
      if (state) state.wake = null
      mo.disconnect()
      clearTimeout(quiet)
      clearTimeout(limit)
      resolve()
    }
  })
}

// 사용자가 누를 때만 실행: 마지막 리뷰 쪽으로 스크롤하고, 허용된 '더보기'를 단계마다 최대 한 번 누릅니다.
// 한도(횟수·시간·정체)나 중단 버튼으로 멈추고, 끝나면 항상 원래 스크롤 위치로 돌아옵니다.
async function loadMoreReviews(onProgress) {
  const { scrollX, scrollY } = window
  const state = { aborted: false, wake: null }
  loader = state
  const startedAt = Date.now()
  let steps = 0
  let stalls = 0
  let count = reviewElements().length
  let reason = null
  const total = readReviewTotal(document) // 못 찾으면 null
  try {
    while (!(reason = shouldStop({ steps, elapsedMs: Date.now() - startedAt, stalls, aborted: state.aborted, count, total }))) {
      const list = reviewElements()
      const target = list[list.length - 1]
      if (target) target.scrollIntoView({ block: 'center' })
      const btn = findMoreButton()
      if (btn) btn.click()
      await quietWait(STEP_QUIET_MS, STEP_WAIT_MS, state)
      steps += 1
      const next = reviewElements().length
      stalls = next > count ? 0 : stalls + 1
      count = next
      onProgress(count)
    }
  } finally {
    window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' }) // smooth 스크롤 설정을 무시
    loader = null
  }
  return reason
}

function loadMoreBlock(r) {
  const box = el('div')
  const btn = el('button', 'btn', '리뷰 더 불러오기')
  btn.type = 'button'
  const stop = el('button', 'btn', '중단')
  stop.type = 'button'
  stop.hidden = true
  const prog = el('p', 'prog')
  prog.setAttribute('role', 'status')
  stop.addEventListener('click', () => {
    if (loader) {
      loader.aborted = true
      if (loader.wake) loader.wake()
    }
  })
  btn.addEventListener('click', async () => {
    if (busy) return
    busy = true
    btn.disabled = true
    stop.hidden = false
    fab.disabled = true
    prog.textContent = '불러온 리뷰 0건'
    let reason = 'aborted'
    try {
      reason = await loadMoreReviews((n) => {
        prog.textContent = `불러온 리뷰 ${n}건`
      })
      const profile = await readProfile()
      if (!isUsableProfile(profile)) throw new Error('no-profile')
      const next = analyzePage(document, location.href, profile, EXT_VERSION)
      const scroll = { before: r.reviewsLoaded ?? 0, after: next.reviewsLoaded ?? 0, stop: toReportStop(reason) }
      if (next.status === 'ok') {
        next.diagnostics = collectDiagnostics(document, location.href, EXT_VERSION, { scroll })
        next.loadInfo = `리뷰 ${scroll.before}건에서 ${scroll.after}건으로 늘렸어요. ${STOP_LABEL[reason]}.`
      }
      busy = false
      renderResult(next)
    } catch {
      busy = false
      prog.textContent = '리뷰를 더 불러오다 문제가 생겼어요. 다시 눌러 주세요.'
      btn.disabled = false
      stop.hidden = true
    } finally {
      busy = false
      fab.disabled = false
    }
  })
  btn.setAttribute('title', '누를 때만 동작해요. 리뷰 영역을 스크롤하며 리뷰의 더보기 버튼만 누르고, 최대 약 30초 뒤 멈춰요. 끝나면 원래 위치로 돌아와요.')
  box.append(btn, stop, prog)
  return box
}

function renderResult(r) {
  showCard((card) => {
    if (r.status !== 'ok') {
      card.append(el('p', null, r.message))
      if (r.details?.length) {
        const diag = section('진단 정보')
        const ul = el('ul', 'det')
        for (const t of r.details) ul.append(el('li', null, t))
        diag.body.append(ul)
        card.append(diag.det)
      }
      if (r.diagnostics) {
        card.append(manualForm(r))
        card.append(reportBlock(formatReport(r.diagnostics)))
      }
      return
    }
    // 기본으로 보이는 것: 추천 사이즈, 확신도, 근거 한 줄, 필수 고지 한 줄, 리뷰 더 불러오기. 나머지는 접어 둡니다.
    const conf = el('span', 'badge', r.confidenceLabel.text)
    conf.style.color = r.confidenceLabel.color
    const row = el('div', 'row')
    row.append(el('span', 'eyebrow', r.categoryLabel), conf)
    card.append(row)
    if (r.recommendedSize) card.append(el('div', 'size', r.recommendedLabel || r.recommendedSize))
    card.append(el('p', 'sum', r.manual ? `${r.summary} · 직접 입력한 사이즈표` : r.summary))
    card.append(el('p', 'tiny', '참고용이에요. 확신도는 정확도를 측정한 값이 아니에요.'))
    const fold = el('div', 'fold')
    fold.append(loadMoreBlock(r))
    if (r.loadInfo) fold.append(el('p', 'tiny', r.loadInfo))

    const why = section('추천 이유')
    if (r.reasons.length) {
      const ul = el('ul', 'why')
      for (const t of r.reasons) ul.append(el('li', null, t))
      why.body.append(ul)
    }
    why.body.append(el('h3', null, r.headline), el('p', null, r.body))
    fold.append(why.det)

    if (r.reviewViews) {
      const rv = section(`리뷰 원문 (비슷한 체형 ${r.reviewViews.matchedTotal}건 / 불러온 ${r.reviewsLoaded}건)`)
      rv.body.append(reviewsBlock(r.reviewViews))
      fold.append(rv.det)
    }
    const manual = manualForm(r)
    const ch = section(r.chartView ? '읽은 사이즈표 (페이지 그대로)' : '사이즈표 (읽지 못함)', !r.chartView)
    if (r.chartView) ch.body.append(chartTable(r.chartView), el('p', 'tiny', '읽은 표가 다르면 직접 입력으로 고칠 수 있어요.'))
    ch.body.append(manual)
    fold.append(ch.det)

    if (r.diagnostics) {
      const rep = section('문제가 있나요? 진단 리포트')
      rep.body.append(reportBlock(formatReport(r.diagnostics)))
      fold.append(rep.det)
    }
    card.append(fold)
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
  let stage = 'profile' // 오류가 난 단계 (고정 문자열만 리포트에 넣습니다)
  try {
    const profile = await readProfile()
    if (!isUsableProfile(profile)) {
      renderResult({ status: 'no-profile', message: '먼저 확장 프로그램 아이콘을 눌러 키·몸무게 등 체형 정보를 저장해주세요.' })
      return
    }
    stage = 'wait'
    await waitForRender()
    stage = 'analyze'
    // 사이즈표를 못 찾으면 짧게 기다렸다가 다시 읽어요. 클릭·스크롤은 하지 않고 화면 글만 읽습니다.
    let result = analyzePage(document, location.href, profile, EXT_VERSION)
    for (const delay of RETRY_DELAYS) {
      if (result.status !== 'no-data') break
      await new Promise((r) => setTimeout(r, delay))
      result = analyzePage(document, location.href, profile, EXT_VERSION)
    }
    stage = 'render'
    renderResult(result)
  } catch (err) {
    // 오류는 이름만 리포트에 넣습니다 (메시지에 페이지 글이 섞일 수 있어 제외).
    let diagnostics = null
    try {
      diagnostics = collectDiagnostics(document, location.href, EXT_VERSION)
      diagnostics.errorName = String(err?.name || 'Error')
      diagnostics.errorWhere = stage
      // 메시지 원문은 저장하지 않고, 'X is not defined' 의 식별자 이름만 검증 후 담습니다.
      const m = /^([A-Za-z_$][\w$]{0,40}) is not defined$/.exec(String(err?.message || ''))
      if (m) diagnostics.errorIdent = m[1]
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
