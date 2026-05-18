---
uid: chore-001
status: done
priority: high
scheduled: 2026-05-18
completed: 2026-05-18
timeEstimate: 30
pomodoros: 0
projects:
- '[[sprint.md|Current Sprint]]'
contexts:
- phase:8
- composers
- git
tags:
- task
- chore
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: low
  hintsInferred: true
---

# Commit composers phase + universal compose

Sessão longa de 2026-05-17 culminou em um pipeline de composers funcionais. Commitar o estado atual antes de seguir.

## Contexto

Funcionando e validado em impressão:

- **Chaveiro** (`src/lib/compose/keychain.ts`) — through-hole real
- **Porta-copo** (`src/lib/compose/coaster.ts`) — disco achatado + logo engraving
- **Medalha** (`src/lib/compose/medal.ts`) — disco + argola, logo vazada (✅ 6 unidades impressas em PETG laranja)
- **Universal Meshy** (`src/lib/compose/with-meshy-base.ts`) — Meshy gera forma + carva logo na face fina

Suporte:

- Logo extrude pipeline robusto: Otsu auto-threshold + blur sutil + trim agressivo + heurística per-outer pra preservar/dropar holes
- Size parser ("maior/menor/média") nos 3 composers dedicados
- Reduced Meshy polycount (`target_polycount: 8000`) pra compose ficar tratável

## Subtasks

- [ ] `git status` + `git diff --stat` — revisar tamanho
- [ ] Stage só arquivos relevantes (não `.next/`, uploads, meshes)
- [ ] Commit message descritiva (sugestão abaixo)
- [ ] NÃO push — esperar confirmação humana
- [ ] Verificar `pnpm exec vitest run` — 47 testes verdes

## Sugestão de commit message

```
feat(compose): deterministic composers + universal Meshy fallback

- Dedicated composers: keychain, coaster, medal with logo cutouts
- Universal Meshy+logo composer for arbitrary shapes
- Logo extrude pipeline: Otsu + blur + trim + outer/hole heuristic
- Size parser for natural-language size modifiers (maior/menor/média)
```

## Arquivos esperados no diff

```
M  src/app/api/generate/route.ts
M  src/components/Chat.tsx
M  src/lib/meshy/client.ts
M  src/lib/logo-extrude/extrude.ts
M  src/lib/logo-extrude/preview.ts
A  src/lib/logo-extrude/otsu.ts
A  src/lib/compose/keychain.ts
A  src/lib/compose/detect-keychain.ts
A  src/lib/compose/coaster.ts
A  src/lib/compose/detect-coaster.ts
A  src/lib/compose/medal.ts
A  src/lib/compose/detect-medal.ts
A  src/lib/compose/with-meshy-base.ts
A  src/lib/compose/parse-size.ts
M  next.config.ts  # serverExternalPackages: potrace, jimp, sharp, jscad
```

Deps adicionadas: `potrace`, `sharp`.

## Related

- [[CHORE-002-cleanup-orphan-code-from-compose-iterations]] - faz DEPOIS deste commit
- [[sprint]]
- [[activeContext]]
