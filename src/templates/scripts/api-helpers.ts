/**
 * GitHub/Gitea 양쪽에서 작동하는 API 호출 헬퍼
 *
 * gh CLI 대신 curl + ${{ github.api_url }}을 사용하여
 * GitHub Actions와 Gitea Actions 모두에서 동작하도록 함
 */

/** curl 기본 헤더 (Authorization + Accept) */
export const CURL_HEADERS = `-H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" -H "Accept: application/json"`;

/** API GET 요청 */
export function apiGet(endpoint: string, jqFilter?: string): string {
  const base = `curl -sf ${CURL_HEADERS} "\${{ github.api_url }}${endpoint}"`;
  return jqFilter ? `${base} | jq -r '${jqFilter}'` : base;
}

/** API POST 요청 (JSON body) */
export function apiPost(endpoint: string, data: string): string {
  return `curl -sf ${CURL_HEADERS} -H "Content-Type: application/json" -X POST "\${{ github.api_url }}${endpoint}" -d '${data}'`;
}

/** API PATCH 요청 (파일에서 body 읽기) */
export function apiPatchFile(endpoint: string, bodyFile: string): string {
  return `curl -sf ${CURL_HEADERS} -H "Content-Type: application/json" -X PATCH "\${{ github.api_url }}${endpoint}" -d @${bodyFile}`;
}

/**
 * gh CLI → curl 변환 패턴
 *
 * | gh CLI | curl equivalent |
 * |--------|-----------------|
 * | gh api /repos/.../statuses/SHA | apiGet('/repos/.../statuses/SHA') |
 * | gh api /repos/.../statuses/SHA -f state=... | apiPost('/repos/.../statuses/SHA', {...}) |
 * | gh pr view N --json headRefOid | apiGet('/repos/.../pulls/N', '.head.sha') |
 * | gh pr view N --json headRefName | apiGet('/repos/.../pulls/N', '.head.ref') |
 * | gh pr view N --json reviews | apiGet('/repos/.../pulls/N/reviews') |
 * | gh pr comment N --body-file F | apiPost('/repos/.../issues/N/comments', ...) + file read |
 * | gh pr diff N | apiGet('/repos/.../pulls/N.diff') (Accept: text/plain) |
 */

/** PR 정보 조회 */
export function getPrInfo(prNumber: string, jqFilter: string): string {
  return apiGet(`/repos/\${{ github.repository }}/pulls/${prNumber}`, jqFilter);
}

/** PR HEAD SHA 조회 */
export function getPrHeadSha(prNumber: string): string {
  return getPrInfo(prNumber, '.head.sha');
}

/** PR HEAD branch 조회 */
export function getPrHeadRef(prNumber: string): string {
  return getPrInfo(prNumber, '.head.ref');
}

/** 사용자 권한 조회 */
export function getUserPermission(user: string): string {
  return apiGet(`/repos/\${{ github.repository }}/collaborators/${user}/permission`, '.permission');
}

/** commit status 조회 */
export function getCommitStatuses(sha: string, jqFilter?: string): string {
  return apiGet(`/repos/\${{ github.repository }}/commits/${sha}/statuses`, jqFilter);
}

/** commit status 설정 (POST) */
export function setCommitStatus(sha: string, state: string, context: string, description: string): string {
  const data = `{"state":"${state}","context":"${context}","description":"${description}"}`;
  return `curl -sf ${CURL_HEADERS} -H "Content-Type: application/json" -X POST "\${{ github.api_url }}/repos/\${{ github.repository }}/statuses/${sha}" -d '${data}'`;
}

/** PR 댓글 목록 조회 */
export function getPrComments(prNumber: string, jqFilter?: string): string {
  return apiGet(`/repos/\${{ github.repository }}/issues/${prNumber}/comments`, jqFilter);
}

/** PR 댓글 작성 */
export function createPrComment(prNumber: string, bodyVar: string): string {
  return `curl -sf ${CURL_HEADERS} -H "Content-Type: application/json" -X POST "\${{ github.api_url }}/repos/\${{ github.repository }}/issues/${prNumber}/comments" -d "{\\"body\\": \$${bodyVar}}"`;
}

/** PR 댓글 수정 */
export function updatePrComment(commentId: string, bodyFile: string): string {
  return apiPatchFile(`/repos/\${{ github.repository }}/issues/comments/${commentId}`, bodyFile);
}

/** PR diff 조회 */
export function getPrDiff(prNumber: string): string {
  return `curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" -H "Accept: application/vnd.github.v3.diff" "\${{ github.api_url }}/repos/\${{ github.repository }}/pulls/${prNumber}"`;
}

/** PR reviews 조회 */
export function getPrReviews(prNumber: string, jqFilter?: string): string {
  return apiGet(`/repos/\${{ github.repository }}/pulls/${prNumber}/reviews`, jqFilter);
}
