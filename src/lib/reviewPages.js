// 쇼핑몰의 '후기 전체보기' 페이지 ↔ 상품 페이지 주소. 리뷰 페이지에는 사이즈표가 없어서,
// 상품 페이지에서 분석할 때 이 브라우저에 저장해 둔 사이즈표(사이즈표 모음)를 상품 주소로 찾아 써요.
const MUSINSA_REVIEW_RE = /^https?:\/\/(?:www\.)?musinsa\.com\/review\/goods\/(\d{3,12})(?:[/?#]|$)/i
const MUSINSA_PRODUCT_RE = /^https?:\/\/(?:www\.)?musinsa\.com\/products\/(\d{3,12})(?:[/?#]|$)/i

/** 리뷰 전체보기 페이지면 그 상품 페이지 주소(쿼리 없음), 아니면 null */
export function productUrlOfReviewPage(url) {
  const m = String(url || '').match(MUSINSA_REVIEW_RE)
  return m ? `https://www.musinsa.com/products/${m[1]}` : null
}

/** 상품 페이지면 그 상품의 리뷰 전체보기 주소, 아니면 null */
export function reviewPageOfProduct(url) {
  const m = String(url || '').match(MUSINSA_PRODUCT_RE)
  return m ? `https://www.musinsa.com/review/goods/${m[1]}` : null
}
