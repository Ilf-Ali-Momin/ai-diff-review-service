# Results

15 real bugs from BugsJS, each reintroduced by reversing its upstream fix. A bug counts as caught when a finding points within 2 lines of a line the fix had removed, on a line that is really in the diff.

| Reviewer | Runs | Bugs caught (min / median / max) | Findings | On added lines | On context lines | Fabricated | Misquoted | No location | Extra: valid / noise / unlabeled |
|---|---|---|---|---|---|---|---|---|---|
| diff-review-service | 3 | **13 / 13 / 13** of 15 | 44 | 44 | 0 | 0 | 0 | 0 | 0 / 0 / 0 |
| diff-review-service-strict | 3 | **2 / 4 / 4** of 15 | 10 | 10 | 0 | 0 | 0 | 0 | 0 / 0 / 0 |
| model-raw | 3 | **2 / 4 / 4** of 15 | 46 | 10 | 0 | 1 | 35 | 0 | 0 / 0 / 0 |

What ran:

- **diff-review-service**: openai/gpt-oss-120b + validateFinding
- **diff-review-service-strict**: openai/gpt-oss-120b + validateFinding (strict: exact line and quote)
- **model-raw**: openai/gpt-oss-120b

## Per case

| Case | Severity | diff-review-service | diff-review-service-strict | model-raw |
|---|---|---|---|---|
| express-3 | medium | 2/3 | 1/3 | 1/3 |
| express-4 | medium | 3/3 | 3/3 | 3/3 |
| express-5 | medium | 3/3 | 0/3 | 0/3 |
| express-9 | medium | 3/3 | 0/3 | 0/3 |
| express-16 | low | 2/3 | 1/3 | 1/3 |
| express-22 | high | 3/3 | 0/3 | 0/3 |
| express-26 | high | 2/3 | 0/3 | 0/3 |
| hexo-7 | high | 3/3 | 1/3 | 1/3 |
| hexo-12 | medium | 3/3 | 0/3 | 0/3 |
| karma-3 | low | 3/3 | 0/3 | 0/3 |
| karma-22 | medium | 0/3 | 0/3 | 0/3 |
| mongoose-8 | medium | 3/3 | 2/3 | 2/3 |
| mongoose-11 | medium | 3/3 | 1/3 | 1/3 |
| mongoose-16 | medium | 3/3 | 1/3 | 1/3 |
| mongoose-22 | critical | 3/3 | 0/3 | 0/3 |

## Missed by every reviewer

- **karma-22** (medium): The URL pattern now strips any host from stack traces instead of only karma's own hostname and port, mangling third party URLs.

## Fabricated and misquoted findings

Findings that point at a path or line that is not in the diff, or quote a line as saying something it does not. These are what validateFinding exists to drop.

- model-raw on express-5 (misquoted): `lib/utils.js:71` "Windows absolute path detection no longer accepts forward slash after drive letter"
- model-raw on express-9 (misquoted): `lib/application.js:168` "mount_app.mountpath assigned to user-provided path instead of mount_path"
- model-raw on express-16 (misquoted): `lib/response.js:822` "Potential open redirect vulnerability using unvalidated URL"
- model-raw on express-16 (misquoted): `lib/response.js:826` "Potential open redirect vulnerability using unvalidated URL in HTML output"
- model-raw on express-22 (fabricated): `lib/request.js:485` "Improper host parsing may break IPv6 addresses"
- model-raw on express-26 (misquoted): `lib/router/index.js:126` "Removed leading slash check when detecting fully qualified URL, may misinterpret relative paths"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:51` "Removing .toString() may cause non‑string values to be passed to slugize"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:204` "Removing .toString() may cause non‑string slug values to be passed to slugize"
- model-raw on karma-3 (misquoted): `lib/reporter.js:97` "Potential loss of return value from config.formatError"
- model-raw on karma-22 (misquoted): `lib/reporter.js:27` "Overly permissive URL regular expression may allow malicious hosts"
- model-raw on mongoose-11 (misquoted): `lib/query.js:514` "Removed duplicate field check may cause redundant field inclusion"
- model-raw on mongoose-22 (misquoted): `lib/model.js:764` "Remove operation uses empty query, potentially deleting all documents"
- model-raw on express-3 (misquoted): `lib/response.js:607` "Calling req.accepts with empty array may change behavior"
- model-raw on express-5 (misquoted): `lib/utils.js:69` "Windows device path detection no longer accepts forward slash separator"
- model-raw on express-9 (misquoted): `lib/application.js:168` "Incorrect assignment of mount_app.mountpath; uses 'path' instead of 'mount_path'"
- model-raw on express-22 (misquoted): `lib/request.js:480` "Host header parsing incorrectly splits on ':' breaking IPv6 handling"
- model-raw on express-26 (misquoted): `lib/router/index.js:126` "Removed leading slash check when extracting FQDN, can misinterpret relative URLs"
- model-raw on hexo-7 (misquoted): `lib/plugins/helper/toc.js:25` "Using unescaped HTML for TOC entries can lead to XSS"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:47` "Removed .toString() may cause non-string slug values to break slugize"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:204` "Removed .toString() may cause non-string slug values to break slugize in publish"
- model-raw on karma-3 (misquoted): `lib/reporter.js:97` "Overwrites msg with formatted error, may cause type errors on concatenation"
- model-raw on karma-22 (misquoted): `lib/reporter.js:25` "Broad URL regex may match unintended hosts"
- model-raw on mongoose-11 (misquoted): `lib/query.js:514` "Removed check for existing path in keys, altering inclusion logic"
- model-raw on mongoose-16 (misquoted): `lib/model.js:340` "Removed version check may cause incorrect early return"
- model-raw on mongoose-22 (misquoted): `lib/model.js:764` "Query conditions removed, may delete all documents unintentionally"
- model-raw on express-5 (misquoted): `lib/utils.js:68` "Absolute path detection fails for Windows paths using forward slash"
- model-raw on express-9 (misquoted): `lib/application.js:168` "mount_app.mountpath assigned to raw path argument instead of normalized mount_path"
- model-raw on express-16 (misquoted): `lib/response.js:822` "Potential open redirect by using unvalidated URL in response body"
- model-raw on express-22 (misquoted): `lib/request.js:476` "Host parsing using split(':') mishandles IPv6 addresses"
- model-raw on hexo-7 (misquoted): `lib/plugins/helper/toc.js:27` "HTML not escaped when generating TOC, potential XSS vulnerability"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:47` "Removing .toString() may cause type errors when slug or title is not a string"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:204` "Calling slugize on possibly undefined slug without .toString() can raise errors"
- model-raw on karma-3 (misquoted): `lib/reporter.js:98` "Assigning formatted error to msg changes return semantics and may cause type errors"
- model-raw on mongoose-8 (misquoted): `lib/document.js:353` "Missing return statement discards result of update operation"
- model-raw on mongoose-16 (misquoted): `lib/model.js:341` "Removed version check may cause incorrect delta handling"
- model-raw on mongoose-22 (misquoted): `lib/model.js:764` "Remove operation ignores conditions, potentially deleting all documents"
