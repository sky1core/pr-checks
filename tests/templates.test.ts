import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { execSync } from 'child_process';
import { generatePrChecksWorkflow } from '../src/templates/pr-checks.js';
import { generateApprovalOverrideWorkflow } from '../src/templates/approval-override.js';
import type { Config, PrTestCheck, PrReviewCheck } from '../src/types/config.js';

const createTestConfig = (overrides: Partial<Config> = {}): Config => ({
  input: {
    platform: 'github',
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
          { name: 'Install deps', run: 'npm ci' },
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
  ...overrides,
});

const getStep = (parsed: any, jobName: string, stepName: string) => {
  const steps = parsed.jobs?.[jobName]?.steps ?? [];
  const step = steps.find((s: any) => s.name === stepName);
  if (!step) {
    throw new Error(`step not found: ${jobName}.${stepName}`);
  }
  return step;
};

const getStepRun = (parsed: any, jobName: string, stepName: string): string => {
  const step = getStep(parsed, jobName, stepName);
  return String(step.run ?? '');
};

describe('pr-checks.yml 생성', () => {
  describe('YAML 문법 유효성', () => {
    it('유효한 YAML을 생성해야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);

      expect(() => parseYaml(yaml)).not.toThrow();
    });

    it('빈 브랜치 배열도 처리해야 함', () => {
      const config = createTestConfig();
      config.input.branches = ['develop'];
      const yaml = generatePrChecksWorkflow(config);

      expect(() => parseYaml(yaml)).not.toThrow();
    });
  });

  describe('브랜치 설정', () => {
    it('대상 브랜치가 올바르게 설정되어야 함', () => {
      const config = createTestConfig();
      config.input.branches = ['main', 'develop'];

      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.on.pull_request.branches).toEqual(['main', 'develop']);
    });

    it('단일 브랜치도 처리해야 함', () => {
      const config = createTestConfig();
      config.input.branches = ['main'];

      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.on.pull_request.branches).toEqual(['main']);
    });
  });

  describe('필수 job 존재', () => {
    it('모든 필수 job이 있어야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.jobs['guide-comment']).toBeDefined();
      expect(parsed.jobs['check-trigger']).toBeDefined();
      expect(parsed.jobs['pr-test']).toBeDefined();
      expect(parsed.jobs['pr-review']).toBeDefined();
      expect(parsed.jobs['review-status']).toBeDefined();
    });
  });

  describe('동적 job 생성', () => {
    it('checks 배열에 따라 job이 생성되어야 함', () => {
      const config = createTestConfig();
      config.input.checks = [
        {
          name: 'my-test',
          trigger: '/mytest',
          type: 'pr-test',
          mustRun: true,
          mustPass: true,
          command: 'npm run test:unit',
        } as PrTestCheck,
        {
          name: 'lint-check',
          trigger: '/lint',
          type: 'pr-test',
          mustRun: false,
          mustPass: false,
          command: 'npm run lint',
        } as PrTestCheck,
      ];

      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.jobs['my-test']).toBeDefined();
      expect(parsed.jobs['lint-check']).toBeDefined();
    });

    it('AI 리뷰 체크도 job으로 생성되어야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.jobs['pr-review']).toBeDefined();
    });
  });

  describe('테스트 설정', () => {
    it('테스트 명령어가 올바르게 설정되어야 함', () => {
      const config = createTestConfig();
      (config.input.checks[0] as PrTestCheck).command = 'npm test';

      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('npm test');
    });

    it('테스트 setup steps가 포함되어야 함', () => {
      const config = createTestConfig();

      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('Setup Node.js');
      expect(yaml).toContain('actions/setup-node@v4');
      expect(yaml).toContain('Install deps');
      expect(yaml).toContain('npm ci');
    });
  });

  describe('워크플로우 트리거', () => {
    it('pull_request 트리거가 올바르게 설정되어야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.on.pull_request.types).toContain('opened');
    });

    it('pull_request synchronize 트리거가 있어야 함 (푸시 시 자동 실행)', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.on.pull_request.types).toContain('synchronize');
    });

    it('issue_comment 트리거가 있어야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.on.issue_comment).toBeDefined();
      expect(parsed.on.issue_comment.types).toContain('created');
    });

    it('check-trigger job이 pull_request synchronize 이벤트를 처리해야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain("github.event_name == 'pull_request'");
      expect(yaml).toContain("github.event.action == 'synchronize'");
    });

    it('Draft PR은 자동 실행을 스킵해야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('github.event.pull_request.draft');
      expect(yaml).toContain('Draft PR - skipping auto run');
    });

  });

  describe('autoRunOn 설정', () => {
    it('mustRun: true인 체크는 기본적으로 opened, synchronize에서 자동 실행', () => {
      const config = createTestConfig();
      config.input.checks = [
        {
          name: 'my-test',
          trigger: '/test',
          type: 'pr-test',
          mustRun: true,
          mustPass: true,
          command: 'npm test',
        } as PrTestCheck,
      ];

      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      // PR 이벤트 타입에 opened와 synchronize가 포함되어야 함
      expect(parsed.on.pull_request.types).toContain('opened');
      expect(parsed.on.pull_request.types).toContain('synchronize');

      // check-trigger outputs에 auto_run_my-test가 있어야 함
      expect(parsed.jobs['check-trigger'].outputs).toHaveProperty('auto_run_my-test');

      // 자동 실행 로직에 opened와 synchronize 조건이 있어야 함
      expect(yaml).toContain('auto_run_my-test=true');
    });

    it('mustRun: false인 체크는 기본적으로 자동 실행되지 않음', () => {
      const config = createTestConfig();
      config.input.checks = [
        {
          name: 'optional-test',
          trigger: '/opt',
          type: 'pr-test',
          mustRun: false,
          mustPass: false,
          command: 'npm run optional',
        } as PrTestCheck,
      ];

      const yaml = generatePrChecksWorkflow(config);

      // 자동 실행이 항상 false
      expect(yaml).toContain('auto_run_optional-test=false');
    });

    it('autoRunOn: []이면 자동 실행되지 않음', () => {
      const config = createTestConfig();
      config.input.checks = [
        {
          name: 'manual-only',
          trigger: '/manual',
          type: 'pr-test',
          mustRun: true,
          mustPass: true,
          command: 'npm test',
          autoRunOn: [],
        } as PrTestCheck,
      ];

      const yaml = generatePrChecksWorkflow(config);

      // 자동 실행이 항상 false
      expect(yaml).toContain('auto_run_manual-only=false');
    });

    it('autoRunOn: [opened]이면 PR 생성 시에만 자동 실행', () => {
      const config = createTestConfig();
      config.input.checks = [
        {
          name: 'create-only',
          trigger: '/create',
          type: 'pr-test',
          mustRun: true,
          mustPass: true,
          command: 'npm test',
          autoRunOn: ['opened'],
        } as PrTestCheck,
      ];

      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      // PR 이벤트 타입에 opened가 포함되어야 함
      expect(parsed.on.pull_request.types).toContain('opened');

      // opened 조건만 있어야 함
      expect(yaml).toContain('"$ACTION" = "opened"');
    });

    it('autoRunOn: [ready_for_review]이면 Ready 전환 시에만 자동 실행', () => {
      const config = createTestConfig();
      config.input.checks = [
        {
          name: 'ready-only',
          trigger: '/ready',
          type: 'pr-test',
          mustRun: true,
          mustPass: true,
          command: 'npm test',
          autoRunOn: ['ready_for_review'],
        } as PrTestCheck,
      ];

      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      // PR 이벤트 타입에 ready_for_review가 포함되어야 함
      expect(parsed.on.pull_request.types).toContain('ready_for_review');

      // ready_for_review 조건이 있어야 함
      expect(yaml).toContain('"$ACTION" = "ready_for_review"');
    });

    it('여러 체크의 autoRunOn이 합쳐져서 PR 이벤트 타입이 결정됨', () => {
      const config = createTestConfig();
      config.input.checks = [
        {
          name: 'test1',
          trigger: '/test1',
          type: 'pr-test',
          mustRun: true,
          mustPass: true,
          command: 'npm test',
          autoRunOn: ['opened'],
        } as PrTestCheck,
        {
          name: 'test2',
          trigger: '/test2',
          type: 'pr-test',
          mustRun: true,
          mustPass: true,
          command: 'npm test',
          autoRunOn: ['synchronize', 'reopened'],
        } as PrTestCheck,
      ];

      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      // 모든 이벤트 타입이 포함되어야 함
      expect(parsed.on.pull_request.types).toContain('opened');
      expect(parsed.on.pull_request.types).toContain('synchronize');
      expect(parsed.on.pull_request.types).toContain('reopened');
    });

    it('pr-test job의 if 조건에 auto_run output이 포함되어야 함', () => {
      const config = createTestConfig();
      config.input.checks = [
        {
          name: 'my-test',
          trigger: '/test',
          type: 'pr-test',
          mustRun: true,
          mustPass: true,
          command: 'npm test',
        } as PrTestCheck,
      ];

      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      // job의 if 조건에 auto_run이 포함되어야 함
      const jobIf = parsed.jobs['my-test'].if;
      expect(jobIf).toContain("needs.check-trigger.outputs.auto_run_my-test == 'true'");
    });

    it('pr-review job의 if 조건에 auto_run output이 포함되어야 함', () => {
      const config = createTestConfig();
      config.input.checks = [
        {
          name: 'my-review',
          trigger: '/review',
          type: 'pr-review',
          mustRun: true,
          mustPass: false,
          provider: 'bedrock',
          model: 'test-model',
          apiKeySecret: 'TEST_KEY',
        } as PrReviewCheck,
      ];

      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      // job의 if 조건에 auto_run이 포함되어야 함
      const jobIf = parsed.jobs['my-review'].if;
      expect(jobIf).toContain("needs.check-trigger.outputs.auto_run_my-review == 'true'");
    });
  });
});

