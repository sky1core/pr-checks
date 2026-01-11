import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { generateWorkflowFiles } from '../src/generators/workflow.js';
import type { Config, PrTestCheck, PrReviewCheck } from '../src/types/config.js';

const createTestConfig = (platform: 'github' | 'gitea' = 'github'): Config => ({
  input: {
    platform,
    checks: [
      {
        name: 'pr-test',
        trigger: '/test',
        type: 'pr-test',
        required: true,
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
        required: true,
        mustPass: false,
        provider: 'bedrock',
        model: 'us.amazon.nova-micro-v1:0',
        apiKeySecret: 'BEDROCK_API_KEY',
      } as PrReviewCheck,
    ],
    ciTrigger: '/checks',
    generateApprovalOverride: true,
    branches: ['main'],
  },
});

describe('generateWorkflowFiles', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(tmpdir(), 'pr-checks-gen-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true });
  });

  describe('파일 생성', () => {
    it('.github/workflows 디렉토리를 생성해야 함', async () => {
      const config = createTestConfig();
      await generateWorkflowFiles(testDir, config);

      const workflowsDir = path.join(testDir, '.github', 'workflows');
      expect(await fs.pathExists(workflowsDir)).toBe(true);
    });

    it('pr-checks.yml을 생성해야 함', async () => {
      const config = createTestConfig();
      const result = await generateWorkflowFiles(testDir, config);

      expect(result.files).toContain('.github/workflows/pr-checks.yml');

      const filePath = path.join(testDir, '.github', 'workflows', 'pr-checks.yml');
      expect(await fs.pathExists(filePath)).toBe(true);
    });

    it('pr-checks-approval.yml을 생성해야 함 (generateApprovalOverride가 true일 때)', async () => {
      const config = createTestConfig();
      config.input.generateApprovalOverride = true;

      const result = await generateWorkflowFiles(testDir, config);

      expect(result.files).toContain('.github/workflows/pr-checks-approval.yml');
    });

    it('pr-checks-approval.yml을 생성하지 않아야 함 (generateApprovalOverride가 false일 때)', async () => {
      const config = createTestConfig();
      config.input.generateApprovalOverride = false;

      const result = await generateWorkflowFiles(testDir, config);

      expect(result.files).not.toContain('.github/workflows/pr-checks-approval.yml');
    });
  });

  describe('파일 내용', () => {
    it('생성된 pr-checks.yml에 올바른 내용이 있어야 함', async () => {
      const config = createTestConfig();
      await generateWorkflowFiles(testDir, config);

      const content = await fs.readFile(
        path.join(testDir, '.github', 'workflows', 'pr-checks.yml'),
        'utf-8'
      );

      expect(content).toContain('name: PR Checks');
      expect(content).toContain('npm test');
    });

    it('설정값이 올바르게 반영되어야 함', async () => {
      const config = createTestConfig();
      (config.input.checks[0] as PrTestCheck).command = 'yarn test';

      await generateWorkflowFiles(testDir, config);

      const content = await fs.readFile(
        path.join(testDir, '.github', 'workflows', 'pr-checks.yml'),
        'utf-8'
      );

      expect(content).toContain('yarn test');
    });
  });

  describe('덮어쓰기', () => {
    it('기존 파일이 있으면 덮어써야 함', async () => {
      const config = createTestConfig();

      // 먼저 생성
      await generateWorkflowFiles(testDir, config);

      // 설정 변경 후 다시 생성
      (config.input.checks[0] as PrTestCheck).command = 'npm run test:all';
      await generateWorkflowFiles(testDir, config);

      const content = await fs.readFile(
        path.join(testDir, '.github', 'workflows', 'pr-checks.yml'),
        'utf-8'
      );

      expect(content).toContain('npm run test:all');
    });
  });

  describe('결과 반환', () => {
    it('생성된 파일 목록을 반환해야 함', async () => {
      const config = createTestConfig();
      const result = await generateWorkflowFiles(testDir, config);

      expect(result.files).toBeInstanceOf(Array);
      expect(result.files.length).toBeGreaterThan(0);
    });

    it('workflowsDir 경로를 반환해야 함', async () => {
      const config = createTestConfig();
      const result = await generateWorkflowFiles(testDir, config);

      expect(result.workflowsDir).toBe(path.join(testDir, '.github', 'workflows'));
    });
  });

  describe('중첩 디렉토리', () => {
    it('깊은 경로에서도 동작해야 함', async () => {
      const deepDir = path.join(testDir, 'a', 'b', 'c');
      await fs.ensureDir(deepDir);

      const config = createTestConfig();
      const result = await generateWorkflowFiles(deepDir, config);

      expect(result.files).toContain('.github/workflows/pr-checks.yml');
      expect(
        await fs.pathExists(path.join(deepDir, '.github', 'workflows', 'pr-checks.yml'))
      ).toBe(true);
    });
  });

  describe('스크립트 파일 생성', () => {
    it('pr-test용 스크립트 파일이 생성되어야 함', async () => {
      const config = createTestConfig();
      const result = await generateWorkflowFiles(testDir, config);

      expect(result.files).toContain('.pr-checks/scripts/pr-test-report.sh');
      expect(result.files).toContain('.pr-checks/scripts/pr-test-collapse.sh');
    });

    it('스크립트 파일이 실제로 존재해야 함', async () => {
      const config = createTestConfig();
      await generateWorkflowFiles(testDir, config);

      const reportPath = path.join(testDir, '.pr-checks', 'scripts', 'pr-test-report.sh');
      const collapsePath = path.join(testDir, '.pr-checks', 'scripts', 'pr-test-collapse.sh');

      expect(await fs.pathExists(reportPath)).toBe(true);
      expect(await fs.pathExists(collapsePath)).toBe(true);
    });

    it('report 스크립트에 필수 내용이 포함되어야 함', async () => {
      const config = createTestConfig();
      await generateWorkflowFiles(testDir, config);

      const content = await fs.readFile(
        path.join(testDir, '.pr-checks', 'scripts', 'pr-test-report.sh'),
        'utf-8'
      );

      expect(content).toContain('#!/bin/bash');
      expect(content).toContain('set +e');
      expect(content).toContain('curl');
      expect(content).toContain('GITHUB_TOKEN');
    });

    it('collapse 스크립트에서 SHORT_SHA 변환이 포함되어야 함', async () => {
      const config = createTestConfig();
      await generateWorkflowFiles(testDir, config);

      const content = await fs.readFile(
        path.join(testDir, '.pr-checks', 'scripts', 'pr-test-collapse.sh'),
        'utf-8'
      );

      expect(content).toContain('SHORT_SHA="${HEAD_SHA:0:7}"');
    });

    it('워크플로우에서 스크립트 호출이 포함되어야 함', async () => {
      const config = createTestConfig();
      await generateWorkflowFiles(testDir, config);

      const content = await fs.readFile(
        path.join(testDir, '.github', 'workflows', 'pr-checks.yml'),
        'utf-8'
      );

      expect(content).toContain('bash .pr-checks/scripts/pr-test-report.sh');
      expect(content).toContain('bash .pr-checks/scripts/pr-test-collapse.sh');
    });
  });

  describe('플랫폼별 경로', () => {
    it('GitHub 플랫폼은 .github/workflows에 생성해야 함', async () => {
      const config = createTestConfig('github');
      const result = await generateWorkflowFiles(testDir, config);

      expect(result.workflowsDir).toBe(path.join(testDir, '.github', 'workflows'));
      expect(result.files).toContain('.github/workflows/pr-checks.yml');
      expect(await fs.pathExists(path.join(testDir, '.github', 'workflows', 'pr-checks.yml'))).toBe(true);
    });

    it('Gitea 플랫폼은 .gitea/workflows에 생성해야 함', async () => {
      const config = createTestConfig('gitea');
      const result = await generateWorkflowFiles(testDir, config);

      expect(result.workflowsDir).toBe(path.join(testDir, '.gitea', 'workflows'));
      expect(result.files).toContain('.gitea/workflows/pr-checks.yml');
      expect(await fs.pathExists(path.join(testDir, '.gitea', 'workflows', 'pr-checks.yml'))).toBe(true);
    });

    it('Gitea 플랫폼의 approval 워크플로우도 .gitea/workflows에 생성해야 함', async () => {
      const config = createTestConfig('gitea');
      config.input.generateApprovalOverride = true;
      const result = await generateWorkflowFiles(testDir, config);

      expect(result.files).toContain('.gitea/workflows/pr-checks-approval.yml');
      expect(await fs.pathExists(path.join(testDir, '.gitea', 'workflows', 'pr-checks-approval.yml'))).toBe(true);
    });
  });
});
