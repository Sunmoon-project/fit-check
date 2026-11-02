// `vite build --mode file`에서 쓰는 플러그인: 빌드된 JS·CSS를 index.html 안에 넣어
// 서버 없이 더블클릭으로 열 수 있는 dist/fit-check.html 한 파일을 만듭니다.
export const SINGLE_FILE_NAME = 'fit-check.html'

const escapeScript = (code) => code.replace(/<\/(script)/gi, '<\\/$1')
const escapeStyle = (code) => code.replace(/<\/(style)/gi, '<\\/$1')
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function singleFile() {
  return {
    name: 'fit-check-single-file',
    apply: 'build',
    enforce: 'post',
    config() {
      return {
        base: './',
        build: {
          emptyOutDir: false, // 일반 빌드 결과(dist/)는 그대로 둡니다.
          assetsInlineLimit: Number.MAX_SAFE_INTEGER,
          cssCodeSplit: false,
          modulePreload: false,
          rollupOptions: { output: { inlineDynamicImports: true } },
        },
      }
    },
    generateBundle(_, bundle) {
      const page = bundle['index.html']
      if (!page) return
      let html = String(page.source)

      for (const [name, item] of Object.entries(bundle)) {
        const ref = new RegExp(`(?:\\./|/)?${escapeRe(name)}`)
        if (item.type === 'chunk' && name.endsWith('.js')) {
          const tag = new RegExp(`<script[^>]*src="${ref.source}"[^>]*></script>`)
          html = html.replace(tag, () => `<script type="module">${escapeScript(item.code)}</script>`)
          delete bundle[name]
        } else if (item.type === 'asset' && name.endsWith('.css')) {
          const tag = new RegExp(`<link[^>]*href="${ref.source}"[^>]*>`)
          html = html.replace(tag, () => `<style>${escapeStyle(String(item.source))}</style>`)
          delete bundle[name]
        }
      }

      const leftover = Object.keys(bundle).filter((n) => n !== 'index.html')
      if (leftover.length) this.warn(`인라인하지 못한 파일: ${leftover.join(', ')}`)

      delete bundle['index.html']
      this.emitFile({ type: 'asset', fileName: SINGLE_FILE_NAME, source: html })
    },
  }
}
