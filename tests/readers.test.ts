import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  readConfig,
  createDefaultFiles,
  hasInputFiles,
  getPrChecksDir,
} from '../src/readers/index.js';
import { DEFAULT_INPUT_CONFIG } from '../src/types/config.js';

describe('readers', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(tmpdir(), 'pr-checks-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true });
  });

  describe('getPrChecksDir', () => {
    it('.pr-checks 디렉토리 경로를 반환해야 함', () => {
      const result = getPrChecksDir('/some/path');
      expect(result).toBe('/some/path/.pr-checks');
    });
  });

  describe('hasInputFiles', () => {
    it('config.yml이 없으면 false를 반환해야 함', async () => {
      const result = await hasInputFiles(testDir);
      expect(result).toBe(false);
    });

    it('config.yml이 있으면 true를 반환해야 함', async () => {
      const prChecksDir = path.join(testDir, '.pr-checks');
      await fs.ensureDir(prChecksDir);
      await fs.writeFile(path.join(prChecksDir, 'config.yml'), 'test: true');

      const result = await hasInputFiles(testDir);
      expect(result).toBe(true);
    });
  });

  describe('createDefaultFiles', () => {
    it('config.yml을 생성해야 함', async () => {
      const files = await createDefaultFiles(testDir);

      expect(files).toContain('.pr-checks/config.yml');

      const configPath = path.join(testDir, '.pr-checks', 'config.yml');
      expect(await fs.pathExists(configPath)).toBe(true);
    });

    it('생성된 config.yml이 기본값을 포함해야 함', async () => {
      await createDefaultFiles(testDir);

      const configPath = path.join(testDir, '.pr-checks', 'config.yml');
      const content = await fs.readFile(configPath, 'utf-8');
      const parsed = yaml.parse(content);

      // 새 구조에서는 checks 배열 확인
      expect(parsed.checks).toBeDefined();
      expect(Array.isArray(parsed.checks)).toBe(true);
      expect(parsed.ciTrigger).toBe('/checks');
    });

    it('이미 config.yml이 있으면 덮어쓰지 않아야 함', async () => {
      const prChecksDir = path.join(testDir, '.pr-checks');
      await fs.ensureDir(prChecksDir);
      await fs.writeFile(
        path.join(prChecksDir, 'config.yml'),
        'custom: value'
      );

      const files = await createDefaultFiles(testDir);

      expect(files).toHaveLength(0);

      const content = await fs.readFile(
        path.join(prChecksDir, 'config.yml'),
        'utf-8'
      );
      expect(content).toBe('custom: value');
    });
  });

  describe('readConfig', () => {
    it('config.yml이 없으면 기본값을 반환해야 함', async () => {
      const prChecksDir = path.join(testDir, '.pr-checks');
      await fs.ensureDir(prChecksDir);

      const config = await readConfig(testDir);

      expect(config.input.checks).toBeDefined();
      expect(config.input.ciTrigger).toBe(DEFAULT_INPUT_CONFIG.ciTrigger);
      expect(config.input.platform).toBe('github');
    });

    it('platform 기본값은 github이어야 함', async () => {
      const prChecksDir = path.join(testDir, '.pr-checks');
      await fs.ensureDir(prChecksDir);

      const customConfig = {
        checks: [
          {
            name: 'pr-test',
            trigger: '/test',
            type: 'pr-test',
            mustRun: true,
            mustPass: true,
            command: 'npm test',
          },
        ],
        ciTrigger: '/checks',
        branches: ['main'],
        // platform 명시하지 않음
      };

      await fs.writeFile(
        path.join(prChecksDir, 'config.yml'),
        yaml.stringify(customConfig)
      );

      const config = await readConfig(testDir);
      expect(config.input.platform).toBe('github');
    });

    it('platform을 gitea로 설정할 수 있어야 함', async () => {
      const prChecksDir = path.join(testDir, '.pr-checks');
      await fs.ensureDir(prChecksDir);

      const customConfig = {
        platform: 'gitea',
        checks: [
          {
            name: 'pr-test',
            trigger: '/test',
            type: 'pr-test',
            mustRun: true,
            mustPass: true,
            command: 'npm test',
          },
        ],
        ciTrigger: '/checks',
        branches: ['main'],
      };

      await fs.writeFile(
        path.join(prChecksDir, 'config.yml'),
        yaml.stringify(customConfig)
      );

      const config = await readConfig(testDir);
      expect(config.input.platform).toBe('gitea');
    });

    it('잘못된 platform 값은 github으로 처리해야 함', async () => {
      const prChecksDir = path.join(testDir, '.pr-checks');
      await fs.ensureDir(prChecksDir);

      const customConfig = {
        platform: 'invalid',
        checks: [
          {
            name: 'pr-test',
            trigger: '/test',
            type: 'pr-test',
            mustRun: true,
            mustPass: true,
            command: 'npm test',
          },
        ],
        ciTrigger: '/checks',
        branches: ['main'],
      };

      await fs.writeFile(
        path.join(prChecksDir, 'config.yml'),
        yaml.stringify(customConfig)
      );

      const config = await readConfig(testDir);
      expect(config.input.platform).toBe('github');
    });

    it('config.yml의 값을 읽어야 함', async () => {
      const prChecksDir = path.join(testDir, '.pr-checks');
      await fs.ensureDir(prChecksDir);

      const customConfig = {
        checks: [
          {
            name: 'my-test',
            trigger: '/mytest',
            type: 'pr-test',
            mustRun: true,
            mustPass: true,
            command: 'pytest',
            framework: 'python',
          },
          {
            name: 'my-review',
            trigger: '/myreview',
            type: 'pr-review',
            mustRun: true,
            mustPass: false,
            provider: 'bedrock',
            model: 'custom-model',
            apiKeySecret: 'CUSTOM_KEY',
          },
        ],
        ciTrigger: '/go',
        generateApprovalOverride: false,
        branches: ['main'],
      };

      await fs.writeFile(
        path.join(prChecksDir, 'config.yml'),
        yaml.stringify(customConfig)
      );

      const config = await readConfig(testDir);

      expect(config.input.checks).toHaveLength(2);
      expect(config.input.checks[0].name).toBe('my-test');
      expect(config.input.checks[1].name).toBe('my-review');
      expect(config.input.ciTrigger).toBe('/go');
      expect(config.input.branches).toEqual(['main']);
    });

    it('pr-test 체크에 setupSteps가 자동으로 설정되어야 함', async () => {
      const prChecksDir = path.join(testDir, '.pr-checks');
      await fs.ensureDir(prChecksDir);

      // Node
      const nodeConfig = {
        checks: [
          {
            name: 'pr-test',
            trigger: '/test',
            type: 'pr-test',
            mustRun: true,
            mustPass: true,
            command: 'npm test',
            framework: 'node',
          },
        ],
        ciTrigger: '/checks',
        branches: ['main'],
      };

      await fs.writeFile(
        path.join(prChecksDir, 'config.yml'),
        yaml.stringify(nodeConfig)
      );
      let config = await readConfig(testDir);
      expect((config.input.checks[0] as any).setupSteps?.some((s: any) => s.name === 'Setup Node.js')).toBe(true);

      // Python
      const pythonConfig = {
        checks: [
          {
            name: 'pr-test',
            trigger: '/test',
            type: 'pr-test',
            mustRun: true,
            mustPass: true,
            command: 'pytest',
            framework: 'python',
          },
        ],
        ciTrigger: '/checks',
        branches: ['main'],
      };
      await fs.writeFile(
        path.join(prChecksDir, 'config.yml'),
        yaml.stringify(pythonConfig)
      );
      config = await readConfig(testDir);
      expect((config.input.checks[0] as any).setupSteps?.some((s: any) => s.name === 'Install uv')).toBe(true);

      // Go
      const goConfig = {
        checks: [
          {
            name: 'pr-test',
            trigger: '/test',
            type: 'pr-test',
            mustRun: true,
            mustPass: true,
            command: 'go test',
            framework: 'go',
          },
        ],
        ciTrigger: '/checks',
        branches: ['main'],
      };
      await fs.writeFile(
        path.join(prChecksDir, 'config.yml'),
        yaml.stringify(goConfig)
      );
      config = await readConfig(testDir);
      expect((config.input.checks[0] as any).setupSteps?.some((s: any) => s.name === 'Setup Go')).toBe(true);

      // Rust
      const rustConfig = {
        checks: [
          {
            name: 'pr-test',
            trigger: '/test',
            type: 'pr-test',
            mustRun: true,
            mustPass: true,
            command: 'cargo test',
            framework: 'rust',
          },
        ],
        ciTrigger: '/checks',
        branches: ['main'],
      };
      await fs.writeFile(
        path.join(prChecksDir, 'config.yml'),
        yaml.stringify(rustConfig)
      );
      config = await readConfig(testDir);
      expect((config.input.checks[0] as any).setupSteps?.some((s: any) => s.name === 'Setup Rust')).toBe(true);

      // Custom
      const customConfig = {
        checks: [
          {
            name: 'pr-test',
            trigger: '/test',
            type: 'pr-test',
            mustRun: true,
            mustPass: true,
            command: './test.sh',
            framework: 'custom',
          },
        ],
        ciTrigger: '/checks',
        branches: ['main'],
      };
      await fs.writeFile(
        path.join(prChecksDir, 'config.yml'),
        yaml.stringify(customConfig)
      );
      config = await readConfig(testDir);
      expect((config.input.checks[0] as any).setupSteps).toHaveLength(0);
    });

    it('customRules가 있으면 읽어야 함', async () => {
      const prChecksDir = path.join(testDir, '.pr-checks');
      await fs.ensureDir(prChecksDir);

      const customConfig = {
        checks: [
          {
            name: 'pr-review',
            trigger: '/review',
            type: 'pr-review',
            mustRun: true,
            mustPass: false,
            provider: 'bedrock',
            model: 'model-id',
            apiKeySecret: 'KEY',
            customRules: '- 성능 최우선\n- console.log 금지',
          },
        ],
        ciTrigger: '/checks',
        branches: ['main'],
      };

      await fs.writeFile(
        path.join(prChecksDir, 'config.yml'),
        yaml.stringify(customConfig)
      );

      const config = await readConfig(testDir);

      expect((config.input.checks[0] as any).customRules).toContain('성능 최우선');
    });

    describe('validateConfig 에러 케이스', () => {
      it('지원하지 않는 AI provider는 에러를 던져야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            checks: [
              {
                name: 'pr-review',
                trigger: '/review',
                type: 'pr-review',
                mustRun: true,
                mustPass: false,
                provider: 'openai',
                model: 'gpt-4',
                apiKeySecret: 'KEY',
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        await expect(readConfig(testDir)).rejects.toThrow('지원하지 않는 프로바이더입니다');
      });

      it('지원하지 않는 테스트 프레임워크는 에러를 던져야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            checks: [
              {
                name: 'pr-test',
                trigger: '/test',
                type: 'pr-test',
                mustRun: true,
                mustPass: true,
                command: 'test',
                framework: 'invalid',
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        await expect(readConfig(testDir)).rejects.toThrow('지원하지 않는 프레임워크입니다');
      });

      it('빈 ai.model은 에러를 던져야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            checks: [
              {
                name: 'pr-review',
                trigger: '/review',
                type: 'pr-review',
                mustRun: true,
                mustPass: false,
                provider: 'bedrock',
                model: '  ',
                apiKeySecret: 'KEY',
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        await expect(readConfig(testDir)).rejects.toThrow('model은 bedrock provider에서 필수입니다');
      });

      it('빈 branches는 에러를 던져야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            checks: [],
            ciTrigger: '/checks',
            branches: [],
          })
        );

        await expect(readConfig(testDir)).rejects.toThrow('branches는 최소 1개 이상이어야 합니다.');
      });

      it('잘못된 YAML 문법은 에러를 던져야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          'invalid: yaml: syntax: :::::'
        );

        await expect(readConfig(testDir)).rejects.toThrow('config.yml 파싱 실패');
      });

      it('config.yml이 객체가 아니면 에러를 던져야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          '"just a string"'
        );

        await expect(readConfig(testDir)).rejects.toThrow('config.yml은 객체 형식이어야 합니다.');
      });

      it('check에 name이 없으면 에러를 던져야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            checks: [
              {
                trigger: '/test',
                type: 'pr-test',
                mustRun: true,
                mustPass: true,
                command: 'npm test',
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        await expect(readConfig(testDir)).rejects.toThrow('name은 필수입니다');
      });

      it('check에 type이 없으면 에러를 던져야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            checks: [
              {
                name: 'test',
                trigger: '/test',
                mustRun: true,
                mustPass: true,
                command: 'npm test',
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        await expect(readConfig(testDir)).rejects.toThrow('type은 필수입니다');
      });

      it('pr-test check에 command가 없으면 에러를 던져야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            checks: [
              {
                name: 'test',
                trigger: '/test',
                type: 'pr-test',
                mustRun: true,
                mustPass: true,
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        await expect(readConfig(testDir)).rejects.toThrow('command는 필수입니다');
      });

      it('cli provider에 cliTool이 없으면 에러를 던져야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            checks: [
              {
                name: 'cli-review',
                trigger: '/review',
                type: 'pr-review',
                mustRun: true,
                mustPass: false,
                provider: 'cli',
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        await expect(readConfig(testDir)).rejects.toThrow('cli provider에서는 claude, codex, gemini, kiro 중 하나를 지정하거나 cliCommand를 사용해야 합니다');
      });

      it('cli provider에 유효하지 않은 cliTool이면 에러를 던져야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            checks: [
              {
                name: 'cli-review',
                trigger: '/review',
                type: 'pr-review',
                mustRun: true,
                mustPass: false,
                provider: 'cli',
                cliTool: 'invalid-tool',
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        await expect(readConfig(testDir)).rejects.toThrow('cli provider에서는 claude, codex, gemini, kiro 중 하나를 지정하거나 cliCommand를 사용해야 합니다');
      });

      it('cli provider에 빈 문자열 cliCommand는 에러를 던져야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            checks: [
              {
                name: 'cli-review',
                trigger: '/review',
                type: 'pr-review',
                mustRun: true,
                mustPass: false,
                provider: 'cli',
                cliCommand: '   ',  // 공백만 있는 경우
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        await expect(readConfig(testDir)).rejects.toThrow('cli provider에서는 claude, codex, gemini, kiro 중 하나를 지정하거나 cliCommand를 사용해야 합니다');
      });

      it('숫자로 시작하는 체크 이름은 에러를 던져야 함 (bash 변수명 제약)', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            checks: [
              {
                name: '1test',
                trigger: '/test',
                type: 'pr-test',
                mustRun: true,
                mustPass: true,
                command: 'npm test',
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        await expect(readConfig(testDir)).rejects.toThrow('유효하지 않습니다');
      });

      it('cli provider에 유효한 cliTool이면 성공해야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            checks: [
              {
                name: 'cli-review',
                trigger: '/review',
                type: 'pr-review',
                mustRun: true,
                mustPass: false,
                provider: 'cli',
                cliTool: 'claude',
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        const config = await readConfig(testDir);
        expect(config.input.checks[0]).toMatchObject({
          provider: 'cli',
          cliTool: 'claude',
        });
      });
    });

    describe('selfHosted 설정 파싱', () => {
      it('selfHosted가 없으면 undefined여야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            checks: [
              {
                name: 'pr-test',
                trigger: '/test',
                type: 'pr-test',
                mustRun: true,
                mustPass: true,
                command: 'npm test',
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        const config = await readConfig(testDir);
        expect(config.input.selfHosted).toBeUndefined();
      });

      it('selfHosted: true면 docker: true로 파싱해야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            selfHosted: true,
            checks: [
              {
                name: 'pr-test',
                trigger: '/test',
                type: 'pr-test',
                mustRun: true,
                mustPass: true,
                command: 'npm test',
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        const config = await readConfig(testDir);
        expect(config.input.selfHosted).toBeDefined();
        expect(config.input.selfHosted?.docker).toBe(true);
      });

      it('selfHosted: false면 undefined여야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            selfHosted: false,
            checks: [
              {
                name: 'pr-test',
                trigger: '/test',
                type: 'pr-test',
                mustRun: true,
                mustPass: true,
                command: 'npm test',
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        const config = await readConfig(testDir);
        expect(config.input.selfHosted).toBeUndefined();
      });

      it('selfHosted.docker: true가 파싱되어야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            selfHosted: {
              docker: true,
            },
            checks: [
              {
                name: 'pr-test',
                trigger: '/test',
                type: 'pr-test',
                mustRun: true,
                mustPass: true,
                command: 'npm test',
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        const config = await readConfig(testDir);
        expect(config.input.selfHosted?.docker).toBe(true);
      });

      it('selfHosted.docker: false가 파싱되어야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            selfHosted: {
              docker: false,
            },
            checks: [
              {
                name: 'pr-test',
                trigger: '/test',
                type: 'pr-test',
                mustRun: true,
                mustPass: true,
                command: 'npm test',
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        const config = await readConfig(testDir);
        expect(config.input.selfHosted?.docker).toBe(false);
      });

      it('selfHosted 기본값 docker: true가 적용되어야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          yaml.stringify({
            selfHosted: {},
            checks: [
              {
                name: 'pr-test',
                trigger: '/test',
                type: 'pr-test',
                mustRun: true,
                mustPass: true,
                command: 'npm test',
              },
            ],
            ciTrigger: '/checks',
            branches: ['main'],
          })
        );

        const config = await readConfig(testDir);
        expect(config.input.selfHosted?.docker).toBe(true);
      });
    });

    describe('parseBoolean 동작', () => {
      it('문자열 "false"는 false로 파싱해야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        // YAML에서 따옴표로 감싸면 문자열로 파싱됨
        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          `checks:
  - name: pr-test
    trigger: /test
    type: pr-test
    mustRun: "false"
    mustPass: "false"
    command: npm test
ciTrigger: /checks
branches:
  - main`
        );

        const config = await readConfig(testDir);
        expect(config.input.checks[0].mustRun).toBe(false);
        expect(config.input.checks[0].mustPass).toBe(false);
      });

      it('문자열 "true"는 true로 파싱해야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          `checks:
  - name: pr-test
    trigger: /test
    type: pr-test
    mustRun: "true"
    mustPass: "true"
    command: npm test
ciTrigger: /checks
branches:
  - main`
        );

        const config = await readConfig(testDir);
        expect(config.input.checks[0].mustRun).toBe(true);
        expect(config.input.checks[0].mustPass).toBe(true);
      });

      it('문자열 "0", "no"도 false로 파싱해야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          `checks:
  - name: pr-test
    trigger: /test
    type: pr-test
    mustRun: "0"
    mustPass: "no"
    command: npm test
ciTrigger: /checks
branches:
  - main`
        );

        const config = await readConfig(testDir);
        expect(config.input.checks[0].mustRun).toBe(false);
        expect(config.input.checks[0].mustPass).toBe(false);
      });

      it('문자열 "1", "yes"도 true로 파싱해야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          `checks:
  - name: pr-test
    trigger: /test
    type: pr-test
    mustRun: "1"
    mustPass: "yes"
    command: npm test
ciTrigger: /checks
branches:
  - main`
        );

        const config = await readConfig(testDir);
        expect(config.input.checks[0].mustRun).toBe(true);
        expect(config.input.checks[0].mustPass).toBe(true);
      });

      it('인식 안 되는 문자열은 기본값을 반환해야 함', async () => {
        const prChecksDir = path.join(testDir, '.pr-checks');
        await fs.ensureDir(prChecksDir);

        await fs.writeFile(
          path.join(prChecksDir, 'config.yml'),
          `checks:
  - name: pr-test
    trigger: /test
    type: pr-test
    mustRun: "maybe"
    mustPass: "treu"
    command: npm test
ciTrigger: /checks
branches:
  - main`
        );

        const config = await readConfig(testDir);
        // 인식 안 되는 값은 각 필드의 기본값 반환
        // mustRun 기본값: true, mustPass 기본값: false
        expect(config.input.checks[0].mustRun).toBe(true);
        expect(config.input.checks[0].mustPass).toBe(false);
      });
    });
  });
});
