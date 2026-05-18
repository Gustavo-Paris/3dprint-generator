---
uid: feat-003
status: done
priority: normal
scheduled: 2026-05-18
completed: 2026-05-18
timeEstimate: 45
pomodoros: 0
projects:
- '[[sprint.md|Current Sprint]]'
contexts:
- phase:8
- composers
- plaquinha
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

# Build plaquinha de mesa composer (vertical plate + angled foot)

Adaptação do chaveiro: placa vertical com logo, sem furo de keyring. Em vez disso, **pé inclinado embaixo** pra ficar em pé na mesa em ~15° (legível pra quem olha).

## Especificações sugeridas

- Plate vertical: 80mm × 60mm × 4mm
- Logo: vazada atravessando (igual chaveiro)
- Pé:
  - Cuboid base 80mm × 30mm × 4mm
  - Rotacionado em ângulo (uniformly 15° back-tilt) embaixo da placa
  - União com a placa
- Sem furo de keyring

## Implementação

1. Copy `src/lib/compose/keychain.ts` → `src/lib/compose/plaquinha.ts`
2. Remover branch do furo de keyring
3. Adicionar JSCAD cuboid pra pé, transformes.rotate pra inclinar
4. Union plate + foot, depois subtract logo
5. Triggers: plaquinha, plaquinha de mesa, desk plate, desk plaque, display

## Subtasks

- [ ] `src/lib/compose/plaquinha.ts`
- [ ] `src/lib/compose/detect-plaquinha.ts`
- [ ] Wire route + Chat label
- [ ] Testar print (pé estável? tilt OK?)

## Detalhes do pé

- Ângulo 15° pra frente (display de mesa típico)
- Largura do pé > largura da placa pra dar estabilidade
- Junção pé-placa: linha de cola, pode precisar de fillet pra resistência

## Related

- `src/lib/compose/keychain.ts` — template plate vertical