describe('approval-override.yml 생성', () => {
  describe('YAML 문법 유효성', () => {
    it('유효한 YAML을 생성해야 함', () => {
      const config = createTestConfig();
      const yaml = generateApprovalOverrideWorkflow(config);

      expect(() => parseYaml(yaml)).not.toThrow();
    });
  });

  describe('브랜치 조건', () => {
    it('브랜치 조건이 job if에 포함되어야 함', () => {
      const config = createTestConfig();
      config.input.branches = ['main', 'develop'];

      const yaml = generateApprovalOverrideWorkflow(config);

      expect(yaml).toContain("github.event.pull_request.base.ref == 'main'");
      expect(yaml).toContain("github.event.pull_request.base.ref == 'develop'");
    });
  });

  describe('필수 job 존재', () => {
    it('override-gate와 restore-gate job이 있어야 함', () => {
      const config = createTestConfig();
      const yaml = generateApprovalOverrideWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.jobs['override-gate']).toBeDefined();
      expect(parsed.jobs['restore-gate']).toBeDefined();
    });
  });
});

describe('job 조건문 검증', () => {
  describe('guide-comment job', () => {
    it('opened 이벤트에서만 실행되어야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.jobs['guide-comment'].if).toContain("github.event.action == 'opened'");
    });
  });

  describe('check-trigger job', () => {
    it('outputs이 정의되어야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.jobs['check-trigger'].outputs.should_continue).toBeDefined();
      expect(parsed.jobs['check-trigger'].outputs.pr_number).toBeDefined();
      expect(parsed.jobs['check-trigger'].outputs.trigger).toBeDefined();
      expect(parsed.jobs['check-trigger'].outputs.user_message).toBeDefined();
      expect(parsed.jobs['check-trigger'].outputs.is_official).toBeDefined();
    });

    it('추가 메시지 추출 및 is_official 판정이 있어야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);

      // 추가 메시지 추출 로직
      expect(yaml).toContain('user_message');
      expect(yaml).toContain('USER_MESSAGE=');

      // is_official 판정 로직
      expect(yaml).toContain('is_official=true');
      expect(yaml).toContain('is_official=false');
    });

    it('user_message를 base64로 인코딩해야 함 (injection 방지)', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);

      // base64 인코딩 사용 (command injection 방지)
      expect(yaml).toContain('USER_MESSAGE_B64=$(printf');
      expect(yaml).toContain('| base64 |');
      expect(yaml).toContain('user_message=$USER_MESSAGE_B64');
    });

    it('공백만 있으면 is_official=true로 판정해야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);

      // USER_MESSAGE_TRIMMED로 공백 제거 후 판정
      expect(yaml).toContain('USER_MESSAGE_TRIMMED=');
      expect(yaml).toContain('if [ -z "$USER_MESSAGE_TRIMMED" ]');
    });

    it('awk로 트리거 이후 모든 줄을 추출해야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);

      // awk로 첫 줄 나머지 + 이후 줄 추출
      expect(yaml).toContain('awk -v trigger=');
      expect(yaml).toContain('found { print }');
    });

    it('GitHub 플랫폼은 collaborators API를 사용해야 함', () => {
      const config = createTestConfig();
      config.input.platform = 'github';
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('collaborators/$USER/permission');
      expect(yaml).toContain('# GitHub: collaborators API로 권한 확인');
      // GitHub에서는 Gitea 권한 체크 생략 로직이 없어야 함
      expect(yaml).not.toContain('# Gitea: 권한 체크 미지원');
    });

    it('Gitea 플랫폼은 권한 체크를 생략해야 함', () => {
      const config = createTestConfig();
      config.input.platform = 'gitea';
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('# Gitea: 권한 체크 미지원');
      expect(yaml).toContain('PERMISSION="write"');
      // Gitea에서는 collaborators API를 사용하지 않아야 함
      expect(yaml).not.toContain('# GitHub: collaborators API로 권한 확인');
    });
  });

  describe('pr-test job', () => {
    it('check-trigger에 의존해야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.jobs['pr-test'].needs).toContain('check-trigger');
    });

    it('트리거 조건이 있어야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      const jobIf = parsed.jobs['pr-test'].if;
      expect(jobIf).toContain("needs.check-trigger.outputs.should_continue == 'true'");
    });

    // 회귀 테스트: test_result.txt 파일 읽기 버그
    it('테스트 실패 판정은 step output 조건을 사용해야 함 (test_result.txt 사용 금지)', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      const prTestSteps = parsed.jobs['pr-test'].steps;
      const failStep = prTestSteps.find((s: any) => s.name === 'Fail if tests failed');

      expect(failStep).toBeDefined();
      // step output 조건을 사용해야 함
      expect(failStep.if).toBe("steps.test.outputs.passed != 'true'");
      // test_result.txt 파일을 읽는 코드가 없어야 함
      expect(yaml).not.toContain('test_result.txt');
    });
  });

  describe('pr-review job', () => {
    it('unit-test 성공 시 또는 직접 트리거 시 동작해야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      const jobIf = parsed.jobs['pr-review'].if;
      expect(jobIf).toContain("needs.check-trigger.outputs.should_continue == 'true'");
    });

    it('is_official=true일 때만 status 업데이트해야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      const steps = parsed.jobs['pr-review'].steps;
      const pendingStep = steps.find((s: any) => s.name === 'Set pending status');
      const finalStep = steps.find((s: any) => s.name === 'Set final status');

      expect(pendingStep.if).toContain("is_official == 'true'");
      expect(finalStep.if).toContain("is_official == 'true'");
    });

    it('비공식 실행 시 코멘트에 안내 메시지가 포함되어야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('비공식 실행');
      expect(yaml).toContain('mustRun/mustPass 체크에 반영되지 않습니다');
    });
  });

  describe('review-status job', () => {
    it('ai-review 등 의존 job이 있어야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.jobs['review-status'].needs).toBeDefined();
    });

    it('체크 상태 조회는 재시도 로직을 포함해야 함 (race 방지)', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('get_check_state()');
      expect(yaml).toContain('max_attempts=20');
      expect(yaml).toContain('sleep_seconds=2');
      // curl과 jq를 분리하여 각각의 실패를 감지
      expect(yaml).toContain('if ! raw=$(curl');
      expect(yaml).toContain('curl failed');
      expect(yaml).toContain('jq parse failed');
      // 빈 문자열/null도 none으로 취급
      expect(yaml).toContain('[ -z "$state" ] || [ "$state" = "null" ]');
      expect(yaml).toContain('state="none"');
      expect(yaml).toContain('status=$state (retry');
      expect(yaml).toContain('get_check_state "pr-test"');
      expect(yaml).toContain('get_check_state "pr-review"');
    });

    it('재시도 로그는 stderr로 출력해야 함 (state 오염 방지)', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('status=$state (retry');
      expect(yaml).toContain(')" >&2');
    });

    it('상태 파싱은 state/status 필드를 모두 지원해야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('(.state // .status // "none")');
    });
  });
});

