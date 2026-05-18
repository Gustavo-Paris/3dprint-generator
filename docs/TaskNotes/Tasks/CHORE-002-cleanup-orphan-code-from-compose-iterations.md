---
uid: chore-002
status: open
priority: low
scheduled: 2026-05-18
timeEstimate: 30
pomodoros: 0
projects:
- '[[sprint.md|Current Sprint]]'
contexts:
- phase:8
- cleanup
- refactor
blockedBy:
- chore-001
tags:
- task
- chore
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: low
  hintsInferred: true
---

# Cleanup orphan code from compose iterations

Durante a sessão acumulei vários módulos que ficaram inalcançáveis após simplificações de rota. Remover antes de ficar confuso.

## Código órfão suspeito (verificar grep antes de deletar)

- `src/lib/prompt/classify.ts` — classificador parametric vs generative, removido da route
- `src/lib/prompt/build.ts` — buildMessages do path parametric (removido)
- `src/lib/prompt/base-detect.ts` — detect-base, removido da route
- `src/components/LogoExtrudeStudio.tsx` — UI do Studio, botão 🎨 removido
- `src/app/api/logo-preview/route.ts` — endpoint do Studio, sem chamadores
- `src/lib/logo-extrude/preview.ts` — função previewLogo, sem chamadores
- `src/lib/compose/trophy-base.ts` — buildTrophyBase, checar uso
- `src/lib/compose/stl-compose.ts` — composeOnTop, checar uso

## Subtasks

- [ ] `grep -rn "<module-name>"` cada arquivo suspeito pra confirmar zero uso
- [ ] Remover arquivos sem chamadores
- [ ] `pnpm exec tsc --noEmit` deve continuar verde
- [ ] `pnpm exec vitest run` — 47 testes verdes
- [ ] Commit separado: `chore(cleanup): remove unreachable compose iteration code`

## Cuidados

- NÃO remover sem grep primeiro — pode ter import indireto
- Manter `synthesize-iteration.ts` e `describe-image.ts` (usados pelo path image+text Meshy que ainda existe)
- Manter `logo-extrude/extrude.ts`, `otsu.ts`, `parse-svg-path.ts` (ativos nos composers)

## Related

- [[CHORE-001-commit-composers-phase-universal-compose]] — blocker: commit ANTES de remover
