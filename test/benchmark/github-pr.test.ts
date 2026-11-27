import { describe, expect, it } from 'vitest';

import { fromInline } from '../../benchmark/runners/github-pr';

const comment = (over: Record<string, unknown>): Parameters<typeof fromInline>[0] =>
  ({
    user: { login: 'proofline' },
    path: 'cases/abc12345/lib/response.js',
    line: 821,
    original_line: 821,
    body: 'This loses the callback.',
    ...over,
  }) as Parameters<typeof fromInline>[0];

describe('fromInline', () => {
  it('strips the published slug prefix', () => {
    expect(fromInline(comment({}), 'proofline', 'express-16', 'abc12345').path).toBe(
      'lib/response.js',
    );
  });

  it('keeps the line for a comment on the new side', () => {
    expect(fromInline(comment({ side: 'RIGHT' }), 'proofline', 'express-16', 'abc12345').line).toBe(
      821,
    );
  });

  it('treats a missing side as the new side, which is the GitHub default', () => {
    expect(fromInline(comment({}), 'proofline', 'express-16', 'abc12345').line).toBe(821);
  });

  it('drops the line for a comment on a removed line', () => {
    // Old file line 821 is a different line of the new file. Scoring it
    // against new file ground truth would credit a catch nobody made.
    const finding = fromInline(comment({ side: 'LEFT' }), 'proofline', 'express-16', 'abc12345');

    expect(finding.line).toBeNull();
    expect(finding.path).toBe('lib/response.js');
    expect(finding.title).toBe('This loses the callback.');
  });

  it('falls back to original_line when line is null on the new side', () => {
    expect(
      fromInline(comment({ line: null, side: 'RIGHT' }), 'proofline', 'express-16', 'abc12345').line,
    ).toBe(821);
  });

  it('leaves a path that does not carry this case slug alone', () => {
    const finding = fromInline(
      comment({ path: 'cases/99999999/lib/response.js' }),
      'proofline',
      'express-16',
      'abc12345',
    );

    expect(finding.path).toBe('cases/99999999/lib/response.js');
  });
});
