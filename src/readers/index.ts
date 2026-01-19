import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import yn from 'yn';
import type {
  InputConfig,
  Config,
  Check,
  PrTestCheck,
  PrReviewCheck,
  SetupStep,
  TestFramework,
  Platform,
  CliTool,
  SelfHostedConfig,
  PullRequestAction,
} from '../types/config.js';
import { DEFAULT_INPUT_CONFIG, isPrTestCheck, isPrReviewCheck } from '../types/config.js';

const PR_CHECKS_DIR = '.pr-checks';
const CONFIG_FILE = 'config.yml';

/**
 * 테스트 프레임워크별 기본 setup steps
 */
const TEST_SETUP_STEPS: Record<TestFramework, SetupStep[]> = {
  node: [
    { name: 'Setup Node.js', uses: 'actions/setup-node@v4', with: { 'node-version': '20' } },
    { name: 'Install dependencies', run: 'npm ci' },
  ],
  python: [
    { name: 'Install uv', uses: 'astral-sh/setup-uv@v4' },
  ],
  go: [
    { name: 'Setup Go', uses: 'actions/setup-go@v5', with: { 'go-version': '1.22' } },
  ],
  rust: [
    { name: 'Setup Rust', uses: 'dtolnay/rust-toolchain@stable' },
  ],
  custom: [],
};

export function getPrChecksDir(cwd: string): string {
  return path.join(cwd, PR_CHECKS_DIR);
}

export async function hasInputFiles(cwd: string): Promise<boolean> {
  const configPath = path.join(cwd, PR_CHECKS_DIR, CONFIG_FILE);
  return fs.pathExists(configPath);
}

export async function readConfig(cwd: string): Promise<Config> {
  const prChecksDir = getPrChecksDir(cwd);
  const configPath = path.join(prChecksDir, CONFIG_FILE);

  let input: InputConfig;

  if (await fs.pathExists(configPath)) {
    let configContent: string;
    try {
      configContent = await fs.readFile(configPath, 'utf-8');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`설정 파일 읽기 실패: ${configPath}\n${errorMessage}`);
    }

    let parsed: Record<string, unknown>;
    try {
      const result = yaml.parse(configContent);
      if (result === null || result === undefined) {
        console.warn('경고: config.yml이 비어있습니다. 기본값을 사용합니다.');
        parsed = {};
      } else if (typeof result !== 'object' || Array.isArray(result)) {
        throw new Error('config.yml은 객체 형식이어야 합니다.');
      } else {
        parsed = result as Record<string, unknown>;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('config.yml')) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`config.yml 파싱 실패: ${errorMessage}\n파일 경로: ${configPath}`);
    }

    input = mergeWithDefaults(parsed);
    validateConfig(input);
  } else {
    input = structuredClone(DEFAULT_INPUT_CONFIG);
  }

  // pr-test 체크에 framework 기반 setupSteps 추가
  input.checks = input.checks.map((check) => {
    if (isPrTestCheck(check) && check.framework && !check.setupSteps) {
      return {
        ...check,
        setupSteps: TEST_SETUP_STEPS[check.framework],
      };
    }
    return check;
  });

  return { input };
}

function parseString(value: unknown, defaultValue: string): string {
  if (value === undefined || value === null) return defaultValue;
  return String(value);
}

function parseBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue;
  const result = yn(value, { default: defaultValue });
  return result;
}

function parsePlatform(value: unknown, defaultValue: Platform): Platform {
  if (value === undefined || value === null) return defaultValue;
  const str = String(value).toLowerCase();
  if (str === 'github' || str === 'gitea') {
    return str;
  }
  return defaultValue;
}

function parseSelfHostedConfig(raw: unknown): SelfHostedConfig | undefined {
  if (raw === undefined || raw === null) return undefined;

  // selfHosted: true 형태
  if (typeof raw === 'boolean') {
    return raw ? { docker: true } : undefined;
  }

  // selfHosted: { docker: true } 형태
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  const obj = raw as Record<string, unknown>;
  return {
    docker: parseBoolean(obj.docker, true),
  };
}

