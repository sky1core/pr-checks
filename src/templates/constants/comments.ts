/**
 * 코멘트 마커 상수
 * PR 코멘트 식별 및 접기 처리에 사용
 */
export const COMMENT_MARKERS = {
  /**
   * 테스트 성공 댓글 시작 패턴 생성
   * @param checkName 체크 이름
   */
  prTestPass: (checkName: string) => `## ✅ ${checkName}`,

  /**
   * 테스트 실패 댓글 시작 패턴 생성
   * @param checkName 체크 이름
   */
  prTestFail: (checkName: string) => `## ❌ ${checkName}`,

  /**
   * 리뷰 댓글 시작 패턴 (jq test용 정규식)
   * @param checkName 체크 이름
   */
  prReviewPattern: (checkName: string) => `^## [✅❌] ${checkName}`,

  /** 펼쳐진 상태 마커 */
  detailsOpen: '<details open>',

  /** 접힌 상태 마커 */
  detailsClosed: '<details>',
} as const;
