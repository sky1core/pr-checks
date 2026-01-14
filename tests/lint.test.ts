import { describe, it, expect } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generatePrChecksWorkflow } from '../src/templates/pr-checks.js';
import { generateApprovalOverrideWorkflow } from '../src/templates/approval-override.js';
import type { Config, PrTestCheck, PrReviewCheck } from '../src/types/config.js';

const createTestConfig = (): Config => ({
  input: {
    checks: [
      {
        name: 'pr-test',
        trigger: '/test',
        type: 'pr-test',
        mustRun: true,
        mustPass: true,
        command: 'npm test',
        framework: 'node',
        setupSteps: [
          { name: 'Setup Node.js', uses: 'actions/setup-node@v4', with: { 'node-version': '20' } },
          { name: 'Install dependencies', run: 'npm ci' },
        ],
      } as PrTestCheck,
      {
        name: 'pr-review',
        trigger: '/review',
        type: 'pr-review',
        mustRun: true,
        mustPass: false,
        provider: 'bedrock',
        model: 'us.amazon.nova-micro-v1:0',
        apiKeySecret: 'BEDROCK_API_KEY',
      } as PrReviewCheck,
    ],
    ciTrigger: '/checks',
    generateApprovalOverride: true,
    branches: ['main', 'master'],
  },
});

// 허용되는 경고 패턴 (레퍼런스 구현과 동일한 것들)
const ALLOWED_WARNINGS = [
  'shellcheck reported issue', // shellcheck 경고 전체
  'potentially untrusted', // github.event.comment.body, github.head_ref 등
];

function filterActionlintOutput(output: string): string[] {
  // actionlint는 JSON 형식으로 출력 가능
  // 기본 출력에서 에러 라인만 추출 (파일명:라인:컬럼: 형식)
  const errorLines = output
    .split('\n')
    .filter((line) => /^\S+\.yml:\d+:\d+:/.test(line));

  // 허용된 경고 제외
  return errorLines.filter(
    (line) => !ALLOWED_WARNINGS.some((pattern) => line.includes(pattern))
  );
}

describe('actionlint 검증', () => {
  it('pr-checks.yml이 actionlint를 통과해야 함', async () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);

    const dir = await mkdtemp(path.join(tmpdir(), 'wf-lint-'));
    const wfPath = path.join(dir, 'pr-checks.yml');

    try {
      await writeFile(wfPath, yaml);

      const { stdout, stderr } = await execa('actionlint', [wfPath], {
        reject: false,
      });

      const errors = filterActionlintOutput(stdout + stderr);
      expect(errors, `actionlint errors:\n${errors.join('\n')}`).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('approval-override.yml이 actionlint를 통과해야 함', async () => {
    const config = createTestConfig();
    const yaml = generateApprovalOverrideWorkflow(config);

    const dir = await mkdtemp(path.join(tmpdir(), 'wf-lint-'));
    const wfPath = path.join(dir, 'pr-checks-approval.yml');

    try {
      await writeFile(wfPath, yaml);

      const { stdout, stderr } = await execa('actionlint', [wfPath], {
        reject: false,
      });

      const errors = filterActionlintOutput(stdout + stderr);
      expect(errors, `actionlint errors:\n${errors.join('\n')}`).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
