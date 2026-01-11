/**
 * Status description 메시지
 * gh api statuses 호출 시 사용되는 설명문
 */
export const STATUS_MESSAGES = {
  pending: {
    /** 체크 대기 중 */
    waiting: 'Waiting for checks',

    /** 체크 진행 중 */
    inProgress: 'Check in progress...',
  },

  success: {
    /** 체크 통과 */
    passed: 'Check passed',

    /** 모든 필수 체크 완료 */
    allPassed: 'All required checks passed',
  },

  failure: {
    /** 체크 실패 */
    failed: 'Check failed',

    /** 승인 필요 */
    approvalRequired: 'Approval required',
  },
} as const;

/**
 * Override description (restore-gate에서 검색용)
 */
export const OVERRIDE_DESCRIPTION = 'Overridden by approval';
