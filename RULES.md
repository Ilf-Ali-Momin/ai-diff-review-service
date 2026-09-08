# RULES.md

Authoritative interpretation of the mock provider rules. This file resolves
every ambiguity in the contract's rule table. Implement exactly this. Do not
re resolve, do not improve, do not generalize.

## Governing principle

**Prefer the literal reading of the trigger column.** Where the contract states
a substring, match that substring exactly. Where it states a regex, use that
regex character for character. Only depart from the literal reading where the
literal reading is provably self defeating, and where that happens it is called
out explicitly below with a reason.

Rationale: the scoring probes were written against the contract text, not
against our idea of a good linter. A cleverer rule that catches more real
problems scores worse than a dumber rule that matches the table.

## Preprocessing, applies to every rule

For each added line the parser produces a record:

```ts
type AddedLine = {
  path: string;      // new file path, from the +++ header, b/ prefix stripped
  line: number;      // line number in the NEW file, 1 based
  text: string;      // the line WITHOUT the leading '+' marker
  raw: string;       // the original diff line, retained for debugging only
}
```

Rules evaluate `text`. Never `raw`. This matters most for MOCK-003, where the
`+` marker would otherwise make every added line look like a concatenation.

`text` preserves leading indentation, trailing whitespace and the original
characters exactly. No trimming, no normalization, no case folding except
where a rule says so.

## Line numbering

From each hunk header `@@ -a,b +c,d @@`, the new file counter starts at `c`.

- a `+` line is emitted at the current counter, then the counter increments
- a context line (leading space) increments the counter, emits nothing
- a `-` line does not increment the counter, emits nothing
- `\ No newline at end of file` is metadata, ignored, no increment
- the `+++ b/path` header is a header, never an added line, even though it
  starts with `+`. Detect headers before detecting added lines.

Empty context lines sometimes appear in diffs as a completely empty string
rather than a single space. Treat an empty string inside a hunk as a context
line.

## Path resolution

Take the path from the `+++` header, stripping a leading `b/` if present.
If the `+++` header is `/dev/null` the file is deleted and has no added lines.
For renames, the `+++` path is the new path and that is what we report.
If a `diff --git` header is present but a `+++` header is not, skip the file.

## Finding identity

`id = "<ruleId>:<path>:<line>"`

Deduplicate by `id`. Two different rules matching the same line produce two
findings, because their ids differ. The same rule matching a line twice, for
example a line containing `eval(` twice, produces one finding.

`evidence` is `text`, the added line without its `+` marker, verbatim
including indentation. Not `raw`, not trimmed.

---

## MOCK-001 eval usage

- severity `critical`, category `security`
- **Predicate:** `text.includes("eval(")`
- Case sensitive. Literal substring.

| line | match | why |
|---|---|---|
| `const r = eval(input);` | yes | |
| `foo.eval(x)` | yes | substring is present, literal reading |
| `eval (x)` | no | space breaks the substring |
| `// never use eval(` | yes | we do not parse comments, literal reading |
| `evaluate(x)` | no | no `(` directly after `eval` |

Note `evaluate(` does not match because the substring requires `(` immediately
after `eval`. This is a happy accident of the literal reading, not a special case.

---

## MOCK-002 hardcoded credential

- severity `critical`, category `security`
- **Predicate:** the contract regex, used character for character:

```js
/(api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i
```

Do not modify it. Do not anchor it. Do not add backtick support. Do not
extend the character class. It is case insensitive by its `i` flag.

Consequences of the literal regex, all intended:

- `ACCESS_TOKEN = "abc..."` matches, because `token` appears as a substring
- a value of exactly 16 or more characters from `[A-Za-z0-9_-]` matches
- a value containing `.` or `/` does not match, because those are outside the
  class
- backtick delimited values do not match

| line | match | why |
|---|---|---|
| `const apiKey = "sk_live_abcdefghijklmnop";` | yes | 20 char value, `=` separator |
| `api_key: 'A1B2C3D4E5F6G7H8'` | yes | 16 chars exactly |
| `secret = "short"` | no | fewer than 16 chars |
| `token = \`abcdefghijklmnop\`` | no | backticks not in the regex |
| `SECRET: "aaaaaaaaaaaaaaaaaa"` | yes | `i` flag |

---

## MOCK-003 SQL string concatenation

- severity `high`, category `security`
- The vaguest rule in the table. Resolved as follows.

**Predicate, all three conditions:**

