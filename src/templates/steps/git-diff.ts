import type { Config } from '../../types/config.js';

/**
 * git diff 생성 스텝 (GitHub API 대신 로컬 git 사용)
 */
export function generateGitDiffStep(_config: Config): string {
  // GitHub/Gitea API에서 base branch 가져오기 (양쪽 동일)
  const getBaseBranch = `BASE_BRANCH=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/pulls/\$PR_NUMBER" | jq -r '.base.ref')`;

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

          # diff 생성
          git diff origin/\$BASE_BRANCH...\${{ steps.pr-fetch.outputs.pr_branch }} > diff.txt

          DIFF_SIZE=\$(wc -c < diff.txt | tr -d ' ')
          echo "Diff size: \$DIFF_SIZE bytes"
          echo "diff_size=\$DIFF_SIZE" >> \$GITHUB_OUTPUT

          if [ "\$DIFF_SIZE" -gt 300000 ]; then
            echo "Warning: Large diff (\$DIFF_SIZE bytes)"
          fi`;
}
