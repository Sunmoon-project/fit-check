// 상품 페이지에 "내 사이즈 찾기" 버튼과 결과 카드를 띄웁니다.
// 페이지 데이터는 이 브라우저 안에서만 읽고, 어디로도 보내지 않아요. 네트워크 호출이 없습니다.
import { isProductPage, REVIEW_SELECTOR, readReviewTotal, readReviewCardEls, setRectProvider } from '../src/lib/pageParser.js'
import { analyzePage, manualChartRows } from '../src/lib/extAnalyze.js'
import { buildExportEnvelope } from '../src/lib/wardrobeImport.js'
import { SYNC_QUEUE_KEY, WEB_APP_OPEN_URL, enqueue } from '../src/lib/wardrobeSync.js'
import { collectDiagnostics, formatReport } from '../src/lib/diagnose.js'
import { shouldStop, isSafeMoreButton, isReviewTab, isInnerScroller, loadTarget, loadResultText, toReportStop, AUTO_TARGET, MORE_STEP, MAX_MS } from '../src/lib/reviewLoader.js'
import { compareBody, countUpValue, similarityTier, TIER_LABEL, diffText, buySizeText } from '../src/lib/similarityBreakdown.js'
import { EXT_PROFILE_KEY, isUsableProfile } from '../src/lib/extProfile.js'
import { chromeAdapter, loadLearning, addSamples, resetLearning } from '../src/lib/learnStore.js'
import { createSizeChartDb, SIZE_CHART_DB_STORAGE_NOTE } from '../src/lib/sizeChartDb.js'
import { LEARNING_NOTE, LEARNING_STORAGE_NOTE } from '../src/lib/learnedModel.js'
import { REGION_HYPOTHESIS_NOTE } from '../src/lib/brandRegion.js'
import { isUsedListingPage, usedSiteOf, readListing, listingText } from '../src/lib/usedListing.js'
import { usedSearchQuery, findChartMatches } from '../src/lib/usedAnalyze.js'

// 표 구조로 사이즈표가 안 읽힐 때 화면 위치로 줄·칸을 맞추는 마지막 후보에 쓸 위치 제공자 (읽기만 해요)
setRectProvider((el) => el.getBoundingClientRect())

const WAIT_MS = 4000 // 늦게 그려지는 표·리뷰를 기다리는 최대 시간
const RETRY_DELAYS = [1500, 2500] // 못 찾았을 때 다시 읽기 전 기다림. 전체 대기는 약 8초 이내
const EXT_VERSION = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.().version) || ''
const QUIET_MS = 500 // 이 시간 동안 화면 변화가 없으면 다 그려졌다고 봅니다
const STEP_QUIET_MS = 600 // 리뷰 더 불러오기 한 단계 뒤 화면이 잠잠해질 때까지 기다리는 시간
const STEP_WAIT_MS = 2500 // 한 단계에서 기다리는 최대 시간

