import { STATUS_CONTEXTS, OVERRIDE_KEYWORD } from '../constants/contexts.js';
import { OVERRIDE_DESCRIPTION } from '../constants/messages.js';

/**
 * Override Gate job (approval-override.yml)
 *
 * 역할:
 * 1. PR Approve 시 PR Checks Status 확인
 * 2. 실패 상태면 success로 override
 * 3. 코멘트로 알림
 *
 * @param branchCondition 대상 브랜치 조건
 */
export function generateOverrideGateJob(branchCondition: string): string {
  return `  override-gate:
    if: |
      github.event.action == 'submitted' &&
      github.event.review.state == 'approved' &&
      (${branchCondition})
    runs-on: ubuntu-latest
    permissions:
      statuses: write
      pull-requests: write

    steps:
      - name: Override PR Checks Status if needed
        run: |
          PR_NUMBER="\${{ github.event.pull_request.number }}"
          HEAD_SHA="\${{ github.event.pull_request.head.sha }}"

          GATE_STATUS=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/commits/\$HEAD_SHA/statuses" \\
            | jq '[.[] | select(.context == "${STATUS_CONTEXTS.prChecksStatus}")] | sort_by(.updated_at) | last')

          GATE_STATE=\$(echo "\$GATE_STATUS" | jq -r '.state // "none"')

          if [ "\$GATE_STATE" != "success" ]; then
            curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
              -H "Content-Type: application/json" \\
              -X POST "\${{ github.api_url }}/repos/\${{ github.repository }}/statuses/\$HEAD_SHA" \\
              -d '{"state":"success","context":"${STATUS_CONTEXTS.prChecksStatus}","description":"${OVERRIDE_DESCRIPTION} (@\${{ github.event.review.user.login }})"}'

            printf '## ✅ Merge Gate Override\\n\\n**@%s**의 승인으로 PR Checks Status가 override 되었습니다.\\n\\n머지가 가능합니다.' "\${{ github.event.review.user.login }}" > comment.md
            BODY=\$(jq -Rs '.' comment.md)
            curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
              -H "Content-Type: application/json" \\
              -X POST "\${{ github.api_url }}/repos/\${{ github.repository }}/issues/\$PR_NUMBER/comments" \\
              -d "{\\"body\\": \$BODY}"
          fi`;
}
