import type { Config } from '../../types/config.js';

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

  return `  # 트리거 체크
  check-trigger:
    if: github.event_name == 'issue_comment'
    runs-on: ubuntu-latest
    outputs:
      should_continue: \${{ steps.check.outputs.should_continue }}
      pr_number: \${{ steps.check.outputs.pr_number }}
      head_sha: \${{ steps.check.outputs.head_sha }}
      trigger: \${{ steps.check.outputs.trigger }}
    steps:
      - name: Check trigger
        id: check
        run: |
          # PR 코멘트인지 확인
          if [ -z "\${{ github.event.issue.pull_request }}" ]; then
            echo "should_continue=false" >> \$GITHUB_OUTPUT
            exit 0
          fi

          # 권한 확인 (write 이상 권한 필요)
          USER="\${{ github.event.comment.user.login }}"
          REPO_OWNER="\${{ github.repository_owner }}"

${permissionCheck}

          if [[ ! "\$PERMISSION" =~ ^(owner|admin|maintain|write)\$ ]]; then
            echo "User \$USER does not have write permission (got: \$PERMISSION)"
            echo "should_continue=false" >> \$GITHUB_OUTPUT
            exit 0
          fi

          PR_NUMBER="\${{ github.event.issue.number }}"

          # 트리거 명령어 매칭 (첫 줄 첫 단어만 사용)
          FIRST_LINE=\$(printf '%s' "\${{ github.event.comment.body }}" | head -1)
          FIRST_WORD=\$(echo "\$FIRST_LINE" | awk '{print \$1}')
          TRIGGER=""
          if [[ "\$FIRST_WORD" =~ ^(${triggerPattern})\$ ]]; then
            TRIGGER="\$FIRST_WORD"
          fi

          if [ -z "\$TRIGGER" ]; then
            echo "should_continue=false" >> \$GITHUB_OUTPUT
            exit 0
          fi

          if [ -z "\$PR_NUMBER" ]; then
            echo "should_continue=false" >> \$GITHUB_OUTPUT
            exit 0
          fi

          # HEAD SHA 조회
          HEAD_SHA=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/pulls/\$PR_NUMBER" \\
            | jq -r '.head.sha')

          echo "pr_number=\$PR_NUMBER" >> \$GITHUB_OUTPUT
          echo "head_sha=\$HEAD_SHA" >> \$GITHUB_OUTPUT
          echo "trigger=\$TRIGGER" >> \$GITHUB_OUTPUT
          echo "should_continue=true" >> \$GITHUB_OUTPUT`;
}
