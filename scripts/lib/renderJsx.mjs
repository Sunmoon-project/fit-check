// 웹 컴포넌트를 실제로 서버 렌더(renderToStaticMarkup)해 보는 테스트 도우미.
// esbuild(devDependencies에 고정)로 컴포넌트를 임시 ESM 한 개로 묶어 불러오고, 끝나면 임시 폴더를 지웁니다.
// 임시 폴더는 react 같은 외부 패키지를 찾을 수 있도록 프로젝트의 node_modules 안에 만들어요(git 무시 대상).
import { build } from 'esbuild'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const ROOT = resolve(import.meta.dirname, '..', '..')
const COMPONENTS = ['ResultView', 'ShoeCompare', 'CategoryPicker', 'SizeSummary', 'SimilarityCompare', 'Wardrobe', 'TryOnPanel', 'SizeChartLibrary']

// 컴포넌트가 import 시점이나 렌더 중에 window/localStorage를 건드려도 죽지 않게 하는 최소한의 가짜.
// 쓰는 동안에만 걸어 두고 끝나면 원래대로 돌려놔서, 뒤에 오는 smoke 검사(typeof window 등)에 새지 않게 해요.
function withFakeGlobals(fn) {
  const had = ['window', 'localStorage'].map((k) => [k, Object.prototype.hasOwnProperty.call(globalThis, k), globalThis[k]])
  const store = new Map()
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)), removeItem: (k) => void store.delete(k), clear: () => store.clear() }
  globalThis.window = { localStorage: globalThis.localStorage, matchMedia: () => ({ matches: true }), addEventListener() {}, removeEventListener() {} }
  const restore = () => { for (const [k, existed, v] of had) { if (existed) globalThis[k] = v; else delete globalThis[k] } }
  let out
  try { out = fn() } catch (e) { restore(); throw e }
  if (out && typeof out.then === 'function') return out.finally(restore)
  restore()
  return out
}

/** 컴포넌트들을 묶어 불러와 { 이름: 컴포넌트 }로 돌려줘요. 임시 파일은 불러온 직후 지워요. */
export function loadComponents() {
  return withFakeGlobals(loadComponentsInner)
}

async function loadComponentsInner() {
  const cacheDir = join(ROOT, 'node_modules', '.cache')
  mkdirSync(cacheDir, { recursive: true })
  const dir = mkdtempSync(join(cacheDir, 'fitcheck-render-'))
  try {
    const outfile = join(dir, 'components.mjs')
    await build({
      stdin: {
        contents: COMPONENTS.map((n) => `export { default as ${n} } from './src/components/${n}.jsx'`).join('\n') + "\nexport { SimilarInWardrobe } from './src/components/Wardrobe.jsx'\n",
        resolveDir: ROOT,
        loader: 'js',
      },
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      jsx: 'automatic',
      loader: { '.js': 'jsx' },
      packages: 'external',
      logLevel: 'silent',
    })
    return await import(pathToFileURL(outfile).href)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export const render = (Component, props) => withFakeGlobals(() => renderToStaticMarkup(createElement(Component, props)))
// 태그를 벗기고 공백을 정리한 화면 글자
export const textOf = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
