# PillSeek operations: what runs where

One page for whoever picks this up. No secrets here; the last section says where each one lives.
State as of 2026-09-13.

## Services

| What | Where | Deploys from | Notes |
|---|---|---|---|
| API (FastAPI, this repo) | Render web service | `develop` branch, on push | Build command `bash build.sh`. Serves `/api/*` for the site, the admin and the mobile app. |
| Public site (Next.js, `frontend/`) | Vercel project `pill-project` → pillseek.com | `main` | Proxies `/api/*` to Render. `/admin` is disabled here. |
| Admin (same Next.js code) | Vercel project `pill-project-admin` → admin.pillseek.com | `develop` | `NEXT_PUBLIC_ENABLE_ADMIN=true`. Login = Supabase email code; roles superuser / editor / reviewer / member in `profiles`. |
| Imprint reader (TrOCR base + large) | iMac in the office (LAN 192.168.1.200, ssh user `ar`) | manual | LaunchAgent `com.pillseek.reader`: `/Users/ar/pillseek-reader/ocr_service.py` on port 8002. Log: `/Users/ar/pillseek-reader/reader.log`. |
| Visual matcher (CLIP int8 ONNX) | same iMac | manual | LaunchAgent `com.pillseek.matcher`: `ml/scripts/vision_service.py` in `/Users/ar/pillseek-vision` on 127.0.0.1:8003, CPU provider. |
| Tunnel to the iMac | same iMac | manual | LaunchAgent `com.pillseek.tunnel` runs `cloudflared` with a token: reader.pillseek.com → :8002, matcher.pillseek.com → :8003. Render calls these via `PILL_OCR_URL` / `PILL_MATCH_URL` with `PILL_OCR_KEY` / `PILL_MATCH_KEY`. |
| Database, auth, storage | Supabase project `uqdwcxizabmxwflkbfrb` | manual migrations | Postgres (`DATABASE_URL`), Auth (email one-time codes, SMTP through Resend as noreply@pillseek.com), Storage bucket `user_pill_photos` (private, consented phone photos) and a models bucket. |
| DNS, proxy, WAF | Cloudflare, zone pillseek.com | dashboard | Bot rule blocks non-browser user agents (curl needs a browser UA). WAF skip rule "allow reader api" for the tunnel hosts. Managed Transform "Add visitor location headers" gives captures their city and region. Cloudflare replaces 502/504 bodies from the origin with its own HTML page, so backend error text never reaches the admin for those codes. |
| Email | Resend | dashboard | DKIM set for pillseek.com. Add a `_dmarc` TXT record if not done. |
| Analytics | PostHog, Google Search Console | dashboards | Keys in Render and Vercel env. |

If the iMac reboots, the reader, matcher and tunnel come back by themselves through the LaunchAgents. Check with `launchctl list | grep pillseek` over ssh and `curl https://reader.pillseek.com/health`.

## Repositories and branches

- GitHub `cubit104/Pill_project`. `develop` is the integration branch (Render and the admin go live from it); `main` is the public site. Migrations live in `supabase/migrations/` and are applied by hand to Supabase before the code that needs them is merged; nothing applies them automatically.
- Mobile app lives in `mobile/` on branch `feat/mobile-app` (never merged into develop; the app only talks to the API). Feature branches such as `feat/auto-capture` fast-forward into it.
- On the developer laptop the checkouts are git worktrees: `Pill_project` (feat/mobile-app), `Pill_backend` (backend branches), `Pill_mobile` (mobile feature branches; its `mobile/node_modules` is a junction into `Pill_project`).

## Shipping changes

**Backend or site:** branch from `develop` → PR → merge to `develop` (API and admin redeploy in a few minutes) → merge `develop` into `main` (public site). Run `pytest` in the repo root and `npx tsc --noEmit` in `frontend/` first. The legacy `tests/test_admin_api.py` suite is known to hang; skip it.

**iPhone (Mac only):** the iOS project is a plain copy at `/Users/Shared/pillseek-app` on the iMac, not a git checkout. Copy changed files from `mobile/` there (scp), then over ssh: `export PATH="$HOME/node/bin:$PATH"; cd /Users/Shared/pillseek-app && npm run sync` (tsc, vite build, `cap sync ios`). Then, in a Terminal on the Mac desktop (signing fails over ssh): `bash /Users/Shared/build_pillseek.sh` builds a Debug app and installs it on the plugged-in iPhone. Signed with a free Apple ID, so installs expire after 7 days. Native iOS extras (Vision OCR plugin, time-sensitive notifications) are documented in `mobile/ios-extras-*.md|swift`. Apple Developer Program enrolment was still pending, so no TestFlight yet.

