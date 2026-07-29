# ADR-0004: scrypt passwords + opaque hashed session tokens

Status: accepted · Date: 2026-07-29

## Decision

- Passwords hashed with Node's built-in `scrypt` (N=2^15, r=8, p=1, 32-byte salt) — no native
  addon dependency; parameters stored alongside the hash for future migration.
- Sessions are opaque 256-bit random tokens; only the SHA-256 hash is stored. Lookup is by
  hash; tokens are revocable and expire (30 days), satisfying "secure session rotation" and
  device session management.
- JWTs rejected for first-party sessions: revocation and rotation matter more than statelessness
  on a single-DB deployment.
- Architecture is OIDC-ready: `sessions` don't assume password auth; an OIDC identity table can
  attach to `users` without schema surgery. MFA columns reserved (`users.mfa_enrolled`).

## Consequences

+ Zero native deps; instant revocation; no signing-key management.
− DB hit per request (acceptable; Redis session cache is a drop-in later).
