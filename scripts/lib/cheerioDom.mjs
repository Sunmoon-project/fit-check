// 테스트 전용: cheerio 문서를 pageParser가 쓰는 최소 DOM 인터페이스로 감쌉니다.
// 실제 브라우저의 document와 동작이 완전히 같다는 보장은 아니에요(진짜 Chrome에서는 확인하지 못함).
import * as cheerio from 'cheerio'

export function fakeDocument(html) {
  const $ = cheerio.load(html)
  // 같은 노드는 같은 객체로 돌려줘요 (실제 DOM처럼 ===와 Set이 동작하도록)
  const cache = new WeakMap()
  const wrap = (node) => {
    if (!cache.has(node)) cache.set(node, build(node))
    return cache.get(node)
  }
  const build = (node) => ({
    contains: (other) => other === wrap(node) || $(other._node).parents().toArray().includes(node),
    _node: node,
    nodeType: 1,
    // <br> 줄바꿈을 읽을 수 있도록 글 노드와 요소를 순서대로 돌려줘요 (textContent는 <br>을 버립니다)
    get childNodes() {
      return (node.children || []).map((c) =>
        c.type === 'text' ? { nodeType: 3, nodeValue: c.data, textContent: c.data } : c.type === 'tag' ? wrap(c) : { nodeType: 8, nodeValue: '', textContent: '' },
      )
    },
    get textContent() {
      return $(node).text()
    },
    get children() {
      return $(node).children().toArray().map(wrap)
    },
    get parentElement() {
      const p = $(node).parent()
      return p.length && p[0].type === 'tag' ? wrap(p[0]) : null
    },
    get tagName() {
      return String(node.name || '').toUpperCase()
    },
    get className() {
      return $(node).attr('class') ?? ''
    },
    getAttribute: (n) => $(node).attr(n) ?? null,
    querySelectorAll: (sel) => $(node).find(sel).toArray().map(wrap),
    querySelector: (sel) => {
      const f = $(node).find(sel).first()
      return f.length ? wrap(f[0]) : null
    },
  })
  const root = wrap($.root()[0])
  // 테스트에서 '더보기'를 누르면 리뷰가 늘어나는 페이지를 흉내 낼 수 있게 cheerio 객체를 붙여 둬요.
  root.$ = $
  return root
}
