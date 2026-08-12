/**
 * Domain types shared by the pure core and the providers.
 *
 * These live in one file rather than being exported from whichever module
 * happens to produce them, because `Finding` in particular crosses every
 * boundary in the service: the parser feeds it, the providers return it, the
 * ordering function sorts it, the job store holds it and the SSE route
 * serializes it.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type Category = 'security' | 'correctness' | 'performance' | 'style';

/** The finding object, shaped exactly as CONTRACT.md defines it. */
export type Finding = {
  /** `<ruleId>:<path>:<line>`, the deduplication key. */
  id: string;
  ruleId: string;
  path: string;
  line: number;
  severity: Severity;
  category: Category;
  title: string;
  /** The added line without its `+` marker, verbatim. */
  evidence: string;
};

/**
 * One added line, as RULES.md specifies it.
 *
 * `text` is what every rule evaluates. `raw` is retained for debugging only;
 * a rule reading it would see the leading `+` and, in MOCK-003's case, treat
 * every line as a concatenation. See D-002.
 */
export type AddedLine = {
  /** New file path, taken from the `+++` header with any `b/` prefix stripped. */
  path: string;
  /** Line number in the new file, one based. */
  line: number;
  /** The line without its leading `+` marker. */
  text: string;
  /** The original diff line, including the marker. Never given to a rule. */
  raw: string;
};

/**
 * One line of reconstructed new file content: added lines and context lines
 * together, in new file order. Removed lines do not appear, since they are not
 * part of the new file.
 *
 * MOCK-004 needs this because a catch block routinely opens on an added line
 * and closes on a context line, so brace matching cannot run on added lines
 * alone. See D-005.
 */
export type HunkLine = {
  line: number;
  text: string;
  /** False for a context line. Only an added `catch` may produce a finding. */
  added: boolean;
};

export type Hunk = {
  path: string;
  lines: HunkLine[];
};

/**
 * The complete diff of one file, from its header through to the line before
 * the next file's header. Chunking packs these and never splits one.
 */
export type FileSegment = {
  /** Null when the segment declares no usable new path, for example a deletion. */
  path: string | null;
  text: string;
  /** UTF 8 byte length, which is what the 64 KiB budget is measured in. */
  byteLength: number;
};

export type ParsedDiff = {
  addedLines: AddedLine[];
  hunks: Hunk[];
  segments: FileSegment[];
  /** Zero means the input is not a unified diff. Drives 422. See D-018. */
  hunkCount: number;
};

/** A packed group of whole file segments, at most `chunkBytes` unless one file exceeds it alone. */
export type Chunk = {
  index: number;
  text: string;
  byteLength: number;
};
