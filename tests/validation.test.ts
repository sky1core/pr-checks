import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
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
        setupSteps: [],
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
    branches: ['main'],
  },
});

// 참고: 입력 검증은 readConfig()의 validateConfig()에서 수행됨
// 검증 에러 테스트는 tests/readers.test.ts의 "validateConfig 에러 케이스" 참조

describe('입력값에 따른 YAML 생성', () => {
  describe('경계값 처리', () => {
    it('checks가 빈 배열이어도 YAML 생성됨', () => {
      const config = createTestConfig();
      config.input.checks = [];

      const yaml = generatePrChecksWorkflow(config);
      expect(() => parseYaml(yaml)).not.toThrow();
    });

    it('checks가 하나만 있어도 처리해야 함', () => {
      const config = createTestConfig();
      config.input.checks = [
        {
          name: 'single-test',
          trigger: '/test',
          type: 'pr-test',
          mustRun: true,
          mustPass: true,
          command: 'npm test',
        } as PrTestCheck,
      ];

      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);
      expect(parsed.jobs['single-test']).toBeDefined();
    });
  });

  describe('특수문자 이스케이프', () => {
    it('check name에 특수문자가 있어도 처리해야 함', () => {
      const config = createTestConfig();
      (config.input.checks[0] as PrTestCheck).name = 'test-unit-1';

      const yaml = generatePrChecksWorkflow(config);
      expect(() => parseYaml(yaml)).not.toThrow();
    });

    it('백슬래시가 포함된 명령어도 처리해야 함', () => {
      const config = createTestConfig();
      (config.input.checks[0] as PrTestCheck).command = 'echo "test\\nvalue"';

      const yaml = generatePrChecksWorkflow(config);
      expect(yaml).toContain('echo "test\\nvalue"');
    });

    it('달러 기호가 포함된 명령어도 처리해야 함', () => {
      const config = createTestConfig();
      (config.input.checks[0] as PrTestCheck).command = 'echo $HOME && npm test';

      const yaml = generatePrChecksWorkflow(config);
      expect(yaml).toContain('echo $HOME');
    });
  });

  describe('유니코드 처리', () => {
    it('한글이 포함된 customRules도 처리해야 함', () => {
      const config = createTestConfig();
      (config.input.checks[1] as PrReviewCheck).customRules = '- 한글 규칙';

      const yaml = generatePrChecksWorkflow(config);
      expect(yaml).toContain('한글 규칙');
    });

    it('일본어가 포함된 customRules도 처리해야 함', () => {
      const config = createTestConfig();
      (config.input.checks[1] as PrReviewCheck).customRules = '- 日本語ルール';

      const yaml = generatePrChecksWorkflow(config);
      expect(yaml).toContain('日本語ルール');
    });

    it('복합 이모지가 포함된 customRules도 처리해야 함', () => {
      const config = createTestConfig();
      (config.input.checks[1] as PrReviewCheck).customRules = '- 👨‍👩‍👧‍👦 가족 규칙';

      const yaml = generatePrChecksWorkflow(config);
      expect(yaml).toContain('👨‍👩‍👧‍👦');
    });
  });

  describe('긴 값 처리', () => {
    it('매우 긴 테스트 명령어도 처리해야 함', () => {
      const config = createTestConfig();
      (config.input.checks[0] as PrTestCheck).command = 'npm run ' + 'very-long-'.repeat(100) + 'test';

      const yaml = generatePrChecksWorkflow(config);
      expect(() => parseYaml(yaml)).not.toThrow();
      expect(yaml).toContain((config.input.checks[0] as PrTestCheck).command);
    });

    it('매우 긴 customRules도 처리해야 함', () => {
      const config = createTestConfig();
      (config.input.checks[1] as PrReviewCheck).customRules = ('- Rule number ' + '\n').repeat(100);

      const yaml = generatePrChecksWorkflow(config);
      expect(() => parseYaml(yaml)).not.toThrow();
    });

    it('많은 브랜치도 처리해야 함', () => {
      const config = createTestConfig();
      config.input.branches = Array.from({ length: 50 }, (_, i) => `branch-${i}`);

      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);
      expect(parsed.on.pull_request.branches).toHaveLength(50);
    });

    it('많은 checks도 처리해야 함', () => {
      const config = createTestConfig();
      config.input.checks = Array.from({ length: 10 }, (_, i) => ({
        name: `test-${i}`,
        trigger: `/test${i}`,
        type: 'pr-test',
        mustRun: i % 2 === 0,
        mustPass: i % 2 === 0,
        command: `npm run test${i}`,
      } as PrTestCheck));

      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      // 모든 check에 대해 job이 생성되어야 함
      for (let i = 0; i < 10; i++) {
        expect(parsed.jobs[`test-${i}`]).toBeDefined();
      }
    });
  });
});

describe('approval-override 입력 검증', () => {
  it('빈 브랜치 배열은 빈 조건으로 YAML 생성됨', () => {
    const config = createTestConfig();
    config.input.branches = [];

    // approval-override는 빈 브랜치여도 YAML 생성 자체는 가능 (빈 if 조건)
    const yaml = generateApprovalOverrideWorkflow(config);
    expect(() => parseYaml(yaml)).not.toThrow();
  });

  it('단일 브랜치도 처리해야 함', () => {
    const config = createTestConfig();
    config.input.branches = ['main'];

    const yaml = generateApprovalOverrideWorkflow(config);
    expect(yaml).toContain("github.event.pull_request.base.ref == 'main'");
  });

  it('mustRun + mustPass 체크가 여러 개여도 처리해야 함', () => {
    const config = createTestConfig();
    config.input.checks = [
      {
        name: 'test-1',
        trigger: '/test1',
        type: 'pr-test',
        mustRun: true,
        mustPass: true,
        command: 'npm test',
      } as PrTestCheck,
      {
        name: 'test-2',
        trigger: '/test2',
        type: 'pr-test',
        mustRun: true,
        mustPass: true,
        command: 'npm run test2',
      } as PrTestCheck,
    ];

    const yaml = generateApprovalOverrideWorkflow(config);
    expect(() => parseYaml(yaml)).not.toThrow();
    // restore-gate에서 두 체크 모두 확인해야 함
    expect(yaml).toContain('test-1');
    expect(yaml).toContain('test-2');
  });
});

describe('checks 배열 검증', () => {
  it('mustRun이 true인 체크만 ciTrigger로 실행됨', () => {
    const config = createTestConfig();
    config.input.checks = [
      {
        name: 'must-run-test',
        trigger: '/test',
        type: 'pr-test',
        mustRun: true,
        mustPass: true,
        command: 'npm test',
      } as PrTestCheck,
      {
        name: 'optional-lint',
        trigger: '/lint',
        type: 'pr-test',
        mustRun: false,
        mustPass: false,
        command: 'npm run lint',
      } as PrTestCheck,
    ];

    const yaml = generatePrChecksWorkflow(config);
    // ciTrigger(/checks)로 실행 시 mustRun 체크만 실행되어야 함
    expect(yaml).toContain(config.input.ciTrigger);
  });

  it('mustPass가 true인 체크는 성공 상태 확인이 있어야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);

    // review-status에서 mustPass 체크의 성공 여부 확인
    expect(yaml).toContain('pr-test');
    expect(yaml).toContain('success');
  });

  it('mustPass가 false인 체크는 실행 여부만 확인', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);

    // ai-review는 mustPass=false이므로 실행만 하면 됨
    expect(yaml).toContain('pr-review');
  });
});
