# create-pr-checks

GitHub/Gitea Actions PR 자동 검사 워크플로우 생성기

## 개요

PR 생성/푸시 시 자동 실행되고, 코멘트로도 트리거할 수 있는 단위 테스트와 AI 코드 리뷰 워크플로우를 생성합니다.

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
# GitHub
git add .github/workflows/ .pr-checks/
# Gitea
git add .gitea/workflows/ .pr-checks/

git commit -m "Add PR checks workflow"
git push
```

워크플로우 파일이 기본 브랜치에 푸시되면 자동으로 활성화됩니다.

### 5. (AI 리뷰 사용 시) Secrets 설정

1. GitHub 저장소 → Settings → Secrets and variables → Actions
2. "New repository secret" 클릭
3. Name: `BEDROCK_API_KEY` (또는 config.yml에 설정한 이름)
4. Value: API 키 입력

### 6. 사용

PR을 생성하면 가이드 코멘트가 자동으로 달립니다.

**자동 실행**: PR 생성/푸시 시 `mustRun: true`인 체크가 자동으로 실행됩니다. (`autoRunOn`으로 조정 가능)

**수동 실행**: PR 코멘트로 트리거할 수 있습니다:
```
/test     # 단위 테스트 실행
/review   # AI 리뷰 실행
/checks   # 전체 CI 실행 (mustRun: true인 모든 체크)
```

**추가 메시지 전달** (AI 리뷰 전용):
```
/review 보안 관점에서 특히 봐줘
```

멀티라인도 지원:
```
/review
보안 이슈 확인해줘
성능도 봐줘
```

트리거 명령어 뒤에 텍스트를 추가하면 AI에게 추가 질문으로 전달됩니다.

⚠️ **주의**: 추가 메시지가 있는 실행은 **비공식 실행**으로 취급됩니다:
- 리뷰는 정상 실행됨
- `mustRun`/`mustPass` 체크 통과로 인정되지 않음
- 공식 체크를 원하면 순수하게 `/review`만 입력

**Draft PR**: Draft PR에서는 자동 실행이 스킵됩니다. 준비되면 "Ready for review"로 변경하세요. `autoRunOn: [ready_for_review]`로 설정하면 Ready 전환 시 자동 실행됩니다.

## 생성되는 파일

```
your-project/
├── .github/workflows/          # GitHub (또는 .gitea/workflows/ for Gitea)
│   ├── pr-checks.yml           # 메인 워크플로우
│   └── approval-override.yml   # (선택) 승인 시 머지 게이트 해제
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

# 가이드 코멘트에 추가 문구 (선택)
guideMessage: |
  ### 프로젝트 규칙
  - PR 제목은 conventional commit 형식으로 작성해주세요
  - 테스트 커버리지 80% 이상 유지
```

### 전역 설정

| 설정 | 설명 | 기본값 |
|------|------|--------|
| `platform` | `github` 또는 `gitea` | `github` |
| `runner` | 실행 환경 (문자열 또는 배열) | `ubuntu-latest` |
| `branches` | 대상 브랜치 목록 | `[main, master]` |
| `ciTrigger` | 전체 CI 실행 트리거 | `/checks` |
| `generateApprovalOverride` | 승인 시 머지 게이트 해제 워크플로우 생성 | `true` |
| `guideMessage` | PR 가이드 코멘트에 추가할 커스텀 문구 | - |

### checks 공통 속성

| 속성 | 설명 |
|------|------|
| `name` | 체크 이름 (GitHub status context로 표시됨) |
| `trigger` | 트리거 명령어 (예: `/test`) |
| `type` | `pr-test` 또는 `pr-review` |
| `mustRun` | `true`: ciTrigger 실행 시 포함, autoRunOn 기본값 `[opened, synchronize]` |
| `mustPass` | `true`: 이 체크가 성공해야 머지 가능 (Branch protection 설정 필요) |
| `autoRunOn` | 자동 실행할 PR 이벤트 배열 (기본값: `mustRun: true`면 `[opened, synchronize]`) |

**autoRunOn 옵션:**

자동 실행 시점을 설정합니다. 수동 트리거(`/test`, `/review` 등)는 이 설정과 무관하게 항상 사용 가능합니다.

| 값 | 설명 |
|----|------|
| `opened` | PR 생성 시 |
| `synchronize` | PR에 푸시 시 |
| `reopened` | PR 재오픈 시 |
| `ready_for_review` | Draft → Ready 전환 시 |

```yaml
# 예시: PR 생성 시만 자동 실행 (푸시 시에는 수동으로)
autoRunOn: [opened]

