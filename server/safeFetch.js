// 사용자가 붙여넣은 URL을 서버에서 가져올 때 쓰는 안전한 fetch.
// 내부망(localhost, 사설 IP)으로의 요청을 막고(SSRF 방지), 크기·시간을 제한합니다.
import dns from 'node:dns/promises'
import net from 'node:net'

const MAX_BYTES = 3 * 1024 * 1024
const TIMEOUT_MS = 12000
const MAX_REDIRECTS = 4

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    )
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7))
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')
}

async function assertPublicUrl(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new FetchError('INVALID_URL', '올바른 주소 형식이 아니에요.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchError('INVALID_URL', 'http 또는 https 주소만 지원해요.')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => [])
  if (addrs.length === 0) throw new FetchError('DNS_FAIL', '해당 사이트를 찾을 수 없어요.')
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw new FetchError('BLOCKED', '내부망 주소는 가져올 수 없어요.')
  }
  return url
}

export class FetchError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// HTML 문자열을 반환. 리다이렉트마다 주소를 다시 검사합니다.
export async function safeFetchHtml(rawUrl) {
  let current = rawUrl
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const url = await assertPublicUrl(current)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    let res
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'ko-KR,ko;q=0.9' },
      })
    } catch (e) {
      clearTimeout(timer)
      throw new FetchError('NETWORK', e.name === 'AbortError' ? '사이트 응답이 너무 느려요.' : '사이트에 접속하지 못했어요.')
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer)
      current = new URL(res.headers.get('location'), url).toString()
      continue
    }
    if (!res.ok) {
      clearTimeout(timer)
      throw new FetchError('HTTP_' + res.status, `사이트가 페이지를 주지 않았어요 (HTTP ${res.status}).`)
    }

    // 크기 제한을 지키며 본문 읽기
    const reader = res.body.getReader()
    const chunks = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > MAX_BYTES) {
          ctrl.abort()
          break
        }
        chunks.push(value)
      }
    } finally {
      clearTimeout(timer)
    }
    return { html: Buffer.concat(chunks).toString('utf-8'), finalUrl: url.toString() }
  }
  throw new FetchError('REDIRECT', '리다이렉트가 너무 많아요.')
}
