# Riri — Cloudflare + Modal deployment notes

This prototype separates X DM polling from Qwen GPU inference, and stores recent conversation state and a conservative usage budget in Cloudflare D1. Qwen3.8 runs on a Modal rented GPU with vLLM, not a third-party model inference provider.

**Not live-deployed or proven to work with X.** The unofficial X web interface may change, may not expose encrypted XChat messages, and may refuse datacenter requests. Keep it disabled until tested with your own account.

## Configuration

1. Sign up for Cloudflare Workers/D1 and Modal Starter.
2. In the Modal dashboard, set the actual Workspace spend limit **before** trying GPU inference. The included monthly compute credit and real billable amount are controlled by Modal; the software-only budget here is merely an estimate.
3. Create the Modal secret `riri-modal-auth` with a long `RIRI_MODAL_SECRET`. Deploy `riri-modal/app.py` with `modal deploy riri-modal/app.py`. This requires authentication to your own Modal workspace.
4. Create a Cloudflare D1 database called `riri-qwen-d1`, initialize it using `riri-cloud/schema.sql`, and configure its UUID in `riri-cloud/wrangler.toml`. In Workers, set your own account ID, a protected Worker connection key, a separate admin key, and the URL/credential of the Modal endpoint as private secrets. Do not include credentials in Git source.
5. Set `OWN_USER_ID` to your own numeric X ID. Unofficial X session access requires a valid authenticated session that you control; no third-party account credentials should be supplied. Keep `X_POLL_ENABLED=false` and `AUTO_SEND_ENABLED=false` until tests pass.
6. Once configured, the Worker can be deployed with `npx wrangler deploy`. Cron runs every minute and typically polls X once every two minutes within the configured reply windows. Direct model requests can take considerably longer on a cold GPU.

## Reply windows (Japan time)

- 07:00–09:00
- 12:00–13:30
- 19:00–01:00

New messages are deduplicated by ID. When outbound submission is uncertain, the Worker **does not retry automatically**, to avoid duplicates.

## Budget approval

Initial estimated monthly compute allowance is **15 USD**, subject to the monthly Modal credit and other consumption. The independent admin endpoint `POST /admin/approve` accepts the current Japanese calendar month, a confirmed extra allowance in US cents, and a separate admin key. This authorizes **future GPU use only**. It cannot collect money or approve a PayPay transfer.

**There is no PayPay-to-Modal payment flow.** A user pressing approve must still have a supported Modal payment method to actually pay charges. The actual Workspace spend limit in Modal is the controlling safeguard. Neither this prototype nor the approval endpoint determines the exact Modal invoice.

## Status and tests

- `node --test riri-cloud/tests/*.test.mjs`
- `python -m py_compile riri-modal/app.py`
- GitHub Actions workflow `Riri cloud and Modal checks` runs both automatically on this branch.

These tests use fixture messages; they do not prove live DM delivery, model downloading, GPU memory sufficiency, or billing. The API should be verified against the specific X version and model environment before unattended operation.

## Smartphone-only deployment via GitHub Actions

After reviewing and merging this branch into the default branch, the two manual deployment workflows can be invoked from GitHub's **Actions** page on a smartphone. They do not require installing Docker, Python or Wrangler on a personal computer.

- **Riri Modal manual deploy** expects the repository secrets `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`; create the `riri-modal-auth` secret on Modal beforehand.
- **Riri Cloudflare manual deploy** expects `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `RIRI_OWN_USER_ID`. It finds or creates the free D1 database, initializes the schema, and publishes the Worker plus its static admin screen.
- In the Cloudflare dashboard, configure the private Worker values `BOT_SECRET`, `ADMIN_SECRET`, `MODAL_URL`, `MODAL_SECRET` and the session credentials for the X account that you control. Do not put any credentials in repository files. Initial X reading and sending stay off.
- Visit `https://YOUR-WORKER.workers.dev/admin/` on your phone and enter your `ADMIN_SECRET` to review estimates or approve a higher allowance. This is **not a payment transaction**.
- Switch `X_POLL_ENABLED` and `AUTO_SEND_ENABLED` on only after live testing and a verified Workspace spend limit.

The manual Actions workflows usually must exist on the repository's default branch before GitHub makes them available in the mobile Actions UI. All external service accounts, secrets, and payment methods remain under your control.

## Natural dialogue v2: memory, bursts, personas, reply speed and quality tests

### 1. Long-term memory

D1 table `conversation_memory` stores a compact rolling per-conversation summary. The self-hosted Modal Qwen3.8 receives the previous summary, recent dialogue and new messages together; it returns JSON `{reply,memory_summary}` in one GPU invocation to avoid a separate paid summarization call. The Worker strips common credentials/contact fields from generated summaries, but automated filtering is not infallible: avoid sending sensitive data to the bot. This is a **best-effort summary**, not guaranteed recall.

Protected API: `GET /admin/memory?conversation_id=123-456`, `DELETE /admin/memory?conversation_id=123-456` with `X-Admin-Secret`.

### 2. Multiple incoming messages