# 예시: 자동 실행 비활성화 (수동 트리거만 사용)
autoRunOn: []
```

### pr-test 타입

단위 테스트, 린트, 빌드 등 명령어 기반 체크에 사용합니다.

| 속성 | 설명 |
|------|------|
| `command` | 실행할 명령어 |
| `setupSteps` | 테스트 환경 셋업 스텝 |

### setupSteps 사용법

`setupSteps`로 GitHub Actions의 공식 액션들을 사용해 테스트 환경을 구성합니다. runner에 도구가 미리 설치되어 있지 않아도 워크플로우 실행 시 자동으로 설치됩니다.

**기본 구조:**

```yaml
setupSteps:
  - name: 스텝 이름
    uses: 액션 이름@버전    # GitHub Action 사용
    with:                    # 액션 파라미터 (선택)
      key: value
  - name: 스텝 이름
    run: 쉘 명령어           # 쉘 스크립트 실행
```

**예시 - Node.js:**

```yaml
- name: unit-test
  trigger: /test
  type: pr-test
  mustRun: true
  mustPass: true
  command: npm test
  setupSteps:
    - name: setup-node
      uses: actions/setup-node@v4
      with:
        node-version: '20'
    - name: install-deps
      run: npm ci
```

**예시 - Go:**

```yaml
- name: test
  trigger: /test
  type: pr-test
  mustRun: true
  mustPass: true
  command: go test ./...
  setupSteps:
    - name: setup-go
      uses: actions/setup-go@v5
      with:
        go-version: '1.22'
```

**예시 - Go 린트:**

```yaml
- name: lint
  trigger: /lint
  type: pr-test
  mustRun: true
  mustPass: true
  command: golangci-lint run ./...
  setupSteps:
    - name: setup-go
      uses: actions/setup-go@v5
      with:
        go-version: '1.22'
    - name: install-golangci-lint
      run: go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
```

**예시 - Python:**

```yaml
- name: test
  trigger: /test
  type: pr-test
  mustRun: true
  mustPass: true
  command: pytest
  setupSteps:
    - name: setup-python
      uses: actions/setup-python@v5
      with:
        python-version: '3.12'
    - name: install-deps
      run: pip install -r requirements.txt
```

**예시 - Rust:**

```yaml
- name: test
  trigger: /test
  type: pr-test
  mustRun: true
  mustPass: true
  command: cargo test
  setupSteps:
    - name: setup-rust
      uses: dtolnay/rust-toolchain@stable
```

**자주 사용되는 액션:**

| 언어/도구 | 액션 |
|-----------|------|
| Node.js | `actions/setup-node@v4` |
| Python | `actions/setup-python@v5` |
| Go | `actions/setup-go@v5` |
| Rust | `dtolnay/rust-toolchain@stable` |
| Java | `actions/setup-java@v4` |
| .NET | `actions/setup-dotnet@v4` |

> **참고**: `framework` 옵션은 deprecated입니다. `setupSteps`를 직접 사용하세요.

### pr-review 타입

AI 코드 리뷰에 사용합니다.

| 속성 | 설명 |
|------|------|
| `provider` | `bedrock` 또는 `cli` |
| `model` | AI 모델 ID (bedrock 전용) |
| `apiKeySecret` | GitHub Secret 이름 (bedrock 전용) |
| `cliTool` | CLI 도구 이름 (cli 전용) |
| `cliCommand` | 커스텀 명령어 (cli 전용, cliTool 대신 사용) |
| `parser` | CLI 출력 파서 (`auto` \| `json` \| `verdict`, 기본값: `auto`) |
| `customRules` | 추가 리뷰 규칙 |

## Branch Protection 설정

`mustPass: true`인 체크가 머지를 차단하려면 Branch protection 설정이 필요합니다.

### GitHub

1. 저장소 → Settings → Branches
2. "Add branch protection rule" 클릭
3. Branch name pattern: `main` (또는 대상 브랜치)
4. "Require status checks to pass before merging" 체크
5. 검색창에서 체크 이름 선택 (예: `unit-test`)
6. Save changes

### Gitea

1. 저장소 → Settings → Branches
2. Branch Protection Rules에서 브랜치 선택
3. "Require status checks to pass" 활성화
4. Status Check 패턴에 체크 이름 입력

## Approval Override

체크가 실패해도 리뷰어의 승인으로 머지할 수 있게 해주는 기능입니다.

**동작 방식:**
- PR이 Approve되면 "PR Checks Status"가 success로 변경됨
- 체크 자체는 실패 상태 유지 (결과는 그대로 표시)
- Approve가 취소되면 원래 상태로 복원

**사용 시나리오:**
- 테스트가 일시적으로 실패하지만 머지가 필요한 경우
- 리뷰어가 코드를 확인하고 문제없다고 판단한 경우

**비활성화:**
```yaml
generateApprovalOverride: false
```

## Self-Hosted Runner

macOS self-hosted runner에서 저장소 캐싱과 Docker 자동 시작을 지원합니다.

### 설정 예시 (Go 프로젝트)

```yaml
platform: github
runner: [self-hosted, macOS, ARM64]

