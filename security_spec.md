# GitReplay Firestore Security Specification

## 1. Data Invariants

1. **Zero-Trust Ownership**: All persistent user records (`users/{userId}`, `private`, `annotations`, `savedRepos`, `chatMessages`) are strictly partitioned under `/users/{userId}` and require `request.auth != null`, `request.auth.uid == userId`, and `request.auth.token.email_verified == true`.
2. **PII Isolation**: User email addresses are stored exclusively in `/users/{userId}/private/account` and never in shared or public collections.
3. **Path & ID Hardening**: Every document ID (`userId`, `docId`, `annotationId`, `repoId`, `messageId`) must match `^[a-zA-Z0-9_\\-]+$` and have length `<= 128`.
4. **Strict Payload & Size Caps**: All string fields have bounded `.size()` checks; `commits` arrays in `savedRepos` are bounded (`>= 1 && <= 15`); unknown or shadow fields are rejected via `keys().hasOnly(...)`.
5. **Immutable Audit Fields & Server Timestamps**: `uid` and `createdAt` cannot be modified after creation, and `createdAt`/`updatedAt` must equal `request.time`.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Unauthenticated Write**: Create `/users/u1/annotations/a1` with `request.auth == null` -> `PERMISSION_DENIED`.
2. **Cross-Tenant Read**: User `u2` attempts `get` on `/users/u1/private/account` -> `PERMISSION_DENIED`.
3. **Unverified Email Write**: User `u1` with `email_verified: false` attempts to create `/users/u1/annotations/a1` -> `PERMISSION_DENIED`.
4. **Identity Spoofing**: User `u1` creates `/users/u1/annotations/a1` with `uid: "u2"` -> `PERMISSION_DENIED`.
5. **Shadow / Ghost Field Injection**: User `u1` creates `/users/u1` with `{ ..., isAdmin: true }` -> `PERMISSION_DENIED`.
6. **ID Poisoning**: User `u1` attempts to write `/users/u1/annotations/invalid$id..with.dots` -> `PERMISSION_DENIED`.
7. **Denial-of-Wallet String Bloat**: User `u1` creates `/users/u1/annotations/a1` with `note` of 10,000 characters (`> 4000`) -> `PERMISSION_DENIED`.
8. **Client Timestamp Forgery**: User `u1` creates `/users/u1/annotations/a1` with `createdAt: Timestamp(2020-01-01)` (`!= request.time`) -> `PERMISSION_DENIED`.
9. **Immutable Field Mutation**: User `u1` updates `/users/u1/annotations/a1` attempting to change `createdAt` or `commitSha` -> `PERMISSION_DENIED`.
10. **Array Bloat Attack**: User `u1` writes `/users/u1/savedRepos/r1` with 50 commits (`> 15`) -> `PERMISSION_DENIED`.
11. **Invalid Enum Role/Persona**: User `u1` writes `/users/u1/chatMessages/m1` with `role: "system"` -> `PERMISSION_DENIED`.
12. **Blanket List Scraping**: User `u2` attempts `list` on `/users/u1/chatMessages` -> `PERMISSION_DENIED`.
