// 웹 앱 페이지(허용한 주소)에서만 도는 브리지. 확장 대기열의 옷 정보를 웹 앱에 window.postMessage로 전달하고,
// 웹 앱이 처리했다고 알려준(ack) 항목만 대기열에서 지워요. 네트워크 호출이 없고, 체형 정보는 다루지 않습니다.
// 웹 페이지가 확장에 시킬 수 있는 일은 '대기열 다시 받기(ready)'와 '처리한 id 알리기(ack)' 둘뿐이에요.
import {
  SYNC_QUEUE_KEY, isAllowedPage, postTargetOrigin, isTrustedMessage, pruneQueue, removeAcked,
  makeDeliverMessage, parseAckMessage, isReadyMessage,
} from '../src/lib/wardrobeSync.js'

function start() {
  const loc = window.location
  const target = postTargetOrigin(loc)
  if (!chrome?.storage?.local) return

  const read = (cb) => chrome.storage.local.get(SYNC_QUEUE_KEY, (res) => cb(Array.isArray(res?.[SYNC_QUEUE_KEY]) ? res[SYNC_QUEUE_KEY] : []))
  const write = (queue) => chrome.storage.local.set({ [SYNC_QUEUE_KEY]: queue })

  // 대기열을 정리(만료·형식 오류 제거)하고 남은 항목을 웹 앱에 보냅니다.
  function deliver() {
    read((raw) => {
      const queue = pruneQueue(raw)
      if (queue.length !== raw.length) write(queue)
      if (queue.length > 0) window.postMessage(makeDeliverMessage(queue), target)
    })
  }

  window.addEventListener('message', (event) => {
    if (!isTrustedMessage(event, window, loc)) return
    if (isReadyMessage(event.data)) {
      deliver()
      return
    }
    const ids = parseAckMessage(event.data)
    if (ids && ids.length > 0) read((raw) => write(removeAcked(raw, ids)))
  })

  // 웹 앱이 이미 열려 있을 때: 확장에서 새로 보내면 바로 전달
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SYNC_QUEUE_KEY]) deliver()
  })

  deliver()
}

// manifest의 matches가 넓어져도(또는 실수로 잘못 들어가도) 허용 목록에 없는 페이지에서는 아무것도 하지 않아요.
if (isAllowedPage(window.location)) start()