**Android (laptop):** from `Pill_mobile/mobile`: `npx vite build && npx cap sync android`, then in `android/`: `JAVA_HOME=<JDK 21> ./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`. Install with `adb install -r` over USB or Wi-Fi (pair once with `adb pair IP:PORT CODE` from the phone's Wireless debugging screen, then `adb connect IP:PORT`; the port changes each time the phone toggles it, and port-scanning the phone switches wireless debugging off). Release: `./gradlew bundleRelease` signs with the upload key from `android/keystore.properties` (git-ignored) and writes `app/build/outputs/bundle/release/app-release.aab`; bump `versionCode` in `android/app/build.gradle` for every Play upload. See `mobile/README.md` for the rest.

**Reader models:** weights and training notes are in `ml/MODELS.md`. Live rule ("Original"): the large model reads each side full-frame; the base model runs only if large returned nothing on both sides. Training data comes from Admin → Photo Captures → Export for training (signed URLs, 7 days). Don't retrain from synthetic images; that was tried twice and made reads worse.

## Where secrets live (never in git)

- Render → Environment: `DATABASE_URL`, Supabase URL and service key, `PILL_OCR_URL/KEY`, `PILL_MATCH_URL/KEY`, `ALLOWED_ORIGINS` (includes `capacitor://localhost` for the app), PostHog keys, IndexNow key, `GOOGLE_PLACES_KEY` (Find a doctor), `GEMINI_API_KEY` (second imprint reader: paid-tier key; switched on and capped in Admin → Settings → Second reader, results and cost on Admin → Photo Captures).
- Vercel → both projects: Supabase URL, anon key, `API_BASE_URL`; keep `SUPABASE_SERVICE_ROLE_KEY` only on the Render backend (the site code never reads it).
- iMac: the reader and matcher keys are arguments in the LaunchAgent plists under `~/Library/LaunchAgents/`; the Cloudflare tunnel token is in `com.pillseek.tunnel.plist`.
- Laptop: `Pill_backend/.env` holds a real `DATABASE_URL` (for one-off queries via `Pill_project/venv/Scripts/python.exe` with psycopg2) but placeholder Supabase keys, so storage calls do not work locally. `mobile/android/keystore.properties` plus `C:\Users\<user>\.android\pillseek-upload.jks` are the Play upload key; keep a backup of both outside the laptop.
- Supabase dashboard: the Resend SMTP key, auth email templates (must contain `{{ .Token }}`).

## Where to look when something is wrong

- Photo ID reads wrong or nothing: `reader.log` on the iMac, one line per request: `read 2 photo(s), mode=original ... -> tokens | per-side reads | by ['large'|'base'|'blank']`. `by base` on both sides means the large model gave up, usually a soft or far photo. Admin → Photo Captures shows what the user shot, what was read, where it came from, and lets a reviewer label it.
- Admin shows "Request failed": the reply was not JSON, so it came from Cloudflare, Vercel or a restarting Render, not from the API. Check Render logs (`photo sign failed`, `photo delete failed`) and whether a deploy was in progress.
- Photos not showing in the admin: signed URLs come from Render with the service key; check that key on Render and the bucket name `user_pill_photos`.
- Reminders not firing on a phone: the app re-plans notifications on every open from the account's schedule; check the phone's clock and time zone first.
- App can't reach the API: Cloudflare bot rule or `ALLOWED_ORIGINS`; the app sends header `X-PillSeek-App` and a WKWebView/Chrome user agent.
- Local browser previews of the app cannot call pillseek.com through the Vite proxy (Cloudflare 403); run the API locally (`uvicorn` on port 8001 or 8002, `mobile/.env.local` → `VITE_API_BASE`).

## Local development

- API: `pip install -r requirements.txt`, `.env` from `.env.example`, `uvicorn main:app --port 8001`. Tests: `pytest`.
- Admin/site: `cd frontend && npm install && npm run dev` (port 3001 in the worktree config), `.env.local` pointing `API_BASE_URL` at the local API.
- App: `cd mobile && npm install && npm run dev` (Vite on 5173/5180), `npx vitest run`, `npx tsc --noEmit`. Native builds as above.
