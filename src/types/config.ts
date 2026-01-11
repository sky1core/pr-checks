/**
 * 플랫폼 타입
 */
export type Platform = 'github' | 'gitea';

/**
 * AI 프로바이더 타입
 * TODO: openai, anthropic 등 추가 예정
 */
export type AiProvider = 'bedrock';

/**
 * 테스트 프레임워크 타입 (셋업 스텝 자동 생성용)
 */
export type TestFramework = 'node' | 'python' | 'go' | 'rust' | 'custom';

/**
 * 테스트 셋업 스텝
 */
export interface SetupStep {
  name: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
}

/**
 * 체크 타입
 */
export type CheckType = 'pr-test' | 'pr-review';

/**
 * 기본 체크 인터페이스
 */
interface BaseCheck {
  /** 체크 이름 (GitHub status context로 사용) */
  name: string;
  /** 트리거 명령어 (예: "/test", "/review") */
  trigger: string;
  /** 체크 타입 */
  type: CheckType;
  /** ciTrigger 실행 시 포함 여부 */
  required: boolean;
  /** 머지 게이트 통과 조건: true면 성공해야 함, false면 실행만 하면 됨 */
  mustPass: boolean;
}

/**
 * 테스트 체크
 */
export interface PrTestCheck extends BaseCheck {
  type: 'pr-test';
  /** 테스트 실행 명령어 */
  command: string;
  /** 테스트 프레임워크 (셋업 스텝 자동 생성용) */
  framework?: TestFramework;
  /** 커스텀 셋업 스텝 */
  setupSteps?: SetupStep[];
}

/**
 * 리뷰 체크
 */
export interface PrReviewCheck extends BaseCheck {
  type: 'pr-review';
  /** AI 프로바이더 */
  provider: AiProvider;
  /** AI 모델 ID */
  model: string;
  /** GitHub Secret 이름 */
  apiKeySecret: string;
  /** 프로젝트별 추가 리뷰 규칙 */
  customRules?: string;
}

/**
 * 체크 타입 유니온
 */
export type Check = PrTestCheck | PrReviewCheck;

/**
 * .pr-checks/config.yml 구조
 */
export interface InputConfig {
  /** 플랫폼 (github 또는 gitea, 기본값: github) */
  platform: Platform;
  /** 체크 목록 */
  checks: Check[];
  /** 전체 실행 명령어 (required: true인 체크만 실행) */
  ciTrigger: string;
  /** Approval override 워크플로우 생성 여부 */
  generateApprovalOverride: boolean;
  /** 대상 브랜치 목록 */
  branches: string[];
}

/**
 * 생성기 내부에서 사용하는 전체 Config
 */
export interface Config {
  input: InputConfig;
}

/**
 * 타입 가드: PrTestCheck 여부
 */
export function isPrTestCheck(check: Check): check is PrTestCheck {
  return check.type === 'pr-test';
}

/**
 * 타입 가드: PrReviewCheck 여부
 */
export function isPrReviewCheck(check: Check): check is PrReviewCheck {
  return check.type === 'pr-review';
}

/**
 * 기본 config.yml 템플릿
 */
export const DEFAULT_INPUT_CONFIG: InputConfig = {
  platform: 'github',
  checks: [
    {
      name: 'pr-test',
      trigger: '/test',
      type: 'pr-test',
      required: true,
      mustPass: true,
      command: 'npm test',
      framework: 'node',
    },
    {
      name: 'pr-review',
      trigger: '/review',
      type: 'pr-review',
      required: true,
      mustPass: false,
      provider: 'bedrock',
      model: 'us.amazon.nova-micro-v1:0',
      apiKeySecret: 'BEDROCK_API_KEY',
    },
  ],
  ciTrigger: '/checks',
  generateApprovalOverride: true,
  branches: ['main', 'master'],
};
