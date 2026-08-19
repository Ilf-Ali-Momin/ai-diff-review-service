# AI Diff Review Service

An HTTP service that reviews unified diffs. A client submits a diff, receives a
job id immediately, and collects structured findings either by polling or over
a Server Sent Events stream.

Built as a take home task. The scored deployment has been taken down; the
service runs locally with one command.

## What it does

```
POST /v1/reviews          submit a diff, get a job id back straight away
GET  /v1/reviews/:id      poll for status and findings
GET  /v1/reviews/:id/stream   watch findings arrive, or replay a finished job
GET  /health              public
GET  /spec                public, the service's own declared limits
```

Diffs are parsed, split into chunks on file boundaries, and scanned by a
provider. Two providers share one pipeline:

- **`mock`** is a pure function implementing nine deterministic rules. Same
  diff, same findings, same order, every time.
- **`llm`** sends the diff to any OpenAI compatible endpoint, then validates
  every returned finding against the diff the service parsed itself. A finding
  pointing at a path or line that does not exist is dropped, so a compromised
  model cannot fabricate one.

## Running it

```bash
npm install
npm run build
AUTH_TOKEN=local-dev-token npm start
```

`AUTH_TOKEN` is required; the process refuses to start without one, so a
missing environment variable cannot silently produce an open service.

Submit a diff:

```bash
curl -X POST http://127.0.0.1:3000/v1/reviews \
  -H 'Authorization: Bearer local-dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"diff":"--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,2 @@\n const a=1;\n+eval(x);\n"}'
```

For the `llm` provider, copy `.env.example` to `.env` and fill in
`LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`. The service starts and serves
without them; only a job asking for that provider fails, with a clear message.

## Tests

```bash
npm test     # 219 unit and integration tests, in process, about two seconds
```

A separate black box suite runs the full probe plan over real HTTP against any
running instance:

```bash
PROBE_BASE_URL=http://127.0.0.1:3000 PROBE_TOKEN=local-dev-token npm run probe
```

## Deployment

```bash
docker compose up -d --build
```

Multi stage build on Node 20, non root, health check wired to `/health`. Caddy
terminates TLS in front and is configured so the stream route is neither
buffered nor compressed, which is the failure that survives local testing and
breaks streaming in production.

## Layout

```
src/
  config.ts          every declared limit, in one place; /spec serializes it
  core/              pure functions, no I/O: parser, rules, ordering, chunker
  jobs/              job store with an append only event log, queue, worker
  http/              server, auth, rate limit, error envelope, routes
  providers/         the Provider interface, mock and llm
test/
  core/ http/ providers/   unit and integration
  probe/                   black box suite against a base URL
```

The core is pure and was written and fully tested before any HTTP route
existed. Workers never write to a socket: they append to a job's event log and
the stream route reads it, which is what makes replay, late connection,
multiple concurrent streams and cached jobs all work without special cases.

## Documents

The repository is deliberately document heavy. These were written before the
code and are the reasoning behind it.

| File | What it is |
|---|---|
| `SUBMISSION.md` | the write up: architecture, provider design, how each cross cutting behaviour was verified |
| `DECISIONS.md` | 42 entries, each recorded before the code that depended on it |
| `CONTRACT.md` | the task as given, verbatim, never edited |
| `RULES.md` | the authoritative resolution of every ambiguity in the rule table |
| `ARCHITECTURE.md` | module layout and the designs that matter |
| `TESTPLAN.md` | 84 probes, written before the implementation |
| `DEPLOY.md` | deployment and the pre submission checklist |

## Stack

Node 20, TypeScript strict, Fastify, Vitest. Fastify is the only runtime
dependency: `randomUUID`, `node:crypto` and `fetch` all ship with the runtime.
No database, no queue library, no ORM.
