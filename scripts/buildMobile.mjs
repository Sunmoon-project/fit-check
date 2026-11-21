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
(function(chrome){${ext('content.js')}
})(__fcChrome())})();true;`

// 내 체형 입력 화면: 확장 팝업(popup.html)을 그대로 써요. '이 페이지에서 찾기' 버튼은 앱에 탭이 없으니 숨겨요.
const profileHtml = ext('popup.html')
  .replace('<link rel="stylesheet" href="popup.css" />', `<meta name="viewport" content="width=320" /><style>${ext('popup.css')}
input,select{font-size:16px!important}#run,h1{display:none}</style>`)
  .replace('<script src="popup.js"></script>', `<script>${SHIM};window.chrome=__fcChrome()</script><script>${ext('popup.js').replace(/<\/script/g, '<\\/script')}</script>`)
if (!profileHtml.includes('__fcChrome') || !profileHtml.includes('width=320')) throw new Error('popup.html 모양이 바뀌어 모바일용으로 묶지 못했어요.')

writeFileSync(
  resolve(root, 'mobile', 'injected.js'),
  `// 자동 생성 파일이에요 (npm run build:mobile). 직접 고치지 마세요.\nexport const CONTENT_JS = ${JSON.stringify(contentJs)}\nexport const PROFILE_HTML = ${JSON.stringify(profileHtml)}\n`,
)
console.log('mobile/injected.js 생성 완료')
