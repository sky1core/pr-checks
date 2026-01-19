import type { Config } from '../../types/config.js';
import { getDefaultAutoRunOn } from '../../types/config.js';

/**
 * 트리거 체크 job
 *
 * 역할:
 * 1. 이벤트 유형에 따른 PR 번호/SHA 결정
 * 2. 코멘트 권한 확인 (write 권한 필요)
 * 3. 트리거 명령어 매칭
 * 4. outputs: should_continue, pr_number, head_sha, trigger
 */
/**
 * 플랫폼별 권한 체크 로직 생성
 */
function generatePermissionCheck(platform: 'github' | 'gitea'): string {
  if (platform === 'github') {
    // GitHub: collaborators API로 직접 권한 확인
    return `          # GitHub: collaborators API로 권한 확인
          PERMISSION=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/collaborators/\$USER/permission" \\
            | jq -r '.permission' 2>/dev/null || echo "")

          if [ -z "\$PERMISSION" ]; then
            echo "Failed to get permission for user \$USER"
            echo "should_continue=false" >> \$GITHUB_OUTPUT
            exit 0
          fi`;
  } else {
    // Gitea: 권한 체크 미지원
    return `          # Gitea: 권한 체크 미지원
          PERMISSION="write"`;
  }
}

export function generateCheckTriggerJob(config: Config): string {
  const { input } = config;

  // 모든 트리거 명령어 수집 (개별 + ciTrigger)
  const allTriggers = [...input.checks.map((c) => c.trigger), input.ciTrigger];
  const triggerPattern = allTriggers.map((t) => t.replace('/', '\\/')).join('|');

  const permissionCheck = generatePermissionCheck(input.platform);

  // 각 체크별 auto_run output 생성
  const autoRunOutputs = input.checks
    .map((c) => `      auto_run_${c.name}: \${{ steps.check.outputs.auto_run_${c.name} }}`)
    .join('\n');

  // 모든 체크에서 사용하는 PR 액션 수집 (워크플로우 if 조건용)
  const allActions = new Set<string>();
  for (const c of input.checks) {
    const actions = c.autoRunOn ?? getDefaultAutoRunOn(c.mustRun);
    actions.forEach((a) => allActions.add(a));
  }
  // 최소한 synchronize는 포함 (기존 동작 호환)
  if (allActions.size === 0) {
    allActions.add('synchronize');
  }
  const prActionConditions = Array.from(allActions)
    .map((a) => `github.event.action == '${a}'`)
    .join(' || ');

  // 각 체크별 autoRunOn 설정에 따른 자동 실행 로직 생성
  const autoRunLogic = input.checks
    .map((c) => {
      const autoRunOn = c.autoRunOn ?? getDefaultAutoRunOn(c.mustRun);
      if (autoRunOn.length === 0) {
        return `            echo "auto_run_${c.name}=false" >> \$GITHUB_OUTPUT`;
      } else {
        const conditions = autoRunOn.map((a) => `"\$ACTION" = "${a}"`).join(' ] || [ ');
        return `            if [ ${conditions} ]; then
              echo "auto_run_${c.name}=true" >> \$GITHUB_OUTPUT
            else
              echo "auto_run_${c.name}=false" >> \$GITHUB_OUTPUT
            fi`;
      }
    })
    .join('\n');

  return `  # 트리거 체크
  check-trigger:
    if: |
      github.event_name == 'issue_comment' ||
      (github.event_name == 'pull_request' && (${prActionConditions}))
    runs-on: ubuntu-latest
    outputs:
      should_continue: \${{ steps.check.outputs.should_continue }}
      pr_number: \${{ steps.check.outputs.pr_number }}
      head_sha: \${{ steps.check.outputs.head_sha }}
      trigger: \${{ steps.check.outputs.trigger }}
      user_message: \${{ steps.check.outputs.user_message }}
      is_official: \${{ steps.check.outputs.is_official }}
${autoRunOutputs}
    steps:
      - name: Check trigger
        id: check
        run: |
          # pull_request 이벤트: opened/synchronize 처리
          if [ "\${{ github.event_name }}" = "pull_request" ]; then
            ACTION="\${{ github.event.action }}"

            # Draft PR은 자동 실행 스킵
            if [ "\${{ github.event.pull_request.draft }}" = "true" ]; then
              echo "Draft PR - skipping auto run"
              echo "should_continue=false" >> \$GITHUB_OUTPUT
              exit 0
            fi

            echo "pr_number=\${{ github.event.pull_request.number }}" >> \$GITHUB_OUTPUT
            echo "head_sha=\${{ github.event.pull_request.head.sha }}" >> \$GITHUB_OUTPUT
            echo "trigger=" >> \$GITHUB_OUTPUT
            echo "user_message=" >> \$GITHUB_OUTPUT
            echo "is_official=true" >> \$GITHUB_OUTPUT

            # 각 체크별 자동 실행 여부 설정
${autoRunLogic}

            echo "should_continue=true" >> \$GITHUB_OUTPUT
            exit 0
          fi

          # issue_comment 이벤트: 코멘트로 수동 실행
          # PR 코멘트인지 확인
          if [ -z "\${{ github.event.issue.pull_request }}" ]; then
            echo "should_continue=false" >> \$GITHUB_OUTPUT
            exit 0
          fi

          # 권한 확인 (write 이상 권한 필요)
          USER="\${{ github.event.comment.user.login }}"

${permissionCheck}

          if [[ ! "\$PERMISSION" =~ ^(owner|admin|maintain|write)\$ ]]; then
            echo "User \$USER does not have write permission (got: \$PERMISSION)"
            echo "should_continue=false" >> \$GITHUB_OUTPUT
            exit 0
          fi

          PR_NUMBER="\${{ github.event.issue.number }}"

          # 트리거 명령어 매칭 (첫 비어있지 않은 줄의 첫 단어)
          # 보안: ${{ }}로 직접 삽입하면 command injection 가능하므로 jq로 안전하게 읽음
          COMMENT_BODY=\$(jq -r '.comment.body // ""' "\$GITHUB_EVENT_PATH")
          FIRST_LINE=\$(printf '%s' "\$COMMENT_BODY" | awk 'NF{print; exit}')
          FIRST_WORD=\$(echo "\$FIRST_LINE" | awk '{print \$1}')
          TRIGGER=""
          if [[ "\$FIRST_WORD" =~ ^(${triggerPattern})\$ ]]; then
            TRIGGER="\$FIRST_WORD"
          fi

          if [ -z "\$TRIGGER" ]; then
            echo "should_continue=false" >> \$GITHUB_OUTPUT
            exit 0
          fi

          # 트리거 뒤의 추가 메시지 추출 (첫 줄 나머지 + 이후 모든 줄)
          USER_MESSAGE=\$(printf '%s' "\$COMMENT_BODY" | awk -v trigger="\$TRIGGER" '
            !found && NF {
              found=1
              sub(/^[[:space:]]*/, "")
              sub(/^[^[:space:]]+[[:space:]]*/, "")
              if (length(\$0) > 0) print
              next
            }
            found { print }
          ')

          # 공백만 있는 경우 빈 문자열로 처리 (printf로 echo 옵션 해석 방지)
          USER_MESSAGE_TRIMMED=\$(printf '%s' "\$USER_MESSAGE" | sed 's/^[[:space:]]*//;s/[[:space:]]*\$//' | tr -d '\\n')

          # user_message를 base64로 인코딩하여 출력 (command injection 방지)
          # 다음 job에서 ${{ }}로 읽어도 안전한 문자셋만 포함됨
          USER_MESSAGE_B64=\$(printf '%s' "\$USER_MESSAGE" | base64 | tr -d '\\n')
          echo "user_message=\$USER_MESSAGE_B64" >> \$GITHUB_OUTPUT

          # 추가 메시지가 있으면 비공식 실행 (공백만 있으면 공식 실행)
          if [ -z "\$USER_MESSAGE_TRIMMED" ]; then
            echo "is_official=true" >> \$GITHUB_OUTPUT
          else
            echo "is_official=false" >> \$GITHUB_OUTPUT
          fi

          if [ -z "\$PR_NUMBER" ]; then
            echo "should_continue=false" >> \$GITHUB_OUTPUT
            exit 0
          fi

          # HEAD SHA 조회
          PR_RESPONSE=\$(curl -s -w "\\n%{http_code}" -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/pulls/\$PR_NUMBER")
          HTTP_CODE=\$(echo "\$PR_RESPONSE" | tail -n1)
          RESPONSE_BODY=\$(echo "\$PR_RESPONSE" | sed '\$d')

          if [ "\$HTTP_CODE" != "200" ]; then
            echo "Failed to fetch PR info: HTTP \$HTTP_CODE"
            echo "should_continue=false" >> \$GITHUB_OUTPUT
            exit 0
          fi

          HEAD_SHA=\$(echo "\$RESPONSE_BODY" | jq -r '.head.sha // empty')
          if [ -z "\$HEAD_SHA" ]; then
            echo "Failed to extract head SHA from response"
            echo "should_continue=false" >> \$GITHUB_OUTPUT
            exit 0
          fi

          echo "pr_number=\$PR_NUMBER" >> \$GITHUB_OUTPUT
          echo "head_sha=\$HEAD_SHA" >> \$GITHUB_OUTPUT
          echo "trigger=\$TRIGGER" >> \$GITHUB_OUTPUT
          echo "should_continue=true" >> \$GITHUB_OUTPUT`;
}
