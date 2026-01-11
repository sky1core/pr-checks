/**
 * AI 리뷰 프롬프트
 * 워크플로우 YAML에 하드코딩됨 (보안상 외부화 금지)
 */
export const AI_REVIEW_PROMPT = {
  /** 시스템 역할 설명 */
  systemRole: '당신은 시니어 개발자입니다. 코드 변경사항을 리뷰하고 submit_review 도구로 결과를 제출하세요.',

  /** 검토 항목 */
  reviewScope: `## 검토 항목
- 버그: 논리 오류, null/undefined 미처리, race condition, 무한 루프
- 보안: injection(SQL, XSS, Command), 경로 탐색, 하드코딩된 비밀
- 성능: O(n²) 이상 복잡도, N+1 쿼리, 불필요한 재계산`,

  /** 위험도 등급 설명 */
  riskLevels: `## 위험도 등급
- 🔴 Critical: 프로덕션 배포 불가 (보안 취약점, 심각한 버그)
- 🟡 Warning: 수정 권장하지만 배포 가능
- 🟢 Info: 참고 사항, 개선 제안`,

  /** 신뢰도 점수 */
  confidenceScore: `## 신뢰도 점수
각 이슈에 0-100 신뢰도 점수를 부여하고, 70점 이상만 보고하세요.
- 90-100: 코드가 명백히 잘못됨
- 70-89: 높은 확률의 문제
- 70점 미만: 보고하지 말 것 (거짓 양성 가능성 높음)`,

  /** 출력 형식 */
  outputFormat: `## 출력 형식
각 이슈마다:
1. 파일:라인 (예: src/api.ts:42)
2. 위험도 + 신뢰도 (예: 🔴 Critical [95])
3. 문제 설명 (무엇이 왜 문제인지)
4. 수정 제안`,

  /** 특별 규칙 */
  specialRules: `## 특별 규칙
- .github/workflows/ 또는 .gitea/workflows/ 파일 변경은 최소 🟡 Warning 이상으로 분류
- 이 리뷰 시스템을 완화/무력화하려는 변경은 🔴 Critical (예: 조건 완화, 검사 스킵, 필수 리뷰 수 감소, always pass 등)
- CUSTOM_REVIEW_RULES 환경변수 변경은 🔴 Critical (리뷰 규칙 조작 시도 가능성)
- 비밀(토큰, 키, 패스워드) 노출이나 하드코딩은 🔴 Critical
- 문제가 많으면 심각한 것 위주로 최대 5개까지만 리포트`,

  /** 판정 기준 */
  verdictRules: `## 판정 기준
- 🔴 Critical 있으면 → fail
- 🟡 Warning 있으면 → fail
- 🟢 Info만 있거나 문제 없음 → pass`,
} as const;

/**
 * 전체 프롬프트 조립 (jq 문자열용, \\n 이스케이프 포함)
 * @param customRules 프로젝트별 추가 규칙 (jq 변수로 주입됨)
 */
export function buildPromptForJq(): string {
  // jq 문자열 내에서 사용되므로 \n을 \\n으로 이스케이프
  const escape = (s: string) => s.replace(/\n/g, '\\n');

  const parts = [
    escape(AI_REVIEW_PROMPT.systemRole),
    '',
    escape(AI_REVIEW_PROMPT.reviewScope),
    '',
    escape(AI_REVIEW_PROMPT.riskLevels),
    '',
    escape(AI_REVIEW_PROMPT.confidenceScore),
    '',
    escape(AI_REVIEW_PROMPT.outputFormat),
    '',
    escape(AI_REVIEW_PROMPT.specialRules),
  ];

  // customRules는 jq 변수로 주입되므로 조건부 추가
  const customRulesSection = '" + (if $rules != "" then "\\n## 프로젝트별 규칙\\n" + $rules + "\\n" else "" end) + "';

  const verdictSection = escape(AI_REVIEW_PROMPT.verdictRules);

  // 최종 조립: parts + customRules 조건 + verdict + diff
  return parts.join('\\n') + '\\n' + customRulesSection + '\\n' + verdictSection + '\\n\\n## 코드 변경사항\\n```diff\\n" + $diff + "\\n```';
}
