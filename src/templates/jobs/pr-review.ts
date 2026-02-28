import type { Config, PrReviewCheck, PrTestCheck, CliTool, CliReviewParser } from '../../types/config.js';
import { STATUS_MESSAGES } from '../constants/messages.js';
import { COMMENT_MARKERS } from '../constants/comments.js';
import {
  buildPromptForJq,
  CLI_REVIEW_JSON_PROMPT,
  CLI_REVIEW_VERDICT_PROMPT,
} from '../constants/prompts.js';
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

          # 사용자 추가 메시지 (base64 디코딩)
          USER_MESSAGE_B64="\${{ needs.check-trigger.outputs.user_message }}"
          USER_MESSAGE=""
          if [ -n "\$USER_MESSAGE_B64" ]; then
            USER_MESSAGE=\$(printf '%s' "\$USER_MESSAGE_B64" | base64 -d 2>/dev/null || echo "")
          fi
          if [ -n "\$USER_MESSAGE" ]; then
            CUSTOM_RULES=\$(printf '%s\\n\\n[USER REQUEST]\\n%s\\n[END USER REQUEST]' "\$CUSTOM_RULES" "\$USER_MESSAGE")
          fi

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
                              "enum": ["critical", "warning", "ok"],
                              "description": "리뷰 결과 (critical: 심각한 문제, warning: 경고, ok: 문제 없음)"
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
          TOOL_INPUT=\$(printf '%s' "\$RESPONSE" | jq -r '.output.message.content[0].toolUse.input // empty')

          if [ -z "\$TOOL_INPUT" ]; then
            ERROR_MSG=\$(printf '%s' "\$RESPONSE" | jq -r '.message // .error // empty')
            if [ -z "\$ERROR_MSG" ]; then
              ERROR_MSG="알 수 없는 오류"
            fi
            echo "API 호출 실패: \$ERROR_MSG"
            echo "\$RESPONSE" > review.txt
            RESULT="critical"
            SUMMARY="API 호출 실패: \$ERROR_MSG"
          else
            RESULT=\$(printf '%s' "\$TOOL_INPUT" | jq -r '.result // "critical"')
            DETAILS=\$(printf '%s' "\$TOOL_INPUT" | jq -r '.details // "No details"')
            echo "\$DETAILS" > review.txt

            case "\$RESULT" in
              critical) SUMMARY="Critical issues found" ;;
              warning) SUMMARY="Warnings found" ;;
              ok) SUMMARY="No issues found" ;;
              *) SUMMARY="Review completed" ;;
            esac
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

type ResolvedCliParser = Exclude<CliReviewParser, 'auto'>;

/**
 * CLI 파서 모드 결정
 * - auto: claude/codex/json, gemini/kiro/verdict
 * - cliCommand는 auto일 때 json 기본
 */
function resolveCliParser(check: PrReviewCheck): ResolvedCliParser {
  const parser = check.parser ?? 'auto';

  if (parser === 'json' || parser === 'verdict') {
    return parser;
  }

  // auto 모드
  if (check.cliCommand) {
    return 'json';
  }

  switch (check.cliTool) {
    case 'claude':
    case 'codex':
      return 'json';
    case 'gemini':
    case 'kiro':
      return 'verdict';
    default:
      // validation에서 이미 차단되지만 안전장치로 json 기본
      return 'json';
  }
}

/**
 * VERDICT 마커 파서 스크립트 생성
 */
function generateVerdictParseScript(reviewFile: string): string {
  return `          # VERDICT 마커 우선, 없으면 이모지 카운트로 판정
          if grep -q "<<<VERDICT:CRITICAL>>>" "${reviewFile}"; then
            echo "result=critical" >> \$GITHUB_OUTPUT
          elif grep -q "<<<VERDICT:WARNING>>>" "${reviewFile}"; then
            echo "result=warning" >> \$GITHUB_OUTPUT
          elif grep -q "<<<VERDICT:OK>>>" "${reviewFile}"; then
            echo "result=ok" >> \$GITHUB_OUTPUT
          elif [ \$EXIT_CODE -ne 0 ]; then
            echo "result=critical" >> \$GITHUB_OUTPUT
          else
            # 마커 없으면 이모지 카운트로 판정
            CRITICAL_COUNT=\$(grep -c "🔴" "${reviewFile}" || true)
            WARNING_COUNT=\$(grep -c "🟡" "${reviewFile}" || true)
            if [ "\$CRITICAL_COUNT" -gt 0 ]; then
              echo "result=critical" >> \$GITHUB_OUTPUT
            elif [ "\$WARNING_COUNT" -gt 0 ]; then
              echo "result=warning" >> \$GITHUB_OUTPUT
            else
              echo "result=ok" >> \$GITHUB_OUTPUT
            fi
          fi

          # 출력에서 VERDICT 마커 제거 (댓글에는 표시 안 함)
          perl -pi -e 's/<<<VERDICT:(CRITICAL|WARNING|OK)>>>//g' "${reviewFile}"`;
}

