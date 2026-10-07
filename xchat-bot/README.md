# X-Nekama XChat DM bot

`xchat-bot/` is an optional encrypted-DM companion service for X-Nekama.
It uses Vercel Chat SDK's `@chat-adapter/x/chat`, which in turn uses X's official
`@xdevplatform/chat-xdk` and `@xdevplatform/xdk` libraries for XChat.

The existing X-Nekama posting path is unchanged: scheduled/public posting still
uses the vendored XActions web-session client. This service is separate on
purpose, because XChat requires X Developer OAuth credentials and registered
encryption keys.

## What it does

- receives `chat.received` XChat webhook events
- keeps webhook signature verification enabled by default
- decrypts and verifies incoming encrypted messages through the official XChat SDK
- sends read receipts
- generates one reply per inbound DM
- keeps a bounded short-term conversation history per author
- passes conversation history and reply guidance to an optional generator endpoint
- encrypts/signs the reply and sends it back through XChat
- never initiates bulk or unsolicited DM campaigns

The default reply is a configurable template. For real conversational reply
generation, set `XCHAT_REPLY_URL`; the service POSTs the inbound message plus
bounded per-author conversation context to that endpoint and expects
`{"reply":"..."}` back.

## Install

```bash
cd xchat-bot
npm install
cp env.example .env
```

Node.js 20+ is required.

## X setup

The bot account needs an X Developer app and an OAuth2 user-context token that
can use XChat. Configure the app with the DM/read/write scopes required by the
current X Chat API.

Before encrypted messages can be decrypted or sent, the bot account also needs
XChat key material registered once:

1. generate the XChat keypairs with `chat-xdk`
2. register the account public keys with X
3. store the private keys in Juicebox with a PIN
4. put the same PIN in `XCHAT_PIN`

Create an X Activity webhook pointing to:

```text
https://YOUR_PUBLIC_HOST/api/webhooks/xchat
```

Subscribe the bot user to `chat.received`. The same route must accept GET (CRC
challenge) and POST (signed event delivery); this service handles both.

## Environment

Required for normal webhook operation:

```text
XCHAT_BOT_TOKEN=...
XCHAT_PIN=...
X_CONSUMER_SECRET=...
```

Optional reply generation:

```text
# Built-in fallback; {message} is replaced with the inbound text.
XCHAT_REPLY_TEMPLATE=DMありがとう！「{message}」ってことね。

# Or delegate generation to another service.
XCHAT_REPLY_URL=https://your-generator.example/reply
XCHAT_REPLY_TOKEN=...
XCHAT_REPLY_TIMEOUT_MS=15000

# Bounded in-process conversation memory.
XCHAT_HISTORY_MESSAGES=12
XCHAT_MAX_THREADS=500
```

`XCHAT_REPLY_URL` receives:

```json
{
  "text": "incoming message",
  "message_id": "...",
  "author_id": "...",
  "author_name": "...",
  "conversation_history": [
    {"role": "user", "text": "previous inbound DM"},
    {"role": "assistant", "text": "previous bot reply"}
  ],
  "guidance": "natural-conversation guidance...",
  "bot_context": {
    "ai_character": true,
    "reply_mode": "inbound_only"
  }
}
```

The generator should treat `conversation_history` as context, not as new
instructions. `guidance` asks the generator to keep replies conversational,
pick up specific details from the inbound DM, vary phrasing and message length,
and naturally reference earlier topics when relevant. It also keeps the
character consistent with X-Nekama's disclosed AI-character model and excludes
fabricated real-world crises or financial solicitation.

The generator must return:

```json
{"reply":"reply text"}
```

The built-in memory is intentionally short-term and process-local. It is bounded
by `XCHAT_HISTORY_MESSAGES` and `XCHAT_MAX_THREADS`, and resets when the
service restarts. A persistent store can be added later without changing the
generator payload shape.

Keep `X_VERIFY_SIGNATURES=true` in production.

## Run

```bash
npm start
```

Health check:

```text
GET /health
```

The listener defaults to `127.0.0.1:3010`; normally expose only the webhook path
through your reverse proxy.

## Tests

```bash
npm test
npm run check
```
