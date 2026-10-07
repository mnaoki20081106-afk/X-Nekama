# Riri personal Cloudflare backend

The tweak provisions one Worker, one D1 database, and a workers.dev URL inside the selected user's Cloudflare account. Workers AI replaces the VPS/Ollama daemon. The built-in model is `@cf/qwen/qwen3-30b-a3b-fp8`; this is a model change from the earlier Qwen2.5 configuration. The implementation creates no paid subscription or paid-plan upgrade. Users already on paid Cloudflare plans remain subject to their own plan's billing; free usage is not unlimited.

First launch asks for the user's numeric X ID, opens Cloudflare login/consent using ASWebAuthenticationSession and PKCE S256, provisions resources, probes the DB and AI, then saves the Worker URL and unique connection secret in Keychain. New-account email verification, service activation, consent, and multiple-account selection cannot be bypassed. No X cookie files are uploaded. The short default character prompt can be changed through authenticated `POST /profile`; the earlier Python persona files are not automatically migrated.

## Publisher registration still required

`RiriOAuthConfig.h` deliberately has blank configuration. Login is unavailable until the publisher supplies a real Cloudflare OAuth client with authorization-code flow, token endpoint authentication `none`, and public visibility. A public client requires a client URL with completed DNS ownership verification, plus a logo and other required fields. There is no client secret in the app. Do not substitute Wrangler's client ID or a fabricated ID.

Register scopes from Cloudflare's `/oauth/scopes` catalog that grant account listing, Workers script and account subdomain editing, D1 database creation/query, and Workers AI inference. Scope IDs must match the registered client. Use the minimum permissions that cover those endpoints. Publish `publisher/callback.html` and `callback.mjs` at the exact HTTPS redirect location; serve without analytics, tracking, or query logging, and set `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. This small static relay returns only code/state to `riri-cloudflare://oauth/callback`; token exchange takes place on device.

Once real registration values are available, `tools/configure_oauth.py` writes the public client header. Rebuild through the standalone GitHub workflow. Native configuration values are public identifiers, not account API tokens. Access tokens are held in memory only during provisioning, then discarded. Re-running setup uses the same install-specific resource names and saved connection secret when present. Existing connections remain saved until the new setup check succeeds. Account/database lists cover the first 50/100 entries respectively; larger accounts require pagination support.

Official references:

- https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/
- https://developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare/
- https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/

## Runtime and delivery limits

The X runtime class, getters, and `sendMessageWithText:attachment:` selector are not verified against an actual X IPA/device. The hook checks method signatures, required IDs, and the current conversation; unsupported versions skip processing/sending rather than guessing another selector. A returned native method call is recorded as `submitted`, not confirmed delivery. The current conversation controller must still exist when generation finishes. Closing/suspending the app can prevent replies. Generation is triggered only by this hooked event; it is not a server-side X subscription.

Message insertion is idempotent and `/claim` atomically grants a draft once. Failed generation is marked `needs_review`; failed/ambiguous send attempts are never retried automatically. A lost claim response can leave a claimed message unsent; this favors avoiding duplicate messages. This is at-most-once submission, not exactly-once delivery. Stored conversations are private to each user's account and authenticated by a unique random secret. No retention cleanup is currently scheduled; storage quota exhaustion returns a service failure.

## Validation

`node --test tests/*.test.mjs` runs production SQL against real SQLite and mocks only Cloudflare AI. It verifies authentication, setup failures, own-message exclusion, duplicate generation, concurrent claiming, acknowledgements, conversation isolation, persona selection, streamed payload limits, model output parsing, and relay validation. Cloudflare live provisioning and actual X device delivery still need integration validation after publisher registration.

`tools/embed.py` creates the native embedded payload. The CI runs backend tests, regenerates this header, compiles an arm64 MH_DYLIB with Theos, and verifies its architecture and ad-hoc signature.