describe('PR 생성 가이드 코멘트', () => {
  it('checks 배열에서 동적으로 생성되어야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);

    expect(yaml).toContain('/test');
    expect(yaml).toContain('/review');
    expect(yaml).toContain('/checks');
  });

  it('테이블 형식의 가이드가 있어야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);

    expect(yaml).toContain('| Command |');
    expect(yaml).toContain('| Description |');
    expect(yaml).toContain('| Required |');
  });
});

describe('AI 리뷰 프롬프트 검증', () => {
  it('위험도 등급이 프롬프트에 포함되어야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);

    expect(yaml).toContain('🔴 Critical');
    expect(yaml).toContain('🟡 Warning');
    expect(yaml).toContain('🟢 Info');
  });

  it('워크플로우 파일 변경 감지 규칙이 있어야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);

    expect(yaml).toContain('.github/workflows/');
    expect(yaml).toContain('Warning');
  });

  it('리뷰 시스템 무력화 방지 규칙이 있어야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);

    expect(yaml).toContain('리뷰 시스템을 완화/무력화');
    expect(yaml).toContain('Critical');
  });

  it('Tool Use 구조가 있어야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);

    expect(yaml).toContain('submit_review');
    expect(yaml).toContain('toolConfig');
    expect(yaml).toContain('toolChoice');
  });

  it('코드펜스는 raw triple backticks여야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);

    expect(yaml).toContain('```diff');
    expect(yaml).not.toContain('\\`\\`\\`diff');
  });

  it('판정 기준이 명확해야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);

    expect(yaml).toContain('Critical 있으면');
    expect(yaml).toContain('fail');
    expect(yaml).toContain('Warning 있으면');
    expect(yaml).toContain('pass');
  });
});

describe('코멘트 접기 (Collapse) 기능 검증', () => {
  it('AI 리뷰 코멘트 접기 step이 있어야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);
    const parsed = parseYaml(yaml);

    const aiReviewSteps = parsed.jobs['pr-review'].steps;
    const collapseStep = aiReviewSteps.find((s: any) => s.name === 'Collapse old review comments');
    expect(collapseStep).toBeDefined();
  });

  it('단위테스트 실패 코멘트 접기 step이 있어야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);
    const parsed = parseYaml(yaml);

    const unitTestSteps = parsed.jobs['pr-test'].steps;
    const collapseStep = unitTestSteps.find((s: any) => s.name === 'Collapse old comments');
    expect(collapseStep).toBeDefined();
  });

  it('<details open> 태그 사용해야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);

    expect(yaml).toContain('<details open>');
  });

  it('이전 코멘트는 <details>로 변경해야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);

    expect(yaml).toContain("sed 's/<details open>/<details>/'");
  });
});

