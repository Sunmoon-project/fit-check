// manifest.json 검사. 빌드 결과(dist-extension)가 있으면 참조 파일이 있는지도 확인합니다.
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { findUndeclared } from './checkGlobals.mjs'

export function checkManifest(m, dir = null) {
  const errors = []
  const err = (s) => errors.push(s)
  if (m.manifest_version !== 3) err('manifest_version은 3이어야 해요')
  for (const k of ['name', 'version', 'description']) if (!m[k]) err(`${k} 없음`)
  const perms = m.permissions || []
  for (const p of perms) if (!['storage', 'activeTab', 'scripting'].includes(p)) err(`허용 목록에 없는 권한: ${p}`)
  if (perms.some((p) => /<all_urls>|^https?:|\*/.test(p))) err('permissions에 광범위한 주소 권한이 있어요')
  const hosts = [...(m.host_permissions || []), ...(m.optional_host_permissions || [])]
  if (hosts.length) err('host_permissions는 쓰지 않아요')
  const matches = (m.content_scripts || []).flatMap((c) => c.matches || [])
  for (const x of matches) {
    if (/<all_urls>/.test(x) || /^\*:\/\/\*\//.test(x) || /^https?:\/\/\*\//.test(x)) err(`content_scripts matches가 너무 넓어요: ${x}`)
    // file:// 은 웹 앱 단일 HTML 파일 하나로만 좁힐 때 허용 (file:///* 같은 전체 허용은 거부)
    if (/^file:/.test(x) && !/^file:\/\/\/\*\/fit-check\.html$/.test(x)) err(`file:// matches는 fit-check.html만 허용해요: ${x}`)
  }
  const csp = JSON.stringify(m.content_security_policy || {})
  if (/https?:|unsafe-eval|unsafe-inline/.test(csp)) err('CSP에 원격 주소나 unsafe-*가 있어요')
  if (JSON.stringify(m).match(/https?:\/\/[^"]*\.js/)) err('원격 스크립트 주소가 있어요')
  if (m.background?.service_worker && /^https?:/.test(m.background.service_worker)) err('원격 service_worker')
  const files = [
    ...(m.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
    m.action?.default_popup,
    ...Object.values(m.icons || {}),
    ...Object.values(m.action?.default_icon || {}),
  ].filter(Boolean)
  if (dir) for (const f of files) if (!existsSync(resolve(dir, f))) err(`참조 파일 없음: ${f}`)
  return errors
}

// 직접 실행: node scripts/checkExtension.mjs  (dist-extension 기준)
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = resolve(import.meta.dirname, '..', 'dist-extension')
  const m = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'))
  const errors = checkManifest(m, dir)
  for (const f of ['content.js', 'bridge.js', 'popup.js', 'popup.html', 'manifest.json']) if (!existsSync(resolve(dir, f))) errors.push(`${f} 없음`)
  const html = readFileSync(resolve(dir, 'popup.html'), 'utf8')
  if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(html)) errors.push('popup.html에 인라인 스크립트가 있어요')
  for (const f of ['content.js', 'bridge.js', 'popup.js']) {
    const code = readFileSync(resolve(dir, f), 'utf8')
    try {
      const bad = findUndeclared(code)
      if (bad.length) errors.push(`${f}에 선언되지 않은 식별자가 있어요: ${bad.join(', ')}`)
    } catch (e) {
      errors.push(`${f} 문법 분석 실패: ${e.message}`)
    }
    if (/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\b\s*\(/.test(code) || /new (WebSocket|XMLHttpRequest)/.test(code)) errors.push(`${f}에 네트워크 호출이 있어요`)
  }
  if (errors.length) {
    console.error(errors.map((e) => `- ${e}`).join('\n'))
    process.exit(1)
  }
  console.log('extension manifest ok')
}