selfHosted:
  docker: true  # Docker Desktop 자동 시작

checks:
  # 테스트
  - name: test
    trigger: /test
    type: pr-test
    mustRun: true
    mustPass: true
    command: go test ./...
    setupSteps:
      - name: setup-go
        uses: actions/setup-go@v5
        with:
          go-version: '1.22'

  # 린트
  - name: lint
    trigger: /lint
    type: pr-test
    mustRun: true
    mustPass: true
    command: golangci-lint run ./...
    setupSteps:
      - name: setup-go
        uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - name: install-golangci-lint
        run: go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

  # AI 리뷰 (CLI 도구 사용)
  - name: review
    trigger: /review
    type: pr-review
    mustRun: true
    mustPass: false
    provider: cli
    cliTool: claude

ciTrigger: /checks
branches:
  - main
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

| 도구 | 설정값 |
|------|--------|
| Claude Code | `claude` |
| OpenAI Codex | `codex` |
| Google Gemini | `gemini` |
| Kiro | `kiro` |

각 CLI 도구는 runner에 미리 설치되어 있어야 합니다.

### 설정

```yaml
checks:
  - name: cli-review
    trigger: /review
    type: pr-review
    provider: cli
    cliTool: claude
```

### 파서 모드 (`parser`)

CLI provider는 `parser` 모드로 출력 파싱 방식을 선택합니다.

- `auto` (기본값)
  - `claude`, `codex` → `json`
  - `gemini`, `kiro` → `verdict`
  - `cliCommand` → `json`
- `json`: 구조화 JSON 출력만 허용
- `verdict`: `<<<VERDICT:...>>>` 마커 기반 판정

### 3단계 판정 결과

| 판정 | GitHub Status | 의미 |
|------|---------------|------|
| ❌ CRITICAL | failure | 심각한 문제, 머지 차단 |
| ⚠️ WARNING | success | 경고, 머지 가능하지만 확인 필요 |
| ✅ OK | success | 문제 없음 |

**1) `parser: json`**

출력은 아래 JSON 객체 **1개만** 허용됩니다:
```json
{"result":"critical|warning|ok","details":"리뷰 본문"}
```

- `result`: `critical` / `warning` / `ok`
- `details`: PR 코멘트에 표시할 리뷰 본문
- JSON 파싱 실패 시 `critical` 처리

**2) `parser: verdict`**

출력에 VERDICT 마커가 있으면 이를 우선 사용합니다:
```
<<<VERDICT:CRITICAL>>>   # 심각한 문제 발견
<<<VERDICT:WARNING>>>    # 경고 (머지 가능)
<<<VERDICT:OK>>>         # 문제 없음
```

- CRITICAL이 있으면 머지 차단
- 마커는 최종 출력에서 자동 제거됨

**3) `verdict` 폴백 판정 (마커 없을 때)**

VERDICT 마커가 없으면 다음 순서로 판정:
1. exit code가 0이 아니면 → ❌ CRITICAL
2. 출력에 🔴 이모지가 있으면 → ❌ CRITICAL
3. 출력에 🟡 이모지가 있으면 → ⚠️ WARNING
4. 그 외 → ✅ OK

