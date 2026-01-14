import type { Config, PrTestCheck, SetupStep } from '../../types/config.js';

/**
 * 테스트 셋업 스텝 생성 (helper)
 */
function generateTestSetupSteps(steps?: SetupStep[]): string {
  if (!steps || steps.length === 0) return '';

  return steps
    .map((step) => {
      const lines: string[] = [];
      if (step.uses) {
        lines.push(`      - name: ${step.name}`);
        lines.push(`        uses: ${step.uses}`);
        if (step.with) {
          lines.push('        with:');
          for (const [key, value] of Object.entries(step.with)) {
            lines.push(`          ${key}: '${value}'`);
          }
        }
      } else if (step.run) {
        lines.push(`      - name: ${step.name || 'Setup'}`);
        if (step.run.includes('\n')) {
          lines.push('        run: |');
          step.run.split('\n').forEach((line) => {
            lines.push(`          ${line}`);
          });
        } else {
          lines.push(`        run: ${step.run}`);
        }
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * 테스트 job 생성
 *
 * 역할:
 * 1. PR 브랜치 체크아웃
 * 2. 테스트 환경 셋업
 * 3. 테스트 실행
 * 4. 결과에 따른 status 설정
 * 5. 실패 시 PR 코멘트
 */
export function generatePrTestJob(check: PrTestCheck, config: Config): string {
  const { input } = config;
  const jobId = check.name;

  // 실행 조건: 개별 트리거 또는 ciTrigger(required일 때만)
  const runConditions = [
    `needs.check-trigger.outputs.trigger == '${check.trigger}'`,
  ];
  if (check.mustRun) {
    runConditions.push(`needs.check-trigger.outputs.trigger == '${input.ciTrigger}'`);
  }

  const setupSteps = generateTestSetupSteps(check.setupSteps);

  return `  # ${check.name}
  ${jobId}:
    if: |
      needs.check-trigger.outputs.should_continue == 'true' &&
      (${runConditions.join(' || ')})
    needs: [check-trigger]
    runs-on: ubuntu-latest
    steps:
      - name: Get PR branch
        id: pr-branch
        run: |
          PR_NUMBER="\${{ needs.check-trigger.outputs.pr_number }}"
          BRANCH=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/pulls/\$PR_NUMBER" \\
            | jq -r '.head.ref')
          echo "branch=\$BRANCH" >> \$GITHUB_OUTPUT

      - uses: actions/checkout@v4
        with:
          ref: \${{ steps.pr-branch.outputs.branch }}

${setupSteps}

      - name: Run ${check.name}
        id: test
        shell: bash
        run: |
          set +e
          ${check.command} 2>&1 | tee test_output.txt
          EXIT_CODE=\${PIPESTATUS[0]}
          if [ "\$EXIT_CODE" = "0" ]; then
            echo "passed=true" >> \$GITHUB_OUTPUT
          else
            echo "passed=false" >> \$GITHUB_OUTPUT
          fi

      - name: Set status and post comment
        shell: bash
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_API_URL: \${{ github.api_url }}
          GITHUB_REPOSITORY: \${{ github.repository }}
          GITHUB_SERVER_URL: \${{ github.server_url }}
          GITHUB_RUN_ID: \${{ github.run_id }}
          GITHUB_RUN_NUMBER: \${{ github.run_number }}
        run: |
          bash .pr-checks/scripts/${check.name}-report.sh \\
            "\${{ needs.check-trigger.outputs.head_sha }}" \\
            "\${{ needs.check-trigger.outputs.pr_number }}" \\
            "\${{ steps.test.outputs.passed }}"

      - name: Collapse old comments
        shell: bash
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_API_URL: \${{ github.api_url }}
          GITHUB_REPOSITORY: \${{ github.repository }}
        run: |
          bash .pr-checks/scripts/${check.name}-collapse.sh \\
            "\${{ needs.check-trigger.outputs.pr_number }}" \\
            "\${{ needs.check-trigger.outputs.head_sha }}"

      - name: Fail if tests failed
        shell: bash
        run: |
          if [ "\$(cat test_result.txt)" != "true" ]; then
            exit 1
          fi`;
}
