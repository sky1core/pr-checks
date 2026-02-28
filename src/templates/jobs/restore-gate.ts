import type { Config } from '../../types/config.js';
import { STATUS_CONTEXTS, OVERRIDE_KEYWORD } from '../constants/contexts.js';
import { STATUS_MESSAGES } from '../constants/messages.js';

/**
 * Restore Gate job (approval-override.yml)
 *
 * 역할:
 * 1. PR Approve 취소 (dismissed) 시 실행
 * 2. 다른 Approve가 있으면 무시
 * 3. Override된 상태면 원래 상태로 복원
 * 4. 코멘트로 알림
 *
 * @param config Config
 * @param branchCondition 대상 브랜치 조건
 */
export function generateRestoreGateJob(config: Config, branchCondition: string): string {
  const { input } = config;

  // required + mustPass 체크들의 상태 확인 로직 생성
  const requiredMustPassChecks = input.checks.filter((c) => c.mustRun && c.mustPass);
  const checkFailureConditions: string[] = [];

  for (const check of requiredMustPassChecks) {
    const stateVar = `${check.name.toUpperCase().replace(/-/g, '_')}_STATE`;
    checkFailureConditions.push(`
          # ${check.name} 상태 확인
          ${stateVar}_RAW=""
          if ! ${stateVar}_RAW=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/commits/\$HEAD_SHA/statuses"); then
            ${stateVar}="none"
          elif ! ${stateVar}=\$(printf '%s' "\$${stateVar}_RAW" | jq -r '[.[] | select(.context == "${check.name}")] | sort_by(.updated_at) | last | .state // "none"'); then
            ${stateVar}="none"
          fi
          if [ -z "\$${stateVar}" ] || [ "\$${stateVar}" = "null" ]; then
            ${stateVar}="none"
          fi
          if [ "\$${stateVar}" != "success" ]; then
            SHOULD_RESTORE="true"
          fi`);
  }

  // required but !mustPass 체크들도 확인 (실행하지 않았으면 복원)
  const requiredRunOnlyChecks = input.checks.filter((c) => c.mustRun && !c.mustPass);
  for (const check of requiredRunOnlyChecks) {
    const stateVar = `${check.name.toUpperCase().replace(/-/g, '_')}_STATE`;
    checkFailureConditions.push(`
          # ${check.name} 실행 여부 확인
          ${stateVar}_RAW=""
          if ! ${stateVar}_RAW=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/commits/\$HEAD_SHA/statuses"); then
            ${stateVar}="none"
          elif ! ${stateVar}=\$(printf '%s' "\$${stateVar}_RAW" | jq -r '[.[] | select(.context == "${check.name}")] | sort_by(.updated_at) | last | .state // "none"'); then
            ${stateVar}="none"
          fi
          if [ -z "\$${stateVar}" ] || [ "\$${stateVar}" = "null" ]; then
            ${stateVar}="none"
          fi
          if [ "\$${stateVar}" = "none" ] || [ "\$${stateVar}" = "pending" ]; then
            SHOULD_RESTORE="true"
          fi`);
  }

  return `  restore-gate:
    if: |
      github.event.action == 'dismissed' &&
      (${branchCondition})
    runs-on: ubuntu-latest
    permissions:
      statuses: write
      pull-requests: write

    steps:
      - name: Restore PR Checks Status if needed
        run: |
          PR_NUMBER="\${{ github.event.pull_request.number }}"
          HEAD_SHA="\${{ github.event.pull_request.head.sha }}"

          # 다른 Approve가 있으면 무시
          REVIEWS_RAW=""
          if ! REVIEWS_RAW=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/pulls/\$PR_NUMBER/reviews"); then
            echo "⚠️ reviews API 조회 실패"
            APPROVALS=0
          elif ! APPROVALS=\$(printf '%s' "\$REVIEWS_RAW" | jq '[.[] | select(.state == "APPROVED")] | length'); then
            echo "⚠️ reviews JSON 파싱 실패"
            APPROVALS=0
          fi
          if [ -z "\$APPROVALS" ] || [ "\$APPROVALS" = "null" ]; then
            APPROVALS=0
          fi

          if [ "\$APPROVALS" -gt 0 ]; then
            exit 0
          fi

          # 현재 PR Checks Status 확인
          STATUSES_RAW=""
          if ! STATUSES_RAW=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/commits/\$HEAD_SHA/statuses"); then
            echo "⚠️ statuses API 조회 실패"
            exit 0
          fi
          if ! GATE_STATUS=\$(printf '%s' "\$STATUSES_RAW" | jq '[.[] | select(.context == "${STATUS_CONTEXTS.prChecksStatus}")] | sort_by(.updated_at) | last'); then
            echo "⚠️ GATE_STATUS jq 파싱 실패"
            exit 0
          fi

          GATE_STATE=\$(printf '%s' "\$GATE_STATUS" | jq -r '.state // "none"')
          GATE_DESC=\$(printf '%s' "\$GATE_STATUS" | jq -r '.description // ""')
          if [ -z "\$GATE_STATE" ] || [ "\$GATE_STATE" = "null" ]; then
            GATE_STATE="none"
          fi

          # success가 아니면 복원 불필요
          if [ "\$GATE_STATE" != "success" ]; then
            exit 0
          fi

          # Override된 상태가 아니면 복원 불필요
          if [[ "\$GATE_DESC" != *"${OVERRIDE_KEYWORD}"* ]]; then
            exit 0
          fi

          # 각 체크 상태 확인
          SHOULD_RESTORE="false"
${checkFailureConditions.join('\n')}

          if [ "\$SHOULD_RESTORE" = "true" ]; then
            curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
              -H "Content-Type: application/json" \\
              -X POST "\${{ github.api_url }}/repos/\${{ github.repository }}/statuses/\$HEAD_SHA" \\
              -d '{"state":"failure","context":"${STATUS_CONTEXTS.prChecksStatus}","description":"${STATUS_MESSAGES.failure.approvalRequired}"}'

            printf '## ⚠️ Merge Gate 복원\\n\\nApprove가 취소되어 PR Checks Status가 다시 failure 상태가 되었습니다.\\n\\n머지하려면 다시 Approve가 필요합니다.' > comment.md
            BODY=\$(jq -Rs '.' comment.md)
            curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
              -H "Content-Type: application/json" \\
              -X POST "\${{ github.api_url }}/repos/\${{ github.repository }}/issues/\$PR_NUMBER/comments" \\
              -d "{\\"body\\": \$BODY}"
          fi`;
}