/**
 * JSON 파서 스크립트 생성
 */
function generateJsonParseScript(rawOutputFile: string, rawErrorFile: string, reviewFile: string): string {
  return `          # parser=json: 구조화 출력(JSON)만 허용
          if [ \$EXIT_CODE -ne 0 ]; then
            echo "result=critical" >> \$GITHUB_OUTPUT
            {
              echo "CLI command failed (exit code: \$EXIT_CODE)"
              echo ""
              echo "--- Raw Output ---"
              cat "${rawOutputFile}"
              if [ -s "${rawErrorFile}" ]; then
                echo ""
                echo "--- STDERR ---"
                cat "${rawErrorFile}"
              fi
            } > "${reviewFile}"
          elif jq -e 'type == "object" and (.result | type == "string") and (.details | type == "string") and (.result == "critical" or .result == "warning" or .result == "ok")' "${rawOutputFile}" > /dev/null 2>&1; then
            RESULT=\$(jq -r '.result' "${rawOutputFile}")
            DETAILS=\$(jq -r '.details' "${rawOutputFile}")
            echo "\$DETAILS" > "${reviewFile}"
            echo "result=\$RESULT" >> \$GITHUB_OUTPUT
          else
            echo "result=critical" >> \$GITHUB_OUTPUT
            {
              echo "JSON 파싱 실패: parser=json 모드에서는 {\\"result\\":\\"critical|warning|ok\\",\\"details\\":\\"...\\"} 형식만 허용됩니다."
              echo ""
              echo "--- Raw Output ---"
              cat "${rawOutputFile}"
              if [ -s "${rawErrorFile}" ]; then
                echo ""
                echo "--- STDERR ---"
                cat "${rawErrorFile}"
              fi
            } > "${reviewFile}"
          fi`;
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
  const parserMode = resolveCliParser(check);

  const cliPrompt = parserMode === 'json' ? CLI_REVIEW_JSON_PROMPT : CLI_REVIEW_VERDICT_PROMPT;
  // 프롬프트를 한 줄로 이스케이프 (bash $'...' 문법용)
  const promptOneLine = cliPrompt
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n');

  const rawErrorSetup = parserMode === 'json'
    ? '          RAW_ERROR_FILE="review.stderr.txt"\n'
    : '';
  const executeCommand = parserMode === 'json'
    ? `echo "\$PROMPT" | ${cliCommand} > "\$RAW_OUTPUT_FILE" 2> "\$RAW_ERROR_FILE"`
    : `echo "\$PROMPT" | ${cliCommand} > "\$RAW_OUTPUT_FILE" 2>&1`;
  const parseScript = parserMode === 'json'
    ? generateJsonParseScript('$RAW_OUTPUT_FILE', '$RAW_ERROR_FILE', 'review.txt')
    : generateVerdictParseScript('review.txt');
  const cleanupScript = parserMode === 'json'
    ? '          rm -f "$RAW_OUTPUT_FILE" "$RAW_ERROR_FILE"'
    : '          rm -f "$RAW_OUTPUT_FILE"';

  return `      - name: Run AI Review (${cliTool})
        id: ai-check
        run: |
          echo "🤖 AI 코드 리뷰 실행 중 (${cliTool})..."

          DIFF_CONTENT=\$(cat diff.txt)
          CUSTOM_RULES="${escapedCustomRules}"

          # 사용자 추가 메시지 (base64 디코딩)
          USER_MESSAGE_B64="\${{ needs.check-trigger.outputs.user_message }}"
          USER_MESSAGE=""
          if [ -n "\$USER_MESSAGE_B64" ]; then
            USER_MESSAGE=\$(printf '%s' "\$USER_MESSAGE_B64" | base64 -d 2>/dev/null || echo "")
          fi

          # 사용자 추가 메시지가 있으면 프롬프트에 포함
          USER_PROMPT=""
          if [ -n "\$USER_MESSAGE" ]; then
            USER_PROMPT=\$'\\n\\n=== USER REQUEST ===\\n'\$USER_MESSAGE\$'\\n=== END USER REQUEST ==='
          fi

          # CLI로 리뷰 실행
          PROMPT=\$'${promptOneLine}\\n\\n'\$CUSTOM_RULES\$USER_PROMPT\$'\\n\\n=== DIFF ===\\n'\$DIFF_CONTENT\$'\\n=== END DIFF ==='

          # exit code 캡처 (실패해도 출력은 저장)
          RAW_OUTPUT_FILE="review.raw.txt"
${rawErrorSetup}          # parser=json이면 stdout/stderr 분리, verdict면 기존처럼 결합
          set +e
          ${executeCommand}
          EXIT_CODE=\$?
          set -e

          cp "\$RAW_OUTPUT_FILE" review.txt

${parseScript}

${cleanupScript}`;
}

