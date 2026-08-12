/**
 * The nine mock provider predicates, implemented exactly as RULES.md resolves
 * them.
 *
 * The governing principle throughout is the literal reading of the trigger
 * column. Where a smarter rule would catch more real defects, the literal one
 * wins, because the scoring probes were written against the contract text and
 * not against anyone's idea of a good linter. See D-001.
 *
 * Every predicate here evaluates `AddedLine.text`, which the parser has
 * already stripped of its `+` marker. A predicate reading `raw` is a bug.
 */

import type { AddedLine, Category, Finding, Hunk, ParsedDiff, Severity } from './types';

type RuleMeta = {
  severity: Severity;
  category: Category;
  title: string;
};

/** Transcribed from the rule table in CONTRACT.md, which scores these exactly. */
const RULE_META: Record<string, RuleMeta> = {
  'MOCK-001': { severity: 'critical', category: 'security', title: 'eval usage' },
  'MOCK-002': { severity: 'critical', category: 'security', title: 'hardcoded credential' },
  'MOCK-003': { severity: 'high', category: 'security', title: 'SQL string concatenation' },
  'MOCK-004': { severity: 'high', category: 'correctness', title: 'swallowed exception' },
  'MOCK-005': { severity: 'medium', category: 'correctness', title: 'loose null comparison' },
  'MOCK-006': { severity: 'medium', category: 'performance', title: 'deep-clone via JSON' },
  'MOCK-007': { severity: 'low', category: 'style', title: 'console.log left in' },
  'MOCK-008': { severity: 'low', category: 'style', title: 'unresolved marker' },
  'MOCK-INJ': { severity: 'critical', category: 'security', title: 'prompt-injection content' },
};

/** The contract's regex, used character for character. Not anchored, not extended. */
const CREDENTIAL = /(api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i;

/**
 * The lookbehind and lookahead are the whole point: `=== null` contains the
 * substring `== null`, so a plain substring match fires on strict equality,
 * which the rule title "loose null comparison" directly contradicts. See D-007.
 */
const LOOSE_EQ_NULL = /(?<![=!<>])==(?!=)\s*null\b/;
const LOOSE_NEQ_NULL = /(?<![<>])!=(?!=)\s*null\b/;

/** Word boundaries stop `deleteUser` and `updated_at` triggering. See D-003. */
const SQL_KEYWORD = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;

/** The binding is optional, since `catch { }` is valid modern JavaScript. */
const CATCH_CLAUSE = /\bcatch\s*(\([^)]*\))?\s*\{/g;

const INJECTION_PHRASES = ['ignore previous instructions', 'disregard all prior', 'you are now'];

type StringRange = {
  /** Index of the opening delimiter. */
  start: number;
  /** Index just past the closing delimiter, or the line length when unterminated. */
  end: number;
  terminated: boolean;
};

/**
 * Locates string literals in one line, respecting backslash escapes.
 *
 * A quote with no closing partner runs to the end of the line, so a `+` after
 * it counts as inside a string and MOCK-003 stays silent. That fails closed,
 * which is the direction RULES.md takes everywhere. See D-020.
 */
export function stringLiteralRanges(text: string): StringRange[] {
  const ranges: StringRange[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      let terminated = false;
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === ch) {
          terminated = true;
          break;
        }
        j += 1;
      }
      const end = terminated ? j + 1 : text.length;
      ranges.push({ start: i, end, terminated });
      i = end;
      continue;
    }
    i += 1;
  }

  return ranges;
}

function isInsideAnyRange(index: number, ranges: StringRange[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

/**
 * MOCK-003, all three conditions: a string literal exists, one of them holds a
 * SQL keyword, and a `+` sits outside every literal. The third condition is
 * why stripping the diff marker in the parser is not optional. See D-004.
 */
export function isSqlConcatenation(text: string): boolean {
  const ranges = stringLiteralRanges(text);
  if (ranges.length === 0) {
    return false;
  }

  const hasKeywordInLiteral = ranges.some((range) => {
    const inner = range.terminated
      ? text.slice(range.start + 1, range.end - 1)
      : text.slice(range.start + 1);
    return SQL_KEYWORD.test(inner);
  });
  if (!hasKeywordInLiteral) {
    return false;
  }

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '+' && !isInsideAnyRange(i, ranges)) {
      return true;
    }
  }
  return false;
}

function makeFinding(ruleId: string, path: string, line: number, evidence: string): Finding {
  const meta = RULE_META[ruleId];
  // Unreachable: every call site passes a literal key of RULE_META. Present so
  // that the lookup is a total function rather than a non null assertion.
  if (meta === undefined) {
    throw new Error(`unknown ruleId ${ruleId}`);
  }
  return {
    id: `${ruleId}:${path}:${line}`,
    ruleId,
    path,
    line,
    severity: meta.severity,
    category: meta.category,
    title: meta.title,
    evidence,
  };
}

