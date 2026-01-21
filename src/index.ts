#!/usr/bin/env node

import meow from 'meow';
import { run } from './cli.js';

const cli = meow(`
  Usage
    $ create-pr-checks [options]

  Options
    --init        설정 파일만 생성 (.pr-checks/)
    --yes, -y     확인 없이 진행
    --cwd <path>  대상 디렉토리 지정 (기본: 현재 디렉토리)
    --help        도움말 표시
    --version     버전 표시

  Examples
    $ create-pr-checks --init          # 설정 파일 생성
    $ create-pr-checks                  # 워크플로우 생성
    $ create-pr-checks --yes            # 확인 없이 생성
    $ create-pr-checks --cwd ./my-project

  Workflow
    1. create-pr-checks --init          # 설정 파일 생성
    2. .pr-checks/config.yml 수정       # AI, 테스트, 리뷰 설정
    3. create-pr-checks                 # 워크플로우 생성
`, {
  importMeta: import.meta,
  flags: {
    yes: {
      type: 'boolean',
      shortFlag: 'y',
      default: false,
    },
    cwd: {
      type: 'string',
    },
    init: {
      type: 'boolean',
      default: false,
    },
  },
});

// 비대화형 환경(LLM, CI, 스크립트)에서는 자동으로 -y 적용
const isNonInteractive = !process.stdout.isTTY;

run({
  yes: cli.flags.yes || isNonInteractive,
  cwd: cli.flags.cwd,
  init: cli.flags.init,
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
