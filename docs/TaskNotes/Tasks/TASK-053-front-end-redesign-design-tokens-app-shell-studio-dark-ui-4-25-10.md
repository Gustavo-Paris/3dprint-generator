---
uid: task-053
status: done
priority: normal
scheduled: 2026-06-12
completed: 2026-06-12
pomodoros: 0
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# Front-end redesign: design tokens + app shell + studio dark (UI 4.25/10)

Diagnóstico design-critic (2026-06-12): **4.25/10 — "abaixo do padrão"**. App está
acessível/PT-BR (pós-audit Fase 8) mas estética de scaffold: sem identidade de marca,
monocromático chapado, workspace com vazio branco gigante, viewer 3D não é herói, cards
de projeto genéricos. Relatório completo + scores por tela + findings P0/P1/P2:
`docs/plans/2026-06-12-design-critique.md`. Screenshots regeráveis via script Playwright
contra o app no :3001 (login dev: `/api/auth/test-login?email=gustavo.b.paris@gmail.com`).

**Direção aprovada (diagnóstico primeiro, redesign a decidir):** dois ambientes —
(1) **Studio** (workspace): dark, viewer 3D herói em tela cheia, chat painel lateral, acento
vivo (promover o azul `#3b82f6` a cor de marca); (2) **Shell** (lista/sign-in/404): claro
tipo Linear/Vercel, top bar com marca, cards com thumbnail+hover+status, sign-in num card.

**FUNDAÇÃO ANTES DE TELA** (hoje não existe design system nenhum — só `--background`/`--foreground`).
PR SEPARADO do audit (não sujar o PR #8).

## Subtasks

- [x] Fundação: design tokens (cor + 1 acento, escala tipográfica, espaçamento, radius rounded-xl/lg, sombras, estados) em globals.css + módulo de tokens
- [x] App shell: top bar c/ marca + sign-in card + cards de projeto (thumbnail/hover/status badge); corrigir colisão título/conta no header da home
- [x] Studio: workspace dark, viewer herói, chat lateral, empty state no chat (hoje é vazio branco)
- [x] Polish: micro-interações/transições, favicon/OG, validar contraste no browser

## Notes
Stack: Next App Router + Tailwind v4 (sem PageShell). Pré-requisitos locais: Docker postgres
`3dgen-postgres` up, `pnpm dev --port 3001`, login via test-login (memória [[3dprint-dev-setup]]).

## Related

- [[sprint]] - Current sprint
- [[activeContext]] - Active context
