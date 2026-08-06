# rm-003 — Real strategy in API responses (CHORE-009)

- **Roadmap:** rm-003
- **Date:** 2026-08-06

## Loop contract

- **spec:** Happy-path JSON from generate/flexify returns `strategy` equal to the design kind (via `designKindToStrategy`) or `flexified` — never the dead hardcode `'generative'`. Paint-save rows inherit a real strategy (`imported` or parent). Insert-while-generating may still use a placeholder.
- **done:** Grep shows no `strategy: 'generative'` on success Response.json bodies; unit/integration assert response strategy matches kind where coverage exists.
- **don't:** Do not break back-compat reading of old DB rows still stored as `generative`.
