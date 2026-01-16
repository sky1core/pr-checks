# create-pr-checks

GitHub/Gitea Actions PR 자동 검사 워크플로우 생성기

## 개요

PR 코멘트로 트리거되는 단위 테스트와 AI 코드 리뷰 워크플로우를 자동 생성합니다.

## 빠른 시작

### 1. 설치

```bash
git clone https://github.com/sky1core/pr-checks.git
cd pr-checks
npm install && npm run build
npm link
```

### 2. 프로젝트에서 초기화

```bash
cd your-project
create-pr-checks --init
```

`.pr-checks/config.yml` 파일이 생성됩니다. 프로젝트에 맞게 수정하세요.

### 3. 워크플로우 생성

```bash
create-pr-checks
```

### 4. GitHub에 푸시

```bash
git add .github/workflows/ .pr-checks/
git commit -m "Add PR checks workflow"
git push
```

워크플로우 파일이 main 브랜치에 푸시되면 GitHub Actions가 자동으로 활성화됩니다.

### 5. (AI 리뷰 사용 시) Secrets 설정

1. GitHub 저장소 → Settings → Secrets and variables → Actions
2. "New repository secret" 클릭
3. Name: `BEDROCK_API_KEY` (또는 config.yml에 설정한 이름)
4. Value: API 키 입력

### 6. 사용

PR을 생성하면 가이드 코멘트가 자동으로 달립니다.

**자동 실행**: PR에 푸시하면 `mustRun: true`인 체크가 자동으로 실행됩니다.

**수동 실행**: PR 코멘트로 트리거할 수 있습니다:
```
/test     # 단위 테스트 실행
/review   # AI 리뷰 실행
/checks   # 전체 CI 실행 (mustRun: true인 모든 체크)
```

**Draft PR**: 자동 실행을 원하지 않으면 Draft PR로 작업하세요. Draft PR에서는 자동 실행이 스킵됩니다. 준비되면 "Ready for review"로 변경 후 `/checks`를 실행하면 됩니다.

## 생성되는 파일

```
your-project/
├── .github/workflows/
│   ├── pr-checks.yml           # 메인 워크플로우
│   └── approval-override.yml   # (선택) Approval Override
└── .pr-checks/
    ├── config.yml              # 설정 파일
    └── scripts/                # 리포트/접기 스크립트
        ├── {check-name}-report.sh
        └── {check-name}-collapse.sh
```

## 설정

### 기본 설정 예시

```yaml
platform: github
runner: ubuntu-latest

checks:
  - name: unit-test
    trigger: /test
    type: pr-test
    mustRun: true
    mustPass: true
    command: npm test
    framework: node

  - name: ai-review
    trigger: /review
    type: pr-review
    mustRun: true
    mustPass: false
    provider: bedrock
    model: us.amazon.nova-micro-v1:0
    apiKeySecret: BEDROCK_API_KEY

ciTrigger: /checks
branches:
  - main
```

### 전역 설정

| 설정 | 설명 | 기본값 |
|------|------|--------|
| `platform` | `github` 또는 `gitea` | `github` |
| `runner` | 실행 환경 (문자열 또는 배열) | `ubuntu-latest` |
| `branches` | 대상 브랜치 목록 | `[main, master]` |
| `ciTrigger` | 전체 CI 실행 트리거 | `/checks` |
| `generateApprovalOverride` | Approval Override 워크플로우 생성 | `true` |

### checks 공통 속성

| 속성 | 설명 |
|------|------|
| `name` | 체크 이름 (GitHub status context로 표시됨) |
| `trigger` | 트리거 명령어 (예: `/test`) |
| `type` | `pr-test` 또는 `pr-review` |
| `mustRun` | `true`: ciTrigger 실행 시 포함 |
| `mustPass` | `true`: 이 체크가 성공해야 머지 가능 (Branch protection 설정 필요) |

### pr-test 타입

단위 테스트, 린트, 빌드 등 명령어 기반 체크에 사용합니다.

| 속성 | 설명 |
|------|------|
| `command` | 실행할 명령어 |
| `framework` | `node`, `python`, `go`, `rust`, `custom` |
| `setupSteps` | 커스텀 셋업 스텝 (framework: custom일 때) |

