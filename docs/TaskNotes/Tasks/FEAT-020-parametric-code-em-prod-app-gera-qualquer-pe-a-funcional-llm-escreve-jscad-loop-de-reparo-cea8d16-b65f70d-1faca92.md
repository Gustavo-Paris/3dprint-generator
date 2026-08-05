---
uid: feat-020
status: done
priority: normal
scheduled: 2026-08-05
pomodoros: 0
createdBy: Gustavo-Paris
tags:
- task
- feat
ai:
  parallelParts: 0
  needsReview: true
  uncertainty: med
  hintsInferred: true
---

# parametric_code em prod: app gera qualquer peça funcional (LLM escreve JSCAD + loop de reparo) — cea8d16/b65f70d/1faca92

Fecha o gap "pedido não coberto virava caixa 90x100x120". Novo Design kind
`parametric_code`: o classificador emite uma spec precisa, o modelo principal
escreve JSCAD, o servidor executa no sandbox e valida — erro volta pro modelo
(3 tentativas). Código que funciona fica salvo e a iteração o edita.

Verificado em produção: pedido "projete um suporte de mesa para um iphone 17
pro max" gerou peça de 100 x 144.7 x 96.2 mm (base + encosto 60° + aba + slot
de cabo), status Pronto.

Também: causa do incidente de deploy (a CHECK constraint `iterations_strategy_check`
é gerada do enum TS, então kind novo EXIGE migration) + guardrail de teste que
pegou um segundo caso do mesmo bug (`box` nunca esteve no enum) + migrations
agora automáticas via `preDeployCommand`.

## Follow-ups (não bloqueantes)

- [ ] Iteração que falha despeja o SQL cru + o código inteiro no chat do usuário — trocar por mensagem curta (o detalhe já vai pro log).
- [ ] `strategy: 'generative'` hardcoded na resposta de /api/generate (route.ts:529) é legado morto; a linha do banco já grava o kind real.
- [ ] `tests/integration/find-or-create-user.test.ts` é flaky pré-existente (corrida de INSERT que nem sempre acontece).


## Notes

## Related

- [[sprint]] - Current sprint
- [[activeContext]] - Active context
