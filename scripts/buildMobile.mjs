// `npm run build:mobile`: 확장 빌드(dist-extension/)를 모바일 앱(mobile/)이 WebView에 넣을 문자열로 묶어요 → mobile/injected.js
// 모바일 앱은 쇼핑몰을 앱 안 브라우저로 열고 확장의 content.js를 그대로 실행해요. 분석 코드는 한 벌만 유지해요.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const ext = (f) => readFileSync(resolve(root, 'dist-extension', f), 'utf8')

// chrome.* 대용: 저장은 앱(AsyncStorage)에 맡기고 메시지로 주고받아요. 확장이 쓰는 storage.local과 runtime 일부만 흉내 내요.
// 앱(App.js)은 허용 목록의 쇼핑몰 주소에서 온 메시지만 받아요. 남은 한계(ponytail): 허용된 쇼핑몰 페이지 자체는 같은 세계에서 돌아서
// 이 통로를 흉내 낼 수 있어요. 스토어에 올릴 때는 네이티브 격리 세계(content world)나 세션 토큰으로 옮기세요.
const SHIM = `function __fcChrome(){
  var seq=0,cbs={};
  window.__fcReply=function(id,data){var f=cbs[id];delete cbs[id];if(f)f(data)};
  function call(op,payload,cb){var id=++seq;cbs[id]=cb;window.ReactNativeWebView.postMessage(JSON.stringify({fc:1,id:id,op:op,payload:payload}))}
  return {fitcheckMobile:true,
    storage:{local:{get:function(k,cb){call('get',k,cb)},set:function(o,cb){call('set',o,cb)},remove:function(k,cb){call('remove',k,cb)}}},
    runtime:{lastError:null,getManifest:function(){return {version:'mobile'}},onMessage:{addListener:function(){}}}}
}`

// 쇼핑몰 페이지에 넣는 코드: content.js가 쓰는 chrome을 바깥(window)에 두지 않고 인자로만 넘겨요.
const contentJs = `(function(){if(window.__fitcheckInjected)return;window.__fitcheckInjected=true;${SHIM}
(function(chrome){${ext('content.js').replaceAll('이 브라우저에만', '이 기기에만')}
})(__fcChrome())})();true;`

// 아이폰용 체형 입력 화면: 앱 홈과 같은 색·글씨 크기(17pt 본문, 54pt 칸)로 덮어써요. 제목·닫기는 앱 시트가 그려요.
const MOBILE_POPUP_CSS = `:root{--ink:#191f28;--sub:#4e5968;--mute:#8b95a1;--line:#e5e8eb;--soft:#f2f4f6;--accent:#3182f6}
html{-webkit-text-size-adjust:100%;word-break:keep-all;overflow-wrap:anywhere}
p,.gt p,.hint{text-wrap:pretty}
body{width:auto;padding:8px 24px calc(120px + env(safe-area-inset-bottom));font-size:16px;-webkit-tap-highlight-color:transparent}
#run,h1{display:none}
.hint{font-size:15px;line-height:1.5;margin:0 0 28px;color:var(--sub)}
.hint.sub{font-size:14px;margin:4px 0 16px;color:var(--mute)}
form{gap:24px}
label{font-size:14px;font-weight:600;gap:8px;color:var(--sub)}
fieldset{padding:4px;border-radius:14px;grid-template-columns:1fr 1fr}
legend{display:none}
fieldset label{padding:12px 0;font-size:16px;border-radius:11px;color:var(--sub)}
fieldset label:has(input:checked){color:var(--ink);box-shadow:0 1px 4px rgba(0,0,0,.08)}
.two{gap:12px}
input[type=number],select{height:54px;padding:0 16px;border:0;border-radius:14px;background:var(--soft);font-size:17px!important;font-weight:600;-webkit-appearance:none;appearance:none}
input[type=number]:focus,select:focus{box-shadow:0 0 0 2px var(--accent);border:0}
select{background-image:linear-gradient(45deg,transparent 50%,var(--mute) 50%),linear-gradient(135deg,var(--mute) 50%,transparent 50%);background-position:calc(100% - 22px) 24px,calc(100% - 17px) 24px;background-size:5px 5px;background-repeat:no-repeat}
details{border:0;border-radius:16px;background:var(--soft);padding:0 18px}
details[open]{padding-bottom:18px}
details input[type=number],details select{background-color:#fff}
summary{padding:18px 0;font-size:16px}
.opt{font-size:14px}
.guide{background:#fff;border-radius:14px;padding:12px}
.gb .ga{stroke:#e5e8eb}
.gchips button{padding:6px 11px;font-size:13px}
.gt b{font-size:15px}.gt p{font-size:14px;line-height:1.5}
button.secondary{position:fixed;left:24px;right:24px;bottom:calc(16px + env(safe-area-inset-bottom));width:auto;height:56px;margin:0;border:0;border-radius:16px;background:var(--accent);color:#fff;font-size:17px;box-shadow:0 -12px 24px 12px #fff}
button.secondary:hover{background:var(--accent)}
button.secondary:active{transform:scale(.98);background:#1b64da}
#status{position:fixed;left:24px;right:24px;bottom:calc(84px + env(safe-area-inset-bottom));padding:12px 16px;border-radius:14px;background:#fff;box-shadow:0 4px 16px rgba(0,0,0,.12);text-align:center;font-size:14px;font-weight:600;line-height:1.45;color:var(--accent);margin:0}
#status:empty{display:none}
#status.err{color:#e5484d}`

// 내 체형 입력 화면: 확장 팝업(popup.html)을 그대로 써요. '이 페이지에서 찾기' 버튼은 앱에 탭이 없으니 숨겨요.
const profileHtml = ext('popup.html')
  .replace('<link rel="stylesheet" href="popup.css" />', `<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" /><style>${ext('popup.css')}
${MOBILE_POPUP_CSS}</style>`)
  .replace('이 브라우저에만 저장돼요.', '이\u00a0기기에만 저장돼요.')
  .replace('체형 정보 저장</button>', '저장하기</button>')
  .replace('<script src="popup.js"></script>', `<script>${SHIM};window.chrome=__fcChrome()</script><script>${ext('popup.js').replace('이 브라우저에만 보관돼요.', '이 기기에만 보관돼요.').replace(/<\/script/g, '<\\/script')}</script>`)
if (!profileHtml.includes('__fcChrome') || !profileHtml.includes('width=device-width')) throw new Error('popup.html 모양이 바뀌어 모바일용으로 묶지 못했어요.')

writeFileSync(
  resolve(root, 'mobile', 'injected.js'),
  `// 자동 생성 파일이에요 (npm run build:mobile). 직접 고치지 마세요.\nexport const CONTENT_JS = ${JSON.stringify(contentJs)}\nexport const PROFILE_HTML = ${JSON.stringify(profileHtml)}\n`,
)
console.log('mobile/injected.js 생성 완료')
