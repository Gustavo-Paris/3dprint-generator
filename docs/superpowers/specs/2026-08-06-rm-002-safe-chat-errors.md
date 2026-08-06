# rm-002 — User-safe failure messages in chat (BUG-009)

- **Roadmap:** rm-002
- **Date:** 2026-08-06

## Loop contract

- **spec:** Failed iterations and client API errors never dump SQL, stack traces, or raw JSON into the chat. DB `iterations.error` holds a short PT-BR string; technical detail stays in structured logs. History reload uses the same sanitizer as a belt.
- **done:** Unit tests for sanitizer; failed-history bubble never contains `SELECT`/`INSERT`/`Error:` stack patterns when fed technical strings; generate/flexify/paint-save write short PT-BR on fail paths.
- **don't:** Do not remove server-side `log.error` detail; do not weaken `apiError` envelope contract.
