// 상품 페이지에 "내 사이즈 찾기" 버튼과 결과 카드를 띄웁니다.
// 페이지 데이터는 이 브라우저 안에서만 읽고, 어디로도 보내지 않아요. 네트워크 호출이 없습니다.
import { isProductPage, REVIEW_SELECTOR, readReviewTotal, readReviewCardEls } from '../src/lib/pageParser.js'
import { analyzePage, manualChartRows } from '../src/lib/extAnalyze.js'
import { buildExportEnvelope } from '../src/lib/wardrobeImport.js'
import { SYNC_QUEUE_KEY, WEB_APP_OPEN_URL, enqueue } from '../src/lib/wardrobeSync.js'
import { collectDiagnostics, formatReport } from '../src/lib/diagnose.js'
import { shouldStop, isSafeMoreButton, toReportStop, STOP_LABEL } from '../src/lib/reviewLoader.js'
import { compareBody, countUpValue, similarityTier, TIER_LABEL, diffText, buySizeText } from '../src/lib/similarityBreakdown.js'
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
*{box-sizing:border-box;font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',-apple-system,BlinkMacSystemFont,sans-serif}
.wrap{position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:8px;color:#111}
.fab{border:0;border-radius:999px;background:#111;color:#fff;padding:12px 18px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25)}
.fab:disabled{opacity:.6;cursor:default}
.card{width:320px;max-width:calc(100vw - 32px);max-height:min(80vh,560px);overflow-y:auto;background:#fff;border:1px solid #d4d4d4;border-radius:12px;padding:12px 14px;box-shadow:0 8px 28px rgba(0,0,0,.2);font-size:13px;line-height:1.5}
.card.min .fold{display:none}
.hd{position:sticky;top:-12px;background:#fff;z-index:1;padding-bottom:2px}
.hd .close{margin-left:6px}
.tiny{margin:2px 0 0;font-size:11px;color:#6b6b70}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.eyebrow{font-size:11px;color:#6b6b70}
.close{border:0;background:none;font-size:18px;line-height:1;cursor:pointer;color:#555}
.badge{font-size:12px;font-weight:600}
.size{font-size:28px;font-weight:700;margin:2px 0 0}
.sum{margin:8px 0 0;color:#555;font-size:12px}
.why{margin:6px 0 0;padding-left:16px;color:#555;font-size:12px}
h3{margin:10px 0 2px;font-size:14px}
p{margin:0}
.det{margin:8px 0 0;padding-left:16px;color:#555;font-size:11px}
.btns{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px}
.btns:empty{display:none}
.btns>.btn{margin-top:0}
.btns>.weblink{margin:0}
.btns>.inp{margin-top:0;flex:1 1 100%}
.btn{margin-top:8px;border:1px solid #111;border-radius:8px;background:#fff;color:#111;padding:6px 10px;font-size:12px;cursor:pointer}
.ok{margin-top:6px;font-size:12px;color:#0a7a3c}
.weblink{display:inline-block;margin-top:6px;margin-right:8px;font-size:12px;color:#111}
.inp{width:100%;margin-top:6px;border:1px solid #d4d4d4;border-radius:6px;padding:6px;font-size:12px;font-family:inherit}
.prog{margin-top:6px;font-size:12px;color:#555}
.note{margin-top:6px;font-size:11px;color:#6b6b70}
.sec{margin-top:8px;border-top:1px solid #ececec;padding-top:6px}
.sec>summary{cursor:pointer;font-size:13px;font-weight:700;color:var(--tc,#111);padding:4px 0 4px 8px;border-left:4px solid var(--tc,#d4d4d4)}
.sec.s-why{--tc:#0a7a3c}
.sec.s-rv{--tc:#6a42a8}
.sec.s-ch{--tc:#4a5a6a}
.sec.s-dx{--tc:#a35a00}
.secbody{margin-top:6px}
.tw{overflow-x:auto;margin-top:6px}
table{border-collapse:collapse;font-size:11px;width:100%}
th,td{border:1px solid #e3e3e3;padding:3px 5px;text-align:center;white-space:nowrap}
th{background:#f6f6f6;font-weight:600}
th.dim,td.dim{color:#a0a0a5}
.tabs{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.tab{border:1px solid #d4d4d4;border-radius:999px;background:#fff;color:#111;padding:2px 9px;font-size:11px;cursor:pointer}
.tab.on{background:#111;color:#fff;border-color:#111}
.bar{display:inline-flex;gap:1px;vertical-align:middle;margin-left:4px}
.bar i{display:inline-block;width:6px;height:6px;background:#e3e3e3}
.bar i.on{background:#4a5a6a}
td.mo{color:#6b6b70;font-size:10px;white-space:normal}
tr.rec th,tr.rec td{background:#111;color:#fff}
.cv{display:block;font-size:10px;color:#0a7a3c}
tr.rec .cv{color:#9fe0ba}
.flag{margin-top:6px;font-size:11px;color:#8a5a00}
.rvl{list-style:none;margin:6px 0 0;padding:0}
.rv{border:1px solid #ececec;border-radius:8px;padding:6px 8px;margin-top:6px}
.rvm{display:flex;flex-wrap:wrap;gap:4px}
.tag{font-size:10px;border-radius:999px;background:#f1f1f1;padding:1px 7px;color:#333}
.tag.miss{background:#fff;border:1px dashed #c8c8c8;color:#6b6b70}
.tag.sim{background:#111;color:#fff}
.rvh{margin-bottom:4px}
.rvn{font-size:12px;color:#111}
.rvp{font-size:11px;color:#555;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.rvt{margin-top:4px;font-size:12px;color:#222;word-break:break-word}
.sent{margin:3px 0 0;padding:2px 0 2px 8px;border-left:2px solid #d4d4d4;white-space:pre-wrap}
.phs{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.ph{width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid #ececec}
.rtabs{display:flex;gap:4px;border-bottom:1px solid #ececec;margin-top:2px}
.rtab{border:0;border-bottom:2px solid transparent;background:none;padding:6px 8px;font-size:12px;color:#6b6b70;cursor:pointer}
.rtab.on{color:#111;border-bottom-color:#111;font-weight:600}
.rtab:focus-visible{outline:2px solid #111;outline-offset:1px}
.tp{max-height:320px;overflow-y:auto;overscroll-behavior:contain;padding-top:2px}
.gal{display:flex;flex-direction:column;gap:10px;margin-top:6px}
.pf{margin:0;display:flex;flex-direction:column;gap:4px}
.ph.big{width:100%;height:auto;max-height:280px;object-fit:contain;background:#f6f6f6}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.mecard{display:flex;align-items:baseline;gap:10px;background:#f4f4f5;border-radius:10px;padding:10px 12px;margin-top:2px}
.mel{font-size:11px;color:#6b6b70}
.mev{display:flex;gap:12px;flex:1}
.men{font-size:22px;font-weight:700;color:#111}
.meu{font-size:12px;color:#555;margin-left:2px}
.meg{font-size:12px;color:#555}
.cmp{list-style:none;margin:6px 0 0;padding:0}
.cr{padding:8px 0;border-top:1px solid #ececec}
.cr:first-child{border-top:0}
.crh{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.cpct{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
.cgrp{display:flex;gap:6px;margin-top:6px}
.ccol{flex:1;display:flex;flex-direction:column;gap:2px;background:#f6f6f7;border-radius:8px;padding:6px 8px}
.ccl{font-size:11px;color:#6b6b70;font-weight:600}
.ccv{font-size:13px;font-weight:700;color:#111}
.cbuy{font-size:12px;font-weight:600;color:#444;overflow-wrap:anywhere}
.cdiff{margin:4px 0 0;font-size:11px;color:#6b6b70}
.ctier{font-size:12px;font-weight:700}
.cb.high .ctier,.cb.high .cpct{color:#0a7a3c}
.cb.mid .ctier,.cb.mid .cpct{color:#a35a00}
.cb.low .ctier,.cb.low .cpct{color:#6b6b70}
.cb.high .cbf{background:#0a7a3c}
.cb.mid .cbf{background:#b8650a}
.cb.low .cbf{background:#80808a}
.cb{margin-top:8px}
.cbl{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:#555}
.cbt{height:8px;background:#f0f0f0;border-radius:4px;overflow:hidden;margin-top:3px}
.cbf{height:100%;background:#111;border-radius:2px;transition:width .8s ease-out}
.cg{display:inline-block;font-size:11px;border:1px solid #d4d4d4;border-radius:999px;padding:0 8px;color:#111}
.cg.diff{border-style:dashed;color:#6b6b70}
.ss{margin-top:8px;border-left:4px solid #4a5a6a;padding:2px 0 2px 8px}
.ss .sst{font-size:13px;font-weight:700;color:#4a5a6a}
.ssc{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.ssc span{font-size:11px;border:1px solid #d4d4d4;border-radius:999px;padding:0 8px;color:#111}
.ssc span.on{background:#4a5a6a;border-color:#4a5a6a;color:#fff;font-weight:700}
.ss p{margin-top:3px;font-size:12px;color:#333}
.ss p.tiny{font-size:11px;color:#6b6b70}
.lnk{border:0;background:none;padding:0;margin-left:4px;font-size:11px;color:#555;text-decoration:underline;cursor:pointer}
@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}
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
  cancelAnim()
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
  close.addEventListener('click', () => {
    cancelAnim()
    panel.replaceChildren()
  })
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
  const btns = el('div', 'btns')
  btns.append(btn)
  box.append(btns, done)
  box.append(el('p', 'tiny', '주소 경로(상품명이 있으면 포함)·개수·화면 구조 기호만 담겨요. 체형 정보와 리뷰 글은 없어요.'))
  return box
}

// 사이즈표를 직접 입력하는 작은 양식 (상의·하의, cm). 저장하지 않고 이번 분석에만 써요.
function manualForm(r) {
  const box = el('div')
  const open = el('button', 'btn', '사이즈표 직접 입력')
  open.type = 'button'
  let opened = false
  open.addEventListener('click', () => {
    if (opened) return
    opened = true
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
    const goRow = el('div', 'btns')
    goRow.append(go)
    box.append(cols, lines, goRow, msg, el('p', 'tiny', '저장·전송하지 않고 이번 분석에만 써요.'))
  })
  const openRow = el('div', 'btns')
  openRow.append(open)
  box.append(openRow)
  box.openForm = () => open.click()
  return box
}

// ---------- 접을 수 있는 구역 / 읽은 그대로 보여주기 (페이지 글은 전부 textContent로만 넣어요) ----------
// 섹션마다 색을 달리해 무엇에 대한 내용인지 구분해요 (추천 이유 초록 / 리뷰 보라 / 사이즈표 청회색 / 문제 해결 주황).
const SECTION_TONE = [[/추천 이유/, 's-why'], [/리뷰/, 's-rv'], [/사이즈표/, 's-ch'], [/진단|문제/, 's-dx']]
function section(title, open = false) {
  const tone = (SECTION_TONE.find(([re]) => re.test(title)) || [])[1]
  const det = el('details', tone ? `sec ${tone}` : 'sec')
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
  if (v.ignored?.length) legend.push('추천 키·몸무게 표는 계산에 쓰지 않았어요')
  if (legend.length) box.append(el('p', 'note', legend.join(' · ')))
  return box
}

// 사이즈 탭 + 부위별 비교 표: 내 치수 / 옷 실측 / 여유 / 판정. 비교 기준이 없는 부위는 '실측만 표시'로 구분해요. 모든 글은 textContent로만 넣습니다.
function compareBlock(cv) {
  const box = el('div')
  const tabs = el('div', 'tabs')
  const panels = []
  const buttons = []
  const fmt = (n, u) => (n == null ? '-' : `${n}${u}`)
  cv.sizes.forEach((s, idx) => {
    const isRec = s.size === cv.recommended
    const btn = el('button', 'tab', isRec ? `${s.label} (추천)` : s.label)
    const panel = el('div', 'tw')
    const table = el('table')
    const head = el('tr')
    for (const h of ['부위', '내 치수', '옷 실측', '여유', '판정']) head.append(el('th', null, h))
    table.append(head)
    for (const r of s.rows) {
      const tr = el('tr')
      tr.append(el('th', null, r.label))
      if (r.verdict == null) {
        tr.append(el('td', null, r.body == null ? '-' : fmt(r.body, r.unit)), el('td', null, fmt(r.garment, r.unit)), el('td', null, '-'))
        tr.append(el('td', 'mo', r.note))
      } else {
        const kind = r.bodyKind === 'measured' ? '' : r.bodyKind === 'standard' ? ' (표준)' : ' (추정)'
        tr.append(el('td', null, `${fmt(r.body, r.unit)}${kind}`), el('td', null, fmt(r.garment, r.unit)), el('td', null, `${r.ease > 0 ? '+' : ''}${r.ease}${r.unit}`))
        const td = el('td', null, r.note ? `${r.verdict} (${r.note})` : r.verdict)
        const bar = el('span', 'bar')
        for (let i = 0; i < 5; i++) bar.append(el('i', i === r.level ? 'on' : null))
        td.append(bar)
        tr.append(td)
      }
      table.append(tr)
    }
    panel.append(table)
    panel.hidden = idx !== 0
    btn.className = idx === 0 ? 'tab on' : 'tab'
    btn.addEventListener('click', () => {
      panels.forEach((p, i) => { p.hidden = i !== idx })
      buttons.forEach((b, i) => { b.className = i === idx ? 'tab on' : 'tab' })
    })
    panels.push(panel)
    buttons.push(btn)
    tabs.append(btn)
  })
  box.append(tabs, ...panels)
  box.append(el('p', 'note', '둘레는 단면×2, (추정)은 키·몸무게로 계산한 값이에요. 총장은 키로 계산한 표준 기장과 비교하고, 소매·발길이·총장 기준은 휴리스틱이에요. 막대는 왼쪽부터 작을 수 있음 · 타이트 · 적당 · 넉넉 · 매우 넉넉이에요.'))
  return box
}

const REVIEW_PREVIEW = 120
const SENT_PREVIEW = 3

// 리뷰 한 건: 닉네임·상품명 / 태그 / 문장별 본문 / 사진. 모두 textContent와 createElement로만 만들고 저장·전송하지 않아요.
function reviewItem(rv) {
  const li = el('li', 'rv')
  if (rv.nick || rv.productName) {
    const head = el('div', 'rvh')
    if (rv.nick) head.append(el('b', 'rvn', rv.nick))
    if (rv.productName) head.append(el('div', 'rvp', `상품명 ${rv.productName}`))
    li.append(head)
  }
  const meta = el('div', 'rvm')
  const tag = (label, value, text) => meta.append(el('span', value == null ? 'tag miss' : 'tag', value == null ? `${label} 못 읽음` : `${label} ${text}`))
  if (rv.similarity != null) meta.append(el('span', 'tag sim', `체형 유사도 ${rv.similarity}`))
  meta.append(el('span', rv.gender ? 'tag' : 'tag miss', rv.gender === 'male' ? '남성' : rv.gender === 'female' ? '여성' : '성별 못 읽음'))
  tag('키', rv.height, `${rv.height}cm`)
  tag('몸무게', rv.weight, `${rv.weight}kg`)
  tag('구매 사이즈', rv.size, rv.size)
  tag('핏 평가', rv.fitLabel, rv.fitLabel)
  li.append(meta)

  const sentences = Array.isArray(rv.sentences) && rv.sentences.length ? rv.sentences : null
  const body = el('div', 'rvt')
  li.append(body)
  const full = rv.text
  if (!full && !sentences) body.hidden = true
  const long = sentences ? sentences.length > SENT_PREVIEW : full.length > REVIEW_PREVIEW
  let open = false
  const paint = () => {
    body.replaceChildren()
    if (sentences) {
      for (const s of open ? sentences : sentences.slice(0, SENT_PREVIEW)) body.append(el('p', 'sent', s))
      if (open && rv.sentencesCut) body.append(el('p', 'sent', '… 긴 리뷰라 앞부분만 보여요'))
    } else if (full) {
      body.append(el('p', 'sent', open || full.length <= REVIEW_PREVIEW ? full : `${full.slice(0, REVIEW_PREVIEW)}…`))
    }
  }
  paint()
  if (long) {
    const more = el('button', 'lnk', '더보기')
    more.type = 'button'
    more.addEventListener('click', () => {
      open = !open
      paint()
      more.textContent = open ? '접기' : '더보기'
    })
    li.append(more)
  }

  const urls = (rv.photos || []).filter((u) => /^https?:\/\//i.test(u))
  if (urls.length) {
    const row = el('div', 'phs')
    for (const url of urls) {
      const img = document.createElement('img')
      img.className = 'ph'
      img.src = url
      img.alt = '리뷰 사진'
      img.loading = 'lazy'
      img.referrerPolicy = 'no-referrer'
      img.decoding = 'async'
      row.append(img)
    }
    li.append(row)
  }
  return li
}

function reviewList(list) {
  const ul = el('ul', 'rvl')
  for (const rv of list) ul.append(reviewItem(rv))
  return ul
}

// 사진 모아보기: 리뷰 사진을 큰 크기로 세로로 이어서 봅니다 (https 주소만).
function photoGallery(list) {
  const box = el('div', 'gal')
  let count = 0
  for (const rv of list) {
    const urls = (rv.photos || []).filter((u) => /^https:\/\//i.test(u)).slice(0, 5)
    if (!urls.length) continue
    const fig = el('figure', 'pf')
    for (const url of urls) {
      const img = document.createElement('img')
      img.className = 'ph big'
      img.src = url
      img.alt = '리뷰 사진'
      img.loading = 'lazy'
      img.referrerPolicy = 'no-referrer'
      img.decoding = 'async'
      fig.append(img)
      count += 1
    }
    const cap = [rv.nick || '구매자', rv.height != null && rv.weight != null ? `${rv.height}cm ${rv.weight}kg` : null, rv.size].filter(Boolean).join(' · ')
    fig.append(el('figcaption', 'tiny', cap))
    box.append(fig)
  }
  if (!count) box.append(el('p', 'note', '불러온 리뷰에 사진이 없어요.'))
  return box
}

// 추천 근거가 된 리뷰를 페이지에서 읽은 그대로, 탭 네 개(비슷한 체형 / 전체 리뷰 / 사진 모아보기 / 체형 비교)로 보여줘요.
// 각 탭은 처음 열 때 그리고, 세로로 스크롤돼요. 저장·전송하지 않아요.
function reviewsBlock(rvs) {
  const box = el('div')
  const all = [...rvs.matched, ...rvs.others]
  const tabs = [
    {
      label: '비슷한 체형',
      build() {
        const d = el('div')
        if (rvs.matched.length) d.append(reviewList(rvs.matched))
        else d.append(el('p', 'note', '비슷한 체형(키·몸무게를 읽은) 리뷰가 없어요.'))
        if (rvs.matchedTotal > rvs.matched.length) d.append(el('p', 'note', `비슷한 체형 ${rvs.matchedTotal - rvs.matched.length}건은 표시하지 않았어요.`))
        return d
      },
    },
    {
      label: '전체 리뷰',
      build() {
        const d = el('div')
        if (all.length) d.append(reviewList(all))
        else d.append(el('p', 'note', '불러온 리뷰가 없어요.'))
        const hidden = rvs.matchedTotal + rvs.othersTotal - all.length
        if (hidden > 0) d.append(el('p', 'note', `${hidden}건은 표시하지 않았어요.`))
        return d
      },
    },
    { label: '사진 모아보기', build: () => photoGallery(all) },
    { label: '체형 비교', compare: true },
  ]
  const list = el('div', 'rtabs')
  list.setAttribute('role', 'tablist')
  list.setAttribute('aria-label', '리뷰 보기')
  const panel = el('div', 'tp')
  panel.setAttribute('role', 'tabpanel')
  panel.id = 'fc-tabpanel'
  panel.tabIndex = 0
  const btns = []
  const built = []
  const select = (i, focus) => {
    btns.forEach((b, j) => {
      b.setAttribute('aria-selected', j === i ? 'true' : 'false')
      b.setAttribute('aria-controls', 'fc-tabpanel')
      b.id = `fc-tab-${j}`
      b.tabIndex = j === i ? 0 : -1
      b.className = j === i ? 'rtab on' : 'rtab'
    })
    cancelAnim()
    panel.setAttribute('aria-labelledby', `fc-tab-${i}`)
    if (!built[i]) built[i] = tabs[i].compare ? compareTab(rvs, all) : { node: tabs[i].build() }
    panel.replaceChildren(built[i].node)
    if (built[i].play) built[i].play()
    if (focus && btns[i].focus) btns[i].focus()
  }
  tabs.forEach((t, i) => {
    const b = el('button', 'rtab', t.label)
    b.type = 'button'
    b.setAttribute('role', 'tab')
    b.addEventListener('click', () => select(i, false))
    b.addEventListener('keydown', (e) => {
      const n = tabs.length
      const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }[e.key]
      if (next == null) return
      if (e.preventDefault) e.preventDefault()
      select(next, true)
    })
    btns.push(b)
    list.append(b)
  })
  box.append(list, panel)
  select(0, false)
  return box
}

// 체형 비교 탭: 후기마다 성별·키·몸무게를 내 값과 나란히 보여주고, 유사도 숫자가 0에서 올라가요.
// 애니메이션은 탭을 처음 열 때 한 번만 돌고, 움직임 줄이기 설정이면 바로 최종 값을 보여줘요.
const COUNT_MS = 900
const COMPARE_MAX = 20
const GENDER_TEXT = { male: '남성', female: '여성' }
let stopAnim = null

function cancelAnim() {
  if (stopAnim) stopAnim()
  stopAnim = null
}

function reducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  try {
    return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return true
  }
}

function compareTab(rvs, all) {
  const box = el('div')
  const me = rvs.me
  const rows = me ? all.filter((r) => r.height != null && r.weight != null).slice(0, COMPARE_MAX) : []
  if (!rows.length) {
    box.append(el('p', 'note', '키·몸무게를 읽은 리뷰가 없어서 비교할 수 없어요.'))
    return { node: box, play() {} }
  }
  const card = el('div', 'mecard')
  const vals = el('div', 'mev')
  for (const [n, u] of [[me.height, 'cm'], [me.weight, 'kg']]) {
    const v = el('span', 'mevi')
    v.append(el('span', 'men', String(n)), el('span', 'meu', u))
    vals.append(v)
  }
  card.append(el('span', 'mel', '내 체형'), vals)
  if (me.gender && GENDER_TEXT[me.gender]) card.append(el('span', 'meg', GENDER_TEXT[me.gender]))
  box.append(card)
  const ul = el('ul', 'cmp')
  const fills = [] // { node, pct }
  const counters = [] // { node, target }
  for (const rv of rows) {
    const c = compareBody(me, rv)
    const li = el('li', 'cr')
    const head = el('div', 'crh')
    head.append(el('span', 'rvn', rv.nick || '구매자'))
    const pct = el('span', 'cpct', `${c.similarity ?? 0}%`)
    pct.setAttribute('aria-hidden', 'true')
    head.append(el('span', 'sr', `체형 유사도 ${c.similarity ?? 0}%`))
    counters.push({ node: pct, target: c.similarity ?? 0 })
    li.append(head)
    const genderText = c.gender.state === 'same' ? '성별 같음' : c.gender.state === 'diff' ? '성별 다름' : '성별 확인 불가'
    const chip = el('span', c.gender.state === 'diff' ? 'cg diff' : 'cg', rv.gender ? `${genderText} (${GENDER_TEXT[rv.gender]})` : genderText)
    li.append(chip)
    if (c.gender.state === 'diff') li.append(el('p', 'tiny', '성별이 달라 유사도는 0%예요. 키·몸무게는 참고용이에요.'))
    // 후기 작성자의 키·몸무게만 보여주고(내 체형은 탭 맨 위에 있어요), 그 아래에 비슷한 체형인지 보여주는 퍼센트 막대 하나
    const grp = el('div', 'cgrp')
    const col = el('div', 'ccol')
    col.append(el('span', 'ccl', '후기 체형'), el('span', 'ccv', `${c.height.review}cm · ${c.weight.review}kg`), el('span', 'cbuy', buySizeText(rv.size)))
    grp.append(col)
    li.append(grp)
    const dt = diffText(c)
    if (dt) li.append(el('p', 'cdiff', dt))
    const sim = c.similarity ?? 0
    const tier = similarityTier(sim)
    const b = el('div', `cb ${tier}`)
    const lab = el('div', 'cbl')
    lab.append(el('span', 'ctier', TIER_LABEL[tier]))
    lab.append(pct)
    const track = el('div', 'cbt')
    track.setAttribute('role', 'img')
    track.setAttribute('aria-label', `체형 유사도 ${sim}%: ${TIER_LABEL[tier]}`)
    const fill = el('div', 'cbf')
    const w = `${Math.max(0, Math.min(100, Math.round(sim)))}%`
    fill.style.width = w
    track.append(fill)
    fills.push({ node: fill, w })
    b.append(lab, track)
    li.append(b)
    ul.append(li)
  }
  box.append(ul)
  let played = false
  const finish = () => {
    for (const f of fills) f.node.style.width = f.w
    for (const c of counters) c.node.textContent = `${c.target}%`
  }
  const play = () => {
    if (played) return
    played = true
    if (reducedMotion() || typeof requestAnimationFrame !== 'function') return // 이미 최종 값이 들어 있어요
    for (const f of fills) f.node.style.width = '0%'
    for (const c of counters) c.node.textContent = '0%'
    let frame = null
    let start = null
    const tick = (now) => {
      if (start == null) {
        start = now
        for (const f of fills) f.node.style.width = f.w
      }
      const elapsed = now - start
      for (const c of counters) c.node.textContent = `${countUpValue(elapsed, COUNT_MS, c.target)}%`
      if (elapsed < COUNT_MS) frame = requestAnimationFrame(tick)
      else frame = null
    }
    frame = requestAnimationFrame(tick)
    stopAnim = () => {
      if (frame != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
      frame = null
      finish()
    }
  }
  return { node: box, play }
}

// 내 옷장으로 보내기: 누를 때만 변환된 항목을 이 브라우저의 확장 저장소(대기열)에 넣어요. 핏체크 웹이 열려 있으면 바로, 아니면 열 때 자동으로 옷장에 들어가요.
// 서버로 보내지 않고, 체형 정보는 담지 않아요. 자동 전달이 안 될 때를 위해 '붙여넣기용으로 복사'도 남겨둡니다.
function queueEnvelope(env) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve(false)
      return
    }
    try {
      chrome.storage.local.get(SYNC_QUEUE_KEY, (res) => {
        const q = enqueue(Array.isArray(res?.[SYNC_QUEUE_KEY]) ? res[SYNC_QUEUE_KEY] : [], env)
        if (!q.ok) {
          resolve(false)
          return
        }
        chrome.storage.local.set({ [SYNC_QUEUE_KEY]: q.queue }, () => resolve(!chrome.runtime?.lastError))
      })
    } catch {
      resolve(false)
    }
  })
}

function exportBlock(r) {
  const box = el('div')
  const btn = el('button', 'btn', '내 옷장으로 보내기')
  btn.type = 'button'
  const msg = el('p', 'ok')
  msg.setAttribute('role', 'status')
  const extra = el('div', 'btns')
  btn.addEventListener('click', async () => {
    const env = buildExportEnvelope(r)
    if (!env) {
      msg.textContent = '보낼 수 있는 내용을 만들지 못했어요.'
      return
    }
    extra.replaceChildren()
    const queued = await queueEnvelope(env)
    if (!queued) {
      msg.textContent = '자동으로 보내지 못했어요. 아래 ‘붙여넣기용으로 복사’를 눌러 웹 옷장에 붙여넣어주세요.'
    } else {
      msg.textContent = '보냈어요. 핏체크 웹이 열려 있으면 바로, 아니면 열 때 내 옷장에 자동으로 담겨요.'
      const link = el('a', 'weblink', '개발 서버 웹 열기 (localhost:5173)')
      link.href = WEB_APP_OPEN_URL
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      extra.append(link)
    }
    const copy = el('button', 'btn', '붙여넣기용으로 복사')
    copy.type = 'button'
    copy.addEventListener('click', async () => {
      const text = JSON.stringify(env)
      const ta = el('textarea', 'inp')
      ta.readOnly = true
      ta.rows = 3
      ta.value = text
      ta.setAttribute('aria-label', '옷장으로 보낼 내용')
      extra.append(ta)
      msg.textContent = (await copyText(text)) ? '복사했어요. 핏체크 웹의 내 옷장 > 직접 가져오기에 붙여넣어주세요.' : '복사하지 못했어요. 아래 글을 직접 복사해주세요.'
    })
    extra.append(copy)
  })
  const sendRow = el('div', 'btns')
  sendRow.append(btn)
  box.append(sendRow, msg, extra, el('p', 'tiny', '3일 안에 웹을 열지 않으면 대기열에서 지워져요. file://로 연 웹은 크롬 확장 설정에서 ‘파일 URL에 대한 액세스 허용’을 켜야 자동으로 받아요.'))
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

// 사이즈표 요약: 사이즈 목록, 추천 사이즈 핵심 실측, 위·아래 사이즈 차이, 한 줄 판정. targets는 이동할 구역(details)과 직접 입력 양식이에요.
function sizeSummaryBlock(r, targets) {
  const sm = r.sizeSummary
  if (!sm) return null
  const box = el('div', 'ss')
  box.append(el('div', 'sst', '사이즈표 요약'))
  const go = (label, det, after) => {
    const b = el('button', 'lnk', label)
    b.type = 'button'
    b.addEventListener('click', () => {
      if (det) {
        det.open = true
        if (det.scrollIntoView) det.scrollIntoView({ block: 'nearest' })
      }
      if (after) after()
    })
    return b
  }
  if (sm.status !== 'ok') {
    const p = el('p', null, sm.message)
    p.append(go('사이즈표 직접 입력', targets.ch, () => targets.manual.openForm()))
    box.append(p)
    return box
  }
  const chips = el('div', 'ssc')
  for (const t of sm.sizes) chips.append(el('span', t === sm.recommended ? 'on' : null, t === sm.recommended ? `${t} 추천` : t))
  box.append(chips)
  if (sm.keyParts.length) box.append(el('p', null, `${sm.recommended} 실측 ${sm.keyParts.map((k) => `${k.label} ${k.value}${k.unit}`).join(' · ')}`))
  const near = [sm.neighbors.lowerDiff, sm.neighbors.upperDiff].filter(Boolean)
  if (near.length) box.append(el('p', 'tiny', near.join(' / ')))
  if (sm.verdictLine) box.append(el('p', null, sm.verdictLine))
  const more = el('p', 'tiny')
  more.append(go('자세히 보기', targets.cp || targets.ch))
  box.append(more)
  return box
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
  const btns = el('div', 'btns')
  btns.append(btn, stop)
  box.append(btns, prog)
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
    const summarySlot = el('div')
    fold.append(summarySlot)

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
    if (r.exportData) fold.append(exportBlock(r))
    const manual = manualForm(r)
    let cpSec = null
    if (r.compareView) {
      const cp = section('사이즈표 비교 (내 치수 vs 옷 실측)', true)
      cpSec = cp
      cp.body.append(compareBlock(r.compareView))
      fold.append(cp.det)
    }
    const ch = section(r.chartView ? '읽은 사이즈표 (페이지 그대로)' : '사이즈표 (읽지 못함)', !r.chartView)
    if (r.chartView) ch.body.append(chartTable(r.chartView), el('p', 'tiny', '읽은 표가 다르면 직접 입력으로 고칠 수 있어요.'))
    ch.body.append(manual)
    fold.append(ch.det)
    const summary = sizeSummaryBlock(r, { cp: cpSec?.det || null, ch: ch.det, manual })
    if (summary) summarySlot.append(summary)

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
      if (result.status !== 'no-data' && result.status !== 'no-product') break
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
