# DEPLOY.md

The service is scored live for **96 hours**, four full days. Deployment is not
an afterthought: a host that sleeps on idle will fail the 30 second latency
probe on a cold start and quietly lose points that the code would otherwise
have earned.

Four days is long enough that this stops being a deployment question and
becomes an uptime question. The service has to survive your laptop being
closed, a host restart, and every idle period in between, without anyone
watching it.

## Host choice

| Option | Cost | Sleeps | Notes |
|---|---|---|---|
| Fly.io | free allowance | only if you let it | set `auto_stop_machines = false` and `min_machines_running = 1` |
| Hetzner CX22 | about 4 EUR per month | never | full control, real logs, easiest to defend in the interview |
| Railway | trial credit | on some plans | check before relying on it |
| Render free | free | **yes, after 15 minutes idle** | avoid for this task |
| ngrok or cloudflared tunnel | free | dies with your laptop | not viable over 96 hours |

Recommendation: Fly.io for zero cost, Hetzner for zero surprises.

**A tunnel is effectively disqualified by the 96 hour window.** Four days
without a closed lid, a system sleep, a wifi drop or a router reboot is not a
bet worth making on an internship application. It stays useful for one thing:
testing that SSE behaves correctly over a public URL before you commit to a
host, since proxy buffering only shows up once you leave localhost.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | yes | usually injected by the platform, default 3000 |
| `AUTH_TOKEN` | yes | the bearer token given to the client at submission |
| `LLM_BASE_URL` | for the llm path | OpenAI compatible base, for example `https://api.groq.com/openai/v1` |
| `LLM_API_KEY` | for the llm path | never committed, never logged |
| `LLM_MODEL` | for the llm path | for example `llama-3.3-70b-versatile` |
| `LLM_TIMEOUT_MS` | no | default 20000 |

Generate the bearer token:

```bash
openssl rand -hex 32
```

Store it in the platform's secret store, never in the repo. `.env` goes in
`.gitignore` and `.env.example` carries the key names with empty values.

## Model access

Any OpenAI compatible endpoint works without a code change. Groq is the
fastest route to a working key: free tier, no card required. OpenRouter and
Together also work. A self hosted Ollama works if the machine serving it is
reachable from the service.

The client never sends a key. They call your API with your bearer token only,
so model access has to be configured and working on your server before you
submit. Verify with probe 79 in TESTPLAN.md against the deployed URL.

## Container

Multi stage build, non root user, health check wired to `/health` so the
platform restarts a hung process rather than serving a dead port. Node 20
slim base. Build the TypeScript in the first stage, copy only `dist` and
production dependencies into the second.

## SSE behind a proxy

The failure mode that most often survives local testing and breaks in
production: a reverse proxy buffers the event stream and delivers everything
at once when the connection closes. That turns streaming into a slow poll and
fails the streaming probes.

On the stream route specifically:

- set `Cache-Control: no-cache`
- set `Connection: keep-alive`
- set `X-Accel-Buffering: no`
- disable response compression for this route only
- send a comment heartbeat every 15 seconds on running jobs

Then test against the deployed URL with curl and confirm events arrive
progressively rather than in one burst:

```bash
curl -N -H "Authorization: Bearer $TOKEN" \
  "$BASE/v1/reviews/$JOB_ID/stream"
```

`-N` disables curl's own buffering. Without it you will misdiagnose your own
service.

## Platform timeouts

Some hosts cap request duration. An SSE connection is a long lived request.
Check the platform's limit and confirm a stream on a running job is not cut
short. Fly.io does not cap by default. Some managed platforms cap at 30 or 60
seconds, which is survivable here because jobs finish quickly, but confirm
rather than assume.

## Pre submission checklist

Run in order. Do not submit until every line passes.

1. `curl $BASE/health` returns 200 with a rising `uptimeSeconds`
2. `curl $BASE/spec` limits match `src/config.ts`
3. Full probe suite green **against the deployed URL**, not localhost
4. Probe 79 green, meaning the `llm` path works end to end in production
5. Probe 80 green, meaning a broken model config fails gracefully. Test this
   by temporarily pointing `LLM_BASE_URL` at an unroutable host, confirming a
   `failed` job and a healthy `/health`, then restoring it
6. SSE confirmed progressive over the public URL with `curl -N`
7. Auto sleep disabled, confirmed by leaving the service idle for 20 minutes
   and then timing a cold request
8. Restart policy set so a crash recovers automatically
9. `AUTH_TOKEN` matches exactly what you are about to send, copied not retyped
10. Repository is public or access is granted, and `SUBMISSION.md` is committed
11. No secret anywhere in git history. Check with
    `git log -p | grep -iE "sk-|gsk_|api[_-]?key"`
12. Restart policy set to always, so a crash or a host reboot recovers with no
    manual intervention. Verify by killing the process and confirming it comes
    back
13. Record the exact time you send the submission email. The 96 hour window
    starts then

## During the 96 hours

Leave it running. Do not deploy changes mid window unless something is broken,
and if you must, verify `/health` immediately afterwards.

Four days is long enough that you should not rely on remembering to check.
Set up something that watches for you:

- a free uptime monitor pinging `/health` every five minutes, with an alert to
  your phone. UptimeRobot and Better Stack both have free tiers that cover this
- if the host has log retention, check for unexpected 5xx responses, since the
  contract says the service should never produce them even under burst
- check in properly at least once a day

One thing to sanity check before you submit, specific to the longer window: the
stores in `ARCHITECTURE.md` have no eviction. Over a bounded probe run that is
harmless. Over four days, confirm that nothing grows without bound in a way
that would exhaust memory on a small instance.
