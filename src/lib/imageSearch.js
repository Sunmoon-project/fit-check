// 사진 역검색: 판매글 사진으로 같은 상품(브랜드·모델·품번) 후보를 찾는 공급자 인터페이스예요.
// 기본 provider가 null이라 비활성이고, 네트워크를 쓰지 않아요. 웹 앱은 서버가 켜져 있다고 알려줄 때만
// createServerImageProvider()를 꽂아요(서버 /api/image-search, server/imageSearch.js, 외부 서비스 연결은 미검증).
//
// provider 계약: { searchByImage({ urls }) → Promise<Array<{ brand?, model?, code? }> | { candidates, pages }> }
//   - urls는 https 사진 주소 최대 5개예요.
//   - 외부 서비스에 사진 주소를 보내는 공급자는 서버 쪽(server/)에 두고, 사용자 동의와 키 관리는 그쪽에서 해요(docs/사진_역검색.md).
//   - 확장(content script)은 네트워크 호출을 하지 않는 원칙이라 이 기능을 확장에서 직접 쓰지 않아요.
// 후보는 usedAnalyze.findChartMatches의 candidates로 넘기면 사이즈표 DB 조회에 같이 쓰여요.

export const IMAGE_SEARCH_MAX_URLS = 5
export const IMAGE_SEARCH_MAX_CANDIDATES = 5
export const IMAGE_SEARCH_MAX_PAGES = 8
export const IMAGE_SEARCH_NOTICE = '판매글 사진 주소가 외부 이미지 검색 서비스로 전송돼요.'
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

/** 공급자가 돌려준 링크를 https만, 개수·길이를 제한해 정리해요. 링크는 사용자가 직접 열어보는 용도예요(크롤링 안 함). */
export function cleanPages(list) {
  const out = []
  for (const p of Array.isArray(list) ? list : []) {
    const url = String(p?.url ?? '')
    if (!/^https:\/\//i.test(url) || url.length > 500) continue
    out.push({ url, title: cut(p?.title, 160) || url })
    if (out.length >= IMAGE_SEARCH_MAX_PAGES) break
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
        const raw = await provider.searchByImage({ urls: list })
        const obj = Array.isArray(raw) ? { candidates: raw, pages: [] } : raw || {}
        return { status: 'ok', candidates: cleanCandidates(obj.candidates), pages: cleanPages(obj.pages), message: '' }
      } catch (e) {
        // 공급자가 사용자에게 보여줄 문구(userMessage)를 주면 그대로 써요. 그 밖의 오류 내용은 보이지 않아요.
        return { status: 'error', candidates: [], pages: [], message: cut(e?.userMessage, 200) || '사진 검색에 실패했어요.' }
      }
    },
  }
}

const SERVER_ERROR_TEXT = '사진 검색에 실패했어요.'

/** 서버가 사진 역검색을 켰는지 확인해요(GET /api/status). 서버가 없거나 실패하면 false. 사진 주소는 보내지 않아요. */
export async function fetchImageSearchEnabled(fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn('/api/status')
    if (!res.ok) return false
    return (await res.json())?.imageSearch === true
  } catch {
    return false
  }
}

/**
 * 웹 서버의 POST /api/image-search를 부르는 공급자. 검색할 때만(사용자가 버튼을 눌렀을 때) 호출돼요.
 * 비용을 아끼려고 사진은 첫 번째 한 장만 보내요. 서버가 준 문구는 길이를 제한해 오류로 넘겨요.
 */
export function createServerImageProvider(fetchFn = globalThis.fetch) {
  return {
    async searchByImage({ urls }) {
      let res
      try {
        res = await fetchFn('/api/image-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: urls[0] }),
        })
      } catch {
        throw Object.assign(new Error('network'), { userMessage: '서버에 연결하지 못했어요.' })
      }
      let body = null
      try {
        body = await res.json()
      } catch {
        // 본문이 JSON이 아니면 아래에서 일반 문구
      }
      if (!res.ok) throw Object.assign(new Error('http'), { userMessage: typeof body?.message === 'string' ? body.message : SERVER_ERROR_TEXT })
      return {
        candidates: (Array.isArray(body?.candidates) ? body.candidates : []).map((c) => ({ brand: c?.brand, model: c?.model || c?.label })),
        pages: body?.pages,
      }
    },
  }
}
