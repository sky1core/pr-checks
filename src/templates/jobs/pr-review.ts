import type { Config, PrReviewCheck, PrTestCheck, CliTool } from '../../types/config.js';
import { STATUS_MESSAGES } from '../constants/messages.js';
import { COMMENT_MARKERS } from '../constants/comments.js';
import { buildPromptForJq, CLI_REVIEW_PROMPT } from '../constants/prompts.js';
import { generateCollapsePrReviewCommentsScript } from '../scripts/collapse-comments.js';
import { indent, formatRunner } from '../utils/index.js';
import {
  generateDockerCheckStep,
  generateRepoCacheStep,
  generatePrFetchStep,
  generateGitDiffStep,
} from '../steps/index.js';

/**
 * customRules를 bash 문자열에서 안전하게 사용하기 위해 이스케이프
 * 처리 순서가 중요함: 백슬래시 먼저, 그 다음 다른 문자들
 */
function escapeForBashString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')    // 백슬래시 먼저 처리
    .replace(/"/g, '\\"')      // 쌍따옴표
    .replace(/\$/g, '\\$')     // 달러 기호
    .replace(/`/g, '\\`')      // 백틱
    .replace(/\n/g, '\\n');    // 개행
}

/**
 * Bedrock AI 리뷰 스텝 생성
 */
function generateBedrockReviewStep(check: PrReviewCheck): string {
  // customRules를 bash 문자열에서 안전하게 사용하기 위해 이스케이프
  const escapedCustomRules = escapeForBashString(check.customRules || '');

  return `      - name: Run AI Review
        id: ai-check
        run: |
          echo "🤖 AI 코드 리뷰 실행 중..."

          DIFF_CONTENT=\$(cat diff.txt)

          # 프로젝트별 리뷰 규칙
          CUSTOM_RULES="${escapedCustomRules}"

          # Bedrock API 호출 (Tool Use로 구조화된 응답 강제)
          RESPONSE=\$(curl -s -X POST "https://bedrock-runtime.us-east-1.amazonaws.com/model/${check.model}/converse" \\
            -H "Content-Type: application/json" \\
            -H "Authorization: Bearer \${{ secrets.${check.apiKeySecret} }}" \\
            -d "\$(jq -n --arg diff "\$DIFF_CONTENT" --arg rules "\$CUSTOM_RULES" '{
              "messages": [
                {
                  "role": "user",
                  "content": [{"text": ("${buildPromptForJq()}")}]
                }
              ],
              "toolConfig": {
                "tools": [
                  {
                    "toolSpec": {
                      "name": "submit_review",
                      "description": "코드 리뷰 결과를 제출합니다",
                      "inputSchema": {
                        "json": {
                          "type": "object",
                          "properties": {
                            "result": {
                              "type": "string",
                              "enum": ["pass", "fail"],
                              "description": "리뷰 결과 (pass 또는 fail)"
                            },
                            "details": {
                              "type": "string",
                              "description": "상세 리뷰 내용 (위험도 등급별 문제점 포함)"
                            }
                          },
                          "required": ["result", "details"]
                        }
                      }
                    }
                  }
                ],
                "toolChoice": {
                  "tool": {
                    "name": "submit_review"
                  }
                }
              }
            }')")

          # Tool Use 응답에서 결과 추출
          TOOL_INPUT=\$(echo "\$RESPONSE" | jq -r '.output.message.content[0].toolUse.input // empty')

          if [ -z "\$TOOL_INPUT" ]; then
            ERROR_MSG=\$(echo "\$RESPONSE" | jq -r '.message // .error // empty')
            if [ -z "\$ERROR_MSG" ]; then
              ERROR_MSG="알 수 없는 오류"
            fi
            echo "API 호출 실패: \$ERROR_MSG"
            echo "\$RESPONSE" > review.txt
            RESULT="fail"
            SUMMARY="API 호출 실패: \$ERROR_MSG"
          else
            RESULT=\$(echo "\$TOOL_INPUT" | jq -r '.result')
            DETAILS=\$(echo "\$TOOL_INPUT" | jq -r '.details')
            echo "\$DETAILS" > review.txt

            if [ "\$RESULT" = "pass" ]; then
              SUMMARY="AI review passed"
            else
              SUMMARY="Issues found in AI review"
            fi
          fi

          echo "result=\$RESULT" >> \$GITHUB_OUTPUT
          echo "summary=\$SUMMARY" >> \$GITHUB_OUTPUT
        env:
          ${check.apiKeySecret}: \${{ secrets.${check.apiKeySecret} }}`;
}

/**
 * CLI 도구별 명령어 생성
 */
function getCliCommand(cliTool: CliTool): string {
  switch (cliTool) {
    case 'claude':
      return 'claude -p';
    case 'codex':
      return 'codex exec';
    case 'gemini':
      return 'gemini -p';
    case 'kiro':
      return 'kiro-cli chat --no-interactive';
    default:
      throw new Error(`지원하지 않는 CLI 도구입니다: ${cliTool}`);
  }
}

/**
 * CLI AI 리뷰 스텝 생성
 * - pass/fail 판정 없이 텍스트 결과만
 * - status는 항상 success
 */
function generateCliReviewStep(check: PrReviewCheck): string {
  const cliTool = check.cliTool!;
  const cliCommand = getCliCommand(cliTool);
  const escapedCustomRules = escapeForBashString(check.customRules || '');

  // Kiro는 ANSI 코드 제거 필요
  const postProcess = cliTool === 'kiro'
    ? ` 2>&1 | perl -pe 's/\\e\\[[0-9;]*m//g'`
    : '';

  // 프롬프트를 한 줄로 이스케이프 (bash $'...' 문법용)
  const promptOneLine = CLI_REVIEW_PROMPT
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n');

  return `      - name: Run AI Review (${cliTool})
        id: ai-check
        run: |
          echo "🤖 AI 코드 리뷰 실행 중 (${cliTool})..."

          DIFF_CONTENT=\$(cat diff.txt)
          CUSTOM_RULES="${escapedCustomRules}"

          # CLI로 리뷰 실행
          PROMPT=\$'${promptOneLine}\\n\\n'\$CUSTOM_RULES\$'\\n\\n=== DIFF ===\\n'\$DIFF_CONTENT\$'\\n=== END DIFF ==='

          echo "\$PROMPT" | ${cliCommand}${postProcess} > review.txt || true

          # CLI는 항상 success로 처리 (텍스트 결과만 보여줌)
          echo "result=success" >> \$GITHUB_OUTPUT`;
}

/**
 * AI 리뷰 스텝 생성 (provider에 따라 다른 구현)
 */
function generateReviewStep(check: PrReviewCheck): string {
  if (check.provider === 'bedrock') {
    return generateBedrockReviewStep(check);
  }
  if (check.provider === 'cli') {
    return generateCliReviewStep(check);
  }

  throw new Error(`지원하지 않는 AI provider입니다: ${check.provider}`);
}

/**
 * Diff 가져오기 스텝 생성 (selfHosted 여부에 따라 다름)
 */
function generateDiffSteps(config: Config): string {
  const { selfHosted } = config.input;

  if (selfHosted) {
    // selfHosted: repo-cache + pr-fetch + git-diff 사용
    return `${generateRepoCacheStep(config)}

${generatePrFetchStep()}

${generateGitDiffStep(config)}`;
  }

  // 기본: GitHub API diff
  return `      - name: Get PR diff
        id: diff
        run: |
          PR_NUMBER="\${{ needs.check-trigger.outputs.pr_number }}"
          curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            -H "Accept: application/vnd.github.diff" \\
            "\${{ github.api_url }}/repos/\${{ github.repository }}/pulls/\$PR_NUMBER" > diff.txt
          DIFF_SIZE=\$(wc -c < diff.txt)
          echo "diff_size=\$DIFF_SIZE" >> \$GITHUB_OUTPUT`;
}

/**
 * 리뷰 job 생성
 *
 * 역할:
 * 1. PR diff 가져오기
 * 2. AI 리뷰 실행
 * 3. 결과에 따른 status 설정
 * 4. PR 코멘트 작성
 */
export function generatePrReviewJob(
  check: PrReviewCheck,
  config: Config,
  requiredPrTests: PrTestCheck[]
): string {
  const { input } = config;
  const jobId = check.name;
  const selfHosted = input.selfHosted;

  // 실행 조건: 개별 트리거 또는 ciTrigger(required일 때만)
  const runConditions = [
    `needs.check-trigger.outputs.trigger == '${check.trigger}'`,
  ];
  if (check.mustRun) {
    runConditions.push(`needs.check-trigger.outputs.trigger == '${input.ciTrigger}'`);
  }

  // 의존성: check-trigger + required pr-test jobs (ciTrigger인 경우)
  const dependencies = ['check-trigger'];
  for (const prTest of requiredPrTests) {
    dependencies.push(prTest.name);
  }

  // ciTrigger인 경우 pr-test 성공 조건 추가
  let prTestSuccessCondition = '';
  if (check.mustRun && requiredPrTests.length > 0) {
    const prTestConditions = requiredPrTests.map(
      (pt) => `needs.${pt.name}.result == 'success'`
    );
    prTestSuccessCondition = `
      (needs.check-trigger.outputs.trigger != '${input.ciTrigger}' || (${prTestConditions.join(' && ')})) &&`;
  }

  const runsOn = formatRunner(input.runner);

  // Docker 체크 스텝 (selfHosted + docker일 때)
  const dockerStep = selfHosted?.docker
    ? `${generateDockerCheckStep()}\n\n`
    : '';

  // Diff 가져오기 스텝
  const diffSteps = generateDiffSteps(config);

  return `  # ${check.name}
  ${jobId}:
    if: |
      always() &&
      needs.check-trigger.outputs.should_continue == 'true' &&${prTestSuccessCondition}
      (${runConditions.join(' || ')})
    needs: [${dependencies.join(', ')}]
    runs-on: ${runsOn}
    permissions:
      contents: read
      pull-requests: write
      statuses: write

    steps:
${dockerStep}${diffSteps}

      - name: Set pending status
        run: |
          HEAD_SHA="\${{ needs.check-trigger.outputs.head_sha }}"
          curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            -H "Content-Type: application/json" \\
            -X POST "\${{ github.api_url }}/repos/\${{ github.repository }}/statuses/\$HEAD_SHA" \\
            -d '{"state":"pending","context":"${check.name}","description":"${STATUS_MESSAGES.pending.inProgress}"}'

${generateReviewStep(check)}

      - name: Set final status
        run: |
          HEAD_SHA="\${{ needs.check-trigger.outputs.head_sha }}"
${check.provider === 'cli' ? `
          # CLI provider는 항상 success
          STATE="success"
          DESC="${STATUS_MESSAGES.success.passed}"` : `
          if [ "\${{ steps.ai-check.outputs.result }}" = "pass" ]; then
            STATE="success"
            DESC="${STATUS_MESSAGES.success.passed}"
          else
            STATE="failure"
            DESC="${STATUS_MESSAGES.failure.failed}"
          fi`}

          curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            -H "Content-Type: application/json" \\
            -X POST "\${{ github.api_url }}/repos/\${{ github.repository }}/statuses/\$HEAD_SHA" \\
            -d "{\\"state\\":\\"\$STATE\\",\\"context\\":\\"${check.name}\\",\\"description\\":\\"\$DESC\\"}"

      - name: Collapse old review comments
        run: |
          PR_NUMBER="\${{ needs.check-trigger.outputs.pr_number }}"
          HEAD_SHA="\${{ needs.check-trigger.outputs.head_sha }}"
          SHORT_SHA="\${HEAD_SHA:0:7}"

${indent(generateCollapsePrReviewCommentsScript(check.name), 10)}

      - name: Post PR comment
        run: |
          REVIEW=\$(cat review.txt)

          # GitHub uses run_id in URL, Gitea uses run_number
          if [[ "\${{ github.server_url }}" == *"github.com"* ]]; then
            RUN_URL="\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}"
          else
            ACTUAL_RUN_NUMBER=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
              "\${{ github.api_url }}/repos/\${{ github.repository }}/actions/runs/\${{ github.run_id }}" \\
              | jq -r '.run_number // empty' 2>/dev/null)
            if [ -n "\$ACTUAL_RUN_NUMBER" ]; then
              RUN_URL="\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\$ACTUAL_RUN_NUMBER"
            else
              RUN_URL="\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}"
            fi
          fi

          HEAD_SHA="\${{ needs.check-trigger.outputs.head_sha }}"
          SHORT_SHA="\${HEAD_SHA:0:7}"
${check.provider === 'cli' ? `
          # CLI provider: 단순 리뷰 내용만 표시 (✅ 형식으로 접기 패턴과 일치)
          {
            echo "## ✅ ${check.name}"
            echo ""
            echo "\${REVIEW}"
            echo ""
            echo "---"
            echo "🔗 [상세 로그](\${RUN_URL}) | 📅 \$(date '+%Y-%m-%d %H:%M:%S') | 📌 \${SHORT_SHA}"
            echo ""
            echo "🛠️ CLI: ${check.cliTool} | ${check.trigger} 명령에 대한 응답"
          } > comment.txt` : `
          RESULT="\${{ steps.ai-check.outputs.result }}"

          # 위험도별 개수 세기
          CRITICAL=\$(echo "\$REVIEW" | grep -c "🔴" || true)
          WARNING=\$(echo "\$REVIEW" | grep -c "🟡" || true)
          INFO=\$(echo "\$REVIEW" | grep -c "🟢" || true)

          if [ "\$RESULT" = "pass" ]; then
            EMOJI="✅"
            STATUS="PASS"
          else
            EMOJI="❌"
            STATUS="FAIL"
          fi

          {
            echo "## \${EMOJI} ${check.name} - \${STATUS}"
            echo "🔴 \${CRITICAL} | 🟡 \${WARNING} | 🟢 \${INFO}"
            echo ""
            echo "${COMMENT_MARKERS.detailsOpen}"
            echo "<summary>상세 내용</summary>"
            echo ""
            echo "\${REVIEW}"
            echo ""
            echo "---"
            echo "🔗 [상세 로그](\${RUN_URL}) | 📅 \$(date '+%Y-%m-%d %H:%M:%S') | 📌 \${SHORT_SHA}"
            echo ""
            echo "🤖 Model: ${check.model} | ${check.trigger} 명령에 대한 응답"
            echo "</details>"
          } > comment.txt`}

          BODY=\$(jq -Rs '.' comment.txt)
          curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            -H "Content-Type: application/json" \\
            -X POST "\${{ github.api_url }}/repos/\${{ github.repository }}/issues/\${{ needs.check-trigger.outputs.pr_number }}/comments" \\
            -d "{\\"body\\": \$BODY}"`;
}
