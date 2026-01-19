import fs from 'fs-extra';
import path from 'path';
import type { Config, PrTestCheck } from '../types/config.js';
import { STATUS_MESSAGES } from '../templates/constants/messages.js';
import { COMMENT_MARKERS, METADATA_PREFIX, METADATA_SUFFIX } from '../templates/constants/comments.js';

/**
 * pr-test-report.sh 스크립트 생성
 */
function generatePrTestReportScript(check: PrTestCheck): string {
  const passMarker = COMMENT_MARKERS.prTestPass(check.name);
  const failMarker = COMMENT_MARKERS.prTestFail(check.name);
  const passDesc = STATUS_MESSAGES.success.passed;
  const failDesc = STATUS_MESSAGES.failure.failed;

  return `#!/bin/bash
# PR Test Report Script
# Usage: bash pr-test-report.sh <head_sha> <pr_number> <test_passed>
# Env: GITHUB_TOKEN, GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_SERVER_URL, GITHUB_RUN_ID, GITHUB_RUN_NUMBER

set +e

HEAD_SHA="$1"
PR_NUMBER="$2"
TEST_PASSED="$3"

SHORT_SHA="\${HEAD_SHA:0:7}"

# GitHub uses run_id in URL, Gitea uses run_number
# Note: Gitea's github.run_number incorrectly returns run_id, so we query API to get correct run_number
if [[ "$GITHUB_SERVER_URL" == *"github.com"* ]]; then
  RUN_URL="\${GITHUB_SERVER_URL}/\${GITHUB_REPOSITORY}/actions/runs/\${GITHUB_RUN_ID}"
else
  # Gitea: Query API to get correct run_number from run_id
  ACTUAL_RUN_NUMBER=\$(curl -sf -H "Authorization: token \$GITHUB_TOKEN" \\
    "\$GITHUB_API_URL/repos/\$GITHUB_REPOSITORY/actions/runs/\$GITHUB_RUN_ID" \\
    | jq -r '.run_number // empty' 2>/dev/null)
  if [ -n "\$ACTUAL_RUN_NUMBER" ]; then
    RUN_URL="\${GITHUB_SERVER_URL}/\${GITHUB_REPOSITORY}/actions/runs/\${ACTUAL_RUN_NUMBER}"
  else
    # Fallback to run_id if API fails
    RUN_URL="\${GITHUB_SERVER_URL}/\${GITHUB_REPOSITORY}/actions/runs/\${GITHUB_RUN_ID}"
  fi
fi

if [ "$TEST_PASSED" = "true" ]; then
  STATE="success"
  DESC="${passDesc}"
else
  STATE="failure"
  DESC="${failDesc}"
fi

# Set commit status
echo "Setting commit status..."
curl -sS -f -H "Authorization: token $GITHUB_TOKEN" \\
  -H "Content-Type: application/json" \\
  -X POST "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/statuses/$HEAD_SHA" \\
  -d "{\\"state\\":\\"$STATE\\",\\"context\\":\\"${check.name}\\",\\"description\\":\\"$DESC\\"}" || echo "Warning: Status API failed"

# Build comment with metadata
echo "Building comment..."
# Metadata: type, check name, sha, collapsed state
METADATA="${METADATA_PREFIX}{\\"type\\":\\"pr-test\\",\\"check\\":\\"${check.name}\\",\\"sha\\":\\"$HEAD_SHA\\",\\"collapsed\\":false}${METADATA_SUFFIX}"

if [ "$TEST_PASSED" = "true" ]; then
  {
    echo "$METADATA"
    echo "${passMarker} - PASS"
    echo ""
    echo "🔗 [상세 로그]($RUN_URL) | 📌 $SHORT_SHA"
    echo ""
    echo "\\\`${check.trigger}\\\` 명령에 대한 응답"
  } > comment.md
else
  {
    echo "$METADATA"
    printf '${failMarker} - FAIL\\n\\n\`\`\`\\n'
    tail -50 test_output.txt 2>/dev/null || echo "(no output)"
    printf '\\n\`\`\`\\n\\n'
    echo "🔗 [상세 로그]($RUN_URL) | 📌 $SHORT_SHA"
    echo ""
    echo "\\\`${check.trigger}\\\` 명령에 대한 응답"
  } > comment.md
fi

# Post PR comment
echo "Posting comment..."
BODY=$(jq -Rs '.' comment.md)
curl -sS -f -H "Authorization: token $GITHUB_TOKEN" \\
  -H "Content-Type: application/json" \\
  -X POST "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" \\
  -d "{\\"body\\": $BODY}" || echo "Warning: Comment API failed"

# Save result for later steps
echo "$TEST_PASSED" > test_result.txt
echo "Done."
`;
}