출력은 판정 결과와 관계없이 전부 표시됩니다.

### 커스텀 명령어 (cliCommand)

`cliTool` 대신 `cliCommand`를 사용하면 커스텀 스크립트로 리뷰할 수 있습니다:

```yaml
checks:
  - name: custom-review
    trigger: /review
    type: pr-review
    provider: cli
    cliCommand: ./review-wrapper.sh
    parser: json
```

**인자 전달:**
- 첫 번째 인자: PR 번호
- 두 번째 인자: 추가 메시지 (멀티라인 포함, 빈 문자열 가능)

```bash
# 기본 실행
./review-wrapper.sh 123 ""

# 추가 메시지 포함 (멀티라인도 그대로 전달됨)
./review-wrapper.sh 123 "보안 관점에서 봐줘
성능도 확인해줘"
```

**커스텀 스크립트 예시:**

```bash
#!/bin/bash
# .pr-checks/scripts/review-wrapper.sh

PR_NUMBER="$1"
USER_MESSAGE="$2"

# diff 가져오기
DIFF=$(gh pr diff "$PR_NUMBER")

# AI 리뷰 실행
DETAILS=$(echo "$DIFF" | my-ai-tool --review --message "$USER_MESSAGE")

# JSON 구조화 출력
if echo "$DETAILS" | grep -q "🔴"; then
  RESULT="critical"
elif echo "$DETAILS" | grep -q "🟡"; then
  RESULT="warning"
else
  RESULT="ok"
fi

jq -n --arg result "$RESULT" --arg details "$DETAILS" \
  '{result: $result, details: $details}'
```

**주의:** `cliCommand`는 diff나 프롬프트를 직접 처리해야 합니다. 워크플로우는 checkout만 하고 나머지는 스크립트가 담당합니다.

## 플랫폼별 차이

| 기능 | GitHub | Gitea |
|------|--------|-------|
| 워크플로우 경로 | `.github/workflows/` | `.gitea/workflows/` |
| 권한 체크 | collaborators API | 미지원 (모든 코멘트 허용) |
| 상세 로그 URL | `run_id` 사용 | `run_number` 사용 |

## 워크플로우 위치와 트리거 방식

GitHub Actions는 이벤트 종류에 따라 **다른 브랜치의 워크플로우**를 실행합니다:

| 트리거 방식 | 이벤트 | 사용되는 워크플로우 |
|------------|--------|-------------------|
| `/test`, `/review` 코멘트 | `issue_comment` | **기본 브랜치** (main 등) |
| PR 생성/푸시 자동 실행 | `pull_request` | **PR 브랜치** |

**영향:**
- 코멘트 트리거(`/test`, `/review`): 워크플로우가 **기본 브랜치에 있어야** 작동
- 자동 실행(`autoRunOn`): **PR 브랜치의 워크플로우**가 실행되므로 바로 테스트 가능

**워크플로우를 처음 추가하는 PR:**
- 자동 실행: 작동함 (PR 브랜치에 워크플로우 있음)
- 코멘트 트리거: 작동 안 함 (기본 브랜치에 워크플로우 없음) → 머지 후 사용 가능

## 문제 해결

### 워크플로우가 트리거되지 않음

- 워크플로우 파일이 기본 브랜치에 있는지 확인
- 코멘트 트리거는 기본 브랜치의 워크플로우만 실행됨 (위 표 참고)

### 권한 오류

- GitHub: 코멘트 작성자가 저장소의 write 권한 이상 필요
- Secrets가 올바르게 설정되었는지 확인

### AI 리뷰가 실패함

- Bedrock: API 키가 유효한지 확인
- CLI: runner에 해당 CLI 도구가 설치되어 있는지 확인

## 요구사항

### CLI 도구 (워크플로우 생성용)

- Node.js >= 18.0.0

### Runner 환경 (워크플로우 실행용)

- `jq` - JSON 파싱 (ubuntu-latest에 기본 포함)
- `base64` - 메시지 인코딩 (coreutils에 포함)
- `curl` - API 호출 (ubuntu-latest에 기본 포함)

**Self-hosted runner 사용 시:**
```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq
```

### AI 리뷰

- Bedrock: API 키 (GitHub Secrets에 저장)
- CLI: runner에 CLI 도구 설치 (claude, codex, gemini, kiro)

## 라이선스

MIT
