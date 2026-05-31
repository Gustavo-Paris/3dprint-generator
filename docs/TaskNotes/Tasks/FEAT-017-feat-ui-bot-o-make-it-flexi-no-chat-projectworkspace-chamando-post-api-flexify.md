---
uid: feat-017
status: open
priority: normal
scheduled: 2026-05-31
pomodoros: 0
tags:
- task
- feat
ai:
  parallelParts: 0
  needsReview: true
  uncertainty: med
  hintsInferred: true
---

# feat(ui): botão 'Make it flexi' no Chat/ProjectWorkspace chamando POST /api/flexify

A API `/api/flexify` já existe, testada e na `main` (commit `4d26700`, PR #2).
Falta só o gatilho no front pra fechar a Fase B ponta-a-ponta pelo navegador.

## Subtasks

- [ ] Botão "Make it flexi" na iteração atual (`Chat.tsx` ou `ProjectWorkspace.tsx`), visível quando há iteração `ready` com malha
- [ ] Ao clicar: `POST /api/flexify` com `{ projectId }` (sem `meshUrl` → route usa a última `ready`; allowlist por DB exige URL emitida pelo servidor)
- [ ] Carregar o 3MF multi-corpo no viewer (worker já faz sniff de 3MF via PK zip → `parse3mf`; reusar caminho de `onResult`/hidratação)
- [ ] Estado de loading (~1-20s, síncrono no route)

## Notes

- NÃO depende de créditos Meshy: funciona sobre qualquer 3MF do projeto. Créditos só são
  necessários pra gerar a malha-fonte orgânica via freeform.
- Referência Rocktopus bundlada em `public/refs/rocktopus-reference.3mf`.
- Segurança do route já fechada (SSRF/path-traversal/DoS) — front não precisa validar URL,
  só não inventar `meshUrl` arbitrário.
- Verificação: login dev → projeto com iteração `ready` → clicar → viewer mostra corpo
  articulado (~41 peças) + download.

## Related

- [[sprint]] - Current sprint
- [[activeContext]] - Active context
