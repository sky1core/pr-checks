import type { Config, Check } from '../../types/config.js';
import { STATUS_CONTEXTS } from '../constants/contexts.js';
import { STATUS_MESSAGES, OVERRIDE_DESCRIPTION } from '../constants/messages.js';

/**
 * 종합 판정 (PR Checks Status) + Approve 확인 job
 *
 * 역할:
 * 1. 각 체크의 status 확인
 * 2. required + mustPass 조건 기반으로 머지 게이트 결정
 * 3. Approve가 있으면 override
 */
export function generateReviewStatusJob(config: Config): string {
  const { input } = config;
  const requiredChecks = input.checks.filter((c) => c.required);

  // 의존성: check-trigger + 모든 체크 jobs
  const allJobIds = input.checks.map((c) => c.name);
  const dependencies = ['check-trigger', ...allJobIds];

  // 각 required check의 상태를 확인하는 조건들
  const checkConditions: string[] = [];
  for (const check of requiredChecks) {
    if (check.mustPass) {
      // 성공해야 함
      checkConditions.push(`
          # ${check.name}: must pass
          ${check.name.toUpperCase().replace(/-/g, '_')}_STATE=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/commits/\$HEAD_SHA/statuses" \\
            | jq -r '[.[] | select(.context == "${check.name}")] | sort_by(.updated_at) | last | .state // "none"')
          echo "${check.name}: \$${check.name.toUpperCase().replace(/-/g, '_')}_STATE"
          if [ "\$${check.name.toUpperCase().replace(/-/g, '_')}_STATE" != "success" ]; then
            GATE_FAILED="true"
            FAILURE_REASON="${check.name} not passed"
          fi`);
    } else {
      // 실행만 하면 됨 (status가 존재하면 됨)
      checkConditions.push(`
          # ${check.name}: must run (any result)
          ${check.name.toUpperCase().replace(/-/g, '_')}_STATE=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/commits/\$HEAD_SHA/statuses" \\
            | jq -r '[.[] | select(.context == "${check.name}")] | sort_by(.updated_at) | last | .state // "none"')
          echo "${check.name}: \$${check.name.toUpperCase().replace(/-/g, '_')}_STATE"
          if [ "\$${check.name.toUpperCase().replace(/-/g, '_')}_STATE" = "none" ] || [ "\$${check.name.toUpperCase().replace(/-/g, '_')}_STATE" = "pending" ]; then
            GATE_FAILED="true"
            FAILURE_REASON="${check.name} not completed"
          fi`);
    }
  }

  return `  # 종합 판정 (PR Checks Status)
  review-status:
    needs: [${dependencies.join(', ')}]
    if: always() && needs.check-trigger.outputs.should_continue == 'true'
    runs-on: ubuntu-latest
    permissions:
      statuses: write
      pull-requests: read

    steps:
      - name: Calculate merge gate
        id: gate
        run: |
          HEAD_SHA="\${{ needs.check-trigger.outputs.head_sha }}"
          PR_NUMBER="\${{ needs.check-trigger.outputs.pr_number }}"
          GATE_FAILED="false"
          FAILURE_REASON=""
${checkConditions.join('\n')}

          if [ "\$GATE_FAILED" = "true" ]; then
            curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
              -H "Content-Type: application/json" \\
              -X POST "\${{ github.api_url }}/repos/\${{ github.repository }}/statuses/\$HEAD_SHA" \\
              -d '{"state":"failure","context":"${STATUS_CONTEXTS.prChecksStatus}","description":"${STATUS_MESSAGES.failure.approvalRequired}"}'
            echo "❌ \$FAILURE_REASON"
            echo "should_check_approval=true" >> \$GITHUB_OUTPUT
            echo "head_sha=\$HEAD_SHA" >> \$GITHUB_OUTPUT
            echo "pr_number=\$PR_NUMBER" >> \$GITHUB_OUTPUT
          else
            curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
              -H "Content-Type: application/json" \\
              -X POST "\${{ github.api_url }}/repos/\${{ github.repository }}/statuses/\$HEAD_SHA" \\
              -d '{"state":"success","context":"${STATUS_CONTEXTS.prChecksStatus}","description":"${STATUS_MESSAGES.success.allPassed}"}'
            echo "✅ 머지 가능"
            echo "should_check_approval=false" >> \$GITHUB_OUTPUT
          fi

      - name: Check for approvals
        if: steps.gate.outputs.should_check_approval == 'true'
        run: |
          HEAD_SHA="\${{ steps.gate.outputs.head_sha }}"
          PR_NUMBER="\${{ steps.gate.outputs.pr_number }}"

          # Approve 있는지 확인
          APPROVALS=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/pulls/\$PR_NUMBER/reviews" \\
            | jq '[.[] | select(.state == "APPROVED")] | length')

          echo "👥 Approve 수: \$APPROVALS"

          if [ "\$APPROVALS" -gt 0 ]; then
            curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
              -H "Content-Type: application/json" \\
              -X POST "\${{ github.api_url }}/repos/\${{ github.repository }}/statuses/\$HEAD_SHA" \\
              -d '{"state":"success","context":"${STATUS_CONTEXTS.prChecksStatus}","description":"${OVERRIDE_DESCRIPTION}"}'
            echo "✅ Approve로 머지 가능"
          fi`;
}
