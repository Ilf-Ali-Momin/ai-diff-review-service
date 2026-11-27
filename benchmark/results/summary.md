# Results

15 real bugs from BugsJS, each reintroduced by reversing its upstream fix. A bug counts as caught when a finding points within 2 lines of a line the fix had removed, on a line that is really in the diff.

| Reviewer | Runs | Bugs caught (min / median / max) | Findings | On added lines | On context lines | Fabricated | Misquoted | No location | Extra: valid / noise / unlabeled |
|---|---|---|---|---|---|---|---|---|---|
| diff-review-service | 3 | **12 / 12 / 14** of 15 | 42 | 42 | 0 | 0 | 0 | 0 | 0 / 0 / 0 |
| diff-review-service-strict | 3 | **2 / 2 / 4** of 15 | 8 | 8 | 0 | 0 | 0 | 0 | 0 / 0 / 0 |
| model-raw | 3 | **2 / 2 / 4** of 15 | 46 | 8 | 0 | 0 | 38 | 0 | 0 / 0 / 0 |

What ran:

- **diff-review-service**: openai/gpt-oss-120b + validateFinding
- **diff-review-service-strict**: openai/gpt-oss-120b + validateFinding (strict: exact line and quote)
- **model-raw**: openai/gpt-oss-120b

## Per case

| Case | Severity | diff-review-service | diff-review-service-strict | model-raw |
|---|---|---|---|---|
| express-3 | medium | 3/3 | 0/3 | 0/3 |
| express-4 | medium | 3/3 | 2/3 | 2/3 |
| express-5 | medium | 2/3 | 0/3 | 0/3 |
| express-9 | medium | 3/3 | 1/3 | 1/3 |
| express-16 | low | 1/3 | 0/3 | 0/3 |
| express-22 | high | 3/3 | 1/3 | 1/3 |
| express-26 | high | 2/3 | 0/3 | 0/3 |
| hexo-7 | high | 3/3 | 2/3 | 2/3 |
| hexo-12 | medium | 3/3 | 0/3 | 0/3 |
| karma-3 | low | 3/3 | 0/3 | 0/3 |
| karma-22 | medium | 0/3 | 0/3 | 0/3 |
| mongoose-8 | medium | 3/3 | 2/3 | 2/3 |
| mongoose-11 | medium | 3/3 | 0/3 | 0/3 |
| mongoose-16 | medium | 3/3 | 0/3 | 0/3 |
| mongoose-22 | critical | 3/3 | 0/3 | 0/3 |

## Missed by every reviewer

- **karma-22** (medium): The URL pattern now strips any host from stack traces instead of only karma's own hostname and port, mangling third party URLs.

## Fabricated and misquoted findings

Findings that point at a path or line that is not in the diff, or quote a line as saying something it does not. These are what validateFinding exists to drop.

- model-raw on express-3 (misquoted): `lib/response.js:608` "Unconditional call to req.accepts may mis-handle empty key list"
- model-raw on express-4 (misquoted): `lib/request.js:454` "Improper handling of IP addresses when computing subdomains"
- model-raw on express-5 (misquoted): `lib/utils.js:71` "Removed support for forward slash in Windows device paths"
- model-raw on express-22 (misquoted): `lib/request.js:476` "Naive split on ':' breaks IPv6 host parsing"
- model-raw on express-26 (misquoted): `lib/router/index.js:126` "Removed leading slash check, may misidentify FQDN for paths starting with '/'"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:49` "Removing .toString() may pass non‑string values to slugize, causing runtime errors"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:205` "Removing .toString() may pass non‑string values to slugize, leading to unexpected behavior"
- model-raw on karma-3 (misquoted): `lib/reporter.js:96` "Changing error formatting return behavior and adding newline"
- model-raw on karma-22 (misquoted): `lib/reporter.js:31` "Broad URL regex permits any host, weakening URL validation"
- model-raw on mongoose-8 (misquoted): `lib/document.js:353` "Missing return statement may cause undefined result"
- model-raw on mongoose-11 (misquoted): `lib/query.js:514` "Removed existence check may cause duplicate field inclusion"
- model-raw on mongoose-16 (misquoted): `lib/model.js:339` "Removed version check may cause premature return"
- model-raw on mongoose-22 (misquoted): `lib/model.js:764` "Removing query conditions may cause deletion of all documents"
- model-raw on express-3 (misquoted): `lib/response.js:606` "Calling req.accepts with empty array may produce unexpected result"
- model-raw on express-5 (misquoted): `lib/utils.js:68` "Reduced Windows device path detection may misclassify absolute paths"
- model-raw on express-9 (misquoted): `lib/application.js:168` "Incorrect assignment to mount_app.mountpath may break routing"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:51` "Removing .toString() may pass non‑string values to slugize, causing runtime errors"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:208` "Removing .toString() may pass non‑string values to slugize, causing runtime errors"
- model-raw on karma-3 (misquoted): `lib/reporter.js:101` "Overwrites msg with formatted error instead of returning, may cause type errors"
- model-raw on karma-22 (misquoted): `lib/reporter.js:25` "Regex now permits any hostname, potentially allowing untrusted URLs"
- model-raw on mongoose-11 (misquoted): `lib/query.js:518` "Removed duplicate field check, may cause redundant field inclusion"
- model-raw on mongoose-16 (misquoted): `lib/model.js:339` "Removed version check may skip delta handling when version mismatch"
- model-raw on mongoose-22 (misquoted): `lib/model.js:764` "Query conditions ignored, leading to removal of all documents"
- model-raw on express-3 (misquoted): `lib/response.js:606` "Calling req.accepts with empty array may change behavior when no response formats are defined"
- model-raw on express-5 (misquoted): `lib/utils.js:68` "Windows absolute path detection no longer accepts forward slash after colon"
- model-raw on express-9 (misquoted): `lib/application.js:172` "Assigning mount_app.mountpath to request path instead of mount_path breaks routing"
- model-raw on express-16 (misquoted): `lib/response.js:822` "Potential XSS: URL inserted into HTML without proper sanitization"
- model-raw on express-16 (misquoted): `lib/response.js:828` "Potential XSS: URL inserted into HTML anchor without proper sanitization"
- model-raw on express-22 (misquoted): `lib/request.js:480` "Improper host parsing breaks IPv6 handling"
- model-raw on express-26 (misquoted): `lib/router/index.js:126` "Removed leading slash check when detecting protocol in URL"
- model-raw on hexo-7 (misquoted): `lib/plugins/helper/toc.js:25` "Unescaped HTML inserted into TOC can lead to XSS"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:51` "Removing .toString() may cause non-string slug values leading to errors"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:208` "Removing .toString() may cause undefined slug to cause slugize error"
- model-raw on karma-3 (misquoted): `lib/reporter.js:98` "Changing return behavior may cause type errors"
- model-raw on karma-22 (misquoted): `lib/reporter.js:27` "Overly permissive URL regular expression allows any hostname"
- model-raw on mongoose-11 (misquoted): `lib/query.js:514` "Removed check for existing key may cause duplicate field inclusion"
- model-raw on mongoose-16 (misquoted): `lib/model.js:339` "Removed version check may cause incorrect early return"
- model-raw on mongoose-22 (misquoted): `lib/model.js:764` "Remove operation ignores conditions, may delete all documents"
