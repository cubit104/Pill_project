# Visual matcher service

The pill encoder and the fingerprint index used to live inside the API process on
Render. Together with ONNX Runtime they do not fit in a 512 MB instance: on
2026-09-11 Render killed the service with *"Ran out of memory (used over
512MB)"*, which returns 502 for every endpoint, not just photo identification,
for as long as the restart takes.

They now run in their own service, `ml/scripts/vision_service.py`, alongside the
imprint reader. The API keeps the database join, the imprint logic and the rate
limiting, and holds no model at all.

## Where the code lives

| File | Role |
| --- | --- |
| `services/pill_vision_core.py` | The encoder, the index and the maths. No FastAPI, no database. Runs unchanged on Render, on the Mac, or on a GPU box. |
| `ml/scripts/vision_service.py` | The standalone service wrapping the core. |
| `routes/identify_photo.py` | The API. Calls the service when `PILL_MATCH_URL` is set, otherwise loads the core in-process. |

## Running it on the Mac

Same box as the imprint reader. It needs the ~115 MB of assets, which it
downloads from Supabase Storage on first boot exactly as the API used to.

```
PILL_VISION_DIR=~/pillseek-vision \
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
PILL_MATCH_KEY=<shared secret> \
uvicorn --app-dir ml/scripts vision_service:app --host 127.0.0.1 --port 8003
```

Then expose it the way the reader is exposed: add an ingress rule to the
existing Cloudflare Tunnel pointing a hostname at `localhost:8003`, and give it
a LaunchAgent so it survives a reboot. `ml/MODELS.md` documents the reader's
`com.pillseek.reader` agent; copy that pattern.

Check it with `GET /health`, which reports the fingerprint count and the
execution providers actually in use.

## Pointing the API at it

Two variables in Render, on the `Pill_project` service:

| Key | Value |
| --- | --- |
| `PILL_MATCH_URL` | `https://<hostname>/match` |
| `PILL_MATCH_KEY` | the same shared secret |

Setting `PILL_MATCH_URL` also stops the API downloading the model assets at
startup, so the 115 MB fetch after every restart goes away.

**Rolling back is unsetting `PILL_MATCH_URL`.** The API then loads the model
in-process again, which is the behaviour that shipped before this change. No
deploy, no code change, no database migration. That is deliberate: the matcher
becoming unreachable should never be a one-way door.

## What happens when the matcher is down

Photo identification degrades rather than failing. If the imprint reader found
something, those matches are returned on their own, with the leave-one-out
guesses ordered behind the full reads. Only when the reader found nothing too
does the endpoint return 503. `tests/test_identify_photo_backends.py` covers
both paths.

## Moving to a GPU later

The service is deliberately host-agnostic. Deploying it on a CUDA box is:

1. Run the same service there, with `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` so it fetches its own assets.
2. Leave `PILL_VISION_PROVIDERS` unset and it will pick CUDA automatically, or
   pin it explicitly.
3. Change `PILL_MATCH_URL` in Render.

Nothing in the app, the website or the API changes. Keep it that way: no Mac
paths and no hardcoded device in the core.

## Tuning

| Variable | Default | Notes |
| --- | --- | --- |
| `PILL_VISION_PROVIDERS` | auto | CUDA, else CoreML, else CPU. Benchmark before trusting CoreML: the encoder is int8, and quantized models often fall back to CPU op by op, which can be slower than pinning `CPUExecutionProvider`. |
| `PILL_VISION_THREADS` | 0 | Intra-op threads; 0 leaves it to the runtime. |
| `PILL_VISION_CPU_ARENA` | 1 | `0` disables ONNX Runtime's CPU memory arena. Costs a little speed, saves a lot of resident memory. Only worth it on a memory-capped box. |
| `PILL_MATCH_WORKERS` | 2 | Concurrent identifications before requests queue. |
| `PILL_MATCH_QUEUE` | 3x workers | How many requests may wait before the service refuses with 503. Waiting requests hold their uploads in memory, so this is a memory limit, not a politeness setting. |
| `PILL_MATCH_LIMIT` | 25 | Ranked slugs returned. The API needs 6 to show and 25 to decide whether a leave-one-out imprint guess is visually confirmed. |
