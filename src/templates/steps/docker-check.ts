/**
 * Docker Desktop 실행 체크 스텝 생성 (macOS용)
 */
export function generateDockerCheckStep(): string {
  return `      - name: Ensure Docker is running
        if: runner.os == 'macOS'
        run: |
          if ! docker info > /dev/null 2>&1; then
            echo "Starting Docker Desktop..."
            open -a Docker

            timeout=120
            elapsed=0
            while ! docker info > /dev/null 2>&1; do
              if [ \$elapsed -ge \$timeout ]; then
                echo "Error: Docker failed to start within \${timeout}s"
                exit 1
              fi
              echo "Waiting for Docker... (\$elapsed/\${timeout}s)"
              sleep 5
              elapsed=\$((elapsed + 5))
            done
            echo "Docker is ready"
          else
            echo "Docker is already running"
          fi`;
}