describe('API 키 시크릿 검증', () => {
  it('설정된 API 키 시크릿을 사용해야 함', () => {
    const config = createTestConfig();
    (config.input.checks[1] as PrReviewCheck).apiKeySecret = 'MY_CUSTOM_KEY';

    const yaml = generatePrChecksWorkflow(config);

    expect(yaml).toContain('secrets.MY_CUSTOM_KEY');
  });

  it('기본값은 BEDROCK_API_KEY여야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);

    expect(yaml).toContain('secrets.BEDROCK_API_KEY');
  });
});

describe('권한 설정 검증', () => {
  it('guide-comment job에 필요한 권한이 있어야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);
    const parsed = parseYaml(yaml);

    const permissions = parsed.jobs['guide-comment'].permissions;
    expect(permissions['pull-requests']).toBe('write');
    expect(permissions.statuses).toBe('write');
  });

  it('ai-review job에 필요한 권한이 있어야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);
    const parsed = parseYaml(yaml);

    const permissions = parsed.jobs['pr-review'].permissions;
    expect(permissions.contents).toBe('read');
    expect(permissions['pull-requests']).toBe('write');
    expect(permissions.statuses).toBe('write');
  });

  it('review-status job에 필요한 권한이 있어야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);
    const parsed = parseYaml(yaml);

    const permissions = parsed.jobs['review-status'].permissions;
    expect(permissions.statuses).toBe('write');
    expect(permissions['pull-requests']).toBe('read');
  });
});

describe('concurrency 설정 검증', () => {
  it('PR별 동시 실행 방지가 설정되어야 함', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);
    const parsed = parseYaml(yaml);

    expect(parsed.concurrency).toBeDefined();
    expect(parsed.concurrency.group).toContain('github.event.pull_request.number');
    expect(parsed.concurrency['cancel-in-progress']).toBe(false);
  });
});

describe('테스트 프레임워크별 설정', () => {
  describe('Node.js 프리셋', () => {
    it('node 프리셋이 올바르게 적용되어야 함', () => {
      const config = createTestConfig();
      (config.input.checks[0] as PrTestCheck).framework = 'node';
      (config.input.checks[0] as PrTestCheck).command = 'npm test';
      (config.input.checks[0] as PrTestCheck).setupSteps = [
        { name: 'Setup Node.js', uses: 'actions/setup-node@v4', with: { 'node-version': '20' } },
        { name: 'Install dependencies', run: 'npm ci' },
      ];

      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('Setup Node.js');
      expect(yaml).toContain('actions/setup-node@v4');
      expect(yaml).toContain('npm ci');
      expect(yaml).toContain('npm test');
    });
  });

  describe('Python 프리셋', () => {
    it('python 프리셋이 올바르게 적용되어야 함', () => {
      const config = createTestConfig();
      (config.input.checks[0] as PrTestCheck).framework = 'python';
      (config.input.checks[0] as PrTestCheck).command = 'uv run pytest tests/ -v';
      (config.input.checks[0] as PrTestCheck).setupSteps = [
        { name: 'Install uv', uses: 'astral-sh/setup-uv@v4' },
      ];

      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('Install uv');
      expect(yaml).toContain('astral-sh/setup-uv@v4');
      expect(yaml).toContain('uv run pytest');
    });
  });

  describe('Go 프리셋', () => {
    it('go 프리셋이 올바르게 적용되어야 함', () => {
      const config = createTestConfig();
      (config.input.checks[0] as PrTestCheck).framework = 'go';
      (config.input.checks[0] as PrTestCheck).command = 'go test ./...';
      (config.input.checks[0] as PrTestCheck).setupSteps = [
        { name: 'Setup Go', uses: 'actions/setup-go@v5', with: { 'go-version': '1.22' } },
      ];

      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('Setup Go');
      expect(yaml).toContain('actions/setup-go@v5');
      expect(yaml).toContain('go test ./...');
    });
  });

  describe('Rust 프리셋', () => {
    it('rust 프리셋이 올바르게 적용되어야 함', () => {
      const config = createTestConfig();
      (config.input.checks[0] as PrTestCheck).framework = 'rust';
      (config.input.checks[0] as PrTestCheck).command = 'cargo test';
      (config.input.checks[0] as PrTestCheck).setupSteps = [
        { name: 'Setup Rust', uses: 'dtolnay/rust-toolchain@stable' },
      ];

      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('Setup Rust');
      expect(yaml).toContain('dtolnay/rust-toolchain@stable');
      expect(yaml).toContain('cargo test');
    });
  });

  describe('Custom 프리셋', () => {
    it('custom 프리셋은 setup steps가 비어있어도 됨', () => {
      const config = createTestConfig();
      (config.input.checks[0] as PrTestCheck).framework = 'custom';
      (config.input.checks[0] as PrTestCheck).command = './run-tests.sh';
      (config.input.checks[0] as PrTestCheck).setupSteps = [];

      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(yaml).toContain('./run-tests.sh');
      expect(parsed.jobs['pr-test']).toBeDefined();
    });
  });
});

describe('에지 케이스', () => {
  describe('특수문자 처리', () => {
    it('customRules에 특수문자가 있어도 처리되어야 함', () => {
      const config = createTestConfig();
      (config.input.checks[1] as PrReviewCheck).customRules = '- `console.log` 사용 금지\n- O(n²) 복잡도 경고';

      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('console.log');
      expect(yaml).toContain('O(n²)');
    });
  });

  describe('극단적인 값', () => {
    it('브랜치가 많아도 처리되어야 함', () => {
      const config = createTestConfig();
      config.input.branches = ['main', 'master', 'develop', 'staging', 'production', 'release/*'];

      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.on.pull_request.branches).toHaveLength(6);
    });

    it('긴 테스트 명령어도 처리되어야 함', () => {
      const config = createTestConfig();
      (config.input.checks[0] as PrTestCheck).command = 'npm run lint && npm run typecheck && npm run test:unit && npm run test:integration';

      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('npm run lint && npm run typecheck && npm run test:unit && npm run test:integration');
    });

    it('멀티라인 customRules도 처리되어야 함', () => {
      const config = createTestConfig();
      (config.input.checks[1] as PrReviewCheck).customRules = `- 성능 최우선
- 보안 취약점은 무조건 Critical
- console.log 금지
- TODO 주석 경고
- 테스트 커버리지 80% 이상 권장`;

      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('성능 최우선');
      expect(yaml).toContain('보안 취약점');
      expect(yaml).toContain('테스트 커버리지');
    });
  });

  describe('빈 값 처리', () => {
    it('customRules가 undefined여도 처리되어야 함', () => {
      const config = createTestConfig();
      delete (config.input.checks[1] as PrReviewCheck).customRules;

      const yaml = generatePrChecksWorkflow(config);

      expect(() => parseYaml(yaml)).not.toThrow();
    });

    it('setupSteps가 빈 배열이어도 처리되어야 함', () => {
      const config = createTestConfig();
      (config.input.checks[0] as PrTestCheck).setupSteps = [];

      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.jobs['pr-test']).toBeDefined();
    });
  });
});

