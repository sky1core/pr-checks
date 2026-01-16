import type { Config } from '../../types/config.js';

/**
 * 저장소 클론/재사용 스텝 생성
 */
export function generateRepoCacheStep(_config: Config): string {
  // GitHub/Gitea 양쪽 모두 github.server_url 사용 가능
  const serverUrl = '\${{ github.server_url }}';

  return `      - name: Clone or update repository
        id: repo-cache
        run: |
          REPO_URL="${serverUrl}/\${{ github.repository }}.git"
          REPO_DIR="\${{ github.workspace }}/repo"

          if [ -d "\$REPO_DIR/.git" ]; then
            echo "Using cached repository at \$REPO_DIR"
            cd "\$REPO_DIR"
            git fetch --all --prune
          else
            echo "Cloning repository to \$REPO_DIR"
            mkdir -p "\$(dirname "\$REPO_DIR")"
            git clone "\$REPO_URL" "\$REPO_DIR"
          fi

          echo "repo_dir=\$REPO_DIR" >> \$GITHUB_OUTPUT`;
}
