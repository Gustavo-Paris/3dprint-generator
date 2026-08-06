# Projeto Fodão — etapas executáveis com `/goal`

- **Data:** 2026-08-06
- **Fonte:** auditoria session-start + full-system-audit v1 (2026-07-21) + handoff LSF/logo
- **Roadmap:** `.pgdk/roadmap.yaml` (`rm-001` … `rm-016`)
- **Como executar cada etapa:** `/goal rm-NNN` (pipeline brainstorm → plan → execute → integrate)

## North star

> Descreva (ou solte IFC/logo/3MF) → veja peça confiável com progresso → pinte/logo/articule sem beco → baixe um 3MF que imprime de primeira na Bambu.

Três pilares, nesta ordem: **confiável → fluido → mágico**.

---

## Como usar

```bash
# Ver fila
pg-devkit roadmap list
pg-devkit roadmap status   # % done + links tn

# Executar UMA etapa (recomendado: uma por sessão)
/goal rm-001

# Resume se status active
/goal rm-001

# Abortar arco em voo (volta pra idea; commits ficam)
# (dizer "para" / "abort" no /goal, ou:)
pg-devkit roadmap edit rm-001 --status idea
```

Cada `/goal` tem **2 gates humanos**: design approval + integração final.  
Entre os gates roda sozinho (com checkpoints em mudanças estruturais).

**Regra:** um `rm-*` por vez. Não paralelizar dois `/goal` no mesmo worktree.

---

## Ops manuais (fora do `/goal` — você faz)

| Ação | Por quê | Quando |
|------|---------|--------|
| `/open-okr` (daily de hoje) | Ritual PG | Já |
| Rotacionar `AUTH_RESEND_KEY` + `MESHY_API_KEY` (`CHORE-005`) | Keys vazadas | Antes de qualquer deploy público |
| Conectar GitHub → Railway auto-deploy (`CHORE-006`) | Push = ship | Após CI verde |
| Recarregar créditos Meshy (`CHORE-007`) | Freeform morto sem crédito | Antes de `rm-009` |
| Smoke prod: IFC LSF + logo pedestal | Validar ship de 2026-08-06 | Após deploy |

---

## Etapa 0 — Fundação (NOW) · confiar no ship

Objetivo: **CI verde + erros honestos + lixo de API morto**. Sem isso, produto novo é teatro.

| ID | Título | Links | Comando |
|----|--------|-------|---------|
| **rm-001** | CI verde: flake `find-or-create-user` | `tn:CHORE-010` | `/goal rm-001` |
| **rm-002** | Chat limpo em falha (sem SQL/stack) | `tn:BUG-009` | `/goal rm-002` |
| **rm-003** | Remover `strategy:'generative'` hardcoded | `tn:CHORE-009` | `/goal rm-003` |

**Ordem sugerida:** `rm-001` → `rm-002` → `rm-003` (001 desbloqueia 004/005).

### Seeds (three pieces) — colar no GATE 1 se o /goal pedir

#### `/goal rm-001`
- **spec:** Teste de corrida naive em `find-or-create-user` deixa de ser flaky no CI; suite coverage verde em 3 runs locais + 1 run GHA.
- **done:** `pnpm test:coverage` verde local 3×; workflow CI `lint · types · unit` success no commit; e2e deixa de ser skipped por falha de unit.
- **don't:** Não “skip” o teste de race; não enfraquecer a asserção real do `findOrCreateUser`; não tocar auth product path além do necessário pro race.

#### `/goal rm-002`
- **spec:** Qualquer falha de generate/flexify/slice/paint-save mostra só mensagem PT-BR curta no chat; detalhe técnico só em log estruturado.
- **done:** Teste unit/integration cobre envelope → message; repro manual com falha forçada não mostra SQL/`stack`/`CREATE TABLE`.
- **don't:** Não remover o log server-side; não expor path de arquivo local no client.

#### `/goal rm-003`
- **spec:** Response de `/api/generate` grava/devolve o `kind` real (`designKindToStrategy`); zero hardcode `'generative'` no path feliz.
- **done:** Grep + teste de route; row no DB com strategy coerente com o kind.
- **don't:** Não migrar rows legadas de forma destrutiva; manter back-compat de leitura.

---

## Etapa 1 — Core loop premium (NOW → NEXT) · fluido

Objetivo: **gerar → ver → editar → exportar** sem confusão, sem painel morto, sem beco.

| ID | Título | blockedBy | Comando |
|----|--------|-----------|---------|
| **rm-004** | Export unificado (STL / 3MF multi-cor / 3MF fatiado) | rm-001 | `/goal rm-004` |
| **rm-005** | Studio layout sem overlap (desktop+mobile) | rm-001 | `/goal rm-005` |
| **rm-006** | Progresso de geração em passos | rm-005 | `/goal rm-006` |
| **rm-007** | Histórico clicável / restaurar versão | rm-002 | `/goal rm-007` |
| **rm-008** | Sair do importado + chips contextuais | — | `/goal rm-008` |

**Ordem sugerida:** `rm-005` ∥ `rm-004` → `rm-006` → `rm-007` → `rm-008`.

### Seeds

#### `/goal rm-004`
- **spec:** Um controle “Exportar” com 3 opções nomeadas pelo resultado; fatiar multi-cor avisa se achatar; paint dirty bloqueia/aviso antes de fatiar sem save.
- **done:** E2E ou integration: cada opção gera o arquivo certo; copy PT-BR; sem download silencioso mono quando há 2 cores.
- **don't:** Não remover o path OrcaSlicer; não quebrar Bambu profile no 3MF multi-cor.

