# create-pr-checks

GitHub/Gitea Actions PR 자동 검사 워크플로우 생성기

## 개요

PR 코멘트로 트리거되는 단위 테스트와 AI 코드 리뷰 워크플로우를 자동 생성합니다.

## 설치

### 소스에서 빌드

```bash
git clone https://github.com/sky1core/pr-checks.git
cd pr-checks
npm install
npm run build
npm link  # 글로벌 명령어 등록
```

### 초기 설정

```bash
create-pr-checks --init
```

`.pr-checks/config.yml` 파일이 생성됩니다.

### 워크플로우 생성

```bash
create-pr-checks
```

설정에 따라 워크플로우 파일이 생성됩니다:
- GitHub: `.github/workflows/pr-checks.yml`
- Gitea: `.gitea/workflows/pr-checks.yml`

## 설정

`.pr-checks/config.yml` 예시:

```yaml
platform: github  # github 또는 gitea (기본: github)

checks:
  - name: unit-test
    trigger: /test
    type: pr-test
    required: true
    mustPass: true
    command: npm test
    framework: node

  - name: ai-review
    trigger: /review
    type: pr-review
    required: true
    mustPass: false
    provider: bedrock
    model: us.amazon.nova-micro-v1:0
    apiKeySecret: BEDROCK_API_KEY
    customRules: |
      - console.log 사용 금지

ciTrigger: /ci
branches:
  - main
```

### 설정 항목

| 설정 | 설명 | 기본값 |
|------|------|--------|
| `platform` | 플랫폼 (`github` 또는 `gitea`) | `github` |
| `branches` | 대상 브랜치 목록 | `[main, master]` |
| `ciTrigger` | 전체 CI 실행 트리거 | `/ci` |
| `generateApprovalOverride` | Approval Override 워크플로우 생성 | `true` |

### checks 공통 속성

| 속성 | 설명 |
|------|------|
| `name` | 체크 이름 (GitHub status context) |
| `trigger` | 트리거 명령어 (예: `/test`) |
| `type` | `pr-test` 또는 `pr-review` |
| `required` | CI 트리거 시 포함 여부 |
| `mustPass` | 머지 게이트 통과 조건 |

### pr-test 타입 추가 속성

| 속성 | 설명 |
|------|------|
| `command` | 테스트 실행 명령어 |
| `framework` | `node`, `python`, `go`, `rust`, `custom` |
| `setupSteps` | 커스텀 셋업 스텝 (framework: custom) |

### pr-review 타입 추가 속성

| 속성 | 설명 |
|------|------|
| `provider` | AI 제공자 (`bedrock`) |
| `model` | AI 모델 ID |
| `apiKeySecret` | GitHub Secret 이름 |
| `customRules` | 프로젝트별 추가 리뷰 규칙 |

## 트리거 방식

PR 코멘트로 실행:
```
/test     # 단위 테스트 실행
/review   # AI 리뷰 실행
/ci       # 전체 CI 실행
```

### 권한 체크

- **GitHub**: collaborators API로 write 권한 이상 확인
- **Gitea**: 권한 체크 미지원 (모든 코멘트 허용)

## 플랫폼별 차이

| 기능 | GitHub | Gitea |
|------|--------|-------|
| 워크플로우 경로 | `.github/workflows/` | `.gitea/workflows/` |
| 권한 체크 | collaborators API | 미지원 |
| 상세 로그 URL | `run_id` 사용 | `run_number` 사용 |

## 요구사항

- Node.js >= 18.0.0
- GitHub/Gitea Actions 활성화
- AI 리뷰 사용 시: Bedrock API 키 (GitHub Secrets에 설정)

## 라이선스

MIT
