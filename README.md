# Gmail Ingestion Backend Module — Architecture Documentation

## Overview

The Gmail ingestion backend is a production-ready, modular Node.js/TypeScript service that handles Google OAuth2 flows, securely stores credentials, and provides a robust client for interacting with the Gmail API. It uses Express for routing, Prisma for database access (PostgreSQL), and Zod for runtime validation.

## Module Architecture

The codebase is organized in `src/services/gmail/` with clearly defined responsibilities:

```
src/services/gmail/
├── auth/
│   ├── gmail-oauth.service.ts    # OAuth2 flow, token exchange, auto-refresh
│   └── oauth-state.service.ts    # CSRF state generation and validation
├── client/
│   └── gmail-client.ts           # Type-safe wrapper around googleapis with retry logic
├── ingestion/
│   └── gmail-ingestion.service.ts # Placeholder: Future mailbox sync orchestration
├── processors/
│   └── email-processor.ts        # Placeholder: Future AI content extraction
├── models/
│   └── gmail.types.ts            # Provider-agnostic TypeScript interfaces
├── utils/
│   └── gmail.utils.ts            # Header/body parsing, MIME extraction, Base64 decoding
└── index.ts                      # Top-level barrel export
```

## Key Design Decisions

### 1. Provider-Agnostic Core
- Database models (`UserEmailConnection`, `EmailMessage`) use a `provider` enum.
- The `EmailMessage` model normalizes fields (sender, recipients as JSON, plain text vs HTML bodies).
- TypeScript models in `gmail.types.ts` are designed to be generic where possible, easing future integration with Outlook/Microsoft Graph.

### 2. Token Security
- **No Plaintext Tokens:** Access and refresh tokens are encrypted at the application layer before reaching the database.
- **AES-256-GCM:** We use authenticated encryption (`src/utils/encryption.ts`). The random IV and authentication tag ensure confidentiality and tamper detection.
- **Storage Format:** Ciphertexts are stored as `iv:authTag:ciphertext` (base64 encoded).

### 3. CSRF Protection
- The `/connect` endpoint generates a UUID state via `OAuthStateService`.
- The state is time-limited (15 mins) and single-use.
- The `/callback` endpoint validates and consumes the state before exchanging tokens.

### 4. Gmail Client Abstraction
- Other parts of the codebase **never** call `googleapis` directly.
- The `GmailClient` wrapper translates Google's complex nested payload structures into our clean `GmailMessage` type.
- Built-in exponential backoff retry logic for transient errors (429, 500, 503).

## Database Schema

- **`UserEmailConnection`**: Links a platform user to a provider email address. Stores the encrypted tokens and token expiry.
- **`EmailMessage`**: Stores normalized email data, linking back to the connection.

## API Endpoints

- **`GET /integrations/gmail/connect?userId=...`**
  Returns the Google authorization URL for the user to visit.
- **`GET /integrations/gmail/callback?code=...&state=...`**
  Handles the OAuth redirect, exchanges the code, encrypts tokens, and upserts the DB connection.
