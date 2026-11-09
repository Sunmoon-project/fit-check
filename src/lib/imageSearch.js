// 사진 역검색 자리: 판매글 사진으로 같은 상품(브랜드·모델·품번) 후보를 찾는 공급자 인터페이스예요.
// 이번 단계에서는 실제 검색을 구현하지 않았어요. 기본 provider가 null이라 비활성이고, 네트워크를 쓰지 않아요.
//
// provider 계약: { searchByImage({ urls }) → Promise<Array<{ brand?, model?, code? }>> }
//   - urls는 https 사진 주소 최대 5개예요.
//   - 외부 서비스에 사진 주소를 보내는 공급자는 서버 쪽(server/)에 두고, 사용자 동의와 키 관리를 따로 설계해야 해요(docs/중고_라벨인식.md).
//   - 확장(content script)은 네트워크 호출을 하지 않는 원칙이라 이 기능을 확장에서 직접 쓰지 않아요.
// 후보는 usedAnalyze.findChartMatches의 candidates로 넘기면 사이즈표 DB 조회에 같이 쓰여요.

export const IMAGE_SEARCH_MAX_URLS = 5
export const IMAGE_SEARCH_MAX_CANDIDATES = 5
export const IMAGE_SEARCH_DISABLED_TEXT = '사진 역검색은 아직 연결된 검색 서비스가 없어서 쓸 수 없어요. (준비 중)'

const cut = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const httpsUrls = (urls) => [...new Set((Array.isArray(urls) ? urls : []).filter((u) => /^https:\/\//i.test(String(u)) && String(u).length < 600))].slice(0, IMAGE_SEARCH_MAX_URLS)

/** 공급자가 돌려준 값을 안전한 후보 목록으로 정리해요. 이름이 하나도 없는 후보는 버려요. */
export function cleanCandidates(list) {
  const out = []
  for (const c of Array.isArray(list) ? list : []) {
    const cand = { brand: cut(c?.brand, 40), model: cut(c?.model, 120), code: cut(c?.code, 40) }
    if (cand.brand || cand.model || cand.code) out.push(cand)
    if (out.length >= IMAGE_SEARCH_MAX_CANDIDATES) break
  }
  return out
}

/** @param {{ searchByImage?: Function }|null} provider 없으면(null) 비활성 */
export function createImageSearcher(provider = null) {
  const enabled = !!provider && typeof provider.searchByImage === 'function'
  return {
    enabled,
    async search(urls) {
      if (!enabled) return { status: 'disabled', candidates: [], message: IMAGE_SEARCH_DISABLED_TEXT }
      const list = httpsUrls(urls)
      if (!list.length) return { status: 'no-photo', candidates: [], message: '검색할 사진 주소(https)가 없어요.' }
      try {
        return { status: 'ok', candidates: cleanCandidates(await provider.searchByImage({ urls: list })), message: '' }
      } catch {
        return { status: 'error', candidates: [], message: '사진 검색에 실패했어요.' }
      }
    },
  }
}
