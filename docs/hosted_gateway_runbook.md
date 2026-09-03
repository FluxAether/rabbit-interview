# Hosted gateway runbook

Status: pre-production, single replica, public email-verified registration with manual grants and an opt-in Alipay adapter.

The Gateway is OnCue's OIDC Provider and hosted AI resource server. It runs as one Rust process backed by MySQL 8.4. The desktop is the only registered public client and uses Authorization Code with PKCE (`S256`).

## Build and start

```bash
docker build -f server/Dockerfile -t rabbit-gateway:local server
docker run --rm --name rabbit-gateway \
  --env-file .env \
  -v /host/secrets:/run/secrets:ro \
  -p 127.0.0.1:8787:8787 \
  rabbit-gateway:local
```

For a container, set `GATEWAY_LISTEN_ADDR=0.0.0.0:8787`. Terminate with `SIGTERM`; the process stops accepting work, cancels streams, waits up to 15 seconds for tracked tasks, and leaves expired holds for the lease reaper.

Do not run multiple replicas in this version. Login throttles, one-time WebSocket tickets, and active LLM cancellation handles are process-local. Put them in a shared store before horizontal scaling.

## Required configuration

- `DATABASE_URL`: dedicated MySQL 8.4 database user and schema.
- `GATEWAY_PUBLIC_URL`: public HTTPS origin; localhost HTTP is development-only.
- `LANDING_PUBLIC_URL`: public HTTPS landing origin. Production landing and Gateway must be sibling domains under the same site; local development uses `http://localhost:4174` and `http://localhost:8787`. A localhost landing origin also allows the matching `127.0.0.1` origin, and the reverse.
- `GATEWAY_ALLOWED_ORIGINS`: exact Tauri, landing, and development origins, never `*`. The configured landing origin is added automatically.
- `OIDC_CLIENT_ID=rabbit-desktop`.
- `OIDC_REDIRECT_URI=rabbitinterview://auth/callback` and `OIDC_POST_LOGOUT_REDIRECT_URI=rabbitinterview://auth/logout`.
- `OIDC_SIGNING_KEYSET_FILE` and `OIDC_DATA_KEYRING_FILE`: read-only secret files described below.
- `RESEND_API_KEY`: Resend API key (`re_...`).
- `RESEND_FROM`: verified sender, either `no-reply@example.com` or `OnCue <no-reply@example.com>`.
- `RESEND_API_URL`: optional Resend-compatible API origin; defaults to `https://api.resend.com`.
- `GATEWAY_ADMIN_TOKEN`: secret used only by account and quota administration APIs.
- `VOLCENGINE_API_KEY` and `GEMINI_API_KEY`: deployment secrets, never desktop build variables.
- `ALIPAY_APP_ID` and `ALIPAY_SELLER_ID`: the identifiers for the selected Alipay application and merchant.
- `ALIPAY_PRIVATE_KEY`: the unarmored Base64 application RSA2 private key from Alipay. Do not wrap it as PEM.
- `ALIPAY_PUBLIC_KEY`: the unarmored Base64 Alipay RSA2 public key from Alipay. This integration uses public-key mode, not certificate mode.
- `ALIPAY_GATEWAY_URL`: the matching sandbox or production OpenAPI gateway URL.

Set `GATEWAY_TRUSTED_PROXY_CIDRS` only to CIDRs of reverse proxies that replace `X-Forwarded-For`; otherwise the direct peer address is used for throttling.

Keep `HOSTED_STT_ENABLED=false`, `HOSTED_LLM_ENABLED=false`, and `PAYMENTS_ENABLED=false` until their gates are complete. When payments are enabled, startup fails if an Alipay identifier or parseable RSA key is missing. The asynchronous notification URL is derived as `${GATEWAY_PUBLIC_URL}/webhooks/alipay`; the browser return URL is `${LANDING_PUBLIC_URL}/subscribe`.

Both desktop and landing builds need `VITE_HOSTED_GATEWAY_URL=https://your-gateway.example`. Replace `gateway.example.com` in `src-tauri/tauri.conf.json` CSP with the same HTTPS/WSS origin before release. The Gateway allows credentialed CORS only from the exact configured origins; do not use wildcard origins.

## OIDC keys

