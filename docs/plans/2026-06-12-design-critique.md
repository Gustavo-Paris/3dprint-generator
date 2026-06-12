---
title: Design Critique Report — 3dprint-generator
created: 2026-06-12
status: actionable
tags: [type/audit, design-critic]
---

# Design Critique Report

**Data**: 2026-06-12
**Modo**: Full Audit (app rodando em http://localhost:3001, dev, logado via test-login)
**Telas analisadas**: 5 (sign-in, home/lista, workspace, 404) × desktop 1440 + mobile 390
**Screenshots**: `/tmp/3dgen-shots/*.png` (regeráveis)
**Stack real**: Next App Router + Tailwind v4 cru (sem design system / sem PageShell / sem tokens semânticos — só `--background`/`--foreground`)

## Score Geral

| Pilar | Score | Peso | Contribuição |
|-------|-------|------|--------------|
| Visual Consistency | 5/10 | 25% | 1.25 |
| Information Hierarchy | 4/10 | 25% | 1.00 |
| Interaction Quality | 4/10 | 20% | 0.80 |
| Spatial Design | 5/10 | 15% | 0.75 |
| Polish & Craft | 3/10 | 15% | 0.45 |
| **TOTAL** | | | **4.25/10** |

**Veredito:** Abaixo do padrão — redesign parcial necessário. Confirma o "amador": a app está *acessível e correta* (pós-Fase 8) mas **sem identidade, sem profundidade e sem celebrar o produto** (o viewer 3D). Parece scaffold de Tailwind, não produto.

## Score por Tela

| Tela | VC | IH | IQ | SD | PC | Total |
|------|----|----|----|----|----| ------|
| sign-in | 5 | 5 | 4 | 6 | 3 | 4.6 |
| home / lista | 5 | 3 | 4 | 5 | 3 | 4.0 |
| workspace | 4 | 4 | 4 | 4 | 3 | 3.8 |
| 404 | 6 | 6 | 4 | 6 | 4 | 5.3 |

## Findings principais

### P0 — Blockers

**[P0-1] IH — colisão título/conta no header da home** (`src/app/page.tsx` header)
"Seus projetos" cola no "gustavo.b.paris@gmail.com — sair" (sem respiro no desktop; no mobile o h1 quebra em 2 linhas e a conta fica espremida no topo-direito). Precisa de barra de topo real (logo à esquerda, conta à direita com gap/menu).

**[P0-2] IQ — workspace sem empty state (vazio branco gigante)** (`src/components/Chat.tsx` / `ProjectWorkspace.tsx`)
O painel de chat abre como um vazão branco — sem mensagem de boas-vindas, sem exemplos, sem CTA. O usuário não sabe o que fazer. É o que mais grita "inacabado".

**[P0-3] Polish — zero identidade de marca** (global)
Sem logo, sem nome tratado, sem cor de marca, sem favicon de produto. Preto/branco/cinza chapado em tudo. Nada memorável.

### P1 — Must-Fix

- **[P1-1] VC/Polish — paleta monocromática + sem profundidade.** Só preto/branco/cinza. Falta 1 cor de acento (a app já usa azul `#3b82f6` na "Cor da Base" — dá pra promover a acento de marca), estados, sombras suaves, depth.
- **[P1-2] IH/IQ — cards de projeto genéricos e repetitivos.** Todos idênticos (título + timestamp cinza), sem hover, sem ícone/thumbnail/preview da peça, sem badge de status. Impossível escanear/diferenciar. Um thumbnail do mesh + status mudaria tudo.
- **[P1-3] Polish — sign-in flutua sem âncora.** Form solto no meio do branco, sem card/elevação, sem logo. Deveria ter um card centrado com a marca em cima.
- **[P1-4] VC — tipografia sem escala.** Hierarquia só por tamanho; pouca variação de peso/cor; sem ritmo tipográfico.
- **[P1-5] SD — viewer 3D não é o herói.** O viewer (a alma do produto) divide a tela 50/50 com um chat vazio, separado por uma linha fina. Deveria dominar visualmente, com o chat como painel lateral elegante.

### P2 — Advisory
- Radius inconsistente (cards ~`rounded-lg`/`md`, sem padrão), sem `rounded-xl` premium.
- `bg-black`/`text-white` literais em vez de um token de acento (não suporta tema/dark).
- Datas e labels OK em PT-BR (Fase 8), mas micro-copy ainda seco.
- 404 e skeletons (Fase 8) estão limpos — bom ponto de partida.

## Recomendação (direção do redesign)

A app tem dois "ambientes" distintos → tratar como tal:
1. **Studio (workspace):** dark, o viewer 3D como herói em tela cheia, chat como painel lateral flutuante translúcido, acento vivo. É onde o "uau" mora.
2. **App shell (lista/sign-in/404):** claro, limpo, tipo SaaS premium (Linear/Vercel) — barra de topo com marca, cards com thumbnail+hover+status, sign-in num card com logo.

**Fundação antes de tela:** criar um mini design system (tokens de cor incl. 1 acento, escala tipográfica, espaçamento, radius `rounded-xl`/`lg`, sombras, estados) — hoje não existe nenhum. Depois aplicar tela a tela. Redesign vai num **PR separado** (não no PR do audit).

**Esforço sugerido (incremental, validável a cada passo):**
1. Tokens + design system base (globals.css + um arquivo de tokens). 
2. App shell: top bar com marca + sign-in card + cards de projeto (thumbnail/hover/status).
3. Studio: workspace dark, viewer herói, chat lateral, empty state.
4. Polish: micro-interações, transições, favicon/OG.

## Status
Auto-fix **NÃO aplicado** (operador pediu diagnóstico primeiro). Próximo passo é decisão de direção + começar pela fundação.