/**
 * 커스텀 명령어 리뷰 스텝 생성
 * - PR 번호만 인자로 전달
 * - 명령어가 diff, 프롬프트, LLM 호출 모두 처리
 * - exit 0 = pass, exit 1 = fail
 */
function generateCustomCommandReviewStep(check: PrReviewCheck, config: Config): string {
  const command = check.cliCommand!;
  const { selfHosted } = config.input;
  const parserMode = resolveCliParser(check);

  // selfHosted는 repo 서브디렉토리로 클론
  const workingDir = selfHosted ? '\n        working-directory: repo' : '';

  const rawErrorSetup = parserMode === 'json'
    ? '          RAW_ERROR_FILE="${{ github.workspace }}/review.stderr.txt"\n'
    : '';
  const executeCommand = parserMode === 'json'
    ? `${command} "\$PR_NUMBER" "\$USER_MESSAGE" > "\$RAW_OUTPUT_FILE" 2> "\$RAW_ERROR_FILE"`
    : `${command} "\$PR_NUMBER" "\$USER_MESSAGE" > "\$RAW_OUTPUT_FILE" 2>&1`;
  const parseScript = parserMode === 'json'
    ? generateJsonParseScript('$RAW_OUTPUT_FILE', '$RAW_ERROR_FILE', '$REVIEW_FILE')
    : generateVerdictParseScript('$REVIEW_FILE');
  const cleanupScript = parserMode === 'json'
    ? '          rm -f "$RAW_OUTPUT_FILE" "$RAW_ERROR_FILE"'
    : '          rm -f "$RAW_OUTPUT_FILE"';

  return `      - name: Run AI Review (custom)
        id: ai-check${workingDir}
        run: |
          PR_NUMBER="\${{ needs.check-trigger.outputs.pr_number }}"
          echo "🤖 AI 코드 리뷰 실행 중 (custom command)..."

          # 사용자 추가 메시지 (base64 디코딩)
          USER_MESSAGE_B64="\${{ needs.check-trigger.outputs.user_message }}"
          USER_MESSAGE=""
          if [ -n "\$USER_MESSAGE_B64" ]; then
            USER_MESSAGE=\$(printf '%s' "\$USER_MESSAGE_B64" | base64 -d 2>/dev/null || echo "")
          fi

          # 커스텀 명령어 실행 (PR 번호 + 추가 메시지)
          # review.txt는 workspace에 저장 (다른 step에서 접근 가능하도록)
          REVIEW_FILE="\${{ github.workspace }}/review.txt"
          RAW_OUTPUT_FILE="\${{ github.workspace }}/review.raw.txt"
${rawErrorSetup}          # parser=json이면 stdout/stderr 분리, verdict면 기존처럼 결합
          set +e
          ${executeCommand}
          EXIT_CODE=\$?
          set -e

          cp "\$RAW_OUTPUT_FILE" "\$REVIEW_FILE"

${parseScript}

${cleanupScript}`;
}

/**
 * AI 리뷰 스텝 생성 (provider에 따라 다른 구현)
 */
