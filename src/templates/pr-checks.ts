import type { Config, PrTestCheck, PrReviewCheck } from '../types/config.js';
import { isPrTestCheck, isPrReviewCheck, getDefaultAutoRunOn } from '../types/config.js';
import {
  generateCheckTriggerJob,
  generatePrTestJob,
  generatePrReviewJob,
  generateReviewStatusJob,
} from './jobs/index.js';

/**
 * 가이드 코멘트 job 생성
 */
function generateGuideCommentJob(config: Config): string {
  const { input } = config;

  // 체크 목록 테이블 생성
  const checkRows = input.checks.map((check) => {
    const required = check.mustRun ? 'Yes' : 'No';
    const mustPass = check.mustPass ? ' (must pass)' : '';
    return `          | \`${check.trigger}\` | ${check.name} | ${required}${mustPass} |`;
  });

  return `  # PR 생성 시 가이드 코멘트
  guide-comment:
    if: github.event_name == 'pull_request' && github.event.action == 'opened'
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      statuses: write
    steps:
      - name: Post guide comment
        run: |
          cat > comment.md << 'GUIDE_EOF'
          ## PR Checks Guide

          ### Commands
          | Command | Description | Required |
          |---------|-------------|----------|
${checkRows.join('\n')}
          | \`${input.ciTrigger}\` | Run all required checks | - |

          ### Merge Requirements
          All required checks must be completed, or approval is needed.
${input.guideMessage ? `\n${input.guideMessage.split('\n').map(line => `          ${line}`).join('\n')}` : ''}
          GUIDE_EOF

          # 앞 공백 제거
          sed -i 's/^          //' comment.md

          # PR 댓글 작성
          BODY=\$(jq -Rs '.' comment.md)
          curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            -H "Content-Type: application/json" \\
            -X POST "\${{ github.api_url }}/repos/\${{ github.repository }}/issues/\${{ github.event.pull_request.number }}/comments" \\
            -d "{\\"body\\": \$BODY}"

          # 초기 pending status 설정
          curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            -H "Content-Type: application/json" \\
            -X POST "\${{ github.api_url }}/repos/\${{ github.repository }}/statuses/\${{ github.event.pull_request.head.sha }}" \\
            -d '{"state":"pending","context":"PR Checks Status","description":"Waiting for checks"}'`;
}

export function generatePrChecksWorkflow(config: Config): string {
  const { input } = config;

  // 체크 분류
  const prTestChecks = input.checks.filter(isPrTestCheck);
  const prReviewChecks = input.checks.filter(isPrReviewCheck);
  const requiredPrTests = prTestChecks.filter((c) => c.mustRun);

  // 모든 체크에서 사용하는 PR 액션 수집
  const allActions = new Set<string>(['opened']); // opened는 항상 필요 (guide-comment용)
  for (const c of input.checks) {
    const actions = c.autoRunOn ?? getDefaultAutoRunOn(c.mustRun);
    actions.forEach((a) => allActions.add(a));
  }
  const prTypes = Array.from(allActions).join(', ');

  // 각 체크 job 생성
  const prTestJobs = prTestChecks
    .map((check) => generatePrTestJob(check, config))
    .join('\n\n');

  const prReviewJobs = prReviewChecks
    .map((check) => generatePrReviewJob(check, config, requiredPrTests))
    .join('\n\n');

  return `name: PR Checks

on:
  # PR 이벤트 (guide-comment + 자동 실행)
  pull_request:
    types: [${prTypes}]
    branches: [${input.branches.join(', ')}]

  # PR 코멘트로 수동 실행
  issue_comment:
    types: [created]

# 동일 PR에 대해 순차 실행
concurrency:
  group: pr-checks-\${{ github.event.pull_request.number || github.event.issue.number || github.ref }}
  cancel-in-progress: false

permissions:
  contents: read
  pull-requests: write
  statuses: write

jobs:
${generateGuideCommentJob(config)}

${generateCheckTriggerJob(config)}

${prTestJobs}

${prReviewJobs}

${generateReviewStatusJob(config)}
`;
}