/** The eight single line predicates. MOCK-004 is handled separately, over hunks. */
function scanAddedLine(added: AddedLine): Finding[] {
  const { text, path, line } = added;
  const findings: Finding[] = [];
  const hit = (ruleId: string): void => {
    findings.push(makeFinding(ruleId, path, line, text));
  };

  // Literal substring. `evaluate(` does not match because the `(` must follow
  // `eval` directly, which is a happy accident of the literal reading.
  if (text.includes('eval(')) {
    hit('MOCK-001');
  }

  if (CREDENTIAL.test(text)) {
    hit('MOCK-002');
  }

  if (isSqlConcatenation(text)) {
    hit('MOCK-003');
  }

  if (LOOSE_EQ_NULL.test(text) || LOOSE_NEQ_NULL.test(text)) {
    hit('MOCK-005');
  }

  // Exact substring, no whitespace tolerance. A space after `parse(` misses,
  // and RULES.md accepts that miss.
  if (text.includes('JSON.parse(JSON.stringify(')) {
    hit('MOCK-006');
  }

  if (text.includes('console.log(')) {
    hit('MOCK-007');
  }

  // Case sensitive, unlike MOCK-INJ. The contract distinguished the two
  // deliberately and the distinction is information. See D-008.
  if (text.includes('TODO') || text.includes('FIXME')) {
    hit('MOCK-008');
  }

  const lowered = text.toLowerCase();
  if (INJECTION_PHRASES.some((phrase) => lowered.includes(phrase))) {
    hit('MOCK-INJ');
  }

  return findings;
}

type Position = { lineIndex: number; charIndex: number };

function offsetToPosition(offset: number, lineStarts: number[]): Position {
  let lineIndex = 0;
  for (let i = 0; i < lineStarts.length; i += 1) {
    if ((lineStarts[i] ?? 0) <= offset) {
      lineIndex = i;
    } else {
      break;
    }
  }
  return { lineIndex, charIndex: offset - (lineStarts[lineIndex] ?? 0) };
}

/**
 * Walks forward from an opening brace to its partner, counting only braces
 * that sit outside string literals, and returns the text enclosed by the pair.
 *
 * The scan is line by line rather than over the joined hunk, so an unterminated
 * quote cannot swallow the following lines. Returns null when the hunk ends
 * first, because RULES.md is explicit that we do not guess about content we
 * cannot see.
 *
 * Comments are not skipped, and do not need to be: a brace inside a comment
 * either is not reached, or ends the block early leaving the comment itself as
 * enclosed content, and a comment counts as content either way. See D-006.
 */
function enclosedBlockText(hunk: Hunk, open: Position): string | null {
  let depth = 0;
  const collected: string[] = [];

  for (let lineIndex = open.lineIndex; lineIndex < hunk.lines.length; lineIndex += 1) {
    const text = hunk.lines[lineIndex]?.text ?? '';
    const ranges = stringLiteralRanges(text);
    const from = lineIndex === open.lineIndex ? open.charIndex : 0;
    let lineContribution = '';

    for (let i = from; i < text.length; i += 1) {
      const ch = text[i] ?? '';
      if (isInsideAnyRange(i, ranges)) {
        lineContribution += ch;
        continue;
      }
      if (ch === '{') {
        depth += 1;
        if (depth === 1) {
          // The opening brace itself is not part of the enclosed content.
          continue;
        }
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          collected.push(lineContribution);
          return collected.join('\n');
        }
      }
      lineContribution += ch;
    }

    collected.push(lineContribution);
  }

  return null;
}

/**
 * MOCK-004. The `catch` token must be on an added line, but emptiness is
 * judged against reconstructed new file content, added and context lines
 * together, because a catch block routinely closes on a context line.
 * See D-005.
 */
function scanHunkForSwallowedExceptions(hunk: Hunk): Finding[] {
  const texts = hunk.lines.map((entry) => entry.text);
  const joined = texts.join('\n');

  const lineStarts: number[] = [];
  let accumulated = 0;
  for (const text of texts) {
    lineStarts.push(accumulated);
    accumulated += text.length + 1;
  }

  const findings: Finding[] = [];
  CATCH_CLAUSE.lastIndex = 0;
  let match = CATCH_CLAUSE.exec(joined);

  while (match !== null) {
    const catchPosition = offsetToPosition(match.index, lineStarts);
    const catchLine = hunk.lines[catchPosition.lineIndex];

    if (catchLine !== undefined && catchLine.added) {
      const bracePosition = offsetToPosition(match.index + match[0].length - 1, lineStarts);
      const enclosed = enclosedBlockText(hunk, bracePosition);

      if (enclosed !== null && enclosed.replace(/\s/g, '') === '') {
        findings.push(makeFinding('MOCK-004', hunk.path, catchLine.line, catchLine.text));
      }
    }

    match = CATCH_CLAUSE.exec(joined);
  }

  return findings;
}

/**
 * Runs every rule over a parsed diff. Returns findings unordered and possibly
 * duplicated: ordering, deduplication and truncation belong to the pipeline,
 * not to a provider.
 */
export function scan(parsed: ParsedDiff): Finding[] {
  const findings: Finding[] = [];

  for (const added of parsed.addedLines) {
    findings.push(...scanAddedLine(added));
  }

  for (const hunk of parsed.hunks) {
    findings.push(...scanHunkForSwallowedExceptions(hunk));
  }

  return findings;
}