function generateReviewStep(check: PrReviewCheck, config: Config): string {
  if (check.provider === 'bedrock') {
    return generateBedrockReviewStep(check);
  }
  if (check.provider === 'cli') {
    // cliCommand가 있으면 커스텀 명령어 사용
    if (check.cliCommand) {
      return generateCustomCommandReviewStep(check, config);
    }
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
  const diffStepId = selfHosted ? 'git-diff' : 'diff';

  // 실행 조건: 개별 트리거, ciTrigger(mustRun일 때), 자동 실행
  const runConditions = [
    `needs.check-trigger.outputs.trigger == '${check.trigger}'`,
  ];
  if (check.mustRun) {
    runConditions.push(`needs.check-trigger.outputs.trigger == '${input.ciTrigger}'`);
  }
  runConditions.push(`needs.check-trigger.outputs.auto_run_${check.name} == 'true'`);

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

  // 커스텀 명령어는 diff를 직접 처리하므로 diff 생성만 스킵
  const useCustomCommand = check.provider === 'cli' && check.cliCommand;

  // Checkout/Diff 스텝
  let diffSteps: string;
  if (useCustomCommand) {
    // 커스텀 명령어: checkout만 (diff는 직접 처리)
    if (selfHosted) {
      diffSteps = `${generateRepoCacheStep(config)}

${generatePrFetchStep()}`;
    } else {
      diffSteps = `      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: refs/pull/\${{ needs.check-trigger.outputs.pr_number }}/head
          submodules: recursive`;
    }
  } else {
    diffSteps = generateDiffSteps(config);
  }

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
        if: needs.check-trigger.outputs.is_official == 'true'
        run: |
          HEAD_SHA="\${{ needs.check-trigger.outputs.head_sha }}"
          curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
            -H "Content-Type: application/json" \\
            -X POST "\${{ github.api_url }}/repos/\${{ github.repository }}/statuses/\$HEAD_SHA" \\
            -d '{"state":"pending","context":"${check.name}","description":"${STATUS_MESSAGES.pending.inProgress}"}'

${generateReviewStep(check, config)}

      - name: Set final status
        if: needs.check-trigger.outputs.is_official == 'true'
        run: |
          HEAD_SHA="\${{ needs.check-trigger.outputs.head_sha }}"
          RESULT="\${{ steps.ai-check.outputs.result }}"

          # 3단계 판정: critical=failure, warning/ok=success
          case "\$RESULT" in
            critical)
              STATE="failure"
              DESC="Critical issues found"
              ;;
            warning)
              STATE="success"
              DESC="Warnings found (review recommended)"
              ;;
            ok)
              STATE="success"
              DESC="No issues found"
              ;;
            *)
              STATE="failure"
              DESC="Review failed"
              ;;
          esac

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
          # ANSI escape code 제거 (색상, 커서 제어 등 모든 CSI/OSC 시퀀스)
          REVIEW=\$(perl -pe 's/\\x1B\\[[0-?]*[ -\\/]*[\\@-~]//g; s/\\x1B\\][^\\x07]*\\x07//g; s/\\x1B[()][0-2]//g' review.txt)

          # GitHub uses run_id in URL, Gitea uses run_number
          if [[ "\${{ github.server_url }}" == *"github.com"* ]]; then
            RUN_URL="\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}"
          else
            RUN_RAW=\$(curl -sf -H "Authorization: token \${{ secrets.GITHUB_TOKEN }}" \\
              "\${{ github.api_url }}/repos/\${{ github.repository }}/actions/runs/\${{ github.run_id }}" 2>/dev/null) || RUN_RAW=""
            ACTUAL_RUN_NUMBER=\$(printf '%s' "\$RUN_RAW" | jq -r '.run_number // empty' 2>/dev/null)
            if [ -n "\$ACTUAL_RUN_NUMBER" ]; then
              RUN_URL="\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\$ACTUAL_RUN_NUMBER"
            else
              RUN_URL="\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}"
            fi
          fi

          HEAD_SHA="\${{ needs.check-trigger.outputs.head_sha }}"
          SHORT_SHA="\${HEAD_SHA:0:7}"

          # Runner 환경 판별
          if [[ "\${{ runner.name }}" == "GitHub Actions"* ]]; then
            RUNNER_TYPE="☁️ Hosted"
          else
            RUNNER_TYPE="🏠 Self-hosted"
          fi

${useCustomCommand ? `          DIFF_DISPLAY=""` : `          # Diff 크기 (KB 단위로 표시)
          DIFF_SIZE="\${{ steps.${diffStepId}.outputs.diff_size }}"
          if [ -n "\$DIFF_SIZE" ] && [ "\$DIFF_SIZE" -gt 0 ] 2>/dev/null; then
            if [ "\$DIFF_SIZE" -ge 1024 ]; then
              DIFF_KB=\$(awk "BEGIN {printf \\"%.1f\\", \$DIFF_SIZE / 1024}")
              DIFF_DISPLAY="📊 \${DIFF_KB}KB"
            else
              DIFF_DISPLAY="📊 \${DIFF_SIZE}B"
            fi
          else
            DIFF_DISPLAY=""
          fi`}

          # 비공식 실행 여부
          IS_OFFICIAL="\${{ needs.check-trigger.outputs.is_official }}"

          # 사용자 추가 메시지 (base64 디코딩)
          USER_MESSAGE_B64="\${{ needs.check-trigger.outputs.user_message }}"
          USER_MESSAGE=""
          if [ -n "\$USER_MESSAGE_B64" ]; then
            USER_MESSAGE=\$(printf '%s' "\$USER_MESSAGE_B64" | base64 -d 2>/dev/null || echo "")
          fi
