# Privacy Policy

Last updated: 2026-09-05

OnCue is a local-first desktop app. An OnCue account and online sign-in at startup are required. Hosted STT and LLM share a credit balance. Using custom provider API keys requires a separate ¥39 lifetime account unlock; Apple on-device recognition does not consume credits. Purchased credits do not expire; the one-time 300-credit registration gift expires after 30 days.

## What stays on this device

- BYOK provider API keys, encrypted in the local SQLite database
- The hosted refresh token, in the OS keychain or credential manager; the short-lived access token stays in memory
- Resume workspace, target role, target company, and job description
- Interview history, transcripts, scores, and recordings
- Settings, licenses, and recovery snapshots

## What leaves this device

In BYOK mode, audio, transcripts, resume text, and job descriptions may be sent directly to the provider you select, such as Groq, OpenAI, Anthropic, Gemini, or Deepgram.

In hosted mode, the selected system-audio and microphone streams pass through the OnCue gateway to the operator-selected transcription provider (Volcengine, Deepgram, or Gemini Live). Questions and the context needed to generate an answer pass through the gateway to the operator-selected LLM provider (Gemini, OpenAI, Anthropic, or Groq). The active provider and model may change between new requests. The gateway does not persist audio, transcripts, prompts, resumes, or answers. Third-party provider processing remains subject to that provider's terms; when Gemini Live session resumption is used, Google may retain resumable session state during its two-hour handle-validity window.

If you choose a hosted subscription, Alipay receives the merchant order number, product description, and payment amount needed to complete payment. OnCue does not receive or store your Alipay password or payment credential.

The hosted service stores the account email address, display name, salted password hash, optional encrypted TOTP secret and recovery-code hashes, browser and refresh-token session records, quota buckets, reservations, payment order and provider transaction identifiers, allowlisted payment-event metadata, subscription periods, provider request IDs, and metering metadata. It does not store plaintext passwords, TOTP secrets, recovery codes, bearer tokens, or payment credentials. Usage metadata is retained for 730 days; security audit events are retained for 30 days.

## What we do not collect

BYOK provider keys are never sent to OnCue. The gateway logs operational metadata and error categories, not JWTs, provider keys, audio, transcripts, prompts, resumes, or complete answers.

## Your responsibilities

You are responsible for third-party provider terms, API cost, interview-host rules, and recording consent.

## Deletion

Settings → Shortcuts & Privacy → Clear local data removes history, settings, resume workspace, recording metadata, BYOK keys, and the hosted refresh token from this device. It does not delete required hosted billing/security records. Public registration must not be promoted to production until an account-deletion contact and reviewed retention process are published.
