// 웹 앱 쪽 연결: 확장 브리지가 보낸 message를 받아 handler로 넘기고, 처리한 id를 ack로 돌려줘요.
// win/loc을 주입할 수 있어 가짜 창으로 테스트합니다.
import { isTrustedMessage, postTargetOrigin, parseDeliverMessage, makeAckMessage, makeReadyMessage } from './wardrobeSync.js'

// handler(entries) → 처리 완료한 id 배열 (저장에 실패한 항목은 빼야 확장이 다시 보내요). 반환값: 연결 해제 함수.
export function connectExtensionSync(handler, win = window, loc = win.location) {
  const target = postTargetOrigin(loc)
  function onMessage(event) {
    if (!isTrustedMessage(event, win, loc)) return
    const entries = parseDeliverMessage(event.data)
    if (!entries || entries.length === 0) return
    const ids = handler(entries)
    if (Array.isArray(ids) && ids.length > 0) win.postMessage(makeAckMessage(ids), target)
  }
  win.addEventListener('message', onMessage)
  win.postMessage(makeReadyMessage(), target) // 브리지가 먼저 보냈어도 놓치지 않게 한 번 요청
  return () => win.removeEventListener('message', onMessage)
}
