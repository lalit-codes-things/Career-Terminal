# CSRF Threat Model — ApplyWise API

## Authentication Mechanism

ApplyWise uses **stateless Bearer token authentication exclusively**.

- Access tokens are short-lived JWTs sent via the `Authorization: Bearer <token>` HTTP header.
- Refresh tokens are exchanged via `POST /auth/refresh` — also via the `Authorization` header body, not a cookie.
- **No session cookies are set by the server.**
- **No `Set-Cookie` response headers are emitted anywhere in the API.**

## CSRF Applicability

**Standard CSRF attacks are NOT applicable to ApplyWise.**

CSRF exploits the browser's automatic cookie attachment behaviour: a malicious page can trigger a state-changing request to the victim API because the browser silently includes the victim's session cookie. Since ApplyWise does not use cookies for authentication, a cross-origin form submission or `fetch()` from a malicious origin:

1. Will not carry any credential — the access token lives only in the calling application's JavaScript memory.
2. Will be blocked at the CORS layer unless the origin is in the allowed origins list.
3. Even if the CORS preflight is somehow bypassed (e.g., simple request), the server will reject the request at `requireAuth` because no `Authorization: Bearer` header is present.

## OAuth Callback CSRF Protection

The Gmail OAuth callback (`GET /integrations/gmail/callback`) is a public endpoint (required because Google redirects there). It is protected against CSRF via the **OAuth state parameter**:

- On `GET /integrations/gmail/connect`, the server generates a cryptographically random, server-signed state token and embeds the authenticated user's ID within it.
- Google's OAuth server returns this state token unchanged in the callback query parameter.
- `gmailOAuthService.handleCallback(code, state)` verifies the state token's signature and extracts the userId from it — the user's identity is never derived from a caller-supplied query parameter.
- An attacker who crafts a callback URL cannot forge a valid state token without the server's signing secret.

## Recommendations

| Control | Status | Notes |
|---|---|---|
| CSRF token middleware | Not required | Bearer-only auth |
| `SameSite` cookie attribute | Not applicable | No cookies set |
| `Origin`/`Referer` header validation | Implemented (CORS layer) | Blocks cross-origin requests |
| OAuth state token | ✅ Implemented | Protects `/integrations/gmail/callback` |

## Future Consideration

If ApplyWise ever introduces session-cookie-based authentication (e.g., a web browser UI with `HttpOnly` session cookies), CSRF protection **must** be implemented before that feature ships. At that point:

- Add `SameSite=Strict` or `SameSite=Lax` to all session cookies.
- Implement a synchronizer token pattern or `Double Submit Cookie` pattern.
- Validate `Origin` header on all state-changing routes.
- Revisit this document.
