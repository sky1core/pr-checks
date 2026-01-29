/**
 * PR 브랜치 fetch 스텝 생성
 */
export function generatePrFetchStep(): string {
  return `      - name: Fetch PR branch
        id: pr-fetch
        run: |
          PR_NUMBER="\${{ needs.check-trigger.outputs.pr_number }}"
          cd "\${{ steps.repo-cache.outputs.repo_dir }}"

          # 기존 PR 브랜치가 체크아웃된 상태면 detach
          CURRENT_BRANCH=\$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
          if [ "\$CURRENT_BRANCH" = "pr-\$PR_NUMBER" ]; then
            git checkout --detach
          fi

          # 기존 PR 브랜치 삭제 (있으면)
          git branch -D pr-\$PR_NUMBER 2>/dev/null || true

          # 이전 실행에서 남은 로컬 변경사항 정리 (tracked 파일)
          git checkout -- .

          # PR 브랜치 fetch
          git fetch origin pull/\$PR_NUMBER/head:pr-\$PR_NUMBER

          # PR 브랜치 체크아웃
          git checkout pr-\$PR_NUMBER

          echo "pr_branch=pr-\$PR_NUMBER" >> \$GITHUB_OUTPUT`;
}