#### `/goal rm-005`
- **spec:** Em 1496×725 e 390×844, centros de “Logo aqui”, “Pintar cores”, “Fatiar”, “Make it flexi” são clicáveis (`elementFromPoint` = o botão).
- **done:** Teste Playwright de hit-target ou checklist + screenshots em `docs/screenshots/`; zero fieldset absolute cobrindo toolbar.
- **don't:** Não reescrever o MeshViewer 3D; só chrome/layout dos painéis.

#### `/goal rm-006`
- **spec:** Durante generate, UI mostra passos (interpretar → gerar malha → salvar → carregar preview) com estado atual; falha aponta o passo.
- **done:** Smoke manual + teste de estados no Chat/workspace; sem “Pronto” se mesh 404.
- **don't:** Não inventar progresso fake de % no Meshy sem dados; passos honestos.

#### `/goal rm-007`
- **spec:** Clique na bolha assistant carrega aquela iteração no viewer; ação “usar esta versão” atualiza `currentIterationId`.
- **done:** Unit + browser: histórico com 2+ ready; restaurar mostra mesh da bolha clicada.
- **don't:** Não apagar iterações antigas; não quebrar paint-save que cria row nova.

#### `/goal rm-008`
- **spec:** Banner de 3MF importado tem dismiss; pedido claramente “nova peça” sai do path imported; chips mudam por modo.
- **done:** Repro: import → dismiss → “cubo 30mm” → kind paramétrico; chips import listam furo/texto/pintar topo.
- **don't:** Não perder a malha importada no disco ao dismiss (só limpa intent de edição).

---

## Etapa 2 — Diferenciais (NEXT) · mágico

| ID | Título | blockedBy | Comando |
|----|--------|-----------|---------|
| **rm-009** | Freeform editável (paint + logo em Meshy) | rm-008 | `/goal rm-009` |
| **rm-010** | Flexify herói (produto, não botão escondido) | rm-005 | `/goal rm-010` |
| **rm-011** | LSF Phase D (story color / PDF) | — | `/goal rm-011` |
| **rm-012** | Perf malhas grandes | — | `/goal rm-012` |

**Pré-req ops:** créditos Meshy (`CHORE-007`) antes de `rm-009`.

### Seeds (resumo)

#### `/goal rm-009`
- **spec:** Malha freeform ready habilita paint + logo; route aceita freeform como base de edição.
- **done:** Fluxo Meshy → pintar → paint-save → export multi-cor verde em teste.
- **don't:** Não forçar Meshy em pedido paramétrico; cost cap se já existir.

#### `/goal rm-010`
- **spec:** Flexify descobrível, PT-BR, preview multi-body, erro humano se junta falhar.
- **done:** E2E/smoke com mesh de ref; copy sem “Make it flexi” cru se i18n já partial.
- **don't:** Não mudar a matemática de juntas sem golden Rocktopus.

#### `/goal rm-011`
- **spec:** Pós-maquete LSF: colorir por storey e/ou export PDF one-pager com escala e preview.
- **done:** Spec LSF Phase D fechada + teste worker/UI mínimo.
- **don't:** Não quebrar multi-body non-watertight path do slice.

#### `/goal rm-012`
- **spec:** `/meshes` com compressão; serialize 3MF multi-cor fora da main thread; menos retenção tripla de buffer no client.
- **done:** Benchmark antes/depois documentado; export não congela UI >1s em malha de teste grande.
- **don't:** Não quebrar auth do route handler de meshes.

---

## Etapa 3 — Produto polido (LATER)

| ID | Título | blockedBy | Comando |
|----|--------|-----------|---------|
| **rm-013** | Presets + galeria + thumbnails reais | rm-007 | `/goal rm-013` |
| **rm-014** | i18n PT-BR + perfil impressora visível | — | `/goal rm-014` |
| **rm-015** | GC órfãos + chat virtualizado | — | `/goal rm-015` |
| **rm-016** | Print-to-Bambu LAN (FEAT-018) | — | `/goal rm-016` |

Seeds curtas no GATE 1 de cada `/goal` — o título do item + “three pieces” do skill bastam; expandir só no brainstorm.

---

## Sequência de execução recomendada (checklist)

```
[ops]  /open-okr + rotacionar keys (CHORE-005)
[0]    /goal rm-001   # CI
[0]    /goal rm-002   # erros
[0]    /goal rm-003   # strategy limpa
[ops]  CHORE-006 auto-deploy Railway
[1]    /goal rm-005   # layout studio
[1]    /goal rm-004   # export unificado
[1]    /goal rm-006   # progresso
[1]    /goal rm-007   # histórico
[1]    /goal rm-008   # import escape + chips
[ops]  CHORE-007 Meshy credits
[2]    /goal rm-009   # freeform edit
[2]    /goal rm-010   # flexify herói
[2]    /goal rm-011   # LSF D   (pode paralelizar mentalmente com 012)
[2]    /goal rm-012   # perf
[3]    /goal rm-013 … rm-016 conforme prioridade de negócio
```

---

## Critério de “projeto fodão” (exit criteria)

| Pilar | Critério binário |
|-------|------------------|
| Confiável | CI main verde; 0 vazamento de stack no chat; deploy no push |
| Fluido | 1 menu export; 0 botões cobertos em desktop/mobile; progresso + histórico |
| Mágico | Freeform pintável; flexify óbvio; LSF B2B fechado ou consciente do gap |
| Print | 3MF multi-cor + fatiado honestos; (opcional) LAN Bambu |

---

## Referências

- Audit graded: `docs/reviews/2026-07-21-full-system-audit-v1.md`
- Roadmap histórico Meshy/flexify: `docs/reports/roadmap-2026-05-31.md`
- Session brief: `.pgdk/session-brief.md`
- Capacidades atuais: README + `src/db/strategy.ts` + `src/lib/design/schema.ts`
