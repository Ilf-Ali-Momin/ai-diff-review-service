/**
 * Checks benchmark/PROOFLINE_FEEDBACK.md against itself.
 *
 * That document has been its own worst area: the counts disagreed with the
 * entries, the ledger disagreed with a verdict, entries named no commit, and
 * each time the repair was another hand correction that the next review found
 * wrong again. Hand corrections are what kept failing, so the invariants are
 * asserted here instead: the ledger and the prose have to agree, or the suite
 * goes red.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BENCH_DIR } from '../../benchmark/core/io';

const DOC = readFileSync(join(BENCH_DIR, 'PROOFLINE_FEEDBACK.md'), 'utf8');

type Row = {
  key: string;
  entries: string[];
  reports: number;
  rounds: number[];
  disposition: string;
  commit: string;
};

const rows: Row[] = [...DOC.matchAll(/^\| ([\d, ]+) \| (.+?) \| (\d+) \| ([\d, ]+) \| (.+?) \| (.+?) \|$/gm)].map(
  (m) => ({
    key: (m[1] as string).trim(),
    entries: (m[1] as string).split(',').map((n) => n.trim()),
    reports: Number(m[3]),
    rounds: (m[4] as string).split(',').map((n) => Number(n.trim())),
    disposition: (m[5] as string).trim(),
    commit: (m[6] as string).trim(),
  }),
);

/** Each numbered entry's body, from its heading to the next one. */
const bodies = new Map<string, string>();
for (const m of DOC.matchAll(/^### (\d+)\. [^\n]*\n([\s\S]*?)(?=^### |^## )/gm)) {
  bodies.set(m[1] as string, m[2] as string);
}

describe('PROOFLINE_FEEDBACK.md agrees with its own ledger', () => {
  it('has a ledger', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it('numbers entries consecutively from 1', () => {
    const numbers = [...bodies.keys()].map(Number).sort((a, b) => a - b);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it('has a prose entry for every number the ledger names, and no orphans', () => {
    const inLedger = rows.flatMap((r) => r.entries).sort((a, b) => Number(a) - Number(b));
    const inProse = [...bodies.keys()].sort((a, b) => Number(a) - Number(b));

    expect(inLedger).toEqual(inProse);
  });

  it('states a commit in every entry', () => {
    for (const [number, body] of bodies) {
      expect(body, `entry ${number}`).toMatch(/\*\*Commit:\*\* /);
    }
  });

  it('agrees with each entry on the disposition', () => {
    for (const row of rows) {
      const first = bodies.get(row.entries[0] as string) ?? '';
      const verdict = /\*\*Verdict:\*\* ([^\n]+)/.exec(first)?.[1] ?? '';

      if (row.disposition === 'rejected') {
        expect(verdict, `entry ${row.key}`).toMatch(/^rejected/);
      } else if (row.disposition === 'accepted in part') {
        expect(verdict, `entry ${row.key}`).toMatch(/accepted in part/);
      } else {
        expect(verdict, `entry ${row.key}`).not.toMatch(/^rejected|accepted in part/);
      }
    }
  });

  it('names in each entry the commit its ledger row names', () => {
    // A placeholder once survived into the ledger because the entries carried
    // the real hash and nothing compared the two.
    for (const row of rows) {
      const last = bodies.get(row.entries[row.entries.length - 1] as string) ?? '';
      const stated = /\*\*Commit:\*\* (.+)/.exec(last)?.[1] ?? '';
      const hashes = (text: string): string[] => [...text.matchAll(/`([0-9a-f]{7,40})`/g)].map((m) => m[1] as string);

      expect(hashes(row.commit), `entry ${row.key}`).not.toEqual([]);
      for (const hash of hashes(row.commit)) {
        expect(hashes(stated), `entry ${row.key}`).toContain(hash);
      }
    }
  });

  it('says in the prose when a problem was reported more than once', () => {
    // The stated convention: an entry mentions a report count only when it is
    // more than one. A pair of entry numbers is itself that statement.
    for (const row of rows.filter((r) => r.reports > 1 && r.entries.length === 1)) {
      const body = bodies.get(row.entries[0] as string) ?? '';
      // Line wrapping puts newlines inside the phrase, so match across whitespace.
      expect(body, `entry ${row.key}`).toMatch(/[Rr]eported\s+(twice|three\s+times|four\s+times)/);
    }
  });

  it('gives a paired entry one report each', () => {
    for (const row of rows.filter((r) => r.entries.length > 1)) {
      expect(row.reports, `entry ${row.key}`).toBe(row.entries.length);
    }
  });

  it('states totals that match the ledger', () => {
    const reports = rows.reduce((sum, r) => sum + r.reports, 0);
    const stated = /(\d+) reports, (\d+) problems\./.exec(DOC);

    expect(stated, 'the opening has to state the totals').not.toBeNull();
    expect(Number(stated?.[1])).toBe(reports);
    expect(Number(stated?.[2])).toBe(rows.length);
  });

  it('states per round figures that match the ledger', () => {
    const perRound = new Map<number, number>();
    const newPerRound = new Map<number, number>();
    for (const row of rows) {
      for (const round of row.rounds) {
        // A row lists each round once; its reports split across them, with the
        // extras inside the round it was first reported in.
        perRound.set(round, (perRound.get(round) ?? 0) + 1);
      }
      const extras = row.reports - row.rounds.length;
      const first = Math.min(...row.rounds);
      perRound.set(first, (perRound.get(first) ?? 0) + extras);
      newPerRound.set(first, (newPerRound.get(first) ?? 0) + 1);
    }

    for (const [round, count] of perRound) {
      const sentence = new RegExp(`round ${round}\\s+produced\\s+${count}\\s+reports?\\s+and\\s+(\\d+)\\s+new`, 'i');
      const stated = sentence.exec(DOC);
      expect(stated, `round ${round} should be stated as producing ${count} reports`).not.toBeNull();
      expect(Number(stated?.[1]), `round ${round} new problems`).toBe(newPerRound.get(round) ?? 0);
    }
  });
});
