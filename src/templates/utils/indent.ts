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