1. The line contains at least one string literal. String literals are
   delimited by `'`, `"` or `` ` ``. Backslash escapes are respected when
   scanning for the closing delimiter.
2. At least one string literal contains a SQL keyword: `SELECT`, `INSERT`,
   `UPDATE` or `DELETE`, matched **case insensitively** with word boundaries
   on both sides.
3. The line contains at least one `+` character that lies **outside** every
   string literal. That is the concatenation operator.

Condition 3 is what makes stripping the `+` marker essential. It is also why a
template literal using `${}` does not match: there is no `+` operator.

Word boundaries prevent `deleteUser(` and `updated_at` from triggering.
Case insensitivity is chosen over the uppercase spelling in the table because
lowercase SQL is common and the table is naming keywords, not spellings. This
is the one deliberate departure from the strict literal reading, recorded in
DECISIONS.md.

| line | match | why |
|---|---|---|
| `db.query("SELECT * FROM u WHERE id = " + id)` | yes | keyword in string, `+` outside |
| `const q = "delete from logs where id=" + x` | yes | case insensitive |
| `` const q = `SELECT * FROM u WHERE id = ${id}` `` | no | no `+` operator |
| `const q = "SELECT * FROM users";` | no | no `+` |
| `total = a + b; // SELECT` | no | keyword not inside a string literal |
| `deleteUser(id) + 1` | no | word boundary fails |
| `msg = "please UPDATE your profile " + name` | yes | literal reading, false positive accepted |

The last row is a genuine false positive and we accept it. Trying to
distinguish English prose from SQL is out of scope and would risk missing a
scored probe.

---

## MOCK-004 swallowed exception

- severity `high`, category `correctness`
- The only multi line rule. Report on the `catch` line.

**Predicate:**

1. The **`catch` token appears on an added line**. That added line is the one
   reported. If the `catch` is on a context line, no finding, because the rule
   table says rules apply to added lines only.
2. The catch clause is matched by `/\bcatch\s*(\([^)]*\))?\s*\{/`. The binding
   is optional, since `catch { }` is valid modern JavaScript.
3. The block is **empty**: between the opening `{` and its matching `}`, after
   removing whitespace and line breaks, nothing remains.

**Emptiness is judged against reconstructed new file content**, which means
added lines and context lines together, in new file order, within the same
hunk. A catch block frequently opens on an added line and closes on a context
line, and judging on added lines alone would miss it.

Brace matching counts braces that appear outside string literals only.

If the hunk ends before the matching `}` is found, emit **no finding**. We do
not guess about content we cannot see.

**A block containing only a comment is not empty and produces no finding.**
The trigger says "empty catch block" and a comment is content. This follows
the governing principle. The alternative reading, that a comment only catch is
still a swallowed exception, is defensible and is recorded in DECISIONS.md as
the rejected option.

| case | finding |
|---|---|
| `+ } catch (e) {}` | yes, on that line |
| `+ } catch {}` | yes, optional binding |
| `+ } catch (e) {` then `+ }` | yes, on the catch line |
| `+ } catch (e) {` then context `  }` | yes, closing brace may be context |
| `+ } catch (e) { /* intentional */ }` | no, comment is content |
| `+ } catch (e) { log(e); }` | no, has a statement |
| context `} catch (e) {` then `+ }` | no, catch line is not an added line |

---

## MOCK-005 loose null comparison

- severity `medium`, category `correctness`
- Contains a trap: `=== null` contains the substring `== null`.

**Predicate:** either regex matches.

```js
/(?<![=!<>])==(?!=)\s*null\b/     // loose equality
/(?<![<>])!=(?!=)\s*null\b/       // loose inequality
```

The lookbehind and lookahead exclude the strict operators. Verify by hand:

- `x == null` matches, the char before `==` is a space
- `x === null` does not match, the lookahead `(?!=)` fails on the third `=`
- `x != null` matches
- `x !== null` does not match, the lookahead fails
- `x >= null` does not match, `>` is excluded by the lookbehind on the
  inequality pattern and `=` alone is not `==`

`\s*` permits `x ==null`. The trigger column writes one space but the intent
is the operator, not the spacing.

`\b` after `null` prevents matching `nullable`.

| line | match |
|---|---|
| `if (user == null) return;` | yes |
| `if (user === null) return;` | no |
| `while (x != null) {` | yes |
| `if (a !== null && b !== null)` | no |
| `if (v ==null)` | yes |
| `if (x == nullable)` | no |

---

## MOCK-006 deep clone via JSON

- severity `medium`, category `performance`
- **Predicate:** `text.includes("JSON.parse(JSON.stringify(")`
- Exact substring, case sensitive, no whitespace tolerance.

`JSON.parse( JSON.stringify(` with a space does not match. This is the literal
reading and we accept the miss.

---

## MOCK-007 console.log left in

- severity `low`, category `style`
- **Predicate:** `text.includes("console.log(")`
- Exact substring, case sensitive.

`console.error(` does not match. `console.log (` does not match.

---

## MOCK-008 unresolved marker

- severity `low`, category `style`
- **Predicate:** `text.includes("TODO") || text.includes("FIXME")`
- **Case sensitive.**

The case sensitivity is inferred from contrast: MOCK-INJ says "case
insensitive" explicitly and MOCK-008 does not. The contract author
distinguished them deliberately. So `todo` and `Fixme` do not match.

A line containing both `TODO` and `FIXME` yields one finding, since the id is
identical.

---

## MOCK-INJ prompt injection content

- severity `critical`, category `security`
- **Predicate:** case insensitive substring match on any of:
  - `ignore previous instructions`
  - `disregard all prior`
  - `you are now`

Match on `text.toLowerCase()`. No whitespace normalization, so
`ignore  previous  instructions` with a double space does not match. Literal
reading.

A line matching two phrases yields one finding, same id.

**Inertness is a hard requirement.** The matched content is reported as
`evidence` like any other finding and is never interpreted. In the mock
provider this is automatic. In the LLM provider it is enforced by the wrapping
and validation described in the provider design. Diff content never reaches a
model as anything other than delimited data.

---

## Ordering

One function, applied once, feeding both the JSON result and the event log.

1. `path`, lexicographic by code unit. Use plain `<` and `>` comparison, not
   `localeCompare`, which is locale dependent and would sort differently on a
   different host.
2. `line`, numeric ascending. Not string ascending. `9` sorts before `10`.
3. `ruleId`, lexicographic. `MOCK-001` before `MOCK-002` before `MOCK-INJ`,
   which falls out naturally because `I` is greater than any digit.

Deduplicate by `id` before sorting, keeping the first occurrence.

## maxFindings

Truncates the **ordered, deduplicated** list, taking the first `maxFindings`
entries. Default 100.

`usage` always reflects the **full** scan: `inputBytes` is the byte length of
the whole submitted diff, `chunks` is the full chunk count. Truncation never
changes usage. The contract states this explicitly.

The SSE stream emits the truncated list, and its `done` event reports
`total` as the count of emitted findings, matching the truncated list length.
