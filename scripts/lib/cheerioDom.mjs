// 테스트 전용: cheerio 문서를 pageParser가 쓰는 최소 DOM 인터페이스로 감쌉니다.
// 실제 브라우저의 document와 동작이 완전히 같다는 보장은 아니에요(진짜 Chrome에서는 확인하지 못함).
import * as cheerio from 'cheerio'

export function fakeDocument(html) {
  const $ = cheerio.load(html)
  const wrap = (node) => ({
    get textContent() {
      return $(node).text()
    },
    getAttribute: (n) => $(node).attr(n) ?? null,
    querySelectorAll: (sel) => $(node).find(sel).toArray().map(wrap),
    querySelector: (sel) => {
      const f = $(node).find(sel).first()
      return f.length ? wrap(f[0]) : null
    },
  })
  return wrap($.root()[0])
}
