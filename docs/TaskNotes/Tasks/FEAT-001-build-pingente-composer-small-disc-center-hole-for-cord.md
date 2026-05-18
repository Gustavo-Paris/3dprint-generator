---
uid: feat-001
status: open
priority: normal
scheduled: 2026-05-18
timeEstimate: 30
pomodoros: 0
projects:
- '[[sprint.md|Current Sprint]]'
contexts:
- phase:8
- composers
- pingente
blockedBy:
- chore-001
tags:
- task
- feat
ai:
  parallelParts: 0
  needsReview: true
  uncertainty: med
  hintsInferred: true
---

# Build pingente composer (small disc + center hole for cord)

Variação menor da medalha, mais delicada. Pendant pra cordão/colar.

## Especificações sugeridas

- Diâmetro: 25-30mm (menor que medalha de 60mm)
- Espessura: 3mm
- Furo do cordão: 2-3mm, mais próximo da borda
- Logo: vazada atravessando, ou gravada (configurable)

## Implementação

1. Copy `src/lib/compose/medal.ts` → `src/lib/compose/pingente.ts`
2. Ajustar defaults: diameter 28, thickness 3, holeD 2.5
3. Logo size 0.7 (menor proporção pra dar mais material em volta)
4. Criar `detect-pingente.ts` com triggers: pingente, pendant, colar
5. Wire em `/api/generate` antes de medal
6. Atualizar `Chat.tsx` label "Pingente com tua logo"

## Subtasks

- [ ] Criar `src/lib/compose/pingente.ts`
- [ ] Criar `src/lib/compose/detect-pingente.ts`
- [ ] Wire no route + Chat label
- [ ] Testar com logo da ToStudy
- [ ] Testes verdes: `pnpm exec vitest run`

## Related

- [[CHORE-001-commit-composers-phase-universal-compose]] — depois deste
- `src/lib/compose/medal.ts` — template
- `src/lib/compose/coaster.ts` — flat disc reference