${check.provider === 'cli' ? `
          # CLI provider: 3단계 판정
          RESULT="\${{ steps.ai-check.outputs.result }}"
          case "\$RESULT" in
            critical)
              EMOJI="❌"
              STATUS="CRITICAL"
              ;;
            warning)
              EMOJI="⚠️"
              STATUS="WARNING"
              ;;
            ok)
              EMOJI="✅"
              STATUS="OK"
              ;;
            *)
              EMOJI="❓"
              STATUS="UNKNOWN"
              ;;
          esac

          # Metadata for comment tracking
          METADATA="<!-- pr-checks:{\\"type\\":\\"pr-review\\",\\"check\\":\\"${check.name}\\",\\"sha\\":\\"\${HEAD_SHA}\\",\\"collapsed\\":false} -->"

          {
            echo "\$METADATA"
            echo "## \${EMOJI} ${check.name} - \${STATUS}"
            if [ "\$IS_OFFICIAL" = "false" ]; then
              echo ""
              echo "> ⚠️ **비공식 실행**: 추가 메시지가 포함되어 mustRun/mustPass 체크에 반영되지 않습니다."
              echo "> 📝 요청: \${USER_MESSAGE}"
            fi
            echo ""
            echo "${COMMENT_MARKERS.detailsOpen}"
            echo "<summary>상세 내용</summary>"
            echo ""
            echo "\${REVIEW}"
            echo ""
            echo "---"
            echo "🔗 [상세 로그](\${RUN_URL}) | 📅 \$(date '+%Y-%m-%d %H:%M:%S') | 📌 \${SHORT_SHA} | \${RUNNER_TYPE}\${DIFF_DISPLAY:+ | \$DIFF_DISPLAY}"
            echo ""
            echo "🛠️ CLI: ${check.cliCommand ? 'custom' : check.cliTool} | ${check.trigger} 명령에 대한 응답"
            echo "</details>"
          } > comment.txt` : `
          RESULT="\${{ steps.ai-check.outputs.result }}"

          # 위험도별 개수 세기
          CRITICAL=\$(echo "\$REVIEW" | grep -c "🔴" || true)
          WARNING=\$(echo "\$REVIEW" | grep -c "🟡" || true)
          INFO=\$(echo "\$REVIEW" | grep -c "🟢" || true)

          # 3단계 판정
          case "\$RESULT" in
            critical)
              EMOJI="❌"
              STATUS="CRITICAL"
              ;;
            warning)
              EMOJI="⚠️"
              STATUS="WARNING"
              ;;
            ok)
              EMOJI="✅"
              STATUS="OK"
              ;;
            *)
              EMOJI="❓"
              STATUS="UNKNOWN"
              ;;
          esac

          # Metadata for comment tracking
          METADATA="<!-- pr-checks:{\\"type\\":\\"pr-review\\",\\"check\\":\\"${check.name}\\",\\"sha\\":\\"\${HEAD_SHA}\\",\\"collapsed\\":false} -->"

          {
            echo "\$METADATA"
            echo "## \${EMOJI} ${check.name} - \${STATUS}"
            if [ "\$IS_OFFICIAL" = "false" ]; then
              echo ""
              echo "> ⚠️ **비공식 실행**: 추가 메시지가 포함되어 mustRun/mustPass 체크에 반영되지 않습니다."
              echo "> 📝 요청: \${USER_MESSAGE}"
            fi
            echo "🔴 \${CRITICAL} | 🟡 \${WARNING} | 🟢 \${INFO}"
            echo ""
            echo "${COMMENT_MARKERS.detailsOpen}"
            echo "<summary>상세 내용</summary>"
            echo ""
            echo "\${REVIEW}"
            echo ""
            echo "---"
            echo "🔗 [상세 로그](\${RUN_URL}) | 📅 \$(date '+%Y-%m-%d %H:%M:%S') | 📌 \${SHORT_SHA} | \${RUNNER_TYPE}\${DIFF_DISPLAY:+ | \$DIFF_DISPLAY}"
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
