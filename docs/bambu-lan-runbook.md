# Bambu H2D LAN — runbook (rm-016 / FEAT-018)

Timebox: **1 tarde**. Fallback pré-decidido: **Bambu Studio manual**.

## Objetivo

Enviar G-code / 3MF fatiado do 3dprint-generator para a Bambu H2D na LAN
sem reabrir o Studio a cada peça — *quando* o envio for confiável.

## Pré-requisitos

1. Impressora e Mac na mesma LAN (ou Tailscale).
2. LAN mode ligado no painel da Bambu; anotar **IP**, **serial**, **access code**.
3. Peça já **fatiada** no app (`Fatiar para impressão`) ou 3MF multi-cor exportado.
4. Referência externa (se existir no workshop):  
   `~/www/cad-workshop/docs/bambu-h2d-lan-runbook.md`

## Env vars (deploy / `.env.local`)

| Var | Uso |
|-----|-----|
| `BAMBU_LAN_HOST` | IP da impressora |
| `BAMBU_LAN_SERIAL` | Serial |
| `BAMBU_LAN_ACCESS_CODE` | Código LAN |
| `BAMBU_LAN_ENABLED` | `1` só quando quiser permitir handoff real |

## API dry-run

```bash
curl -sS -X POST http://localhost:3000/api/print-bambu \
  -H 'content-type: application/json' \
  -d '{}'
```

Resposta esperada sem config: `dry_run: true`, `status: "not_configured"`, checklist.

Com LAN configurada mas sem `confirm: true`: `status: "ready_for_confirm"`.

Live print: **501** até a integração MQTT/FTPS ser productizada — **não** force print
automático nesta etapa.

## Critério de sucesso do experimento

- [ ] Dry-run responde em <1s com checklist honesto
- [ ] Operador consegue imprimir a peça do dia via **Bambu Studio** (fallback)
- [ ] Decisão escrita: continuar LAN no SaaS **ou** manter Studio manual

## Kill criteria

- Mais de 1h sem handshake LAN estável → abortar, documentar, fallback Studio.