function parseCheck(rawCheck: Record<string, unknown>, index: number): Check {
  const type = rawCheck.type as string;

  if (!type) {
    throw new Error(`checks[${index}].type은 필수입니다.`);
  }

  const name = rawCheck.name as string | undefined;
  if (!name || !name.trim()) {
    throw new Error(`checks[${index}].name은 필수입니다.`);
  }

  // name 패턴 검증: bash 변수명으로도 사용되므로 소문자로 시작해야 함
  const namePattern = /^[a-z][a-z0-9_-]*$/;
  if (!namePattern.test(name.trim())) {
    throw new Error(
      `checks[${index}].name: '${name}'은 유효하지 않습니다. ` +
        `소문자로 시작하고, 소문자/숫자/하이픈/언더스코어만 사용해야 합니다.`
    );
  }

  const trigger = rawCheck.trigger as string | undefined;
  if (!trigger || !trigger.trim()) {
    throw new Error(`checks[${index}].trigger는 필수입니다.`);
  }

  const baseCheck = {
    name: name.trim(),
    trigger: trigger.trim(),
    mustRun: parseBoolean(rawCheck.mustRun, true),
    mustPass: parseBoolean(rawCheck.mustPass, false),
    autoRunOn: rawCheck.autoRunOn as PullRequestAction[] | undefined,
  };

  if (type === 'pr-test') {
    const command = rawCheck.command as string | undefined;
    if (!command || !command.trim()) {
      throw new Error(`checks[${index}].command는 필수입니다.`);
    }
    const check: PrTestCheck = {
      ...baseCheck,
      type: 'pr-test',
      command: command.trim(),
      framework: rawCheck.framework as TestFramework | undefined,
      setupSteps: rawCheck.setupSteps as SetupStep[] | undefined,
    };
    return check;
  }

  if (type === 'pr-review') {
    const provider = (rawCheck.provider as PrReviewCheck['provider']) ?? 'bedrock';
    const check: PrReviewCheck = {
      ...baseCheck,
      type: 'pr-review',
      provider,
      model: provider === 'bedrock' ? parseString(rawCheck.model, '') : undefined,
      apiKeySecret: provider === 'bedrock' ? parseString(rawCheck.apiKeySecret, '') : undefined,
      cliTool: provider === 'cli' ? (rawCheck.cliTool as CliTool) : undefined,
      cliCommand: provider === 'cli' ? (parseString(rawCheck.cliCommand, '').trim() || undefined) : undefined,
      customRules: rawCheck.customRules as string | undefined,
    };
    return check;
  }

  throw new Error(`checks[${index}].type: 지원하지 않는 타입입니다: ${type}`);
}

function mergeWithDefaults(parsed: Record<string, unknown>): InputConfig {
  const defaults = DEFAULT_INPUT_CONFIG;

  // checks 배열 파싱
  let checks: Check[];
  if (Array.isArray(parsed.checks) && parsed.checks.length > 0) {
    checks = parsed.checks.map((rawCheck, index) => {
      if (typeof rawCheck !== 'object' || rawCheck === null) {
        throw new Error(`checks[${index}]는 객체여야 합니다.`);
      }
      return parseCheck(rawCheck as Record<string, unknown>, index);
    });
  } else {
    checks = structuredClone(defaults.checks);
  }

  // runner 파싱: 문자열 또는 배열
  let runner: string | string[];
  if (parsed.runner === undefined || parsed.runner === null) {
    runner = defaults.runner;
  } else if (Array.isArray(parsed.runner)) {
    runner = parsed.runner.map(String);
  } else {
    runner = String(parsed.runner);
  }

  return {
    platform: parsePlatform(parsed.platform, defaults.platform),
    runner,
    checks,
    ciTrigger: parseString(parsed.ciTrigger, defaults.ciTrigger),
    generateApprovalOverride: parseBoolean(parsed.generateApprovalOverride, defaults.generateApprovalOverride),
    branches: Array.isArray(parsed.branches) ? parsed.branches.map(String) : defaults.branches,
    selfHosted: parseSelfHostedConfig(parsed.selfHosted),
  };
}

