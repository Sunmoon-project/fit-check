// 사용자가 붙여넣은 URL을 서버에서 가져올 때 쓰는 안전한 fetch.
// 내부망(localhost, 사설 IP)으로의 요청을 막고(SSRF 방지), 크기·시간을 제한합니다.
// 알려진 한계: DNS 검사(dns.lookup)와 실제 접속(fetch)이 따로 이름을 풀어서, DNS 리바인딩은
// 완전히 막지 못해요. 내 컴퓨터에서 도는 개발용 서버라 감수하고, 공개 배포 시에는 접속 주소 고정이 필요해요.
import dns from 'node:dns/promises'
import net from 'node:net'

const MAX_BYTES = 3 * 1024 * 1024
const TIMEOUT_MS = 12000
const MAX_REDIRECTS = 4

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'

// 막을 주소 대역. net.BlockList는 IPv4-mapped IPv6(::ffff:7f00:1 등)도 IPv4 규칙으로 검사해요.
const BLOCKED = new net.BlockList()
for (const [addr, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3], // 멀티캐스트 + 예약 대역(240/4)까지
]) {
  BLOCKED.addSubnet(addr, prefix, 'ipv4')
}
for (const [addr, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  BLOCKED.addSubnet(addr, prefix, 'ipv6')
}

export function isPrivateIp(ip) {
  const type = net.isIPv4(ip) ? 'ipv4' : net.isIPv6(ip) ? 'ipv6' : null
  if (!type) return true // IP가 아니면 안전하게 차단
  return BLOCKED.check(ip, type)
}

// 응답 바이트를 문자열로. Content-Type → <meta charset> 순으로 인코딩을 찾고, 없으면 UTF-8.
// 오래된 한국 쇼핑몰의 EUC-KR 페이지도 읽을 수 있어요.
export function decodeHtml(buf, contentType = '') {
  const head = buf.subarray(0, 4096).toString('latin1')
  const charset =
    /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || '')?.[1] ||
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ||
    'utf-8'
  try {
    return new TextDecoder(charset.toLowerCase()).decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
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
    return { html: decodeHtml(Buffer.concat(chunks), res.headers.get('content-type')), finalUrl: url.toString() }
  }
  throw new FetchError('REDIRECT', '리다이렉트가 너무 많아요.')
}
