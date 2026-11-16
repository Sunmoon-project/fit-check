// 사용자가 붙여넣은 URL을 서버에서 가져올 때 쓰는 안전한 fetch.
// 내부망(localhost, 사설 IP)으로의 요청을 막고(SSRF 방지), 크기·시간을 제한합니다.
// DNS 리바인딩 방지: 접속할 때 쓰는 lookup(safeLookup)에서 IP를 검사해요. 검사한 IP로 바로 접속하므로
// "검사할 땐 공인 IP, 접속할 땐 내부 IP"로 바꿔치기할 틈이 없어요(공개 배포용).
import dns from 'node:dns/promises'
import { lookup as dnsLookupCb } from 'node:dns'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'

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

export async function assertPublicUrl(raw) {
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
    let res
    try {
      res = await request(url)
    } catch (e) {
      if (e instanceof FetchError) throw e
      throw new FetchError('NETWORK', e.code === 'TIMEOUT' ? '사이트 응답이 너무 느려요.' : '사이트에 접속하지 못했어요.')
    }

    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      res.destroy()
      current = new URL(res.headers.location, url).toString()
      continue
    }
    if (res.status < 200 || res.status >= 300) {
      res.destroy()
      throw new FetchError('HTTP_' + res.status, `사이트가 페이지를 주지 않았어요 (HTTP ${res.status}).`)
    }

    // 크기 제한을 지키며 본문 읽기 (압축은 풀고 나서 셈)
    const chunks = []
    let size = 0
    try {
      for await (const chunk of res.body) {
        size += chunk.length
        if (size > MAX_BYTES) break
        chunks.push(chunk)
      }
    } catch {
      if (!chunks.length) throw new FetchError('NETWORK', '사이트 응답을 읽지 못했어요.')
    } finally {
      res.destroy()
    }
    return { html: decodeHtml(Buffer.concat(chunks), res.headers['content-type']), finalUrl: url.toString() }
  }
  throw new FetchError('REDIRECT', '리다이렉트가 너무 많아요.')
}

// 접속 순간의 DNS 조회. 사설·내부 IP가 하나라도 나오면 접속 자체를 거부해요.
export function safeLookup(hostname, options, cb) {
  dnsLookupCb(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err)
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
      return cb(new FetchError('BLOCKED', '내부망 주소는 가져올 수 없어요.'))
    }
    if (options.all) return cb(null, addrs)
    cb(null, addrs[0].address, addrs[0].family)
  })
}

// fetch 대신 http(s).request: lookup을 직접 넘길 수 있어서 검사한 IP로만 접속해요.
function request(url) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http
    const req = mod.request(
      url,
      {
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'ko-KR,ko;q=0.9', 'Accept-Encoding': 'gzip, deflate, br' },
      },
      (res) => {
        const enc = String(res.headers['content-encoding'] || '').toLowerCase()
        const unzip = enc === 'gzip' ? zlib.createGunzip() : enc === 'deflate' ? zlib.createInflate() : enc === 'br' ? zlib.createBrotliDecompress() : null
        const body = unzip ? res.pipe(unzip) : res
        if (unzip) res.on('error', (e) => unzip.destroy(e))
        resolve({ status: res.statusCode, headers: res.headers, body, destroy: () => { res.destroy(); unzip?.destroy() } })
      },
    )
    // 전체 시간 제한 (socket timeout은 '조용한 시간'만 재므로 따로 둬요)
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), TIMEOUT_MS)
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })))
    req.on('error', (e) => { clearTimeout(timer); reject(e) })
    req.on('close', () => clearTimeout(timer))
    req.end()
  })
}