Create an RSA key outside the repository and make it readable only by the Gateway:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /run/secrets/oidc-2026-08.pem
chmod 600 /run/secrets/oidc-2026-08.pem
```

`OIDC_SIGNING_KEYSET_FILE` points to:

```json
{
  "active_kid": "2026-08",
  "keys": [
    {
      "kid": "2026-08",
      "private_key_file": "/run/secrets/oidc-2026-08.pem"
    }
  ]
}
```

The Gateway derives and publishes the active public JWK. To rotate, add the new private key and make its `kid` active. Keep the previous public JWK in `keys` as `public_jwk` until every previously issued token has expired, then restart after each keyset change.

Generate a 32-byte base64url data key. `OIDC_DATA_KEYRING_FILE` points to:

```json
{
  "active_kid": "2026-08",
  "keys": {
    "2026-08": "REPLACE_WITH_32_BYTE_BASE64URL_VALUE"
  }
}
```

New TOTP secrets and CSRF values use the active data key. Keep every old data key while any `accounts.totp_key_id` or `oidc_browser_sessions.pending_totp_key_id` row references it.

## OIDC endpoints

- Discovery: `/.well-known/openid-configuration`
- Authorization: `/oauth2/authorize`
- Token: `/oauth2/token`
- JWKS: `/oauth2/jwks`
- UserInfo: `/oauth2/userinfo`
- Revocation: `/oauth2/revoke`
- RP-initiated logout: `/oauth2/logout`

The Provider accepts only the fixed Rabbit desktop client, exact custom-scheme callbacks, `response_type=code`, PKCE `S256`, and scopes `openid profile email offline_access`. It does not expose implicit, password, device, client-credentials, or dynamic-registration grants.

All browser-facing authentication UI is served by the landing application under `/auth/*`. The Gateway keeps account state and exposes JSON interactions. Authorization request secrets and account action tokens are carried in URL fragments, cleared from the visible URL by the landing application, and never stored in browser storage. The desktop callback and PKCE exchange remain unchanged.

## Account operations

Users register at `https://your-landing.example/auth/register`. Registration sends a one-time email verification and password setup link valid for 24 hours. It creates no hosted quota; grant quota separately when appropriate. The public explanation is `https://your-landing.example/subscribe`. A signed-in browser session can read remaining quota from `GET /account/subscription/context`.

Administrators can still invite an account:

```bash
curl -fsS -X POST \
  -H "X-Admin-Token: $GATEWAY_ADMIN_TOKEN" \
  -H "X-Admin-Actor: operator@example.com" \
  -H "Content-Type: application/json" \
  https://your-gateway.example/internal/accounts/invitations \
  -d '{"email":"person@example.com","display_name":"Person"}'
```

Invitation and registration setup links are valid for 24 hours. Password-reset links are valid for 30 minutes. Accounts may enable TOTP and obtain single-use recovery codes at `https://your-landing.example/auth/security` after signing in.

Suspend, reactivate, or revoke all sessions using an account UUID:

```bash
curl -fsS -X POST -H "X-Admin-Token: $GATEWAY_ADMIN_TOKEN" -H "X-Admin-Actor: operator@example.com" \
  https://your-gateway.example/internal/accounts/ACCOUNT_ID/suspend
curl -fsS -X POST -H "X-Admin-Token: $GATEWAY_ADMIN_TOKEN" -H "X-Admin-Actor: operator@example.com" \
  https://your-gateway.example/internal/accounts/ACCOUNT_ID/activate
curl -fsS -X POST -H "X-Admin-Token: $GATEWAY_ADMIN_TOKEN" -H "X-Admin-Actor: operator@example.com" \
  https://your-gateway.example/internal/accounts/ACCOUNT_ID/revoke-sessions
```

Look up an account UUID by email, then grant quota. Operators can also use the unlinked landing page `https://your-landing.example/admin`; the admin token stays in that tab and is not stored.

```bash
curl -fsS -X POST   -H "X-Admin-Token: $GATEWAY_ADMIN_TOKEN"   -H "X-Admin-Actor: operator@example.com"   -H "Content-Type: application/json"   https://your-gateway.example/internal/accounts/lookup   -d '{"email":"person@example.com"}'
```

Grant quota by account UUID:

```bash
curl -fsS -X POST \
  -H "X-Admin-Token: $GATEWAY_ADMIN_TOKEN" \
  -H "X-Admin-Actor: operator@example.com" \
  -H "Content-Type: application/json" \
  https://your-gateway.example/internal/accounts/ACCOUNT_ID/quota-adjustments \
  -d '{"metric":"STT_AUDIO_MS","units":3600000,"reason":"invite pilot","valid_until":"2026-09-30T00:00:00Z"}'
```

Use `LLM_TOKEN_UNITS` for LLM grants. Account and quota changes write security audit events. Audio, transcripts, prompts, and answers are not persisted by the Gateway.

## Subscription payments

The self-serve products are one-time purchases with no automatic renewal:

- `PRO_MONTH`: CNY 89, 30 days, 15 STT hours, 2,000,000 LLM units.
- `PRO_QUARTER`: CNY 199, 90 days, 50 STT hours, 8,000,000 LLM units.

Configure an Alipay sandbox application in public-key RSA2 mode, set `ALIPAY_PRIVATE_KEY` and `ALIPAY_PUBLIC_KEY` to the unarmored Base64 key strings from Alipay, set the sandbox gateway URL supplied by Alipay, then set `PAYMENTS_ENABLED=true`. The signed-in landing page creates a server-priced order at `POST /account/payment-orders`; it never submits an amount or quota. Payment is granted only after a verified asynchronous notification or a signed server-side `alipay.trade.query` response. The browser return itself never grants quota.

For sandbox acceptance, buy each product from `/subscribe` and verify all of the following before enabling production payments:

1. Alipay returns literal `success` from the public webhook and the local order becomes `PAID`.
2. One immutable `subscriptions` row and exactly two `SUBSCRIPTION` quota buckets are created for the order.
3. Replaying the notification does not add another subscription or bucket.
4. A mismatched amount, application ID, seller ID, order number, or RSA2 signature returns `failure` and grants nothing.
5. An early renewal starts at the previous paid-through time, so future quota is not spendable early.

Keep `PAYMENTS_ENABLED=false` in production until the merchant account, callback domain, product copy, refund process, privacy review, and archived sandbox evidence are approved.

## Health, recovery, and backups

```bash
curl -fsS https://your-gateway.example/healthz
curl -fsS https://your-gateway.example/readyz
curl -fsS https://your-gateway.example/metrics
```

1. Set `HOSTED_STT_ENABLED=false` and/or `HOSTED_LLM_ENABLED=false`, then restart gracefully. BYOK and Apple remain available.
2. Preserve MySQL; never roll back an applied migration with an older image.
3. Rotate leaked OIDC, Resend, provider, or admin credentials in the secret manager and restart. Revoking the affected accounts' sessions invalidates refresh-token families immediately; access tokens expire within five minutes.
4. Back up MySQL and both OIDC key files together. Test restoration into an isolated environment before production rollout.
5. Inspect active reservations, provider request IDs, and usage metadata. Let leases expire or issue audited adjustments; do not edit usage rows to hide discrepancies.
