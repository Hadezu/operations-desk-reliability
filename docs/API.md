# API notes

All endpoints are same-origin. Mutations require `Origin` matching the configured `APP_ORIGIN`; except demo bootstrap they require the current `X-CSRF-Token`. Session cookies are HttpOnly, SameSite=Lax and Secure on HTTPS. Mutations accept JSON, bounded at 16 KiB. No organization or role supplied by the client is trusted.

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/health` | Database readiness and background mode |
| GET | `/api/openapi.json` | Generated idempotent command contract |
| POST | `/api/demo` | Reuse valid session or create a private workspace |
| GET | `/api/session` | Current identity, CSRF token, available demo identities |
| POST | `/api/session/switch` | Switch to `memberId` in the same demo workspace |
| DELETE | `/api/session` | Revoke server session and expire cookie |
| GET | `/api/requests` | Tenant/role-scoped list; status/category/cursor/limit |
| POST | `/api/requests` | Create own draft; requires idempotency key |
| GET | `/api/requests/:id` | Scoped request |
| PATCH | `/api/requests/:id` | Edit own draft with expected version and idempotency key |
| DELETE | `/api/requests/:id` | Delete own draft with expected version |
| POST | `/api/requests/:id/submit` | Own draft → submitted; version and idempotency key |
| POST | `/api/requests/:id/decision` | Manager approval/rejection; version, comment and key |
| GET | `/api/requests/:id/audit` | Scoped activity, at most 200 entries |
| GET | `/api/requests/:id/report` | Report, outbox and at most 100 attempt entries |
| POST | `/api/requests/:id/replay` | Manager-only terminal failed report replay with reason |

Command keys: 8–100 alphanumeric, underscore or hyphen characters. Keys are unique per organization, member and operation. A key with a different normalized body returns `409 IDEMPOTENCY_MISMATCH`. Stale state/version returns `409 VERSION_CONFLICT`. A foreign record is not disclosed. Observer writes return 403 even when directly invoking the API.

The list defaults to 25 records, maximum 50, ordered by `created_at DESC, id DESC`. Cursor values are validated and bound to the active filters. Cursor contents are pagination position, not authorization. Pagination is not a historical snapshot: changing a filter starts a fresh list.

Draft deletion and failed replay are not stored idempotent commands. Repeated deletion returns 404; replay uses a conditional terminal-state update, so only one concurrent replay succeeds. Audit remains after draft deletion, but the request detail endpoint is intentionally unavailable after deletion.
