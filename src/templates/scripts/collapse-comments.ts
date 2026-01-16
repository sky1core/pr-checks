import { COMMENT_MARKERS } from '../constants/comments.js';

/**
 * 리뷰 이전 댓글 접기 스크립트 생성
 * <details open> → <details> 로 변경
 * @param checkName 체크 이름 (코멘트 식별용)
 */
export function generateCollapsePrReviewCommentsScript(checkName: string): string {
  // ${{ }} 는 GitHub Actions 표현식으로 그대로 출력
  // ${VAR} 는 bash 변수로 \${VAR}로 이스케이프
  // $(cmd) 는 bash command substitution으로 \$(cmd)로 이스케이프
  return `# 현재 커밋 SHA가 아닌 이전 리뷰 코멘트만 접기
# (펼쳐져 있고 + 현재 SHA가 아닌 것)
COMMENTS=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
  "\${{ github.api_url }}/repos/\${{ github.repository }}/issues/\${PR_NUMBER}/comments" \\
  | jq '[.[] | select(.body | test("${COMMENT_MARKERS.prReviewPattern(checkName)}")) | select(.body | contains("${COMMENT_MARKERS.detailsOpen}")) | {id, body}]')

echo "\$COMMENTS" | jq -c '.[]' | while read -r comment; do
  COMMENT_ID=\$(echo "\$comment" | jq -r '.id')
  BODY=\$(echo "\$comment" | jq -r '.body')

  # 현재 커밋의 댓글이면 스킵
  if echo "\$BODY" | grep -q "📌 \${SHORT_SHA}"; then
    echo "현재 커밋 댓글 스킵: \$COMMENT_ID"
    continue
  fi

  echo "접기 처리: 코멘트 \$COMMENT_ID"

  # ${COMMENT_MARKERS.detailsOpen} → ${COMMENT_MARKERS.detailsClosed} 로 변경 (접힌 상태로)
  NEW_BODY=\$(echo "\$BODY" | sed 's/${COMMENT_MARKERS.detailsOpen}/${COMMENT_MARKERS.detailsClosed}/')

  # 코멘트 업데이트
  printf '%s' "\$NEW_BODY" > collapse_body.md
  PATCH_BODY=\$(jq -Rs '.' collapse_body.md)
  curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
    -H "Content-Type: application/json" \\
    -X PATCH "\${{ github.api_url }}/repos/\${{ github.repository }}/issues/comments/\${COMMENT_ID}" \\
    -d "{\\"body\\": \$PATCH_BODY}"
done`;
}

/**
 * 테스트 이전 댓글 접기 스크립트 생성
 * 성공/실패 모두 접기 (최신 것만 펼침)
 * @param checkName 체크 이름 (코멘트 식별용)
 */
export function generateCollapsePrTestCommentsScript(checkName: string): string {
  return `# 현재 커밋 SHA가 아닌 이전 테스트 댓글 접기 (성공/실패 모두)
COMMENTS=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
  "\${{ github.api_url }}/repos/\${{ github.repository }}/issues/\${PR_NUMBER}/comments" \\
  | jq '[.[] | select(.body | test("${COMMENT_MARKERS.prTestPattern(checkName)}")) | select(.body | contains("<details>") | not) | {id, body}]')

echo "\$COMMENTS" | jq -c '.[]' | while read -r comment; do
  COMMENT_ID=\$(echo "\$comment" | jq -r '.id')
  BODY=\$(echo "\$comment" | jq -r '.body')

  # 현재 커밋의 댓글이면 스킵
  if echo "\$BODY" | grep -q "📌 \${SHORT_SHA}"; then
    echo "현재 커밋 댓글 스킵: \$COMMENT_ID"
    continue
  fi

  echo "접기 처리: 코멘트 \$COMMENT_ID"
  FIRST_LINE=\$(echo "\$BODY" | head -1)
  REST=\$(echo "\$BODY" | tail -n +2)

  printf '%s\\n\\n<details>\\n<summary>펼쳐서 보기</summary>\\n%s\\n</details>' "\$FIRST_LINE" "\$REST" > new_body.md

  PATCH_BODY=\$(jq -Rs '.' new_body.md)
  curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
    -H "Content-Type: application/json" \\
    -X PATCH "\${{ github.api_url }}/repos/\${{ github.repository }}/issues/comments/\${COMMENT_ID}" \\
    -d "{\\"body\\": \$PATCH_BODY}"
done`;
}
