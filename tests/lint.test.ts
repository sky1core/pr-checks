import { describe, it, expect } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generatePrChecksWorkflow } from '../src/templates/pr-checks.js';
import { generateApprovalOverrideWorkflow } from '../src/templates/approval-override.js';
import type { Config, PrTestCheck, PrReviewCheck } from '../src/types/config.js';

// --- 테스트 설정 팩토리 ---

const basePrTestCheck: PrTestCheck = {
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
};

const bedrockReviewCheck: PrReviewCheck = {
  name: 'pr-review',
  trigger: '/review',
  type: 'pr-review',
  mustRun: true,
  mustPass: false,
  provider: 'bedrock',
  model: 'us.amazon.nova-micro-v1:0',
  apiKeySecret: 'BEDROCK_API_KEY',
};

const cliClaudeReviewCheck: PrReviewCheck = {
  name: 'pr-review',
  trigger: '/review',
  type: 'pr-review',
  mustRun: true,
  mustPass: false,
  provider: 'cli',
  cliTool: 'claude',
};

const cliGeminiReviewCheck: PrReviewCheck = {
  name: 'pr-review',
  trigger: '/review',
  type: 'pr-review',
  mustRun: true,
  mustPass: false,
  provider: 'cli',
  cliTool: 'gemini',
};

const cliCustomCommandReviewCheck: PrReviewCheck = {
  name: 'pr-review',
  trigger: '/review',
  type: 'pr-review',
  mustRun: true,
  mustPass: false,
  provider: 'cli',
  cliCommand: './scripts/review.sh',
};

function createConfig(overrides: Partial<Config['input']> = {}): Config {
  return {
    input: {
      platform: 'github',
      runner: 'ubuntu-latest',
      checks: [basePrTestCheck, bedrockReviewCheck],
      ciTrigger: '/checks',
      generateApprovalOverride: true,
      branches: ['main', 'master'],
      ...overrides,
    },
  };
}

// --- actionlint 헬퍼 ---

// 허용되는 경고 패턴 (레퍼런스 구현과 동일한 것들)
const ALLOWED_WARNINGS = [
  'shellcheck reported issue', // shellcheck 경고 전체
  'potentially untrusted', // github.event.comment.body, github.head_ref 등
];

function filterActionlintOutput(output: string): string[] {
  const errorLines = output
    .split('\n')
    .filter((line) => /^\S+\.yml:\d+:\d+:/.test(line));

  return errorLines.filter(
    (line) => !ALLOWED_WARNINGS.some((pattern) => line.includes(pattern))
  );
}

async function runActionlint(yaml: string, filename: string): Promise<string[]> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wf-lint-'));
  const wfPath = path.join(dir, filename);

  try {
    await writeFile(wfPath, yaml);

    const { stdout, stderr } = await execa('actionlint', [wfPath], {
      reject: false,
    });

    return filterActionlintOutput(stdout + stderr);
  } finally {
    await rm(dir, { recursive: true });
  }
}

// --- 테스트 ---