const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',-apple-system,BlinkMacSystemFont,sans-serif}
.wrap{--e:cubic-bezier(.22,1,.36,1);position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:10px;color:#18181b;-webkit-font-smoothing:antialiased}
.fab{display:inline-flex;align-items:center;gap:7px;border:0;border-radius:999px;background:#18181b;color:#fff;padding:11px 16px;font-size:13px;font-weight:600;letter-spacing:-.01em;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.22),0 1px 2px rgba(0,0,0,.2);transition:transform .2s var(--e),box-shadow .2s var(--e),opacity .2s}
.fab:hover{transform:translateY(-1px);box-shadow:0 10px 26px rgba(0,0,0,.26),0 1px 2px rgba(0,0,0,.2)}
.fab:active{transform:scale(.96)}
.fab:disabled{opacity:.8;cursor:default;transform:none}
.fab:disabled::before{content:'';width:10px;height:10px;border-radius:50%;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;animation:spin .8s linear infinite}
.card{width:380px;max-width:calc(100vw - 32px);max-height:min(80vh,560px);overflow-y:auto;overscroll-behavior:contain;background:#fff;border:1px solid #e4e4e7;border-radius:16px;padding:0 14px 14px;box-shadow:0 18px 48px rgba(0,0,0,.18),0 2px 6px rgba(0,0,0,.06);font-size:12px;line-height:1.5;transform-origin:bottom right;animation:cardIn .4s var(--e);transition:width .4s var(--e),max-height .4s var(--e);scrollbar-width:thin}
.card.wide{width:min(760px,calc(100vw - 32px));max-height:calc(100vh - 96px)}
.card.still,.card.still .size{animation:none}
.card.min .fold{display:none}
.fold{animation:fade .3s ease}
.hd{position:sticky;top:0;z-index:2;margin:0 -14px 2px;padding:9px 8px 7px 14px;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-bottom:1px solid #f0f0f2}
.hd .eyebrow{font-weight:700;color:#18181b}
.ctl{display:flex;gap:2px}
.close{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:8px;background:none;font-size:15px;line-height:1;cursor:pointer;color:#52525b;transition:background .15s,color .15s,transform .15s var(--e)}
.close:hover{background:#f4f4f5;color:#18181b}
.close:active{transform:scale(.9)}
.close:focus-visible,.btn:focus-visible,.cat:focus-visible,.tab:focus-visible,.lnk:focus-visible,.sec>summary:focus-visible,.zt:focus-visible{outline:2px solid #18181b;outline-offset:2px}
.tiny{margin:2px 0 0;font-size:11px;color:#71717a}
.tiny.tg{margin:6px 0 0;color:#8a5a00;font-weight:600}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.eyebrow{font-size:11px;color:#71717a}
.cats{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:6px}
.cats .tiny{margin:0 4px 0 0}
.cat{border:1px solid #e4e4e7;border-radius:999px;background:#fff;color:#18181b;padding:2px 9px;font-size:11px;cursor:pointer;transition:background .15s,border-color .15s,transform .15s var(--e)}
.cat:hover{border-color:#a1a1aa}
.cat:active{transform:scale(.95)}
.cat.on{background:#18181b;color:#fff;border-color:#18181b}
.badge{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:#f4f4f5}
.size{font-size:34px;font-weight:800;letter-spacing:-.03em;line-height:1.15;margin:4px 0 0;transform-origin:left center;animation:pop .5s var(--e) .08s both}
.sum{margin:8px 0 0;color:#555;font-size:12px}
.why{margin:6px 0 0;padding-left:16px;color:#52525b;font-size:12px}
.why li+li{margin-top:2px}
h3{margin:10px 0 2px;font-size:13px}
p{margin:0}
.det{margin:8px 0 0;padding-left:16px;color:#52525b;font-size:11px}
.btns{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px}
.btns:empty{display:none}
.btns>.btn{margin-top:0}
.btns>.weblink{margin:0}
.btns>.inp{margin-top:0;flex:1 1 100%}
.btn{margin-top:8px;border:1px solid #d4d4d8;border-radius:9px;background:#fff;color:#18181b;padding:6px 11px;font-size:12px;font-weight:600;cursor:pointer;transition:background .15s,border-color .15s,transform .15s var(--e)}
.btn:hover{background:#f4f4f5;border-color:#a1a1aa}
.btn:active{transform:scale(.96)}
.btn:disabled{opacity:.5;cursor:default;transform:none}
.ok{margin-top:6px;font-size:12px;color:#0a7a3c}
.ok:not(:empty){animation:rise .3s var(--e)}
.weblink{display:inline-block;margin-top:6px;margin-right:8px;font-size:12px;color:#18181b}
.inp{width:100%;margin-top:6px;border:1px solid #e4e4e7;border-radius:8px;padding:7px 8px;font-size:12px;font-family:inherit;transition:border-color .15s,box-shadow .15s}
.inp:focus{outline:0;border-color:#18181b;box-shadow:0 0 0 3px rgba(24,24,27,.08)}
.prog{margin-top:6px;font-size:12px;color:#52525b;font-variant-numeric:tabular-nums}
.pbar{height:4px;margin-top:8px;border-radius:2px;background:#f0f0f2;overflow:hidden}
.pbar i{display:block;height:100%;width:0;border-radius:2px;background:#18181b;transition:width .4s var(--e)}
.note{margin-top:6px;font-size:11px;color:#71717a}
.sec{margin-top:8px;border:1px solid #ececef;border-radius:12px;background:#fff;interpolate-size:allow-keywords;transition:border-color .2s,box-shadow .2s}
.sec[open]{border-color:#e4e4e7;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.sec>summary{list-style:none;display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;font-weight:700;color:#18181b;padding:9px 12px;border-radius:12px;transition:background .15s}
.sec>summary::-webkit-details-marker{display:none}
.sec>summary::before{content:'';flex:none;width:7px;height:7px;border-radius:50%;background:var(--tc,#a1a1aa)}
.sec>summary::after{content:'';flex:none;margin-left:auto;width:6px;height:6px;border-right:1.5px solid #71717a;border-bottom:1.5px solid #71717a;transform:translateY(-2px) rotate(45deg);transition:transform .35s var(--e)}
.sec[open]>summary::after{transform:translateY(1px) rotate(-135deg)}
.sec>summary:hover{background:#fafafa}
.sec::details-content{block-size:0;overflow:hidden;opacity:0;transition:block-size .4s var(--e),opacity .3s ease,content-visibility .4s allow-discrete}
.sec[open]::details-content{block-size:auto;opacity:1}
.sec.s-why{--tc:#0a7a3c}
.sec.s-rv{--tc:#6a42a8}
.sec.s-ch{--tc:#4a5a6a}
.sec.s-dx{--tc:#a35a00}
.secbody{padding:0 12px 12px}
.tw{overflow-x:auto;margin-top:6px;border:1px solid #ececef;border-radius:10px}
table{border-collapse:collapse;font-size:11px;width:100%;font-variant-numeric:tabular-nums}
th,td{border-bottom:1px solid #f0f0f2;padding:5px 6px;text-align:center;white-space:nowrap}
tr:last-child>th,tr:last-child>td{border-bottom:0}
th{background:#fafafa;font-weight:600;color:#3f3f46}
th.dim,td.dim{color:#a1a1aa}
.tabs{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.tab{border:1px solid #e4e4e7;border-radius:999px;background:#fff;color:#18181b;padding:3px 10px;font-size:11px;cursor:pointer;transition:background .2s,color .2s,border-color .2s}
.tab.on{background:#18181b;color:#ffffff;border-color:#18181b}
.tw:not([hidden]){animation:fade .25s ease}
.bar{display:inline-flex;gap:2px;vertical-align:middle;margin-left:6px}
.bar i{display:inline-block;width:9px;height:5px;border-radius:2px;background:#e4e4e7}
.bar i.on:nth-child(1){background:#d23b3b}
.bar i.on:nth-child(2){background:#c67a1a}
.bar i.on:nth-child(3){background:#1a7f46}
.bar i.on:nth-child(4){background:#3a6ea5}
.bar i.on:nth-child(5){background:#5b4bb0}
td.mo{color:#71717a;font-size:10px;white-space:normal}
td.vd{white-space:normal;text-align:left;line-height:1.35}
td.vd .bar{display:flex;margin:3px 0 0}
tr.rec th,tr.rec td{background:#18181b;color:#fff}
.cv{display:block;font-size:10px;color:#0a7a3c}
tr.rec .cv{color:#9fe0ba}
.flag{margin-top:6px;font-size:11px;color:#8a5a00}
.rvl{list-style:none;margin:2px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.rv{border:1px solid #ececef;border-radius:12px;padding:9px 10px;background:#fff;animation:rise .35s var(--e) both;transition:border-color .15s,box-shadow .2s}
.rv:hover{border-color:#d4d4d8;box-shadow:0 2px 10px rgba(0,0,0,.05)}
.rv:nth-child(2){animation-delay:.04s}
.rv:nth-child(3){animation-delay:.08s}
.rv:nth-child(4){animation-delay:.12s}
.rv:nth-child(n+5){animation-delay:.16s}
.rvm{display:flex;flex-wrap:wrap;gap:4px}
.tag{font-size:10px;border-radius:6px;background:#f4f4f5;padding:1px 6px;color:#3f3f46}
.tag.miss{background:#fff;border:1px dashed #d4d4d8;color:#71717a}
.tag.sim{background:#18181b;color:#fff}
.tag.excl{background:#fff3e0;border:1px solid #c27a1e;color:#6b3f00}
.rv.excl{border-style:dashed;background:#fafafa}
.rvh{display:flex;align-items:baseline;gap:6px;margin-bottom:5px;min-width:0}
.rvn{font-size:12px;color:#18181b;flex:none}
.rvp{font-size:11px;color:#71717a;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rvt{margin-top:6px;font-size:12px;color:#27272a;line-height:1.55;word-break:break-word}
.sent{margin:3px 0 0;padding:0 0 0 8px;border-left:2px solid #e4e4e7;white-space:pre-wrap;animation:fade .3s ease both}
.phs{display:flex;gap:6px;margin-top:8px;overflow-x:auto;scrollbar-width:none;scroll-snap-type:x mandatory}
.ph{flex:none;width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #ececef;background:#f4f4f5;scroll-snap-align:start;transition:transform .25s var(--e),box-shadow .25s}
.ph[role=button]{cursor:zoom-in}
.ph[role=button]:hover{transform:scale(1.04);box-shadow:0 4px 14px rgba(0,0,0,.14)}
.ph:focus-visible{outline:2px solid #18181b;outline-offset:1px}
.rtabs{display:flex;gap:2px;margin-top:2px;padding:3px;background:#f4f4f5;border-radius:10px}
.rtab{flex:1 1 0;min-width:0;border:0;border-radius:8px;background:none;padding:6px 4px;font-size:11px;color:#52525b;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .2s,color .2s,box-shadow .2s}
.rtab.on{color:#18181b;background:#ffffff;font-weight:700;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.rtab:focus-visible{outline:2px solid #18181b;outline-offset:1px}
.tp{max-height:380px;overflow-y:auto;overscroll-behavior:contain;padding-top:8px;scrollbar-width:thin}
.tp>*{animation:fade .25s ease}
.card.wide .tp{max-height:calc(100vh - 280px)}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:6px}
.gal>.note{grid-column:1/-1}
.pf{position:relative;margin:0;aspect-ratio:3/4;border-radius:10px;overflow:hidden;background:#f4f4f5;animation:rise .35s var(--e) both}
.ph.big{display:block;width:100%;height:100%;border:0;border-radius:0;object-fit:cover}
.pf:hover .ph.big{transform:scale(1.06);box-shadow:none}
.pfc{position:absolute;left:0;right:0;bottom:0;padding:16px 7px 5px;font-size:10px;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.62));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
.zoom{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:56px 72px 16px;background:rgba(9,9,11,.9);backdrop-filter:blur(6px);animation:fade .2s ease;touch-action:pan-y}
.zimg{max-width:100%;max-height:calc(100vh - 190px);min-height:0;object-fit:contain;border-radius:10px;background:#111;box-shadow:0 24px 64px rgba(0,0,0,.5);animation:zin .35s var(--e);user-select:none}
.zcap{display:flex;gap:10px;align-items:baseline;color:#e4e4e7;font-size:12px}
.zbtn{position:absolute;border:0;border-radius:999px;background:rgba(255,255,255,.14);color:#fff;min-width:44px;height:44px;font-size:20px;cursor:pointer;backdrop-filter:blur(8px);transition:background .15s,transform .15s var(--e)}
.zbtn:hover{background:rgba(255,255,255,.26)}
.zbtn:active{transform:scale(.92)}
.zp:active,.zn:active{transform:translateY(-50%) scale(.92)}
.zbtn:focus-visible{outline:3px solid #8ab4ff;outline-offset:2px}
.zx{top:12px;right:12px}
.zp{left:16px;top:50%;transform:translateY(-50%)}
.zn{right:16px;top:50%;transform:translateY(-50%)}
.zc{color:#a1a1aa;font-variant-numeric:tabular-nums}
.zth{display:flex;gap:6px;max-width:100%;overflow-x:auto;padding:4px;scrollbar-width:none}
.zt{flex:none;width:52px;height:52px;padding:0;border:2px solid transparent;border-radius:8px;overflow:hidden;background:#27272a;cursor:pointer;opacity:.5;transition:opacity .2s,border-color .2s,transform .2s var(--e)}
.zt:hover{opacity:.85}
.zt.on{opacity:1;border-color:#fff;transform:scale(1.06)}
.zt img{display:block;width:100%;height:100%;object-fit:cover}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.mecard{display:flex;align-items:baseline;gap:10px;background:#f4f4f5;border-radius:12px;padding:10px 12px;margin-top:2px}
.mel{font-size:11px;color:#71717a}
.mev{display:flex;gap:12px;flex:1}
.men{font-size:20px;font-weight:800;color:#18181b;letter-spacing:-.02em}
.meu{font-size:11px;color:#52525b;margin-left:2px}
.meg{font-size:11px;color:#52525b}
.cmp{list-style:none;margin:6px 0 0;padding:0}
.cr{padding:9px 0;border-top:1px solid #f0f0f2;animation:rise .35s var(--e) both}
.cr:first-child{border-top:0}
.crh{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.cpct{font-size:15px;font-weight:800;font-variant-numeric:tabular-nums}
.cgrp{display:flex;gap:6px;margin-top:6px}
.ccol{flex:1;display:flex;flex-direction:column;gap:2px;background:#fafafa;border-radius:8px;padding:6px 8px}
.ccl{font-size:10px;color:#71717a;font-weight:600}
.ccv{font-size:12px;font-weight:700;color:#18181b}
.cbuy{font-size:11px;font-weight:600;color:#3f3f46;overflow-wrap:anywhere}
.shr{list-style:none;margin:6px 0 0;padding:0}
.shr li{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline;padding:7px 9px;border:1px solid #ececef;border-radius:10px;margin-top:4px;animation:rise .35s var(--e) both}
.shr li.on{border-color:#18181b;background:#f4f4f5}
.shl{font-weight:700}
.shs{font-size:11px;color:#71717a}
.shv{margin-left:auto;font-size:12px;font-weight:600}
.shr li.unfit{opacity:.5}
.shv.v-unfit{color:#d23b3b}.shv.v-iffy{color:#c67a1a}.shv.v-fit{color:#1a7f46}.shv.v-roomy{color:#3a6ea5}
.nofit{margin:6px 0;padding:8px 10px;border:1px solid #d23b3b;border-radius:10px;color:#d23b3b;font-weight:700}
.cdiff{margin:4px 0 0;font-size:11px;color:#71717a}
.ctier{font-size:11px;font-weight:700}
.cb.high .ctier,.cb.high .cpct{color:#0a7a3c}
.cb.mid .ctier,.cb.mid .cpct{color:#a35a00}
.cb.low .ctier,.cb.low .cpct{color:#6b6b70}
.cb.high .cbf{background:#0a7a3c}
.cb.mid .cbf{background:#b8650a}
.cb.low .cbf{background:#80808a}
.cb{margin-top:8px}
.cbl{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:#52525b}
.cbt{height:6px;background:#f0f0f2;border-radius:3px;overflow:hidden;margin-top:3px}
.cbf{height:100%;background:#18181b;border-radius:3px;transition:width .9s var(--e)}
.cg{display:inline-block;font-size:10px;border:1px solid #e4e4e7;border-radius:999px;padding:0 8px;color:#18181b}
.cg.diff{border-style:dashed;color:#71717a}
.ss{margin-top:10px;border:1px solid #ececef;border-radius:12px;padding:10px 12px;background:#fafafa;animation:rise .4s var(--e) .1s both}
.ss .sst{font-size:12px;font-weight:700;color:#3f4a56}
.ssc{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.ssc span{font-size:11px;border:1px solid #e4e4e7;border-radius:999px;padding:1px 9px;color:#18181b;background:#fff}
.ssc span.on{background:#18181b;border-color:#18181b;color:#fff;font-weight:700;animation:pop .45s var(--e) .25s both}
.ss p{margin-top:4px;font-size:12px;color:#333}
.ss p.tiny{font-size:11px;color:#6b6b70}
.fd{margin-top:8px;border:1px solid #ececef;border-radius:12px;padding:10px 12px;animation:rise .4s var(--e) .16s both}
.fdh{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;font-weight:700;color:#3f4a56}
.fdh span{font-size:11px;font-weight:500;color:#71717a}
.fdb{display:flex;height:8px;margin-top:8px;border-radius:4px;overflow:hidden;background:#f0f0f2;animation:wipe .9s var(--e) .3s both}
.fdb i{display:block;height:100%}
.fdb i+i{border-left:2px solid #fff}
.f-small{background:#c67a1a}
.f-true{background:#1a7f46}
.f-large{background:#3a6ea5}
.fdl{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:6px;font-size:11px;color:#3f3f46}
.fdl span{display:inline-flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums}
.fdl i{width:7px;height:7px;border-radius:50%}
.fdl b{font-weight:700}
.lnk{border:0;background:none;padding:0;margin-left:4px;font-size:11px;color:#52525b;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.lnk:hover{color:#18181b}
@keyframes cardIn{from{opacity:0;transform:translateY(12px) scale(.97)}}
@keyframes rise{from{opacity:0;transform:translateY(6px)}}
@keyframes fade{from{opacity:0}}
@keyframes pop{from{opacity:0;transform:scale(.8)}}
@keyframes zin{from{opacity:0;transform:scale(.94)}}
@keyframes wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}
`

let host = null
let shadow = null
let panel = null
let fab = null
let wrapEl = null
let busy = false
let loader = null // 리뷰 불러오기 진행 상태 { aborted, wake }

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
  wrapEl = wrap
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

// 크게 보기 상태는 카드를 다시 그려도 유지해요 (이 페이지에서만, 저장하지 않음).
let wide = false

function showCard(build) {
  cancelAnim()
  // 이미 카드가 떠 있으면 다시 그릴 때 등장 애니메이션을 생략해요 (깜빡임 방지).
  const fresh = !panel.children || panel.children.length === 0
  panel.replaceChildren()
  const card = el('div', fresh ? 'card' : 'card still')
  if (wide) card.classList.toggle('wide', true)
  const head = el('div', 'row hd')
  head.append(el('span', 'eyebrow', '핏체크'))
  const ctl = el('span', 'ctl')
  const big = el('button', 'close', wide ? '⤡' : '⤢')
  big.type = 'button'
  big.setAttribute('aria-label', wide ? '작게 보기' : '크게 보기')
  big.addEventListener('click', () => {
    wide = !wide
    card.classList.toggle('wide', wide)
    big.textContent = wide ? '⤡' : '⤢'
    big.setAttribute('aria-label', wide ? '작게 보기' : '크게 보기')
  })
  ctl.append(big)
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
    if (typeof card.animate !== 'function' || reducedMotion()) {
      panel.replaceChildren()
      return
    }
    // 닫힐 때 살짝 줄어들며 사라져요. 그사이 새 카드가 그려졌으면 그 카드는 건드리지 않아요.
    const a = card.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px) scale(.97)' }], { duration: 180, easing: 'ease-in' })
    a.onfinish = () => card.remove()
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
  box.append(el('p', 'tiny', '주소 경로·개수·화면 구조만 담겨요. 체형 정보·리뷰 글은 없어요.'))
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
        chosenExtraRows = extraRows
        chosenFor = location.href
        renderResult({ ...(await analyzeLearning(profile, { extraRows, categoryOverride: chosenCategory })), manual: true })
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
        const kind = r.bodyKind === 'measured' ? '' : r.bodyKind === 'standard' ? ' (표준)' : r.bodyKind === 'leg' ? ' (다리길이로 계산)' : r.bodyKind === 'review' ? ' (후기 추정)' : r.bodyKind === 'photo' ? ' (사진 추정)' : ' (추정)'
        tr.append(el('td', null, `${fmt(r.body, r.unit)}${kind}`), el('td', null, fmt(r.garment, r.unit)), el('td', null, `${r.ease > 0 ? '+' : ''}${r.ease}${r.unit}`))
        const td = el('td', 'vd', r.note ? `${r.verdict} (${r.note})` : r.verdict)
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
  box.append(el('p', 'note', '둘레는 단면×2, (추정)은 키·몸무게로, (후기 추정)은 비슷한 체형 후기로 보정해 계산했어요. 총장·소매 기준은 휴리스틱이에요. 막대: 작음 · 타이트 · 적당 · 넉넉 · 매우 넉넉'))
  return box
}

const REVIEW_PREVIEW = 120
const SENT_PREVIEW = 3

// 리뷰 한 건: 닉네임·상품명 / 태그 / 문장별 본문 / 사진. 모두 textContent와 createElement로만 만들고 저장·전송하지 않아요.
function reviewItem(rv) {
  const li = el('li', rv.excluded ? 'rv excl' : 'rv')
  if (rv.nick || rv.productName) {
    const head = el('div', 'rvh')
    if (rv.nick) head.append(el('b', 'rvn', rv.nick))
    if (rv.productName) head.append(el('div', 'rvp', `상품명 ${rv.productName}`))
    li.append(head)
  }
  const meta = el('div', 'rvm')
  if (rv.excluded) meta.append(el('span', 'tag excl', rv.excluded.text))
  else if (rv.labelReduced) meta.append(el('span', 'tag excl', '가중치 낮춤(비슷한 체형 다수와 반대 평가)'))
  const tag = (label, value, text) => meta.append(el('span', value == null ? 'tag miss' : 'tag', value == null ? `${label} 못 읽음` : `${label} ${text}`))
  if (rv.similarity != null) meta.append(el('span', 'tag sim', `체형 유사도 ${rv.similarity}`))
  meta.append(el('span', rv.gender ? 'tag' : 'tag miss', rv.gender === 'male' ? '남성' : rv.gender === 'female' ? '여성' : '성별 못 읽음'))
  tag('키', rv.height, `${rv.height}cm`)
  tag('몸무게', rv.weight, `${rv.weight}kg`)
  tag('구매 사이즈', rv.size, rv.size)
  tag('핏 평가', rv.fitLabel, rv.fitLabel)
  if (rv.shoe) {
    if (rv.shoe.option) meta.append(el('span', 'tag', `구매 옵션 ${rv.shoe.option}`))
    if (rv.shoe.sizeFeel) meta.append(el('span', 'tag', `사이즈 ${rv.shoe.sizeFeel}`))
    if (rv.shoe.width) meta.append(el('span', 'tag', `발볼 ${rv.shoe.width}`))
    for (const x of rv.shoe.extras || []) meta.append(el('span', 'tag', `${x.label} ${x.value}`.trim()))
  }
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
    urls.forEach((url, k) => {
      const img = document.createElement('img')
      img.className = 'ph'
      img.src = url
      img.alt = '리뷰 사진'
      img.loading = 'lazy'
      img.referrerPolicy = 'no-referrer'
      img.decoding = 'async'
      makeZoomable(img, urls, k, urls.map(() => photoCaption(rv)))
      row.append(img)
    })
    li.append(row)
  }
  return li
}

// 리뷰 사진 확대: https 주소만 열고, 닫기(버튼·바깥·Esc)와 이전/다음(버튼·좌우 화살표·좌우로 밀기·아래 썸네일)을 지원해요.
// caps가 있으면 사진마다 작성자 체형을 함께 보여줘요. 닫으면 눌렀던 사진으로 포커스가 돌아가요.
function openZoom(urls, start, opener, allCaps) {
  const ok = (u) => typeof u === 'string' && /^https:\/\//i.test(u)
  const list = (urls || []).filter(ok)
  const caps = allCaps ? allCaps.filter((_, k) => ok(urls[k])) : null
  if (!list.length || !wrapEl) return null
  let i = Math.min(Math.max(start, 0), list.length - 1)
  const ov = el('div', 'zoom')
  ov.setAttribute('role', 'dialog')
  ov.setAttribute('aria-modal', 'true')
  ov.setAttribute('aria-label', '사진 확대')
  const img = document.createElement('img')
  img.className = 'zimg'
  img.alt = '확대한 리뷰 사진'
  img.referrerPolicy = 'no-referrer'
  img.draggable = false
  const cap = el('div', 'zcap')
  const count = el('span', 'zc')
  const capText = el('span')
  cap.append(capText, count)
  const mk = (cls, label, text, fn) => {
    const b = el('button', `zbtn ${cls}`, text)
    b.type = 'button'
    b.setAttribute('aria-label', label)
    b.addEventListener('click', (e) => {
      if (e && e.stopPropagation) e.stopPropagation()
      fn()
    })
    return b
  }
  const close = () => {
    ov.remove()
    if (opener && opener.focus) opener.focus()
  }
  const thumbs = []
  const show = (n, dir = 0) => {
    i = (n + list.length) % list.length
    img.src = list[i]
    count.textContent = list.length > 1 ? `${i + 1} / ${list.length}` : ''
    capText.textContent = (caps && caps[i]) || ''
    thumbs.forEach((t, k) => {
      t.className = k === i ? 'zt on' : 'zt'
      t.setAttribute('aria-current', k === i ? 'true' : 'false')
    })
    if (thumbs[i]?.scrollIntoView) thumbs[i].scrollIntoView({ block: 'nearest', inline: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
    // 넘길 때 미는 방향에서 살짝 들어와요 (움직임 줄이기면 생략)
    if (dir && typeof img.animate === 'function' && !reducedMotion()) {
      img.animate([{ opacity: 0.2, transform: `translateX(${dir * 28}px) scale(.98)` }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' })
    }
  }
  const closeBtn = mk('zx', '닫기', '✕', close)
  ov.append(img, cap, closeBtn)
  if (list.length > 1) {
    ov.append(mk('zp', '이전 사진', '‹', () => show(i - 1, -1)), mk('zn', '다음 사진', '›', () => show(i + 1, 1)))
    const strip = el('div', 'zth')
    list.forEach((url, k) => {
      const b = el('button', 'zt')
      b.type = 'button'
      b.setAttribute('aria-label', `${k + 1}번째 사진`)
      const t = document.createElement('img')
      t.src = url
      t.alt = ''
      t.loading = 'lazy'
      t.referrerPolicy = 'no-referrer'
      b.append(t)
      b.addEventListener('click', (e) => {
        if (e && e.stopPropagation) e.stopPropagation()
        if (k !== i) show(k, k > i ? 1 : -1)
      })
      thumbs.push(b)
      strip.append(b)
    })
    ov.append(strip)
    // 터치·마우스로 좌우로 밀어 넘기기
    let sx = null
    img.addEventListener('pointerdown', (e) => { sx = e.clientX })
    img.addEventListener('pointerup', (e) => {
      if (sx == null) return
      const dx = e.clientX - sx
      sx = null
      if (Math.abs(dx) > 40) show(dx < 0 ? i + 1 : i - 1, dx < 0 ? 1 : -1)
    })
  }
  show(i)
  ov.addEventListener('click', (e) => {
    if (!e || e.target === ov) close()
  })
  ov.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); close() }
    else if (e.key === 'ArrowLeft' && list.length > 1) { if (e.preventDefault) e.preventDefault(); show(i - 1, -1) }
    else if (e.key === 'ArrowRight' && list.length > 1) { if (e.preventDefault) e.preventDefault(); show(i + 1, 1) }
  })
  wrapEl.append(ov)
  if (closeBtn.focus) closeBtn.focus()
  return ov
}

// 작은 사진을 키보드로도 누를 수 있게 만들고, 누르면 사진들을 확대해요 (https만).
function makeZoomable(img, urls, index, caps) {
  if (!/^https:\/\//i.test(urls[index] || '')) return
  img.tabIndex = 0
  img.setAttribute('role', 'button')
  img.setAttribute('aria-label', '리뷰 사진 확대')
  img.addEventListener('click', () => openZoom(urls, index, img, caps))
  img.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.preventDefault) e.preventDefault()
      openZoom(urls, index, img, caps)
    }
  })
}

// 사진 아래·확대 화면에 붙는 짧은 설명: 닉네임 · 키 몸무게 · 구매 사이즈
function photoCaption(rv) {
  return [rv.nick || '구매자', rv.height != null && rv.weight != null ? `${rv.height}cm ${rv.weight}kg` : null, rv.size].filter(Boolean).join(' · ')
}

function reviewList(list) {
  const ul = el('ul', 'rvl')
  for (const rv of list) ul.append(reviewItem(rv))
  return ul
}

// 사진 모아보기: 리뷰 사진을 격자로 모아 보고, 누르면 모든 사진을 한 화면에서 넘겨 봐요 (https 주소만, 리뷰당 5장까지).
function photoGallery(list) {
  const box = el('div', 'gal')
  const urls = []
  const caps = []
  for (const rv of list) {
    const cap = photoCaption(rv)
    for (const url of (rv.photos || []).filter((u) => /^https:\/\//i.test(u)).slice(0, 5)) {
      urls.push(url)
      caps.push(cap)
    }
  }
  urls.forEach((url, k) => {
    const fig = el('figure', 'pf')
    if (k < 12) fig.style.animationDelay = `${k * 30}ms`
    const img = document.createElement('img')
    img.className = 'ph big'
    img.src = url
    img.alt = '리뷰 사진'
    img.loading = 'lazy'
    img.referrerPolicy = 'no-referrer'
    img.decoding = 'async'
    makeZoomable(img, urls, k, caps)
    fig.append(img, el('figcaption', 'pfc', caps[k]))
    box.append(fig)
  })
  if (!urls.length) box.append(el('p', 'note', '불러온 리뷰에 사진이 없어요.'))
  return box
}

// 추천 근거가 된 리뷰를 페이지에서 읽은 그대로, 탭 네 개(비슷한 체형 / 전체 리뷰 / 사진 모아보기 / 체형 비교)로 보여줘요.
// 각 탭은 처음 열 때 그리고, 세로로 스크롤돼요. 저장·전송하지 않아요.
function reviewsBlock(rvs) {
  const box = el('div')
  const all = [...rvs.matched, ...rvs.others]
  // 제외된 후기는 숨기지 않고 전체 리뷰 탭에 '제외됨(사유)'로 보여줘요. 추천 계산·사진·체형 비교에는 쓰지 않아요.
  const excluded = rvs.excluded || []
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
        if (all.length || excluded.length) d.append(reviewList([...all, ...excluded]))
        else d.append(el('p', 'note', '불러온 리뷰가 없어요.'))
        if (excluded.length) d.append(el('p', 'note', `제외됨 ${rvs.excludedTotal ?? excluded.length}건은 이상치로 보여 추천 계산에 쓰지 않았어요. 위 목록에 사유와 함께 남겨 뒀어요.`))
        const hidden = rvs.matchedTotal + rvs.othersTotal - all.length
        if (hidden > 0) d.append(el('p', 'note', `${hidden}건은 표시하지 않았어요.`))
        return d
      },
    },
    { label: '사진 모아보기', build: () => photoGallery(all) },
    rvs.isShoes ? { label: '발 정보 비교', build: () => footCompare(all) } : { label: '체형 비교', compare: true },
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

// 발 정보 비교 탭(신발): 후기마다 구매 사이즈·사이즈 체감·발볼을 보여줘요. 신발 후기에는 키·몸무게가 없는 경우가 많아서 체형 유사도는 쓰지 않아요.
// 다른 탭 build()처럼 요소 하나를 돌려줘요.
function footCompare(all) {
  const box = el('div')
  const rows = all.filter((r) => r.shoe || r.size != null).slice(0, COMPARE_MAX)
  if (!rows.length) {
    box.append(el('p', 'note', '구매 사이즈나 사이즈 체감을 읽은 리뷰가 없어요.'))
    return box
  }
  const ul = el('ul', 'shr')
  for (const r of rows) {
    const li = el('li')
    li.append(el('span', 'shl', r.shoe?.option || (r.size ? `${r.size}` : '구매 사이즈 못 읽음')))
    li.append(el('span', 'shs', `사이즈 ${r.shoe?.sizeFeel || r.fitLabel || '못 읽음'}`))
    li.append(el('span', 'shs', `발볼 ${r.shoe?.width || '못 읽음'}`))
    ul.append(li)
  }
  box.append(ul)
  // 탭 build()는 요소를 돌려줘야 해요. { node, play } 객체를 돌려주면 탭 쪽에서 한 번 더 감싸 replaceChildren에 객체가 들어가고
  // 실제 DOM은 그것을 글자로 바꿔 '[object Object]'를 보여줘요.
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

// 리뷰 영역 안인지: 조상의 class·id·data-testid에 review가, 또는 aria-label에 리뷰·후기가 들어 있어요.
// (closest 대신 직접 올라가며 봐서, 테스트용 가짜 DOM에서도 같은 규칙으로 동작해요)
function inReviewBox(e) {
  for (let cur = e, i = 0; cur && i < 30; cur = cur.parentElement, i++) {
    const attr = (n) => String(cur.getAttribute?.(n) || '')
    if (/review/i.test(`${attr('class')} ${attr('id')} ${attr('data-testid')}`) || /리뷰|후기/.test(attr('aria-label'))) return true
  }
  return false
}

const PAGE_ACTIVE_RE = /(?:^|[\s_-])(?:active|on|current|selected|is-active)(?:$|[\s_-])/i

// 리뷰 영역의 쪽 번호 중 지금 쪽 (aria-current 또는 active·on 같은 클래스가 붙은 숫자). 모르면 null
function currentReviewPage() {
  for (const e of document.querySelectorAll('[aria-current], [aria-selected="true"], button, [role="button"], a, strong')) {
    const t = String(e.textContent || '').trim()
    if (!/^\d{1,3}$/.test(t) || !inReviewBox(e)) continue
    const cur = e.getAttribute('aria-current')
    if ((cur && cur !== 'false') || e.getAttribute('aria-selected') === 'true' || PAGE_ACTIVE_RE.test(String(e.getAttribute('class') || ''))) return Number(t)
  }
  return null
}

// 리뷰 영역 안의 버튼 중 허용 목록에 맞는 것 하나만 찾습니다. '더보기' 종류를 먼저, 그다음 '다음', 마지막으로 바로 다음 쪽 번호예요.
function findMoreButton() {
  const cands = Array.from(document.querySelectorAll('button, [role="button"]')).filter(
    (b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true' && inReviewBox(b),
  )
  if (!cands.length) return null
  const text = (b) => String(b.textContent || '').replace(/\s+/g, ' ').trim()
  const currentPage = currentReviewPage()
  const ok = cands.filter((b) => isSafeMoreButton(text(b), { inReviewContainer: true, currentPage }))
  return ok.find((b) => /보기$/.test(text(b))) || ok.find((b) => /^다음/.test(text(b))) || ok[0] || null
}

// '스냅·후기' 같은 리뷰 탭. 탭이라고 화면이 직접 밝힌 것(role="tab" 또는 role="tablist" 안)이고,
// 글 전체가 리뷰 탭 이름 모양이고, 아직 열리지 않았고, 다른 페이지로 가는 링크가 아닐 때만 찾아요(isReviewTab).
// 탭은 같은 페이지 안에서 보이는 영역만 바꾸고 구매·저장 같은 상태를 바꾸지 않아서 이 경우에만 눌러요.
function findReviewTab() {
  for (const e of document.querySelectorAll('[role="tab"], [role="tablist"] button, [role="tablist"] a, [role="tablist"] li')) {
    let inTablist = false
    for (let cur = e.parentElement, i = 0; cur && i < 6; cur = cur.parentElement, i++) if (cur.getAttribute?.('role') === 'tablist') inTablist = true
    const info = { role: e.getAttribute('role'), inTablist, selected: e.getAttribute('aria-selected') === 'true', href: e.getAttribute('href') }
    if (isReviewTab(e.textContent, info)) return e
  }
  return null
}

// 리뷰 목록이 페이지가 아니라 안쪽 상자(모달·패널)에서 스크롤되는 경우 그 상자를 찾아요. 없으면 null
function innerScroller(e) {
  if (typeof getComputedStyle !== 'function') return null
  for (let cur = e?.parentElement, i = 0; cur && i < 20; cur = cur.parentElement, i++) {
    if (cur === document.body || cur === document.documentElement) return null
    let overflowY = ''
    try {
      overflowY = getComputedStyle(cur).overflowY
    } catch {
      return null
    }
    if (isInnerScroller({ overflowY, scrollHeight: cur.scrollHeight, clientHeight: cur.clientHeight })) return cur
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

// '내 사이즈 찾기'(mode 'auto', AUTO_TARGET건까지)나 '리뷰 더 불러오기'(mode 'more', 지금 + MORE_STEP건)를 누를 때만 실행해요.
// 마지막 리뷰 쪽으로 스크롤하고(안쪽 스크롤 상자가 있으면 그 상자도 끝까지), 허용된 '더보기'·'다음'·다음 쪽 번호를 단계마다 최대 한 번 누릅니다.
// 더보기 버튼이 안 보이면 처음 한 번만 '스냅·후기' 같은 리뷰 탭을 눌러 리뷰 영역을 열어요(findReviewTab 조건일 때만).
// 목표 건수·한도(횟수·시간·정체)·중단 버튼으로 멈추고, 끝나면 항상 원래 스크롤 위치로 돌아옵니다.
async function loadMoreReviews(mode, onProgress) {
  const { scrollX, scrollY } = window
  const state = { aborted: false, wake: null }
  loader = state
  const startedAt = Date.now()
  const scrollers = new Map() // 안쪽 스크롤 상자 → 원래 scrollTop
  let steps = 0
  let stalls = 0
  let clicked = false
  let count = reviewElements().length
  const startCount = count
  const target = loadTarget(count, mode)
  let reason = null
  const total = readReviewTotal(document) // 못 찾으면 null
  onProgress(count)
  try {
    if (count < target && !findMoreButton()) {
      const tab = findReviewTab()
      if (tab) {
        tab.click()
        await quietWait(STEP_QUIET_MS, STEP_WAIT_MS, state)
        count = reviewElements().length
        onProgress(count)
      }
    }
    while (!(reason = shouldStop({ steps, elapsedMs: Date.now() - startedAt, stalls, aborted: state.aborted, count, total, target }))) {
      const list = reviewElements()
      const last = list[list.length - 1]
      if (last && typeof last.scrollIntoView === 'function') last.scrollIntoView({ block: 'center' })
      const box = innerScroller(last)
      if (box) {
        if (!scrollers.has(box)) scrollers.set(box, box.scrollTop)
        box.scrollTop = box.scrollHeight
      }
      const btn = findMoreButton()
      if (btn) {
        btn.click()
        clicked = true
      }
      await quietWait(STEP_QUIET_MS, STEP_WAIT_MS, state)
      steps += 1
      const next = reviewElements().length
      stalls = next > count ? 0 : stalls + 1
      count = next
      onProgress(count)
    }
  } finally {
    for (const [box, top] of scrollers) box.scrollTop = top
    window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' }) // smooth 스크롤 설정을 무시
    loader = null
  }
  return { reason, clicked, grewOnPage: count > startCount }
}

// 중고 판매글 페이지면 이 브라우저의 사이즈표 모음에서 비슷한 상품을 미리 찾아 둬요(네트워크 없음). 중고 사이트가 아니거나 실패하면 빈 목록이에요.
async function usedChartMatchesFor(adapter) {
  if (!usedSiteOf(location.href)) return []
  try {
    const listing = readListing(document)
    const q = usedSearchQuery({ ...listing, text: listingText(listing) })
    return q ? await findChartMatches(createSizeChartDb(adapter), q) : []
  } catch {
    return []
  }
}

// 분석 한 번 + 학습: 저장된 학습값으로 판정하고, 이 상품 후기에서 만든 샘플(개인 식별 정보 없음)을 chrome.storage.local에 쌓아요.
// 새 샘플이 쌓였으면 갱신된 학습값으로 한 번 더 분석해요. 저장소를 못 쓰면(예: 확장이 갱신된 직후) 학습 없이 기존 방식으로 분석해요.
async function analyzeLearning(profile, opts) {
  const adapter = chromeAdapter(chrome.storage.local, chrome.runtime)
  let model = null
  try {
    model = (await loadLearning(adapter)).model
  } catch {
    model = null
  }
  const usedChartMatches = await usedChartMatchesFor(adapter)
  let out = analyzePage(document, location.href, profile, EXT_VERSION, { ...opts, learned: model, collectSamples: true, usedChartMatches })
  // 사이즈표를 읽은 상품만 사이즈표 모음에 저장해요(같은 상품은 갱신). 실패해도 분석 결과는 그대로 보여줘요.
  if (out.status === 'ok' && out.chartRecord) {
    try {
      await createSizeChartDb(adapter).put(out.chartRecord)
    } catch {
      /* 무시 */
    }
  }
  if (out.status === 'ok' && out.learnSamples?.length) {
    try {
      const r = await addSamples(adapter, out.learnSamples)
      if (r.added > 0) out = { ...analyzePage(document, location.href, profile, EXT_VERSION, { ...opts, learned: r.model, collectSamples: false }), chartRecord: out.chartRecord }
    } catch {
      /* 저장 실패해도 분석 결과는 그대로 보여줘요 */
    }
  }
  return out
}

// 학습값 사용 표시와 초기화 버튼 (학습값이 있을 때만)
function learningBlock(r) {
  const l = r.learning
  if (!l) return null
  const box = el('div', 'tiny lrn')
  const line = el('p', 'tiny', l.text)
  line.setAttribute('role', 'status')
  box.append(line, el('p', 'tiny', `${LEARNING_NOTE} ${LEARNING_STORAGE_NOTE}`))
  const btn = el('button', 'btn', '학습값 초기화')
  btn.type = 'button'
  btn.addEventListener('click', async () => {
    btn.disabled = true
    try {
      await resetLearning(chromeAdapter(chrome.storage.local, chrome.runtime))
      line.textContent = '학습값과 모은 샘플을 모두 지웠어요. 다음 분석부터 기본 기준으로 판정해요.'
    } catch {
      line.textContent = '초기화하지 못했어요. 다시 눌러 주세요.'
      btn.disabled = false
    }
  })
  box.append(btn)
  return box
}

// 사이즈표 모음 안내와 비우기 버튼 (사이즈표를 읽어 저장한 상품에서만)
function chartDbBlock(r) {
  if (!r.chartRecord) return null
  const box = el('div', 'tiny lrn')
  const line = el('p', 'tiny', `이 상품의 사이즈표를 사이즈표 모음에 저장했어요. ${SIZE_CHART_DB_STORAGE_NOTE}`)
  line.setAttribute('role', 'status')
  const btn = el('button', 'btn', '사이즈표 모음 비우기')
  btn.type = 'button'
  btn.addEventListener('click', async () => {
    btn.disabled = true
    try {
      await createSizeChartDb(chromeAdapter(chrome.storage.local, chrome.runtime)).clear()
      line.textContent = '저장된 사이즈표를 모두 지웠어요.'
    } catch {
      line.textContent = '비우지 못했어요. 다시 눌러 주세요.'
      btn.disabled = false
    }
  })
  box.append(line, btn)
  return box
}

// 불러온 뒤 다시 분석하고 결과 한 줄과 진단 값을 붙여요. before는 불러오기 전 카드에 보이던 리뷰 수예요.
async function reanalyzeAfterLoad(profile, before, res) {
  const next = await analyzeLearning(profile, { categoryOverride: chosenCategory, ...(chosenExtraRows ? { extraRows: chosenExtraRows } : {}) })
  if (chosenExtraRows) next.manual = true
  if (next.status === 'ok') {
    const scroll = { before, after: next.reviewsLoaded ?? 0, stop: toReportStop(res.reason) }
    next.diagnostics = collectDiagnostics(document, location.href, EXT_VERSION, { scroll })
    next.loadInfo = loadResultText({ before, after: scroll.after, reason: res.reason, clicked: res.clicked, grewOnPage: res.grewOnPage })
  }
  return next
}

// 중단 버튼: 진행 중인 불러오기를 멈추고 기다리던 것을 바로 끝내요.
function stopButton() {
  const stop = el('button', 'btn', '중단')
  stop.type = 'button'
  stop.addEventListener('click', () => {
    if (loader) {
      loader.aborted = true
      if (loader.wake) loader.wake()
    }
  })
  return stop
}

// 후기 핏 평가 분포: 작아요 / 정사이즈 / 커요 비율을 한 줄 막대로 보여줘요 (옷은 비슷한 체형, 신발은 불러온 전체 후기 기준).
// 평가를 읽은 후기가 2건 미만이면 그리지 않아요. 제외된 후기는 넣지 않아요.
const FIT_DIST = [['small', '작아요'], ['true', '정사이즈'], ['large', '커요']]
function fitDistBlock(rvs) {
  if (!rvs) return null
  const src = rvs.isShoes ? [...rvs.matched, ...rvs.others] : rvs.matched
  const n = { small: 0, true: 0, large: 0 }
  for (const r of src) if (r.fit in n) n[r.fit] += 1
  const total = n.small + n.true + n.large
  if (total < 2) return null
  const pct = (k) => Math.round((n[k] / total) * 100)
  const box = el('div', 'fd')
  const head = el('div', 'fdh', rvs.isShoes ? '후기 사이즈 체감' : '비슷한 체형 핏 평가')
  head.append(el('span', null, `${total}건`))
  const bar = el('div', 'fdb')
  bar.setAttribute('role', 'img')
  bar.setAttribute('aria-label', FIT_DIST.map(([k, l]) => `${l} ${pct(k)}%`).join(', '))
  const legend = el('div', 'fdl')
  for (const [k, label] of FIT_DIST) {
    if (n[k]) {
      const seg = el('i', `f-${k}`)
      seg.style.width = `${(n[k] / total) * 100}%`
      bar.append(seg)
    }
    const item = el('span')
    item.append(el('i', `f-${k}`), el('span', null, label), el('b', null, `${pct(k)}%`))
    legend.append(item)
  }
  box.append(head, bar, legend)
  return box
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
        if (det.scrollIntoView) det.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
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

// 신발 전용 비교: 사이즈(옵션)별 여유 mm와 판정, 구매 리뷰 집계, 추천 이유. 규칙은 휴리스틱이라고 함께 알려요.
function shoeBlock(sv) {
  const box = el('div', 'ss')
  box.append(el('div', 'sst', '신발 사이즈 비교'))
  const foot = sv.footLength
    ? `내 발길이 ${sv.footLength}mm${sv.footLengthEstimated ? ' (키로 추정)' : ''} · 발볼 ${sv.footWidthLabel || '입력 안 함'}`
    : '발길이를 알 수 없어요'
  box.append(el('p', null, foot))
  if (sv.noFit) box.append(el('p', 'nofit', sv.noFit.message))
  if (sv.windowText) box.append(el('p', 'tiny', sv.windowText))
  const ul = el('ul', 'shr')
  for (const row of sv.rows) {
    const li = el('li', [row.recommended ? 'on' : '', row.unfit ? 'unfit' : ''].filter(Boolean).join(' ') || null)
    li.append(el('span', 'shl', row.recommended ? `${row.label} 추천` : row.label))
    if (row.ease != null) li.append(el('span', 'shs', `여유 ${row.ease > 0 ? '+' : ''}${row.ease}mm`))
    if (row.verdict) li.append(el('span', `shv v-${row.verdictKey}`, row.verdict))
    if (row.widthText) li.append(el('span', 'shs', row.widthText))
    if (row.reviewLine) li.append(el('span', 'shs', row.reviewLine))
    ul.append(li)
  }
  box.append(ul)
  for (const t of sv.reasons) box.append(el('p', 'tiny', t))
  if (sv.widthLine) box.append(el('p', 'tiny', sv.widthLine))
  for (const t of sv.notes) box.append(el('p', 'tiny', t))
  box.append(el('p', 'tiny', sv.heuristicNote))
  return box
}

function loadMoreBlock(r) {
  const box = el('div')
  const btn = el('button', 'btn', '리뷰 더 불러오기')
  btn.type = 'button'
  const stop = stopButton()
  stop.hidden = true
  const prog = el('p', 'prog')
  prog.setAttribute('role', 'status')
  btn.addEventListener('click', async () => {
    if (busy) return
    busy = true
    btn.disabled = true
    stop.hidden = false
    fab.disabled = true
    try {
      const res = await loadMoreReviews('more', (n) => {
        prog.textContent = `불러온 리뷰 ${n}건`
      })
      const profile = await readProfile()
      if (!isUsableProfile(profile)) throw new Error('no-profile')
      const next = await reanalyzeAfterLoad(profile, r.reviewsLoaded ?? 0, res)
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
  btn.setAttribute('title', `누를 때마다 리뷰를 ${MORE_STEP}건씩 더 불러와요. 리뷰 영역을 스크롤하며 리뷰의 더보기·다음 버튼만 누르고, 최대 약 ${Math.round(MAX_MS / 1000)}초 뒤 멈춰요. 끝나면 원래 위치로 돌아와요.`)
  const btns = el('div', 'btns')
  btns.append(btn, stop)
  box.append(btns, prog)
  return box
}

// '내 사이즈 찾기' 직후 리뷰를 AUTO_TARGET건까지 자동으로 불러오는 동안 보이는 카드 (진행 건수와 중단 버튼)
function showAutoLoading() {
  const prog = el('p', 'prog', '불러온 리뷰 0건')
  const fill = el('i')
  prog.setAttribute('role', 'status')
  showCard((card) => {
    card.append(el('p', null, `리뷰를 ${AUTO_TARGET}건까지 불러오는 중이에요. 끝나면 원래 위치로 돌아와요.`))
    const track = el('div', 'pbar')
    track.append(fill)
    const btns = el('div', 'btns')
    btns.append(stopButton())
    card.append(track, prog, btns)
  })
  return (n) => {
    prog.textContent = `불러온 리뷰 ${n}건`
    fill.style.width = `${Math.min(100, Math.round((n / AUTO_TARGET) * 100))}%`
  }
}

// 사용자가 고른 옷 종류 (이 페이지에서만 기억하고 저장하지 않아요). 자동 분류보다 우선합니다.
let chosenCategory = null
// 직접 입력한 사이즈표도 같은 페이지에서만 기억해요 (저장하지 않음). 종류 칩을 눌러도 유지됩니다.
let chosenExtraRows = null
let chosenFor = ''

// 분류 신뢰도가 높지 않을 때 보이는 종류 선택 칩. 누르면 그 종류로 다시 분석해요.
function categoryChips(r) {
  if (!r.categoryConfidence || (r.categoryConfidence === 'high' && !r.categoryOverridden)) return null
  const box = el('div', 'cats')
  box.append(el('span', 'tiny', r.categoryOverridden ? '종류(직접 선택)' : '종류가 확실하지 않아요'))
  for (const c of r.categoryCandidates || []) {
    const b = el('button', c.key === r.category ? 'cat on' : 'cat', c.label)
    b.type = 'button'
    b.setAttribute('aria-pressed', c.key === r.category ? 'true' : 'false')
    b.addEventListener('click', () => reanalyzeWithCategory(c.key))
    box.append(b)
  }
  return box
}

// 고른 종류와 사이즈표(신발 mm표 ↔ 옷 실측표)가 맞지 않을 때: 안내 한 줄과 원래 종류로 되돌리는 칩 (웹과 같은 shoeChartNotice 결과)
function categoryNoticeBlock(r) {
  const n = r.categoryNotice
  if (!n) return null
  const box = el('div', 'cats')
  box.append(el('span', 'tiny', n.message))
  const b = el('button', 'cat', n.actionLabel)
  b.type = 'button'
  b.addEventListener('click', () => reanalyzeWithCategory(n.actionCategory))
  box.append(b)
  return box
}

async function reanalyzeWithCategory(key) {
  if (busy) return
  chosenCategory = key
  chosenFor = location.href
  try {
    const profile = await readProfile()
    if (!isUsableProfile(profile)) throw new Error('no-profile')
    const out = await analyzeLearning(profile, { categoryOverride: key, ...(chosenExtraRows ? { extraRows: chosenExtraRows } : {}) })
    renderResult(chosenExtraRows ? { ...out, manual: true } : out)
  } catch {
    renderResult({ status: 'error', message: '종류를 바꿔 다시 분석하다 문제가 생겼어요. 다시 눌러주세요.', diagnostics: null })
  }
}

// 중고 판매글 결과 카드: 후기 없이 판매글 실측 > 사이즈표 DB > 기본값 순서로 판정해요. 판매글에서 읽은 글은 textContent로만 넣어요.
function usedCard(card, r) {
  const conf = el('span', 'badge', r.confidenceLabel.text)
  conf.style.color = r.confidenceLabel.color
  const row = el('div', 'row')
  row.append(el('span', 'eyebrow', [r.site?.name, r.categoryLabel].filter(Boolean).join(' · ') || '중고 판매글'), conf)
  card.append(row)
  if (r.title) card.append(el('p', 'tiny', r.title))
  card.append(el('div', 'size', r.verdictLabel || '판정 어려움'))
  card.append(el('p', 'sum', r.headline))
  card.append(el('p', 'tiny', `근거: ${r.basisLabel}${r.approx ? ' (근사/추정)' : ''}`))
  if (r.perSize?.length) card.append(el('p', 'tiny', `사이즈별: ${r.perSize.map((p) => `${p.size} ${p.label}`).join(' · ')}`))
  card.append(el('p', 'tiny', r.noReviewNote))
  card.append(el('p', 'tiny', r.disclaimer))
  // 사진 역검색은 서버가 필요해서 확장에서는 호출하지 않아요(확장은 네트워크 호출 없음). 웹 앱의 '중고 상품 분석'으로 가는 링크만 둬요.
  const photoLink = el('a', 'weblink', '사진으로 같은 상품 찾기는 웹 앱 ‘중고 상품 분석’에서 (개발 서버 localhost:5173)')
  photoLink.href = WEB_APP_OPEN_URL
  photoLink.target = '_blank'
  photoLink.rel = 'noopener noreferrer'
  card.append(photoLink)
  const fold = el('div', 'fold')
  const why = section('추천 이유', true)
  const ul = el('ul', 'why')
  for (const t of r.reasons) ul.append(el('li', null, t))
  why.body.append(ul)
  fold.append(why.det)
  const dt = section('추천에 쓰인 근거 (자세히)')
  const dul = el('ul', 'why details')
  for (const t of r.details) dul.append(el('li', null, t))
  dt.body.append(dul)
  fold.append(dt.det)
  if (r.diagnostics) {
    const rep = section('문제가 있나요? 진단 리포트')
    rep.body.append(reportBlock(formatReport(r.diagnostics)))
    fold.append(rep.det)
  }
  card.append(fold)
}

function renderResult(r) {
  showCard((card) => {
    if (r.status === 'used') {
      usedCard(card, r)
      return
    }
    if (r.status !== 'ok') {
      card.append(el('p', null, r.message))
      const noticeBox = categoryNoticeBlock(r)
      if (noticeBox) card.append(noticeBox)
      if (r.details?.length) {
        const diag = section('진단 정보')
        const ul = el('ul', 'det')
        for (const t of r.details) ul.append(el('li', null, t))
        diag.body.append(ul)
        card.append(diag.det)
      }
      if (r.diagnostics) {
        if (!r.usedSite) card.append(manualForm(r))
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
    const chips = categoryChips(r)
    if (chips) card.append(chips)
    if (r.targetGender?.mismatch) card.append(el('p', 'tiny tg', r.targetGender.text))
    const noticeBox = categoryNoticeBlock(r)
    if (noticeBox) card.append(noticeBox)
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

    // 추천에 쓰인 근거를 줄별로 (후기 건수·제외, 학습값·샘플 수, 브랜드/지역 보정, 부위별 여유분, 브랜드 지역)
    if (r.details?.length) {
      const dt = section('추천에 쓰인 근거 (자세히)')
      const dul = el('ul', 'why details')
      for (const t of r.details) dul.append(el('li', null, t))
      dt.body.append(dul)
      if (r.regionInfo) dt.body.append(el('p', 'tiny', REGION_HYPOTHESIS_NOTE))
      fold.append(dt.det)
    }
    if (r.sizeSystem) {
      const ss = section(r.sizeSystem.title)
      const sul = el('ul', 'why')
      for (const t of r.sizeSystem.lines) sul.append(el('li', null, t))
      ss.body.append(sul, el('p', 'tiny', r.sizeSystem.note))
      fold.append(ss.det)
    }

    if (r.reviewViews) {
      // 신발은 키·몸무게 기준 '비슷한 체형' 판정을 추천에 쓰지 않으므로 제목에도 쓰지 않아요.
      const rv = section(r.reviewViews.isShoes ? `리뷰 원문 (불러온 ${r.reviewsLoaded}건)` : `리뷰 원문 (비슷한 체형 ${r.reviewViews.matchedTotal}건 / 불러온 ${r.reviewsLoaded}건${r.reviewViews.excludedTotal ? ` / 제외 ${r.reviewViews.excludedTotal}건` : ''})`)
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
    if (r.shoeView) summarySlot.append(shoeBlock(r.shoeView))
    const dist = fitDistBlock(r.reviewViews)
    if (dist) summarySlot.append(dist)

    // 학습값·사이즈표 모음 안내는 길어서 접어 둬요 (내용과 버튼은 그대로).
    const learnBox = learningBlock(r)
    const chartDbBox = chartDbBlock(r)
    if (learnBox || chartDbBox) {
      const data = section('이 브라우저에 저장된 데이터')
      if (learnBox) data.body.append(learnBox)
      if (chartDbBox) data.body.append(chartDbBox)
      fold.append(data.det)
    }
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
    chosenExtraRows = null // 새로 분석할 때는 이전 직접 입력 표를 쓰지 않아요
    if (chosenFor !== location.href) chosenCategory = null // 다른 상품 페이지로 옮겼으면 이전 선택은 쓰지 않아요
    stage = 'wait'
    await waitForRender()
    stage = 'analyze'
    // 사이즈표를 못 찾으면 짧게 기다렸다가 다시 읽어요. 이 단계에서는 클릭·스크롤 없이 화면 글만 읽습니다.
    let result = await analyzeLearning(profile, { categoryOverride: chosenCategory })
    for (const delay of RETRY_DELAYS) {
      if (result.status !== 'no-data' && result.status !== 'no-product') break
      await new Promise((r) => setTimeout(r, delay))
      result = await analyzeLearning(profile, { categoryOverride: chosenCategory })
    }
    // 리뷰가 AUTO_TARGET건보다 적으면 자동으로 더 불러온 뒤 다시 분석해요 (상품 페이지로 읽힌 경우만).
    if ((result.status === 'ok' || result.status === 'no-data') && !result.usedSite && (result.reviewsLoaded ?? 0) < AUTO_TARGET) {
      stage = 'load'
      fab.textContent = '리뷰 불러오는 중…'
      const res = await loadMoreReviews('auto', showAutoLoading())
      stage = 'analyze'
      const next = await reanalyzeAfterLoad(profile, result.reviewsLoaded ?? 0, res)
      if (next.status === 'ok' || result.status !== 'ok') result = next
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
    if (isProductPage(document) || isUsedListingPage(document, location.href)) ensureUi()
    else if (++tries < 4) setTimeout(maybeShow, 1500)
  }
  maybeShow()
}
