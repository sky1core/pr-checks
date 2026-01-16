/**
 * 문자열의 각 줄에 들여쓰기 추가
 * @param text 원본 문자열
 * @param spaces 들여쓰기 공백 수
 */
export function indent(text: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line ? prefix + line : line))
    .join('\n');
}

/**
 * Runner를 YAML runs-on 형식으로 포맷
 * @param runner 문자열 또는 문자열 배열
 */
export function formatRunner(runner: string | string[]): string {
  if (Array.isArray(runner)) {
    return `[${runner.join(', ')}]`;
  }
  return runner;
}
