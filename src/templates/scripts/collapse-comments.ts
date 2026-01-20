import { COMMENT_MARKERS } from '../constants/comments.js';

/**
 * 리뷰 이전 댓글 접기 스크립트 생성 (메타데이터 기반)
 * @param checkName 체크 이름 (코멘트 식별용)
 */
export function generateCollapsePrReviewCommentsScript(checkName: string): string {
  // 중앙 정의된 패턴 사용
  const metadataPattern = COMMENT_MARKERS.collapsiblePattern(checkName);

  return `# 메타데이터 기반 이전 리뷰 코멘트 접기
COMMENTS=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
  "\${{ github.api_url }}/repos/\${{ github.repository }}/issues/\${PR_NUMBER}/comments" \\
  | jq '[.[] | select(.body | test("${metadataPattern}")) | {id, body}]')

COMMENT_COUNT=\$(echo "\$COMMENTS" | jq 'length')
echo "Found \$COMMENT_COUNT comments to check"

echo "\$COMMENTS" | jq -c '.[]' | while read -r comment; do
  COMMENT_ID=\$(echo "\$comment" | jq -r '.id')
  BODY=\$(echo "\$comment" | jq -r '.body')

  # 메타데이터에서 SHA 추출
  COMMENT_SHA=\$(echo "\$BODY" | grep -o '"sha":"[^"]*"' | head -1 | sed 's/"sha":"\\([^"]*\\)"/\\1/')

  # 현재 커밋의 댓글이면 스킵
  if [ "\$COMMENT_SHA" = "\$HEAD_SHA" ]; then
    echo "현재 커밋 댓글 스킵: \$COMMENT_ID (sha: \$COMMENT_SHA)"
    continue
  fi

  echo "접기 처리: 코멘트 \$COMMENT_ID (sha: \$COMMENT_SHA)"

  # 메타데이터의 collapsed:false → collapsed:true 변경
  # <details open> → <details> 변경
  NEW_BODY=\$(echo "\$BODY" | sed 's/"collapsed":false/"collapsed":true/' | sed 's/<details open>/<details>/')

  printf '%s' "\$NEW_BODY" > collapse_body.md
  PATCH_BODY=\$(jq -Rs '.' collapse_body.md)
  curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
    -H "Content-Type: application/json" \\
    -X PATCH "\${{ github.api_url }}/repos/\${{ github.repository }}/issues/comments/\${COMMENT_ID}" \\
    -d "{\\"body\\": \$PATCH_BODY}"
done`;
}

/**
 * 테스트 이전 댓글 접기 스크립트 생성 (메타데이터 기반)
 * @param checkName 체크 이름 (코멘트 식별용)
 */
export function generateCollapsePrTestCommentsScript(checkName: string): string {
  // 중앙 정의된 패턴 사용
  const metadataPattern = COMMENT_MARKERS.collapsiblePattern(checkName);

  return `# 메타데이터 기반 이전 테스트 댓글 접기
COMMENTS=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
  "\${{ github.api_url }}/repos/\${{ github.repository }}/issues/\${PR_NUMBER}/comments" \\
  | jq '[.[] | select(.body | test("${metadataPattern}")) | {id, body}]')

COMMENT_COUNT=\$(echo "\$COMMENTS" | jq 'length')
echo "Found \$COMMENT_COUNT comments to check"

echo "\$COMMENTS" | jq -c '.[]' | while read -r comment; do
  COMMENT_ID=\$(echo "\$comment" | jq -r '.id')
  BODY=\$(echo "\$comment" | jq -r '.body')

  # 메타데이터에서 SHA 추출
  COMMENT_SHA=\$(echo "\$BODY" | grep -o '"sha":"[^"]*"' | head -1 | sed 's/"sha":"\\([^"]*\\)"/\\1/')

  # 현재 커밋의 댓글이면 스킵
  if [ "\$COMMENT_SHA" = "\$HEAD_SHA" ]; then
    echo "현재 커밋 댓글 스킵: \$COMMENT_ID (sha: \$COMMENT_SHA)"
    continue
  fi

  echo "접기 처리: 코멘트 \$COMMENT_ID (sha: \$COMMENT_SHA)"

  # 메타데이터의 collapsed:false → collapsed:true 변경
  # <details open> → <details> 변경
  NEW_BODY=\$(echo "\$BODY" | sed 's/"collapsed":false/"collapsed":true/' | sed 's/<details open>/<details>/')

  printf '%s' "\$NEW_BODY" > new_body.md
  PATCH_BODY=\$(jq -Rs '.' new_body.md)
  curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
    -H "Content-Type: application/json" \\
    -X PATCH "\${{ github.api_url }}/repos/\${{ github.repository }}/issues/comments/\${COMMENT_ID}" \\
    -d "{\\"body\\": \$PATCH_BODY}"
done`;
}
