# Results

15 real bugs from BugsJS, each reintroduced by reversing its upstream fix. A bug counts as caught when a finding points within 2 lines of a line the fix had removed, on a line that is really in the diff.

| Reviewer | Runs | Bugs caught (min / median / max) | Findings | On added lines | On context lines | Fabricated | Misquoted | No location | Extra: valid / noise / unlabeled |
|---|---|---|---|---|---|---|---|---|---|
| diff-review-service | 3 | **11 / 12 / 13** of 15 | 39 | 39 | 0 | 0 | 0 | 0 | 0 / 0 / 0 |
| diff-review-service-strict | 3 | **1 / 2 / 3** of 15 | 6 | 6 | 0 | 0 | 0 | 0 | 0 / 0 / 0 |
| model-raw | 3 | **1 / 2 / 3** of 15 | 42 | 6 | 0 | 0 | 36 | 0 | 0 / 0 / 0 |

What ran:

- **diff-review-service**: openai/gpt-oss-120b + validateFinding
- **diff-review-service-strict**: openai/gpt-oss-120b + validateFinding (strict: exact line and quote)
- **model-raw**: openai/gpt-oss-120b

## Per case

| Case | Severity | diff-review-service | diff-review-service-strict | model-raw |
|---|---|---|---|---|
| express-3 | medium | 2/3 | 0/3 | 0/3 |
| express-4 | medium | 3/3 | 1/3 | 1/3 |
| express-5 | medium | 3/3 | 1/3 | 1/3 |
| express-9 | medium | 2/3 | 0/3 | 0/3 |
| express-16 | low | 0/3 | 0/3 | 0/3 |
| express-22 | high | 3/3 | 0/3 | 0/3 |
| express-26 | high | 3/3 | 0/3 | 0/3 |
| hexo-7 | high | 3/3 | 2/3 | 2/3 |
| hexo-12 | medium | 3/3 | 0/3 | 0/3 |
| karma-3 | low | 2/3 | 1/3 | 1/3 |
| karma-22 | medium | 0/3 | 0/3 | 0/3 |
| mongoose-8 | medium | 3/3 | 1/3 | 1/3 |
| mongoose-11 | medium | 3/3 | 0/3 | 0/3 |
| mongoose-16 | medium | 3/3 | 0/3 | 0/3 |
| mongoose-22 | critical | 3/3 | 0/3 | 0/3 |

## Missed by every reviewer

Only cases at least one reviewer was scored on. A case no reviewer reached is listed below instead.

- **express-16** (low): The redirect body uses the raw url argument instead of the resolved address, so the body shows a different target than the Location header.
- **karma-22** (medium): The URL pattern now strips any host from stack traces instead of only karma's own hostname and port, mangling third party URLs.

## Not reviewed

Cases no reviewer was scored on, because every run errored or skipped them. These are not misses.

None.

## Errors

Cases a reviewer could not be scored on, per run. A reviewer missing a case here was not asked, not wrong.

None.

## Fabricated and misquoted findings

Findings that point at a path or line that is not in the diff, or quote a line as saying something it does not. These are what validateFinding exists to drop.

- model-raw on express-4 (misquoted): `lib/request.js:456` "Removed IP address check when parsing subdomains"
- model-raw on express-22 (misquoted): `lib/request.js:476` "Improper host parsing breaks IPv6 handling"
- model-raw on express-26 (misquoted): `lib/router/index.js:126` "Removed check for leading '/' may misclassify relative URLs"
- model-raw on hexo-7 (misquoted): `lib/plugins/helper/toc.js:29` "Unescaped HTML inserted into TOC may lead to XSS"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:47` "Removing .toString() may cause non-string slug leading to runtime errors"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:204` "Redundant assignment of data.slug when initializing slug variable"
- model-raw on karma-3 (misquoted): `lib/reporter.js:98` "Overwrites msg instead of returning formatted error, may cause type errors"
- model-raw on karma-22 (misquoted): `lib/reporter.js:25` "Overly permissive URL regular expression may allow unintended URLs"
- model-raw on mongoose-8 (misquoted): `lib/document.js:353` "Missing return statement may cause undefined result"
- model-raw on mongoose-11 (misquoted): `lib/query.js:514` "Removed duplicate path check, may add duplicate fields to projection"
- model-raw on mongoose-16 (misquoted): `lib/model.js:343` "Removed version check may cause stale updates"
- model-raw on mongoose-22 (misquoted): `lib/model.js:764` "Query initialized with empty conditions may delete all documents unintentionally"
- model-raw on express-3 (misquoted): `lib/response.js:607` "Calling req.accepts with empty key list may produce incorrect content negotiation"
- model-raw on express-5 (misquoted): `lib/utils.js:69` "Windows absolute path detection is too restrictive"
- model-raw on express-9 (misquoted): `lib/application.js:168` "Incorrect assignment of mount_app.mountpath to function argument instead of mount_path"
- model-raw on express-22 (misquoted): `lib/request.js:481` "Improper host parsing breaks IPv6 addresses"
- model-raw on express-26 (misquoted): `lib/router/index.js:126` "Removed leading slash check may misclassify relative URLs as absolute"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:47` "Removing .toString() may allow non‑string values to be passed to slugize, causing runtime errors"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:204` "Removing .toString() may allow non‑string values to be passed to slugize, causing runtime errors"
- model-raw on karma-22 (misquoted): `lib/reporter.js:25` "Regex now allows any hostname, reducing URL validation strictness"
- model-raw on mongoose-8 (misquoted): `lib/document.js:352` "Missing return statement in Document.update leads to undefined result"
- model-raw on mongoose-11 (misquoted): `lib/query.js:514` "Removed duplicate path check may cause redundant field inclusion"
- model-raw on mongoose-16 (misquoted): `lib/model.js:341` "Removed version check may cause incorrect delta handling"
- model-raw on mongoose-22 (misquoted): `lib/model.js:764` "Removal operation ignores query conditions, risking full collection deletion"
- model-raw on express-3 (misquoted): `lib/response.js:606` "Calling req.accepts with an empty array may produce unexpected results"
- model-raw on express-4 (misquoted): `lib/request.js:456` "Removed IP check when parsing subdomains, causing incorrect subdomain extraction for IP addresses"
- model-raw on express-5 (misquoted): `lib/utils.js:69` "Removed forward‑slash check for Windows device paths, may misclassify absolute paths"
- model-raw on express-9 (misquoted): `lib/application.js:168` "Incorrect assignment of mount_app.mountpath may break routing"
- model-raw on express-26 (misquoted): `lib/router/index.js:127` "Removed leading slash check when detecting fully qualified URLs"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:47` "Removing .toString() may cause TypeError when slug or title is undefined or non‑string"
- model-raw on hexo-12 (misquoted): `lib/hexo/post.js:204` "Removing .toString() may cause TypeError if data.slug is undefined or non‑string"
- model-raw on karma-22 (misquoted): `lib/reporter.js:28` "Regex now allows any host, reducing validation and may enable SSRF"
- model-raw on mongoose-11 (misquoted): `lib/query.js:514` "Removed check for existing path may cause duplicate field inclusion"
- model-raw on mongoose-16 (misquoted): `lib/model.js:339` "Removed version check may skip necessary delta processing"
- model-raw on mongoose-22 (misquoted): `lib/model.js:764` "Empty query passed to remove may delete all documents"
