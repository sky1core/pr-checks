import type { Config } from '../../types/config.js';

/**
 * git diff 생성 스텝 (GitHub API 대신 로컬 git 사용)
 */
export function generateGitDiffStep(_config: Config): string {
  // GitHub/Gitea API에서 base branch 가져오기 (양쪽 동일)
  const getBaseBranch = `PR_RAW=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/pulls/\$PR_NUMBER") || { echo "::error::PR API 조회 실패"; exit 1; }
          BASE_BRANCH=\$(printf '%s' "\$PR_RAW" | jq -r '.base.ref')
          if [ -z "\$BASE_BRANCH" ] || [ "\$BASE_BRANCH" = "null" ]; then
            echo "::error::base branch를 가져올 수 없음"
            exit 1
          fi`;

  return `      - name: Generate diff using git
        id: git-diff
        run: |
          PR_NUMBER="\${{ needs.check-trigger.outputs.pr_number }}"
          cd "\${{ steps.repo-cache.outputs.repo_dir }}"

          # PR의 base branch 가져오기
          ${getBaseBranch}
          echo "Base branch: \$BASE_BRANCH"

          # base 브랜치 최신화
          git fetch origin \$BASE_BRANCH

          # diff 생성 (workspace에 저장하여 다음 step에서 접근 가능)
          git diff origin/\$BASE_BRANCH...\${{ steps.pr-fetch.outputs.pr_branch }} > \${{ github.workspace }}/diff.txt

          DIFF_SIZE=\$(wc -c < \${{ github.workspace }}/diff.txt | tr -d ' ')
          echo "Diff size: \$DIFF_SIZE bytes"
          echo "diff_size=\$DIFF_SIZE" >> \$GITHUB_OUTPUT

          if [ "\$DIFF_SIZE" -gt 300000 ]; then
            echo "Warning: Large diff (\$DIFF_SIZE bytes)"
          fi`;
}
