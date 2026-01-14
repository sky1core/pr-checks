import { confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import type { Config } from './types/config.js';
import { isPrTestCheck, isPrReviewCheck } from './types/config.js';
import { hasInputFiles, readConfig, createDefaultFiles } from './readers/index.js';
import { generateWorkflowFiles } from './generators/workflow.js';

export interface CliOptions {
  yes?: boolean;
  cwd?: string;
  init?: boolean;
}

export async function run(options: CliOptions): Promise<void> {
  console.log(chalk.bold.cyan('\n🚀 create-pr-checks - PR 자동 검사 워크플로우 생성기\n'));

  const cwd = options.cwd || process.cwd();

  // --init: 설정 파일만 생성
  if (options.init) {
    await runInit(cwd);
    return;
  }

  // 설정 파일 확인
  const hasFiles = await hasInputFiles(cwd);

  if (!hasFiles) {
    console.log(chalk.yellow('⚠️  .pr-checks/ 설정 파일이 없습니다.\n'));

    if (!options.yes) {
      const create = await confirm({
        message: '기본 설정 파일을 생성할까요?',
        default: true,
      });

      if (create) {
        await runInit(cwd);
        console.log(chalk.cyan('\n설정 파일을 수정한 후 다시 실행하세요:'));
        console.log(chalk.gray('  npx create-pr-checks\n'));
        return;
      }
    }

    console.log(chalk.gray('기본값으로 진행합니다.\n'));
  }

  // 설정 읽기
  const config = await readConfig(cwd);

  // 설정 요약 출력
  printSummary(config);

  // 확인
  if (!options.yes) {
    const proceed = await confirm({
      message: '워크플로우를 생성할까요?',
      default: true,
    });
    if (!proceed) {
      console.log(chalk.yellow('\n취소되었습니다.'));
      process.exit(0);
    }
  }

  // 워크플로우 생성
  const spinner = ora('워크플로우 생성 중...').start();

  try {
    const result = await generateWorkflowFiles(cwd, config);

    spinner.succeed('워크플로우 생성 완료!');

    console.log();
    for (const file of result.files) {
      console.log(chalk.green(`  ✔ ${file} 생성됨`));
    }

    printNextSteps(config);
  } catch (error) {
    spinner.fail('워크플로우 생성 실패');
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n오류: ${errorMessage}`));
    if (process.env.DEBUG && error instanceof Error) {
      console.error(chalk.gray('\n스택 트레이스:'));
      console.error(chalk.gray(error.stack));
    } else if (!process.env.DEBUG) {
      console.error(chalk.gray('\n자세한 정보: DEBUG=1 npx create-pr-checks'));
    }
    process.exit(1);
  }
}

async function runInit(cwd: string): Promise<void> {
  const spinner = ora('설정 파일 생성 중...').start();

  try {
    const files = await createDefaultFiles(cwd);

    if (files.length === 0) {
      spinner.info('설정 파일이 이미 존재합니다.');
    } else {
      spinner.succeed('설정 파일 생성 완료!');
      console.log();
      for (const file of files) {
        console.log(chalk.green(`  ✔ ${file} 생성됨`));
      }
    }

    console.log(chalk.cyan('\n📁 생성된 파일:'));
    console.log(chalk.gray('  .pr-checks/config.yml - 체크 설정\n'));
  } catch (error) {
    spinner.fail('설정 파일 생성 실패');
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n오류: ${errorMessage}`));
    if (process.env.DEBUG && error instanceof Error) {
      console.error(chalk.gray('\n스택 트레이스:'));
      console.error(chalk.gray(error.stack));
    } else if (!process.env.DEBUG) {
      console.error(chalk.gray('\n자세한 정보: DEBUG=1 npx create-pr-checks --init'));
    }
    process.exit(1);
  }
}

function printSummary(config: Config): void {
  const { input } = config;

  console.log(chalk.bold('📋 설정 요약:'));
  console.log(`  • 체크 수: ${input.checks.length}개`);

  for (const check of input.checks) {
    const required = check.mustRun ? '필수' : '선택';
    const mustPass = check.mustPass ? ', 통과 필수' : '';
    if (isPrTestCheck(check)) {
      console.log(`    - ${check.name} (${check.trigger}): ${check.command} [${required}${mustPass}]`);
    } else if (isPrReviewCheck(check)) {
      console.log(`    - ${check.name} (${check.trigger}): ${check.provider}/${check.model} [${required}${mustPass}]`);
    }
  }

  console.log(`  • 전체 실행: ${input.ciTrigger}`);
  console.log(`  • 브랜치: ${input.branches.join(', ')}`);
  console.log();
}

function printNextSteps(config: Config): void {
  const { input } = config;

  // AI 리뷰에 사용되는 시크릿 수집
  const secrets = new Set<string>();
  for (const check of input.checks) {
    if (isPrReviewCheck(check)) {
      secrets.add(check.apiKeySecret);
    }
  }

  console.log(chalk.bold.cyan('\n🎉 완료!\n'));
  console.log(chalk.bold('다음 단계:'));

  if (secrets.size > 0) {
    console.log(`  1. GitHub Secrets에 ${chalk.yellow([...secrets].join(', '))} 추가`);
  }
  console.log(`  ${secrets.size > 0 ? '2' : '1'}. Branch Protection에서 ${chalk.yellow('"PR Checks Status"')} 체크 추가`);
  console.log(`  ${secrets.size > 0 ? '3' : '2'}. PR을 만들어서 테스트해보세요!`);
  console.log();
}
