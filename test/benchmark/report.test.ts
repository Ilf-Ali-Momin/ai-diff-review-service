import { describe, expect, it } from 'vitest';

import { mergeTriage, type TriageEntry } from '../../benchmark/report';

const entry = (key: string, label: TriageEntry['label']): TriageEntry => ({
  key,
  reviewer: 'diff-review-service',
  caseId: 'express-3',
  location: 'lib/router.js:40',
  title: 'something',
  code: 'const x = 1;',
  label,
  present: true,
});

describe('mergeTriage', () => {
  it('keeps a labelled entry whose finding this report did not produce', () => {
    const merged = mergeTriage([entry('gone', 'valid')], [entry('here', null)]);

    expect(merged.map((e) => e.key)).toEqual(['here', 'gone']);
    expect(merged.find((e) => e.key === 'gone')).toMatchObject({ label: 'valid', present: false });
  });

  it('drops an unlabelled entry whose finding this report did not produce', () => {
    const merged = mergeTriage([entry('gone', null)], [entry('here', null)]);

    expect(merged.map((e) => e.key)).toEqual(['here']);
  });

  it('does not duplicate an entry the report produced again', () => {
    const merged = mergeTriage([entry('here', 'noise')], [entry('here', 'noise')]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ key: 'here', present: true });
  });

  it('leaves the current entries untouched', () => {
    const current = [entry('a', 'valid'), entry('b', null)];

    expect(mergeTriage([], current)).toEqual(current);
  });
});
