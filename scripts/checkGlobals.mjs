// 확장 코드의 "선언되지 않은 식별자"(no-undef 수준)를 찾는 검사. eslint 없이 @babel/parser + @babel/traverse 의 스코프 분석을 씁니다.
// 오타나 지워진 변수(예: 다른 함수의 지역 변수 state 를 참조) 때문에 실행 중 ReferenceError 가 나는 것을 빌드 때 잡기 위한 용도예요.
// 브라우저에서 실제로 실행해 확인하는 것은 아니며, 아래 허용 목록의 전역은 있다고 가정합니다.
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'

const traverse = _traverse.default || _traverse

export const ALLOWED_GLOBALS = new Set([
  // 표준 JS
  'undefined', 'NaN', 'Infinity', 'globalThis', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math', 'JSON', 'Date', 'RegExp',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'URL', 'URLSearchParams', 'Intl',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'escape', 'unescape',
  'Uint8Array', 'ArrayBuffer', 'TextEncoder', 'TextDecoder', 'structuredClone', 'queueMicrotask', 'console',
  // 브라우저·확장
  'window', 'document', 'location', 'navigator', 'chrome', 'history', 'localStorage', 'sessionStorage',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent',
  'getComputedStyle', 'Blob', 'FileReader', 'AbortController', 'performance', 'crypto', 'DOMParser',
  'CSSStyleSheet', 'FormData', 'File', 'Image', 'HTMLInputElement', 'HTMLButtonElement', 'ShadowRoot', 'Document', 'DocumentFragment', 'Headers', 'Request', 'Response',
])

/** 선언 없이 쓰인 전역 이름 목록 (허용 목록 제외, 중복 제거). 문법 오류면 예외를 던져요. */
export function findUndeclared(code, allowed = ALLOWED_GLOBALS) {
  const ast = parse(code, { sourceType: 'unambiguous', errorRecovery: false })
  const names = new Set()
  traverse(ast, {
    Program(path) {
      for (const name of Object.keys(path.scope.globals)) if (!allowed.has(name)) names.add(name)
    },
  })
  return [...names].sort()
}