describe('approval-override.yml 상세 검증', () => {
  describe('트리거 설정', () => {
    it('pull_request_review 트리거가 있어야 함', () => {
      const config = createTestConfig();
      const yaml = generateApprovalOverrideWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.on.pull_request_review).toBeDefined();
      expect(parsed.on.pull_request_review.types).toContain('submitted');
    });

    it('pull_request_review 트리거가 dismiss 타입도 있어야 함', () => {
      const config = createTestConfig();
      const yaml = generateApprovalOverrideWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.on.pull_request_review.types).toContain('dismissed');
    });
  });

  describe('override-gate job', () => {
    it('approved 리뷰에서만 실행되어야 함', () => {
      const config = createTestConfig();
      const yaml = generateApprovalOverrideWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.jobs['override-gate'].if).toContain("github.event.review.state == 'approved'");
    });

    it('브랜치 조건이 있어야 함', () => {
      const config = createTestConfig();
      config.input.branches = ['main', 'develop'];

      const yaml = generateApprovalOverrideWorkflow(config);

      expect(yaml).toContain("github.event.pull_request.base.ref == 'main'");
      expect(yaml).toContain("github.event.pull_request.base.ref == 'develop'");
    });

    it('PR Checks Status를 success로 설정해야 함', () => {
      const config = createTestConfig();
      const yaml = generateApprovalOverrideWorkflow(config);

      expect(yaml).toContain('PR Checks Status');
      expect(yaml).toContain('"state":"success"');
    });

    it('override 설명 문자열이 포함되어야 함', () => {
      const config = createTestConfig();
      const yaml = generateApprovalOverrideWorkflow(config);
      const parsed = parseYaml(yaml);

      const run = getStepRun(parsed, 'override-gate', 'Override PR Checks Status if needed');
      expect(run).toContain('Overridden by approval');
    });
  });

  describe('restore-gate job', () => {
    it('dismissed 액션에서만 실행되어야 함', () => {
      const config = createTestConfig();
      const yaml = generateApprovalOverrideWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.jobs['restore-gate'].if).toContain("github.event.action == 'dismissed'");
    });

    it('다른 approve가 없을 때만 상태를 복원해야 함', () => {
      const config = createTestConfig();
      const yaml = generateApprovalOverrideWorkflow(config);

      expect(yaml).toContain('APPROVED');
      expect(yaml).toContain('/reviews');
    });

    it('override 여부 판단 로직이 있어야 함', () => {
      const config = createTestConfig();
      const yaml = generateApprovalOverrideWorkflow(config);
      const parsed = parseYaml(yaml);

      const run = getStepRun(parsed, 'restore-gate', 'Restore PR Checks Status if needed');
      expect(run).toContain('Overridden');
    });

    it('mustRun + mustPass 체크들의 상태를 확인해야 함', () => {
      const config = createTestConfig();
      const yaml = generateApprovalOverrideWorkflow(config);

      // unit-test는 mustRun + mustPass이므로 상태 확인이 있어야 함
      expect(yaml).toContain('pr-test');
    });
  });

  describe('권한 설정', () => {
    it('override-gate에 필요한 권한이 있어야 함', () => {
      const config = createTestConfig();
      const yaml = generateApprovalOverrideWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.jobs['override-gate'].permissions.statuses).toBe('write');
    });

    it('restore-gate에 필요한 권한이 있어야 함', () => {
      const config = createTestConfig();
      const yaml = generateApprovalOverrideWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.jobs['restore-gate'].permissions.statuses).toBe('write');
      expect(parsed.jobs['restore-gate'].permissions['pull-requests']).toBe('write');
    });
  });
});

describe('checks 배열 기반 동작', () => {
  it('mustRun 체크만 ciTrigger에 포함되어야 함', () => {
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

    // check-trigger job에서 ciTrigger 처리 시 mustRun 체크만 트리거
    expect(yaml).toContain('/checks');
  });

  it('mustPass가 true인 체크는 성공해야 머지 가능', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);

    // review-status job에서 mustPass 체크의 성공 여부 확인
    expect(yaml).toContain('pr-test');
  });

  it('mustPass가 false인 체크는 실행만 하면 됨', () => {
    const config = createTestConfig();
    const yaml = generatePrChecksWorkflow(config);

    // ai-review는 mustRun=true, mustPass=false
    expect(yaml).toContain('pr-review');
  });
});

describe('트리거 파싱 로직', () => {
  // 워크플로우에 사용되는 bash 로직을 직접 테스트
  const extractFirstWord = (comment: string): string => {
    // 워크플로우의 실제 로직: awk 'NF{print $1; exit}'
    const result = execSync(`printf '%s' "${comment.replace(/"/g, '\\"')}" | awk 'NF{print $1; exit}'`, {
      encoding: 'utf-8',
    });
    return result.trim();
  };

  it('일반 트리거 명령어', () => {
    expect(extractFirstWord('/review')).toBe('/review');
    expect(extractFirstWord('/test')).toBe('/test');
    expect(extractFirstWord('/checks')).toBe('/checks');
  });

  it('뒤에 줄바꿈이 있는 경우', () => {
    expect(extractFirstWord('/review\n')).toBe('/review');
    expect(extractFirstWord('/review\n\n')).toBe('/review');
  });

  it('앞에 줄바꿈이 있는 경우', () => {
    expect(extractFirstWord('\n/review')).toBe('/review');
    expect(extractFirstWord('\n\n/review')).toBe('/review');
  });

  it('앞뒤에 줄바꿈이 있는 경우', () => {
    expect(extractFirstWord('\n/review\n')).toBe('/review');
    expect(extractFirstWord('\n\n/review\n\n')).toBe('/review');
  });

  it('앞에 공백이 있는 경우', () => {
    expect(extractFirstWord('  /review')).toBe('/review');
    expect(extractFirstWord('\t/review')).toBe('/review');
  });

  it('뒤에 추가 텍스트가 있는 경우', () => {
    expect(extractFirstWord('/review please')).toBe('/review');
    expect(extractFirstWord('/review\nmore text')).toBe('/review');
  });

  it('빈 문자열 또는 공백만', () => {
    expect(extractFirstWord('')).toBe('');
    expect(extractFirstWord('   ')).toBe('');
    expect(extractFirstWord('\n\n')).toBe('');
  });

  it('트리거가 아닌 텍스트', () => {
    expect(extractFirstWord('hello world')).toBe('hello');
    expect(extractFirstWord('LGTM')).toBe('LGTM');
  });
});

