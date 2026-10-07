# Qwen3.8 self-host-on-rented-GPU via Modal

Modal rents a GPU; inference itself runs Qwen3.8-27B-FP8 through vLLM in our container. It is **not** a third-party text model API. No GPU runs while scaled to zero.

## Setup

1. Create a Modal account at https://modal.com and a Workspace. **Set a Workspace hard spend limit first**. Modal Starter includes a monthly $30 compute credit, but CPU, memory, cold loading, and GPU all consume it; this project cannot read the actual invoice.
2. Create a secret named `riri-modal-auth` containing `RIRI_MODAL_SECRET` with at least 32 random characters. Do not put it in GitHub.
3. Deploy from a terminal or GitHub Actions with `modal deploy riri-modal/app.py`, using your own `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` GitHub Actions secrets. Never commit those.
4. Modal prints a HTTPS URL for the `chat` Web Function. Set it as Cloudflare `MODAL_URL` and set the same `RIRI_MODAL_SECRET` as `MODAL_SECRET` (both Wrangler secrets).
5. Test a message from an account you own after enabling polling/send.

**Cost caveat**: Model startup may take minutes and caching/download can consume credits. Modal deployment and live inference have **not** been performed here. GPU L40S 48GB. Current official pricing: https://modal.com/pricing

**Payment**: Modal does not natively charge the user's PayPay balance via these files. The Worker approval endpoint merely lifts a *software-estimated* compute ceiling. Actual paid use additionally requires Modal's own payment method and Workspace spending limit.