function validateConfig(config: InputConfig): void {
  // checks 배열 검증
  if (config.checks.length === 0) {
    throw new Error('checks는 최소 1개 이상이어야 합니다.');
  }

  // 이름 중복 검사
  const names = new Set<string>();
  for (const check of config.checks) {
    if (names.has(check.name)) {
      throw new Error(`중복된 체크 이름입니다: ${check.name}`);
    }
    names.add(check.name);
  }

  // 트리거 중복 검사
  const triggers = new Set<string>();
  for (const check of config.checks) {
    if (triggers.has(check.trigger)) {
      throw new Error(`중복된 트리거입니다: ${check.trigger}`);
    }
    triggers.add(check.trigger);
  }

  // ciTrigger가 개별 트리거와 중복되지 않는지 확인
  if (triggers.has(config.ciTrigger)) {
    throw new Error(`ciTrigger(${config.ciTrigger})가 개별 체크 트리거와 중복됩니다.`);
  }

  // 각 체크 검증
  for (let i = 0; i < config.checks.length; i++) {
    const check = config.checks[i];

    if (!check.name.trim()) {
      throw new Error(`checks[${i}].name은 필수입니다.`);
    }

    if (!check.trigger.startsWith('/')) {
      throw new Error(`checks[${i}].trigger는 '/'로 시작해야 합니다: ${check.trigger}`);
    }

    if (isPrTestCheck(check)) {
      if (!check.command.trim()) {
        throw new Error(`checks[${i}].command는 필수입니다.`);
      }
      if (check.framework) {
        const validFrameworks = ['node', 'python', 'go', 'rust', 'custom'];
        if (!validFrameworks.includes(check.framework)) {
          throw new Error(`checks[${i}].framework: 지원하지 않는 프레임워크입니다: ${check.framework}`);
        }
      }
    }

    if (isPrReviewCheck(check)) {
      const validProviders = ['bedrock', 'cli'];
      if (!validProviders.includes(check.provider)) {
        throw new Error(`checks[${i}].provider: 지원하지 않는 프로바이더입니다: ${check.provider}`);
      }
      if (check.provider === 'bedrock') {
        if (!check.model?.trim()) {
          throw new Error(`checks[${i}].model은 bedrock provider에서 필수입니다.`);
        }
        if (!check.apiKeySecret?.trim()) {
          throw new Error(`checks[${i}].apiKeySecret은 bedrock provider에서 필수입니다.`);
        }
      }
      if (check.provider === 'cli') {
        // cliCommand가 있으면 cliTool 불필요
        if (!check.cliCommand) {
          const validCliTools = ['claude', 'codex', 'gemini', 'kiro'];
          if (!check.cliTool || !validCliTools.includes(check.cliTool)) {
            throw new Error(`checks[${i}].cliTool: cli provider에서는 claude, codex, gemini, kiro 중 하나를 지정하거나 cliCommand를 사용해야 합니다.`);
          }
        }
      }
    }
  }

  // ciTrigger 검증
  if (!config.ciTrigger.startsWith('/')) {
    throw new Error(`ciTrigger는 '/'로 시작해야 합니다: ${config.ciTrigger}`);
  }

  // branches 검증
  if (config.branches.length === 0) {
    throw new Error('branches는 최소 1개 이상이어야 합니다.');
  }
}

export async function createDefaultFiles(cwd: string): Promise<string[]> {
  const prChecksDir = getPrChecksDir(cwd);

  try {
    await fs.ensureDir(prChecksDir);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`설정 디렉토리 생성 실패: ${prChecksDir}\n${errorMessage}`);
  }

  const files: string[] = [];
  const configPath = path.join(prChecksDir, CONFIG_FILE);

  if (!(await fs.pathExists(configPath))) {
    try {
      await fs.writeFile(configPath, yaml.stringify(DEFAULT_INPUT_CONFIG), 'utf-8');
      files.push(path.relative(cwd, configPath));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`설정 파일 쓰기 실패: ${configPath}\n${errorMessage}`);
    }
  }

  return files;
}