Same-conversation queued messages are joined after a **60-second quiet window** (configurable `DM_QUIET_MS`, clamped 15–300 seconds). One GPU call creates **one** answer for up to six recent message fragments; all messages in the group are atomically claimed by state transitions, with older rows marked `rolled_up` to prevent one reply per fragment. D1 `conversation_leases` reduce concurrent processing. Newer queued messages cannot overtake an older unsubmitted draft.

### 3. Configurable persona

Profile can be set globally or for a numeric conversation ID. Personality fields include display name, tone, interests, about, interaction style, and reply length. Profiles are stored in D1 and validated server-side. The model is instructed to disclose AI automation if asked and to avoid fabricated real-world activity or deceptive money solicitation.

Phone page: `https://YOUR-WORKER.workers.dev/settings/`. Admin endpoints `GET|POST|DELETE /admin/profile` use the `X-Admin-Secret` header, with optional `?conversation_id=123-456`. `POST` takes `{"persona":{"display_name":"Riri AI","tone":"柔らかい日本語","interests":["映画"],"reply_length":"short","about":"XのAIアシスタント","interaction":"相手の質問に答える"}}`.

### 4. Faster reply, limited spend

Cloudflare cron is **every minute**, with X polling at most **every 2 minutes** during the configured JST windows by default. There is no real X push hook in this implementation. The GPU still scales to zero; Modal idle scale-down is 90 seconds to reuse a model briefly between nearby messages. Cold start can take minutes and is not eliminated. Increasing warm idle time can cost more, so watch the real Modal Workspace spend limit. Existing approval/account defaults remain unchanged.

### 5. Repeatable tests

- `node --test riri-cloud/tests/*.test.mjs`: isolated policy tests and D1/Modal mock end-to-end simulations.
- `python -m py_compile riri-modal/app.py`: syntax test.
- GitHub Actions **Riri cloud and Modal checks**: automatically runs these on `main` and the feature branch.
- GitHub Actions **Riri live Qwen dialog QA (manual, GPU billing)**: only when deliberately triggered, performs up to 20 *synthetic* Japanese DM exchanges against the real Modal GPU, measures average/p95 inference latency, checks concise answers and AI disclosure. Requires repository secrets `RIRI_MODAL_URL` and `RIRI_MODAL_SECRET` and an actual deployed Modal model. Costs real GPU credits. It **does not send X messages**.

**Still untested:** X live ingress/egress, encrypted XChat, actual GPU model loading, physical iPhone behavior, invoice amount, and real conversation quality. The nonofficial X endpoints may cease to work. All cloud credentials/payment setup require owner approval; deployment not automatic.

### Confirming Qwen is actually running

The tweak's `/setup-check` only reports `model_ready:true` **after a real Qwen response is received**. Once Modal has been deployed and the Worker has `MODAL_URL`/`MODAL_SECRET`, visit `https://YOUR-WORKER.workers.dev/settings/`, supply `ADMIN_SECRET`, and press **Qwen接続を確認（GPU利用あり）**. This confirmation explicitly allows one billed GPU inference and stores the verified model endpoint in D1. It may take several minutes from a cold start. Merely entering an API URL does not prove that Qwen can load.

The live 20-turn test is a separate, manually dispatched GitHub Action and is deliberately **not** run automatically or billed without user action. Cloudflare's scheduled Workers have a 15-minute wall-time ceiling, so jobs that exceed it need a more durable async execution approach.

## Adaptive conversation cadence (not artificial human impersonation)

The reply engine now computes timing for each conversation from its last successfully submitted answer, instead of requiring a fixed 60-second pause after every DM. `riri-cloud/cadence.mjs` is pure and unit-tested.

| `DM_PACE` mode | Within four minutes of last sent message | New conversation | Returning after ≥35 minutes |
|---|---:|---:|---:|
| `adaptive` (default) | 4.5 sec | 18 sec | 75 sec |
| `quick` | 2.5 sec | 8 sec | 30 sec |
| `relaxed` | 12 sec | 45 sec | 135 sec |

These are *minimum quiet intervals between incoming messages and starting inference*. They are not delivery SLAs. GPU cold start, model generation, X detection and network latency are additional and may take minutes. Natural dialogue quality depends on actual model evaluation; the app does not impersonate a human.

The Worker contains an optional `ConversationTimer` Durable Object for alarm-based wakeups triggered by the tweak's `/ingest` event. **Important: Durable Object deployment binding is not yet configured in the current `wrangler.toml`; therefore sub-minute wakeups are NOT ACTIVE in a normal deployment.** The 1-minute cron remains the fallback, and X-side legacy web polling at ~2-minute intervals cannot detect a DM within seconds while the app is closed. Cloudflare Workers Free supports SQLite-backed Durable Objects, including alarms, but availability, accounting and live operation need verification. Do not claim a 3-second end-to-end service until the binding is configured and a real X/Modal test passes.

Uncertain X sends are never automatically replayed; per-conversation leases prevent concurrent generation. Inference is queued and budgets require explicit user permission before increasing paid usage. No scheduled test runs billable GPU without an explicit user action.
