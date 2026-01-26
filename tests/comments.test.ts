import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { COMMENT_MARKERS, METADATA_PREFIX, METADATA_SUFFIX } from '../src/templates/constants/comments.js';

describe('COMMENT_MARKERS', () => {
  describe('collapsiblePattern', () => {
    const testMetadata = `${METADATA_PREFIX}{"type":"pr-test","check":"test","sha":"abc123","collapsed":false}${METADATA_SUFFIX}`;

    it('메타데이터 패턴이 jq test()에서 작동해야 함', () => {
      const pattern = COMMENT_MARKERS.collapsiblePattern('test');

      // bash에서 jq로 패턴 테스트 (! 이스케이프 문제 검증)
      const result = execSync(
        `echo '${testMetadata}' | jq -R 'test("${pattern}")'`,
        { encoding: 'utf-8', shell: '/bin/bash' }
      ).trim();

      expect(result).toBe('true');
    });

    it('collapsed:true인 코멘트는 매칭되지 않아야 함', () => {
      const collapsedMetadata = `${METADATA_PREFIX}{"type":"pr-test","check":"test","sha":"abc123","collapsed":true}${METADATA_SUFFIX}`;
      const pattern = COMMENT_MARKERS.collapsiblePattern('test');

      const result = execSync(
        `echo '${collapsedMetadata}' | jq -R 'test("${pattern}")'`,
        { encoding: 'utf-8', shell: '/bin/bash' }
      ).trim();

      expect(result).toBe('false');
    });

    it('다른 체크 이름은 매칭되지 않아야 함', () => {
      const pattern = COMMENT_MARKERS.collapsiblePattern('lint');

      const result = execSync(
        `echo '${testMetadata}' | jq -R 'test("${pattern}")'`,
        { encoding: 'utf-8', shell: '/bin/bash' }
      ).trim();

      expect(result).toBe('false');
    });
  });

});