**framework별 기본 셋업:**

| framework | 셋업 |
|-----------|------|
| `node` | actions/setup-node + npm ci |
| `python` | astral-sh/setup-uv |
| `go` | actions/setup-go |
| `rust` | dtolnay/rust-toolchain |
| `custom` | setupSteps에서 직접 정의 |

### pr-review 타입

AI 코드 리뷰에 사용합니다.

| 속성 | 설명 |
|------|------|
| `provider` | `bedrock` 또는 `cli` |
| `model` | AI 모델 ID (bedrock 전용) |
| `apiKeySecret` | GitHub Secret 이름 (bedrock 전용) |
| `cliTool` | CLI 도구 이름 (cli 전용) |
| `customRules` | 추가 리뷰 규칙 |

## Branch Protection 설정

`mustPass: true`인 체크가 머지를 차단하려면 Branch protection 설정이 필요합니다:

1. GitHub 저장소 → Settings → Branches
2. "Add branch protection rule" 클릭
3. Branch name pattern: `main` (또는 대상 브랜치)
4. "Require status checks to pass before merging" 체크
5. 검색창에서 체크 이름 선택 (예: `unit-test`)
6. Save changes

## Self-Hosted Runner

macOS self-hosted runner에서 저장소 캐싱과 Docker 자동 시작을 지원합니다.

### 설정

```yaml
runner: [self-hosted, macOS, ARM64]

selfHosted:
  docker: true  # Docker Desktop 자동 시작
```

### selfHosted 활성화 시 동작

| 기능 | 설명 |
|------|------|
| 저장소 캐싱 | `actions/checkout` 대신 로컬 캐시 사용 (빠른 체크아웃) |
| PR 브랜치 fetch | `git fetch origin pull/N/head:pr-N` |
| 로컬 diff | GitHub API 대신 `git diff` 사용 |
| Docker 자동 시작 | macOS에서 Docker가 꺼져있으면 자동 시작 |

### Self-Hosted Runner 등록

1. GitHub 저장소 → Settings → Actions → Runners
2. "New self-hosted runner" 클릭
3. OS 선택 후 안내에 따라 설치
4. runner 시작: `./run.sh`

## CLI Provider

로컬 AI CLI 도구로 코드 리뷰를 수행합니다. Self-hosted runner에서 유용합니다.

### 지원 도구

| 도구 | 설정값 | 사전 설치 필요 |
|------|--------|----------------|
| Claude Code | `claude` | `npm install -g @anthropic-ai/claude-code` |
| OpenAI Codex | `codex` | `npm install -g @openai/codex` |
| Google Gemini | `gemini` | `npm install -g @anthropic-ai/gemini-cli` |
| AWS Kiro | `kiro` | AWS Kiro CLI 설치 |

### 설정

```yaml
checks:
  - name: cli-review
    trigger: /review
    type: pr-review
    provider: cli
    cliTool: claude
```

### 참고

- CLI provider는 항상 `success` 상태 반환 (pass/fail 판정 없음)
- 리뷰 결과는 PR 코멘트로 게시

## 플랫폼별 차이

| 기능 | GitHub | Gitea |
|------|--------|-------|
| 워크플로우 경로 | `.github/workflows/` | `.gitea/workflows/` |
| 권한 체크 | collaborators API | 미지원 (모든 코멘트 허용) |
| 상세 로그 URL | `run_id` 사용 | `run_number` 사용 |

## 문제 해결

### 워크플로우가 트리거되지 않음

- 워크플로우 파일이 기본 브랜치(main)에 있는지 확인
- `issue_comment` 이벤트는 기본 브랜치의 워크플로우만 실행됨

### 권한 오류

- GitHub: 코멘트 작성자가 저장소의 write 권한 이상 필요
- Secrets가 올바르게 설정되었는지 확인

### AI 리뷰가 실패함

- Bedrock: API 키가 유효한지 확인
- CLI: runner에 해당 CLI 도구가 설치되어 있는지 확인

## 요구사항

- Node.js >= 18.0.0
- GitHub/Gitea Actions 활성화
- AI 리뷰:
  - Bedrock: API 키 (GitHub Secrets)
  - CLI: runner에 CLI 도구 설치

## 라이선스

MIT
