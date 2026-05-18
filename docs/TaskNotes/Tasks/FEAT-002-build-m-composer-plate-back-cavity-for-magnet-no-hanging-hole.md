---
uid: feat-002
status: done
priority: normal
scheduled: 2026-05-18
completed: 2026-05-18
timeEstimate: 30
pomodoros: 0
projects:
- '[[sprint.md|Current Sprint]]'
contexts:
- phase:8
- composers
- ima
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

# Build ímã composer (plate + back cavity for magnet, no hanging hole)

Adaptação do coaster: disco achatado com logo gravada na face frontal, MAIS uma cavidade circular no verso onde encaixa um ímã neodímio comprado.

## Especificações sugeridas

- Diâmetro: 50mm
- Espessura: 4mm
- Logo: gravada na face superior (engrave, não vazada — não pode ter buraco passante)
- Cavidade verso: cilindro Ø10mm × 2mm de profundidade (ímã neodímio padrão N52, 10×2mm é comum)
- Material restante entre logo e cavidade: ~0.5mm (cuidado pra não atravessar)

## Implementação

1. Copy `src/lib/compose/coaster.ts` → `src/lib/compose/ima.ts`
2. Adicionar segundo `booleans.subtract` pro buraco do ímã no verso
3. Cavidade em (0, 0, -thickness/2 + cavityDepth/2) → talha no fundo
4. Triggers: imã, imá, ima, magnet, magneto, geladeira

## Subtasks

- [ ] `src/lib/compose/ima.ts`
- [ ] `src/lib/compose/detect-ima.ts`
- [ ] Wire route + Chat label
- [ ] Testar montagem (imprimir + colar ímã N52 10×2)

## Cuidados

- A logo + cavidade não podem se encontrar — calcular `engraveDepth + cavityDepth + minWall ≤ thickness`
- Ex: 1.5 + 2 + 0.5 = 4mm ✓

## Related

- `src/lib/compose/coaster.ts` — template (disc deitado + engrave)
