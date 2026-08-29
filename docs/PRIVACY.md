# Privacy Policy

Last updated: 2026-08-30

Rabbit Interview is a local-first desktop app. BYOK and Apple speech recognition work without a Rabbit account. The optional hosted mode uses a Rabbit account and gateway for authentication and metered STT and LLM access.

## What stays on this device

- BYOK provider API keys, encrypted in the local SQLite database
- The hosted refresh token, in the OS keychain or credential manager; the short-lived access token stays in memory
- Resume workspace, target role, target company, and job description
- Interview history, transcripts, scores, and recordings
- Settings, licenses, and recovery snapshots

## What leaves this device

In BYOK mode, audio, transcripts, resume text, and job descriptions may be sent directly to the provider you select, such as Groq, OpenAI, Anthropic, Gemini, or Deepgram.

In hosted mode, the selected system-audio and microphone streams pass through the Rabbit gateway to Volcengine for transcription. Questions and the context needed to generate an answer pass through the gateway to Gemini. The gateway does not persist audio, transcripts, prompts, resumes, or answers.

The hosted service stores the account email address, display name, salted password hash, optional encrypted TOTP secret and recovery-code hashes, browser and refresh-token session records, quota buckets, reservations, provider request IDs, and metering metadata. It does not store plaintext passwords, TOTP secrets, recovery codes, or bearer tokens. Usage metadata is retained for 730 days; security audit events are retained for 30 days.

## What we do not collect

BYOK provider keys are never sent to Rabbit. The gateway logs operational metadata and error categories, not JWTs, provider keys, audio, transcripts, prompts, resumes, or complete answers.

## Your responsibilities

You are responsible for third-party provider terms, API cost, interview-host rules, and recording consent.

## Deletion

Settings → Shortcuts & Privacy → Clear local data removes history, settings, resume workspace, recording metadata, BYOK keys, and the hosted refresh token from this device. It does not delete required hosted billing/security records. Public registration must not be promoted to production until an account-deletion contact and reviewed retention process are published.
