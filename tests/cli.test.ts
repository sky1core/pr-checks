import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { run } from '../src/cli.js';

// process.exit 모킹
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code})`);
});

// console 출력 무시
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('CLI', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(tmpdir(), 'pr-checks-cli-'));
    mockExit.mockClear();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true });
  });

  describe('run with --init', () => {
    it('설정 파일을 생성해야 함', async () => {
      await run({ init: true, cwd: testDir });

      const configPath = path.join(testDir, '.pr-checks', 'config.yml');
      expect(await fs.pathExists(configPath)).toBe(true);
    });

    it('이미 설정 파일이 있으면 덮어쓰지 않아야 함', async () => {
      const prChecksDir = path.join(testDir, '.pr-checks');
      await fs.ensureDir(prChecksDir);
      await fs.writeFile(path.join(prChecksDir, 'config.yml'), 'existing: true');

      await run({ init: true, cwd: testDir });

      const content = await fs.readFile(
        path.join(prChecksDir, 'config.yml'),
        'utf-8'
      );
      expect(content).toBe('existing: true');
    });
  });

  describe('run with --yes', () => {
    it('설정 파일 없이도 기본값으로 워크플로우를 생성해야 함', async () => {
      await run({ yes: true, cwd: testDir });

      const prChecksPath = path.join(
        testDir,
        '.github',
        'workflows',
        'pr-checks.yml'
      );
      expect(await fs.pathExists(prChecksPath)).toBe(true);
    });

    it('설정 파일이 있으면 해당 설정으로 워크플로우를 생성해야 함', async () => {
      // 먼저 설정 파일 생성
      await run({ init: true, cwd: testDir });

      // 워크플로우 생성
      await run({ yes: true, cwd: testDir });

      const prChecksPath = path.join(
        testDir,
        '.github',
        'workflows',
        'pr-checks.yml'
      );
      const approvalPath = path.join(
        testDir,
        '.github',
        'workflows',
        'pr-checks-approval.yml'
      );

      expect(await fs.pathExists(prChecksPath)).toBe(true);
      expect(await fs.pathExists(approvalPath)).toBe(true);
    });

    it('pr-checks.yml에 올바른 내용이 있어야 함', async () => {
      await run({ yes: true, cwd: testDir });

      const prChecksPath = path.join(
        testDir,
        '.github',
        'workflows',
        'pr-checks.yml'
      );
      const content = await fs.readFile(prChecksPath, 'utf-8');

      expect(content).toContain('name: PR Checks');
      expect(content).toContain('/checks');
      expect(content).toContain('check-trigger');
    });

    it('approval-override.yml에 올바른 내용이 있어야 함', async () => {
      await run({ yes: true, cwd: testDir });

      const approvalPath = path.join(
        testDir,
        '.github',
        'workflows',
        'pr-checks-approval.yml'
      );
      const content = await fs.readFile(approvalPath, 'utf-8');

      expect(content).toContain('override-gate');
      expect(content).toContain('restore-gate');
    });
  });

  describe('cwd 옵션', () => {
    it('지정된 디렉토리에서 작업해야 함', async () => {
      const subDir = path.join(testDir, 'subproject');
      await fs.ensureDir(subDir);

      await run({ init: true, cwd: subDir });

      const configPath = path.join(subDir, '.pr-checks', 'config.yml');
      expect(await fs.pathExists(configPath)).toBe(true);

      // testDir에는 생성되지 않아야 함
      const wrongPath = path.join(testDir, '.pr-checks', 'config.yml');
      expect(await fs.pathExists(wrongPath)).toBe(false);
    });
  });

  describe('printConfigSummary 출력', () => {
    it('CLI provider는 cliTool을 출력해야 함 (model이 아님)', async () => {
      const prChecksDir = path.join(testDir, '.pr-checks');
      await fs.ensureDir(prChecksDir);
      await fs.writeFile(
        path.join(prChecksDir, 'config.yml'),
        `checks:
  - name: cli-review
    trigger: /review
    type: pr-review
    mustRun: true
    mustPass: false
    provider: cli
    cliTool: claude
ciTrigger: /checks
branches:
  - main`
      );

      const logs: string[] = [];
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((msg) => {
        if (typeof msg === 'string') logs.push(msg);
      });

      await run({ yes: true, cwd: testDir });

      consoleSpy.mockRestore();

      // cli/claude 형태로 출력되어야 함 (cli/undefined가 아님)
      const reviewLine = logs.find(l => l.includes('cli-review'));
      expect(reviewLine).toBeDefined();
      expect(reviewLine).toContain('cli/claude');
      expect(reviewLine).not.toContain('undefined');
    });

    it('Bedrock provider는 model을 출력해야 함', async () => {
      const prChecksDir = path.join(testDir, '.pr-checks');
      await fs.ensureDir(prChecksDir);
      await fs.writeFile(
        path.join(prChecksDir, 'config.yml'),
        `checks:
  - name: ai-review
    trigger: /review
    type: pr-review
    mustRun: true
    mustPass: false
    provider: bedrock
    model: us.amazon.nova-micro-v1:0
    apiKeySecret: BEDROCK_KEY
ciTrigger: /checks
branches:
  - main`
      );

      const logs: string[] = [];
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((msg) => {
        if (typeof msg === 'string') logs.push(msg);
      });

      await run({ yes: true, cwd: testDir });

      consoleSpy.mockRestore();

      const reviewLine = logs.find(l => l.includes('ai-review'));
      expect(reviewLine).toBeDefined();
      expect(reviewLine).toContain('bedrock/us.amazon.nova-micro-v1:0');
    });
  });

  describe('연속 실행', () => {
    it('init 후 generate를 연속으로 실행할 수 있어야 함', async () => {
      // 1. init
      await run({ init: true, cwd: testDir });
      expect(
        await fs.pathExists(path.join(testDir, '.pr-checks', 'config.yml'))
      ).toBe(true);

      // 2. generate
      await run({ yes: true, cwd: testDir });
      expect(
        await fs.pathExists(
          path.join(testDir, '.github', 'workflows', 'pr-checks.yml')
        )
      ).toBe(true);

      // 3. 다시 generate (덮어쓰기)
      await run({ yes: true, cwd: testDir });
      expect(
        await fs.pathExists(
          path.join(testDir, '.github', 'workflows', 'pr-checks.yml')
        )
      ).toBe(true);
    });
  });
});