describe('actionlint 검증', () => {
  // 기본 설정 (github + bedrock)
  describe('기본 설정 (github + bedrock)', () => {
    it('pr-checks.yml이 actionlint를 통과해야 함', async () => {
      const config = createConfig();
      const yaml = generatePrChecksWorkflow(config);
      const errors = await runActionlint(yaml, 'pr-checks.yml');
      expect(errors, `actionlint errors:\n${errors.join('\n')}`).toHaveLength(0);
    });

    it('approval-override.yml이 actionlint를 통과해야 함', async () => {
      const config = createConfig();
      const yaml = generateApprovalOverrideWorkflow(config);
      const errors = await runActionlint(yaml, 'pr-checks-approval.yml');
      expect(errors, `actionlint errors:\n${errors.join('\n')}`).toHaveLength(0);
    });
  });

  // CLI provider: cliTool=claude (JSON parser)
  describe('CLI provider: claude (JSON parser)', () => {
    it('pr-checks.yml이 actionlint를 통과해야 함', async () => {
      const config = createConfig({
        checks: [basePrTestCheck, cliClaudeReviewCheck],
      });
      const yaml = generatePrChecksWorkflow(config);
      const errors = await runActionlint(yaml, 'pr-checks.yml');
      expect(errors, `actionlint errors:\n${errors.join('\n')}`).toHaveLength(0);
    });
  });

  // CLI provider: cliTool=gemini (VERDICT parser)
  describe('CLI provider: gemini (VERDICT parser)', () => {
    it('pr-checks.yml이 actionlint를 통과해야 함', async () => {
      const config = createConfig({
        checks: [basePrTestCheck, cliGeminiReviewCheck],
      });
      const yaml = generatePrChecksWorkflow(config);
      const errors = await runActionlint(yaml, 'pr-checks.yml');
      expect(errors, `actionlint errors:\n${errors.join('\n')}`).toHaveLength(0);
    });
  });

  // CLI provider: cliCommand (커스텀 명령어, diff step 없음)
  describe('CLI provider: cliCommand (커스텀 명령어)', () => {
    it('pr-checks.yml이 actionlint를 통과해야 함', async () => {
      const config = createConfig({
        checks: [basePrTestCheck, cliCustomCommandReviewCheck],
      });
      const yaml = generatePrChecksWorkflow(config);
      const errors = await runActionlint(yaml, 'pr-checks.yml');
      expect(errors, `actionlint errors:\n${errors.join('\n')}`).toHaveLength(0);
    });
  });

  // selfHosted (Docker 없음)
  describe('selfHosted (Docker 없음)', () => {
    it('pr-checks.yml이 actionlint를 통과해야 함', async () => {
      const config = createConfig({
        runner: ['self-hosted', 'macOS'],
        selfHosted: {},
      });
      const yaml = generatePrChecksWorkflow(config);
      const errors = await runActionlint(yaml, 'pr-checks.yml');
      expect(errors, `actionlint errors:\n${errors.join('\n')}`).toHaveLength(0);
    });

    it('approval-override.yml이 actionlint를 통과해야 함', async () => {
      const config = createConfig({
        runner: ['self-hosted', 'macOS'],
        selfHosted: {},
      });
      const yaml = generateApprovalOverrideWorkflow(config);
      const errors = await runActionlint(yaml, 'pr-checks-approval.yml');
      expect(errors, `actionlint errors:\n${errors.join('\n')}`).toHaveLength(0);
    });
  });

  // selfHosted + Docker
  describe('selfHosted + Docker', () => {
    it('pr-checks.yml이 actionlint를 통과해야 함', async () => {
      const config = createConfig({
        runner: ['self-hosted', 'macOS'],
        selfHosted: { docker: true },
      });
      const yaml = generatePrChecksWorkflow(config);
      const errors = await runActionlint(yaml, 'pr-checks.yml');
      expect(errors, `actionlint errors:\n${errors.join('\n')}`).toHaveLength(0);
    });
  });

  // platform: gitea
  describe('platform: gitea', () => {
    it('pr-checks.yml이 actionlint를 통과해야 함', async () => {
      const config = createConfig({ platform: 'gitea' });
      const yaml = generatePrChecksWorkflow(config);
      const errors = await runActionlint(yaml, 'pr-checks.yml');
      expect(errors, `actionlint errors:\n${errors.join('\n')}`).toHaveLength(0);
    });

    it('approval-override.yml이 actionlint를 통과해야 함', async () => {
      const config = createConfig({ platform: 'gitea' });
      const yaml = generateApprovalOverrideWorkflow(config);
      const errors = await runActionlint(yaml, 'pr-checks-approval.yml');
      expect(errors, `actionlint errors:\n${errors.join('\n')}`).toHaveLength(0);
    });
  });

  // selfHosted + cliCommand 크로스 조합
  describe('selfHosted + cliCommand 크로스 조합', () => {
    it('pr-checks.yml이 actionlint를 통과해야 함', async () => {
      const config = createConfig({
        runner: ['self-hosted', 'macOS'],
        selfHosted: { docker: true },
        checks: [basePrTestCheck, cliCustomCommandReviewCheck],
      });
      const yaml = generatePrChecksWorkflow(config);
      const errors = await runActionlint(yaml, 'pr-checks.yml');
      expect(errors, `actionlint errors:\n${errors.join('\n')}`).toHaveLength(0);
    });
  });

  // selfHosted + bedrock
  describe('selfHosted + bedrock', () => {
    it('pr-checks.yml이 actionlint를 통과해야 함', async () => {
      const config = createConfig({
        runner: ['self-hosted', 'macOS'],
        selfHosted: {},
        checks: [basePrTestCheck, bedrockReviewCheck],
      });
      const yaml = generatePrChecksWorkflow(config);
      const errors = await runActionlint(yaml, 'pr-checks.yml');
      expect(errors, `actionlint errors:\n${errors.join('\n')}`).toHaveLength(0);
    });
  });

  // selfHosted + CLI claude
  describe('selfHosted + CLI claude', () => {
    it('pr-checks.yml이 actionlint를 통과해야 함', async () => {
      const config = createConfig({
        runner: ['self-hosted', 'macOS'],
        selfHosted: {},
        checks: [basePrTestCheck, cliClaudeReviewCheck],
      });
      const yaml = generatePrChecksWorkflow(config);
      const errors = await runActionlint(yaml, 'pr-checks.yml');
      expect(errors, `actionlint errors:\n${errors.join('\n')}`).toHaveLength(0);
    });
  });

  // gitea + selfHosted
  describe('gitea + selfHosted', () => {
    it('pr-checks.yml이 actionlint를 통과해야 함', async () => {
      const config = createConfig({
        platform: 'gitea',
        runner: ['self-hosted', 'macOS'],
        selfHosted: { docker: true },
      });
      const yaml = generatePrChecksWorkflow(config);
      const errors = await runActionlint(yaml, 'pr-checks.yml');
      expect(errors, `actionlint errors:\n${errors.join('\n')}`).toHaveLength(0);
    });
  });
});
