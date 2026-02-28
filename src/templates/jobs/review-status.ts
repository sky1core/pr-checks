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
  const requiredChecks = input.checks.filter((c) => c.mustRun);

  // 의존성: check-trigger + 모든 체크 jobs
  const allJobIds = input.checks.map((c) => c.name);
  const dependencies = ['check-trigger', ...allJobIds];

  // 각 required check의 상태를 확인하는 조건들
  const checkConditions: string[] = [];
  for (const check of requiredChecks) {
    const stateVar = `${check.name.toUpperCase().replace(/-/g, '_')}_STATE`;
    if (check.mustPass) {
      // 성공해야 함
      checkConditions.push(`
          # ${check.name}: must pass
          ${stateVar}=\$(get_check_state "${check.name}")
          echo "${check.name}: \$${stateVar}"
          if [ "\$${stateVar}" != "success" ]; then
            GATE_FAILED="true"
            FAILURE_REASON="${check.name} not passed"
          fi`);
    } else {
      // 실행만 하면 됨 (status가 존재하면 됨)
      checkConditions.push(`
          # ${check.name}: must run (any result)
          ${stateVar}=\$(get_check_state "${check.name}")
          echo "${check.name}: \$${stateVar}"
          if [ "\$${stateVar}" = "none" ] || [ "\$${stateVar}" = "pending" ]; then
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

          # 상태 전파 지연(race) 대응: context별 최신 status를 재시도하며 조회
          get_check_state() {
            local context="\$1"
            local max_attempts=20
            local sleep_seconds=2
            local attempt=1
            local state="none"

            while [ "\$attempt" -le "\$max_attempts" ]; do
              # curl과 jq를 분리하여 각각의 실패를 명시적으로 감지
              raw=""
              if ! raw=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
                "\${{ github.api_url }}/repos/\${{ github.repository }}/commits/\$HEAD_SHA/statuses"); then
                state="none"
                echo "⚠️ \$context: curl failed (attempt \$attempt/\$max_attempts)" >&2
              elif ! state=\$(printf '%s' "\$raw" | jq -r --arg context "\$context" '[.[] | select(.context == $context)] | sort_by(.updated_at) | last | (.state // .status // "none")'); then
                state="none"
                echo "⚠️ \$context: jq parse failed (attempt \$attempt/\$max_attempts)" >&2
              fi

              # 빈 문자열/null도 none으로 취급
              if [ -z "\$state" ] || [ "\$state" = "null" ]; then
                state="none"
              fi

              if [ "\$state" != "pending" ] && [ "\$state" != "none" ]; then
                echo "\$state"
                return 0
              fi

              if [ "\$attempt" -eq "\$max_attempts" ]; then
                echo "\$state"
                return 0
              fi

              # 명령치환(\$(...))으로 상태를 받으므로 로그는 stderr로 출력
              echo "⏳ \$context: status=\$state (retry \$attempt/\$max_attempts)" >&2
              attempt=\$((attempt + 1))
              sleep "\$sleep_seconds"
            done

            echo "\$state"
          }
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

          # Approve 있는지 확인 (curl/jq 분리)
          REVIEWS_RAW=""
          if ! REVIEWS_RAW=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/pulls/\$PR_NUMBER/reviews"); then
            echo "⚠️ reviews API 조회 실패"
            APPROVALS=0
          elif ! APPROVALS=\$(printf '%s' "\$REVIEWS_RAW" | jq '[.[] | select(.state == "APPROVED")] | length'); then
            echo "⚠️ reviews JSON 파싱 실패"
            APPROVALS=0
          fi

          # 빈값/null 정규화
          if [ -z "\$APPROVALS" ] || [ "\$APPROVALS" = "null" ]; then
            APPROVALS=0
          fi

          echo "👥 Approve 수: \$APPROVALS"

          if [ "\$APPROVALS" -gt 0 ]; then
            curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
              -H "Content-Type: application/json" \\
              -X POST "\${{ github.api_url }}/repos/\${{ github.repository }}/statuses/\$HEAD_SHA" \\
              -d '{"state":"success","context":"${STATUS_CONTEXTS.prChecksStatus}","description":"${OVERRIDE_DESCRIPTION}"}'
            echo "✅ Approve로 머지 가능"
          fi`;
}