describe('CLI provider 지원', () => {
  const createCliConfig = (
    cliTool: 'claude' | 'codex' | 'gemini' | 'kiro',
    parser?: 'auto' | 'json' | 'verdict'
  ): Config => ({
    input: {
      platform: 'github',
      runner: ['self-hosted', 'macOS', 'ARM64'],
      checks: [
        {
          name: 'cli-review',
          trigger: '/review',
          type: 'pr-review',
          mustRun: true,
          mustPass: false,
          provider: 'cli',
          cliTool,
          parser,
        } as PrReviewCheck,
      ],
      ciTrigger: '/checks',
      generateApprovalOverride: false,
      branches: ['main'],
    },
  });

  describe('CLI 도구별 명령어 생성', () => {
    it('claude CLI 명령어가 올바르게 생성되어야 함', () => {
      const config = createCliConfig('claude');
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('claude -p');
      expect(yaml).toContain('Run AI Review (claude)');
    });

    it('codex CLI 명령어가 올바르게 생성되어야 함', () => {
      const config = createCliConfig('codex');
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('codex exec');
      expect(yaml).toContain('Run AI Review (codex)');
    });

    it('gemini CLI 명령어가 올바르게 생성되어야 함', () => {
      const config = createCliConfig('gemini');
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('gemini -p');
      expect(yaml).toContain('Run AI Review (gemini)');
    });

    it('kiro CLI 명령어가 올바르게 생성되어야 함', () => {
      const config = createCliConfig('kiro');
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('kiro-cli chat --no-interactive');
      expect(yaml).toContain('Run AI Review (kiro)');
      // ANSI 코드 제거 필터가 있어야 함
      expect(yaml).toContain('perl -pe');
      // CSI 시퀀스 패턴 (색상, 커서 제어 등)
      expect(yaml).toContain('[0-?]*[ -\\/]*[\\@-~]');
    });

    it('커스텀 명령어가 올바르게 생성되어야 함', () => {
      const config: Config = {
        input: {
          platform: 'github',
          runner: ['self-hosted', 'macOS', 'ARM64'],
          checks: [
            {
              name: 'custom-review',
              trigger: '/review',
              type: 'pr-review',
              mustRun: true,
              mustPass: false,
              provider: 'cli',
              cliCommand: 'my-review-wrapper',
            } as PrReviewCheck,
          ],
          ciTrigger: '/checks',
          generateApprovalOverride: false,
          branches: ['main'],
        },
      };
      const yaml = generatePrChecksWorkflow(config);

      // 커스텀 명령어 사용
      expect(yaml).toContain('my-review-wrapper "$PR_NUMBER"');
      expect(yaml).toContain('Run AI Review (custom)');
      // diff 스텝이 없어야 함
      expect(yaml).not.toContain('Get PR diff');
      expect(yaml).not.toContain('DIFF_CONTENT=$(cat diff.txt)');
      // parser auto + cliCommand => json 파서
      expect(yaml).toContain('parser=json: 구조화 출력(JSON)만 허용');
      expect(yaml).toContain('jq -e');
      expect(yaml).toContain('JSON 파싱 실패');
      expect(yaml).toContain('RAW_ERROR_FILE="${{ github.workspace }}/review.stderr.txt"');
      expect(yaml).toContain('> "$RAW_OUTPUT_FILE" 2> "$RAW_ERROR_FILE"');
      expect(yaml).toContain('--- STDERR ---');
      // verdict 마커 파싱은 없어야 함
      expect(yaml).not.toContain('<<<VERDICT:CRITICAL>>>');
      expect(yaml).not.toContain('<<<VERDICT:WARNING>>>');
      expect(yaml).not.toContain('<<<VERDICT:OK>>>');
      // result 출력
      expect(yaml).toContain('EXIT_CODE=$?');
      expect(yaml).toContain('result=critical');
      expect(yaml).toContain('result=$RESULT');
      // 댓글 푸터에 CLI: custom 표시
      expect(yaml).toContain('CLI: custom');
    });
  });

  describe('diff 헤더 설정', () => {
    it('GitHub API diff 요청 시 Accept 헤더가 포함되어야 함', () => {
      const config = createCliConfig('claude');
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('Accept: application/vnd.github.diff');
      // .diff URL 확장자를 사용하면 안 됨
      expect(yaml).not.toContain('/pulls/$PR_NUMBER.diff');
    });
  });

  describe('CLI 리뷰 스텝 구조', () => {
    it('DIFF_CONTENT 변수가 설정되어야 함', () => {
      const config = createCliConfig('claude');
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('DIFF_CONTENT=$(cat diff.txt)');
    });

    it('ANSI escape 코드 필터가 CSI/OSC/문자셋 시퀀스를 모두 처리해야 함', () => {
      const config = createCliConfig('claude');
      const yaml = generatePrChecksWorkflow(config);

      // CSI 시퀀스 패턴 (색상, 커서 제어: \e[?25h 등)
      expect(yaml).toContain('[0-?]*[ -\\/]*[\\@-~]');
      // OSC 시퀀스 패턴 (터미널 타이틀 등: \e]0;title\x07)
      expect(yaml).toContain('[^\\x07]*\\x07');
      // 문자셋 시퀀스 패턴 (\e(0, \e)2 등)
      expect(yaml).toContain('[()][0-2]');
    });

    it('프롬프트에 diff 내용이 포함되어야 함', () => {
      const config = createCliConfig('claude');
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('=== DIFF ===');
      expect(yaml).toContain('=== END DIFF ===');
    });

    it('CLI provider는 VERDICT 마커 기반으로 3단계 판정해야 함 (CRITICAL 우선)', () => {
      const config = createCliConfig('gemini');
      const yaml = generatePrChecksWorkflow(config);

      // exit code 캡처
      expect(yaml).toContain('EXIT_CODE=$?');
      // VERDICT 마커 기반 3단계 판정 (CRITICAL 우선 체크)
      expect(yaml).toContain('<<<VERDICT:CRITICAL>>>');
      expect(yaml).toContain('<<<VERDICT:WARNING>>>');
      expect(yaml).toContain('<<<VERDICT:OK>>>');
      expect(yaml).toContain('result=critical');
      expect(yaml).toContain('result=warning');
      expect(yaml).toContain('result=ok');
      // 마커 제거 (perl 사용 - macOS/Linux 호환)
      expect(yaml).toContain('perl -pi -e');
    });

    it('CLI 리뷰 프롬프트가 포함되어야 함', () => {
      const config = createCliConfig('gemini');
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('시니어 개발자');
      expect(yaml).toContain('코드 변경사항을 리뷰');
      // VERDICT 마커 출력 지시
      expect(yaml).toContain('<<<VERDICT:CRITICAL>>>');
      expect(yaml).toContain('<<<VERDICT:WARNING>>>');
      expect(yaml).toContain('<<<VERDICT:OK>>>');
    });

    it('auto 모드에서 claude는 JSON 파서를 사용해야 함', () => {
      const config = createCliConfig('claude');
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('parser=json: 구조화 출력(JSON)만 허용');
      expect(yaml).toContain('최종 출력은 반드시 JSON 객체 1개만 출력하세요.');
      expect(yaml).toContain('RAW_ERROR_FILE="review.stderr.txt"');
      expect(yaml).toContain('> "$RAW_OUTPUT_FILE" 2> "$RAW_ERROR_FILE"');
      expect(yaml).toContain('--- STDERR ---');
      expect(yaml).not.toContain('<<<VERDICT:CRITICAL>>>');
    });

    it('auto 모드에서 gemini는 VERDICT 파서를 사용해야 함', () => {
      const config = createCliConfig('gemini');
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('<<<VERDICT:CRITICAL>>>');
      expect(yaml).toContain('<<<VERDICT:WARNING>>>');
      expect(yaml).toContain('<<<VERDICT:OK>>>');
      expect(yaml).toContain('> "$RAW_OUTPUT_FILE" 2>&1');
    });

    it('parser를 verdict로 강제하면 codex도 VERDICT 파서를 사용해야 함', () => {
      const config = createCliConfig('codex', 'verdict');
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('<<<VERDICT:CRITICAL>>>');
      expect(yaml).toContain('<<<VERDICT:WARNING>>>');
      expect(yaml).toContain('<<<VERDICT:OK>>>');
    });

    it('parser를 json으로 강제하면 gemini도 JSON 파서를 사용해야 함', () => {
      const config = createCliConfig('gemini', 'json');
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('parser=json: 구조화 출력(JSON)만 허용');
      expect(yaml).toContain('최종 출력은 반드시 JSON 객체 1개만 출력하세요.');
      expect(yaml).not.toContain('<<<VERDICT:CRITICAL>>>');
    });

    it('CLI provider 댓글이 접기 패턴과 일치해야 함 (회귀 테스트)', () => {
      const config = createCliConfig('claude');
      const yaml = generatePrChecksWorkflow(config);

      // CLI provider 댓글도 result 기반으로 ✅/⚠️/❌ 이모지 사용 (3단계)
      expect(yaml).toContain('echo "## ${EMOJI} cli-review');
      // 동적으로 EMOJI 결정 (3단계)
      expect(yaml).toContain('EMOJI="✅"');
      expect(yaml).toContain('EMOJI="⚠️"');
      expect(yaml).toContain('EMOJI="❌"');
    });
  });

  describe('runner 설정', () => {
    it('self-hosted runner 배열이 올바르게 포맷되어야 함', () => {
      const config = createCliConfig('claude');
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.jobs['cli-review']['runs-on']).toEqual(['self-hosted', 'macOS', 'ARM64']);
    });

    it('문자열 runner도 처리되어야 함', () => {
      const config = createCliConfig('claude');
      config.input.runner = 'ubuntu-latest';
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      expect(parsed.jobs['cli-review']['runs-on']).toBe('ubuntu-latest');
    });
  });

  describe('코멘트 포맷', () => {
    it('CLI 도구 정보가 코멘트에 포함되어야 함', () => {
      const config = createCliConfig('claude');
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('CLI: claude');
    });

    it('diff 크기를 awk로 계산해야 함 (bc 대신)', () => {
      const config = createCliConfig('claude');
      const yaml = generatePrChecksWorkflow(config);

      // awk로 KB 변환 (bc 의존성 제거)
      expect(yaml).toContain('DIFF_KB=$(awk');
      expect(yaml).toContain('$DIFF_SIZE / 1024');
      // bc는 사용하면 안 됨
      expect(yaml).not.toContain('| bc');
    });
  });

  describe('YAML 유효성', () => {
    it('CLI provider 설정으로 유효한 YAML이 생성되어야 함', () => {
      const config = createCliConfig('claude');
      const yaml = generatePrChecksWorkflow(config);

      expect(() => parseYaml(yaml)).not.toThrow();
    });

    it('모든 CLI 도구에서 유효한 YAML이 생성되어야 함', () => {
      const tools: Array<'claude' | 'codex' | 'gemini' | 'kiro'> = ['claude', 'codex', 'gemini', 'kiro'];

      for (const tool of tools) {
        const config = createCliConfig(tool);
        const yaml = generatePrChecksWorkflow(config);

        expect(() => parseYaml(yaml)).not.toThrow();
      }
    });
  });
});

