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
  const requiredMustPassChecks = input.checks.filter((c) => c.required && c.mustPass);
  const checkFailureConditions: string[] = [];

  for (const check of requiredMustPassChecks) {
    checkFailureConditions.push(`
          # ${check.name} 상태 확인
          ${check.name.toUpperCase().replace(/-/g, '_')}_STATE=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/commits/\$HEAD_SHA/statuses" \\
            | jq -r '[.[] | select(.context == "${check.name}")] | sort_by(.updated_at) | last | .state // "none"')
          if [ "\$${check.name.toUpperCase().replace(/-/g, '_')}_STATE" != "success" ]; then
            SHOULD_RESTORE="true"
          fi`);
  }

  // required but !mustPass 체크들도 확인 (실행하지 않았으면 복원)
  const requiredRunOnlyChecks = input.checks.filter((c) => c.required && !c.mustPass);
  for (const check of requiredRunOnlyChecks) {
    checkFailureConditions.push(`
          # ${check.name} 실행 여부 확인
          ${check.name.toUpperCase().replace(/-/g, '_')}_STATE=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/commits/\$HEAD_SHA/statuses" \\
            | jq -r '[.[] | select(.context == "${check.name}")] | sort_by(.updated_at) | last | .state // "none"')
          if [ "\$${check.name.toUpperCase().replace(/-/g, '_')}_STATE" = "none" ] || [ "\$${check.name.toUpperCase().replace(/-/g, '_')}_STATE" = "pending" ]; then
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
          APPROVALS=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/pulls/\$PR_NUMBER/reviews" \\
            | jq '[.[] | select(.state == "APPROVED")] | length')

          if [ "\$APPROVALS" -gt 0 ]; then
            exit 0
          fi

          # 현재 PR Checks Status 확인
          GATE_STATUS=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/commits/\$HEAD_SHA/statuses" \\
            | jq '[.[] | select(.context == "${STATUS_CONTEXTS.prChecksStatus}")] | sort_by(.updated_at) | last')

          GATE_STATE=\$(echo "\$GATE_STATUS" | jq -r '.state // "none"')
          GATE_DESC=\$(echo "\$GATE_STATUS" | jq -r '.description // ""')

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
