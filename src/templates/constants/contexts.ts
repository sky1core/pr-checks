/**
 * GitHub Commit Status API에서 사용하는 context 이름들
 * 이 값들을 변경하면 워크플로우 동작에 영향을 줌
 */
export const STATUS_CONTEXTS = {
  /** 종합 머지 게이트 status */
  prChecksStatus: 'PR Checks Status',
} as const;

/**
 * override 판정 키워드
 * restore-gate에서 description에 이 키워드가 포함되어 있으면 override로 판정
 */
export const OVERRIDE_KEYWORD = 'Overridden';