/**
 * collapse-comments.sh 스크립트 생성
 * 메타데이터 기반으로 이전 코멘트 접기
 */
function generateCollapseCommentsScript(checkName: string): string {
  // 중앙 정의된 패턴 사용
  const metadataPattern = COMMENT_MARKERS.collapsiblePattern(checkName);

  return `#!/bin/bash
# Collapse Old Comments Script (metadata-based)
# Usage: bash collapse-comments.sh <pr_number> <head_sha>
# Env: GITHUB_TOKEN, GITHUB_API_URL, GITHUB_REPOSITORY

set +e

PR_NUMBER="$1"
HEAD_SHA="$2"

# Find comments with metadata: check="${checkName}" and collapsed:false
COMMENTS=$(curl -sf -H "Authorization: token $GITHUB_TOKEN" \\
  "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" \\
  | jq "[.[] | select(.body | test(\\"${metadataPattern}\\")) | {id, body}]")

COMMENT_COUNT=$(echo "$COMMENTS" | jq 'length')
echo "Found $COMMENT_COUNT comments to check"

echo "$COMMENTS" | jq -c '.[]' | while read -r comment; do
  COMMENT_ID=$(echo "$comment" | jq -r '.id')
  BODY=$(echo "$comment" | jq -r '.body')

  # Extract SHA from metadata
  COMMENT_SHA=$(echo "$BODY" | grep -o '"sha":"[^"]*"' | head -1 | sed 's/"sha":"\\([^"]*\\)"/\\1/')

  # Skip current commit's comment
  if [ "$COMMENT_SHA" = "$HEAD_SHA" ]; then
    echo "Skipping current commit comment: $COMMENT_ID (sha: $COMMENT_SHA)"
    continue
  fi

  echo "Collapsing comment: $COMMENT_ID (sha: $COMMENT_SHA)"

  # Update metadata: collapsed:false → collapsed:true
  # Then wrap content with <details>
  FIRST_LINE=$(echo "$BODY" | head -1)
  REST=$(echo "$BODY" | tail -n +2)

  # Update collapsed flag in metadata
  NEW_FIRST_LINE=$(echo "$FIRST_LINE" | sed 's/"collapsed":false/"collapsed":true/')

  # Get the title line (second line, e.g., "## ✅ pr-test - PASS")
  TITLE_LINE=$(echo "$REST" | head -1)
  CONTENT=$(echo "$REST" | tail -n +2)

  {
    echo "$NEW_FIRST_LINE"
    echo "$TITLE_LINE"
    echo ""
    echo "<details>"
    echo "<summary>펼쳐서 보기</summary>"
    echo "$CONTENT"
    echo "</details>"
  } > new_body.md

  PATCH_BODY=$(jq -Rs '.' new_body.md)
  curl -sf -H "Authorization: token $GITHUB_TOKEN" \\
    -H "Content-Type: application/json" \\
    -X PATCH "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/issues/comments/$COMMENT_ID" \\
    -d "{\\"body\\": $PATCH_BODY}" || echo "Warning: Failed to collapse $COMMENT_ID"
done
`;
}

/**
 * 스크립트 파일들 생성
 */
export async function generateScriptFiles(cwd: string, config: Config): Promise<string[]> {
  const scriptsDir = path.join(cwd, '.pr-checks', 'scripts');
  await fs.mkdir(scriptsDir, { recursive: true });

  const files: string[] = [];

  for (const check of config.input.checks) {
    if (check.type === 'pr-test') {
      const prTestCheck = check as PrTestCheck;

      // pr-test-report.sh
      const reportScript = generatePrTestReportScript(prTestCheck);
      const reportPath = path.join(scriptsDir, `${check.name}-report.sh`);
      await fs.writeFile(reportPath, reportScript, { mode: 0o755 });
      files.push(`.pr-checks/scripts/${check.name}-report.sh`);

      // collapse-comments.sh
      const collapseScript = generateCollapseCommentsScript(check.name);
      const collapsePath = path.join(scriptsDir, `${check.name}-collapse.sh`);
      await fs.writeFile(collapsePath, collapseScript, { mode: 0o755 });
      files.push(`.pr-checks/scripts/${check.name}-collapse.sh`);
    }
  }

  return files;
}
