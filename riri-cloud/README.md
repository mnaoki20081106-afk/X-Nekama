# Riri — Cloudflare + Modal deployment notes

This prototype separates X DM polling from Qwen GPU inference, and stores recent conversation state and a conservative usage budget in Cloudflare D1. Qwen3.8 runs on a Modal rented GPU with vLLM, not a third-party model inference provider.

**Not live-deployed or proven to work with X.** The unofficial X web interface may change, may not expose encrypted XChat messages, and may refuse datacenter requests. Keep it disabled until tested with your own account.

## Configuration

1. Sign up for Cloudflare Workers/D1 and Modal Starter.
2. In the Modal dashboard, set the actual Workspace spend limit **before** trying GPU inference. The included monthly compute credit and real billable amount are controlled by Modal; the software-only budget here is merely an estimate.
3. Create the Modal secret `riri-modal-auth` with a long `RIRI_MODAL_SECRET`. Deploy `riri-modal/app.py` with `modal deploy riri-modal/app.py`. This requires authentication to your own Modal workspace.
4. Create a Cloudflare D1 database called `riri-qwen-d1`, initialize it using `riri-cloud/schema.sql`, and configure its UUID in `riri-cloud/wrangler.toml`. In Workers, set your own account ID, a protected Worker connection key, a separate admin key, and the URL/credential of the Modal endpoint as private secrets. Do not include credentials in Git source.
5. Set `OWN_USER_ID` to your own numeric X ID. Unofficial X session access requires a valid authenticated session that you control; no third-party account credentials should be supplied. Keep `X_POLL_ENABLED=false` and `AUTO_SEND_ENABLED=false` until tests pass.
6. Once configured, the Worker can be deployed with `npx wrangler deploy`. Cron runs every five minutes. Direct model requests can take considerably longer on a cold GPU.

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
