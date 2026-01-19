/**
 * 코멘트 메타데이터 타입
 */
export interface CommentMetadata {
  type: 'pr-test' | 'pr-review';
  check: string;
  sha: string;
  collapsed: boolean;
}

/**
 * 메타데이터 마커 prefix (HTML 주석)
 */
export const METADATA_PREFIX = '<!-- pr-checks:';
export const METADATA_SUFFIX = ' -->';

/**
 * 코멘트 마커 상수
 * PR 코멘트 식별 및 접기 처리에 사용
 */
export const COMMENT_MARKERS = {
  /**
   * 메타데이터 마커 생성
   * @param meta 메타데이터 객체
   */
  metadata: (meta: CommentMetadata) =>
    `${METADATA_PREFIX}${JSON.stringify(meta)}${METADATA_SUFFIX}`,

  /**
   * 메타데이터 jq 패턴 (체크명 기준, 모든 코멘트)
   * @param checkName 체크 이름
   */
  metadataPattern: (checkName: string) =>
    `^<!-- pr-checks:.*check.*${checkName}.*-->`,

  /**
   * 접히지 않은 코멘트 찾기용 jq 패턴 (collapsed:false)
   * bash 문자열 내에서 따옴표 이스케이프 문제를 피하기 위해 단순화된 패턴 사용
   * @param checkName 체크 이름
   */
  collapsiblePattern: (checkName: string) =>
    `^<!-- pr-checks:.*check.*${checkName}.*collapsed.:false.*-->`,

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
   * 테스트 댓글 시작 패턴 (jq test용 정규식, 성공/실패 모두 매칭)
   * @param checkName 체크 이름
   */
  prTestPattern: (checkName: string) => `^## [✅❌] ${checkName}`,

  /**
   * 리뷰 댓글 시작 패턴 (jq test용 정규식)
   * 3단계: ✅ OK, ⚠️ WARNING, ❌ CRITICAL
   * @param checkName 체크 이름
   */
  prReviewPattern: (checkName: string) => `^## [✅⚠️❌] ${checkName}`,

  /** 펼쳐진 상태 마커 */
  detailsOpen: '<details open>',

  /** 접힌 상태 마커 */
  detailsClosed: '<details>',
} as const;