describe('selfHosted 지원', () => {
  const createSelfHostedConfig = (): Config => ({
    input: {
      platform: 'github',
      runner: ['self-hosted', 'macOS', 'ARM64'],
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
          framework: 'node',
          setupSteps: [
            { name: 'Setup Node.js', uses: 'actions/setup-node@v4', with: { 'node-version': '20' } },
          ],
        } as PrTestCheck,
        {
          name: 'pr-review',
          trigger: '/review',
          type: 'pr-review',
          mustRun: true,
          mustPass: false,
          provider: 'cli',
          cliTool: 'claude',
        } as PrReviewCheck,
      ],
      ciTrigger: '/checks',
      generateApprovalOverride: false,
      branches: ['main'],
    },
  });

  describe('Docker 체크 스텝', () => {
    it('pr-test에 Docker 체크 스텝이 포함되어야 함', () => {
      const config = createSelfHostedConfig();
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('Ensure Docker is running');
      expect(yaml).toContain('open -a Docker');
      expect(yaml).toContain("if: runner.os == 'macOS'");
    });

    it('pr-review에 Docker 체크 스텝이 포함되어야 함', () => {
      const config = createSelfHostedConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      const prReviewSteps = parsed.jobs['pr-review']?.steps || [];
      const dockerStep = prReviewSteps.find((s: any) => s.name === 'Ensure Docker is running');
      expect(dockerStep).toBeDefined();
    });

    it('docker: false면 Docker 체크 스텝이 없어야 함', () => {
      const config = createSelfHostedConfig();
      config.input.selfHosted!.docker = false;
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).not.toContain('Ensure Docker is running');
    });
  });

  describe('저장소 캐싱 (repo-cache)', () => {
    it('Clone or update repository 스텝이 포함되어야 함', () => {
      const config = createSelfHostedConfig();
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('Clone or update repository');
      expect(yaml).toContain('git fetch --all --prune');
      expect(yaml).toContain('git clone');
    });

    it('REPO_DIR 출력이 설정되어야 함', () => {
      const config = createSelfHostedConfig();
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('repo_dir=');
      expect(yaml).toContain('GITHUB_OUTPUT');
    });
  });

  describe('PR fetch', () => {
    it('Fetch PR branch 스텝이 포함되어야 함', () => {
      const config = createSelfHostedConfig();
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('Fetch PR branch');
      expect(yaml).toContain('git fetch origin pull/');
      expect(yaml).toContain('git checkout pr-');
    });

    // 회귀 테스트: 기존 PR 브랜치 체크아웃 상태에서 fetch 실패 버그
    it('기존 PR 브랜치 삭제 후 fetch해야 함 (재fetch 버그 방지)', () => {
      const config = createSelfHostedConfig();
      const yaml = generatePrChecksWorkflow(config);

      // 기존 브랜치가 체크아웃된 경우 detach
      expect(yaml).toContain('git rev-parse --abbrev-ref HEAD');
      expect(yaml).toContain('git checkout --detach');
      // 기존 PR 브랜치 삭제
      expect(yaml).toContain('git branch -D pr-$PR_NUMBER');
    });

    it('pr_branch 출력이 설정되어야 함', () => {
      const config = createSelfHostedConfig();
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('pr_branch=pr-');
    });
  });

  describe('git diff', () => {
    it('useGitDiff가 true면 git diff 스텝이 포함되어야 함', () => {
      const config = createSelfHostedConfig();
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('Generate diff using git');
      expect(yaml).toContain('git diff origin/');
    });

    it('useGitDiff가 true면 GitHub API diff가 사용되지 않아야 함', () => {
      const config = createSelfHostedConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      // pr-review job에서 GitHub API diff 스텝 확인
      const prReviewSteps = parsed.jobs['pr-review']?.steps || [];
      const githubApiDiffStep = prReviewSteps.find((s: any) => s.name === 'Get PR diff');
      expect(githubApiDiffStep).toBeUndefined();
    });

    it('base branch를 가져오는 로직이 포함되어야 함', () => {
      const config = createSelfHostedConfig();
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('BASE_BRANCH=');
      expect(yaml).toContain('.base.ref');
    });
  });

  describe('selfHosted 없을 때 기본 동작', () => {
    it('selfHosted가 없으면 GitHub API diff가 사용되어야 함', () => {
      const config = createSelfHostedConfig();
      delete config.input.selfHosted;
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('Get PR diff');
      expect(yaml).toContain('Accept: application/vnd.github.diff');
    });

    it('selfHosted가 없으면 actions/checkout이 사용되어야 함', () => {
      const config = createSelfHostedConfig();
      delete config.input.selfHosted;
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('actions/checkout@v4');
    });

    it('selfHosted가 없으면 Docker 체크 스텝이 없어야 함', () => {
      const config = createSelfHostedConfig();
      delete config.input.selfHosted;
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).not.toContain('Ensure Docker is running');
    });
  });

  describe('pr-test job 통합', () => {
    it('pr-test에서 repo-cache와 pr-fetch가 사용되어야 함', () => {
      const config = createSelfHostedConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      const prTestSteps = parsed.jobs['pr-test']?.steps || [];
      const repoCacheStep = prTestSteps.find((s: any) => s.name === 'Clone or update repository');
      const prFetchStep = prTestSteps.find((s: any) => s.name === 'Fetch PR branch');

      expect(repoCacheStep).toBeDefined();
      expect(prFetchStep).toBeDefined();
    });

    it('pr-test에서 WORK_DIR이 설정되어야 함', () => {
      const config = createSelfHostedConfig();
      const yaml = generatePrChecksWorkflow(config);

      expect(yaml).toContain('WORK_DIR=');
      expect(yaml).toContain('steps.repo-cache.outputs.repo_dir');
    });

  });

  describe('YAML 유효성', () => {
    it('selfHosted 설정으로 유효한 YAML이 생성되어야 함', () => {
      const config = createSelfHostedConfig();
      const yaml = generatePrChecksWorkflow(config);

      expect(() => parseYaml(yaml)).not.toThrow();
    });

    it('다양한 selfHosted 조합에서 유효한 YAML이 생성되어야 함', () => {
      const variations: Array<{ docker: boolean }> = [
        { docker: true },
        { docker: false },
      ];

      for (const selfHosted of variations) {
        const config = createSelfHostedConfig();
        config.input.selfHosted = selfHosted;
        const yaml = generatePrChecksWorkflow(config);

        expect(() => parseYaml(yaml)).not.toThrow();
      }
    });
  });

  describe('pr-review job 실행 조건', () => {
    it('자동 실행(ciTrigger)에서는 pr-test 성공해야 pr-review 실행', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      const prReviewIf = parsed.jobs['pr-review'].if;

      // ciTrigger일 때 pr-test 성공 조건 필요
      // trigger == '/checks' → pr-test.result == 'success' 체크
      expect(prReviewIf).toContain("needs.pr-test.result == 'success'");
      expect(prReviewIf).toContain("/checks");
    });

    it('수동 실행(/review)에서는 pr-test 상태와 무관하게 실행', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      const prReviewIf = parsed.jobs['pr-review'].if;

      // 개별 트리거(/review)면 pr-test.result 체크 안 함
      // trigger != '/checks' 조건으로 우회
      expect(prReviewIf).toContain("trigger != '/checks'");

      // 조건 구조: (trigger != '/checks' || pr-test.result == 'success')
      // /review 트리거면 앞부분이 true라서 뒷부분 평가 안 함
      expect(prReviewIf).toMatch(/trigger != '\/checks'.*\|\|.*pr-test\.result/s);
    });

    it('수동 /review 트리거 시 pr-test가 skipped여도 pr-review 실행 가능해야 함', () => {
      const config = createTestConfig();
      const yaml = generatePrChecksWorkflow(config);
      const parsed = parseYaml(yaml);

      const prReviewIf = parsed.jobs['pr-review'].if;

      // always() 필수 - needs job이 skipped여도 if 조건 평가되도록
      expect(prReviewIf).toContain('always()');
    });
  });
});
