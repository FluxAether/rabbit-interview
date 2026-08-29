# Hosted vendor contract status

Last reviewed: 2026-08-30

This document records the boundary between protocol implementation and evidence from real vendor accounts. Hosted access must remain disabled until every item under **Production gate** is closed.

## Frozen product decisions

- Hosted STT uses Volcengine BigModel streaming recognition. Hosted LLM uses Gemini Interactions with `gemini-3.7-flash`.
- STT charges the sum of accepted source durations. System audio and microphone are separate metered streams.
- Quota is consumed from the earliest-expiring valid bucket first. A legacy season pass does not grant hosted quota; it remains BYOK/Apple-only.
- Gateway accounts use public email-verified registration with manual quota adjustments. Registration grants no hosted quota. Payments remain disabled until a real payment adapter and verified webhook exist.
- The gateway stores account, quota, reservation, usage, and security metadata. It does not persist audio, transcripts, prompts, resumes, or model answers.

## Verified from vendor documentation and local fixtures

| Provider | Contract implemented | Local evidence |
|---|---|---|
| Volcengine STT v3 | `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel`; `X-Api-Key`, `X-Api-Resource-Id`, and `X-Api-Connect-Id`; resource `volc.bigasr.sauc.duration`; binary protocol v1 with gzip payloads | Encoder/parser fixture tests cover regular/final audio frames, split fields, transcript boundaries, offsets, and malformed frames |
| Gemini Interactions | `POST /v1beta/interactions?alt=sse`; API-key header; `interaction.created`, text `step.delta`, completed usage, and failed events | On 2026-08-29, a real `gemini-3.7-flash` stream returned `OK` and final usage of 6 input, 1 output, 11 thought, and 18 total tokens. The 16-token budget produced `interaction.status=incomplete`, now mapped to a `length` terminal state. SSE fixture tests also cover chunk splitting and suppression of thought content |

Primary references:

- Volcengine BigModel streaming recognition: <https://www.volcengine.com/docs/6561/1395846?lang=zh>
- Gemini Interactions API: <https://ai.google.dev/api/interactions-api>

## Not yet verified with real credentials

- Volcengine TLS/auth handshake, short/long/silent audio, clean close, abnormal disconnect, process kill, returned request IDs, error-code mapping, and invoice rounding.
- Gemini cancellation after generation begins, usage when the stream disconnects, and billed-token reconciliation.
- Internal source-duration totals versus vendor invoices, including a 45-minute dual-source session.

Synthetic fixtures and successful compilation are not vendor or billing evidence.

## Production gate

1. Run opt-in probes with dedicated test credentials and archive redacted request IDs, responses, and invoice exports outside the repository.
2. Approve the maximum allowed internal/vendor metering difference and cancellation policy.
3. Replace `gateway.example.com` in the Tauri CSP with the deployed gateway origin and rebuild the desktop package.
4. Deploy and exercise the Gateway OIDC Provider with production Resend, managed MySQL backup/restore, signing/data-key rotation, privacy review, and at least seven days of reconciliation.
5. Keep `PAYMENTS_ENABLED=false`; payment work requires a separate approved provider contract and sandbox evidence.
