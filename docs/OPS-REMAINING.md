# Ops restantes (humano — não automatizáveis no código)

Atualizado 2026-08-06 após o arco Fodão + storage privado.

## CHORE-005 — Rotacionar secrets

1. Resend → revogar `AUTH_RESEND_KEY` antigo, criar novo.
2. Meshy → revogar/criar `MESHY_API_KEY`.
3. Atualizar **Railway** env + `.env.local`.
4. Redeploy app. Não commitar keys.

## CHORE-006 — Auto-deploy Railway

1. Railway project → **Settings → Source** → connect `Gustavo-Paris/3dprint-generator`.
2. Branch: `main`, auto-deploy on push.
3. Volume `/data` se ainda usar storage local (sem Blob).
4. Env: `MESH_STORAGE_DIR=/data/meshes`, `UPLOAD_STORAGE_DIR=/data/uploads`
   (já no `startCommand` de `railway.json`).
5. Smoke: push trivial → deploy green → open app.

Até isso: `railway up --service 3dprint-generator --ci`.

## CHORE-007 — Créditos Meshy

1. Recarregar conta em meshy.ai.
2. Confirmar key no Settings do app ou env.
3. Smoke freeform: “um dragão em miniatura” → mesh ready.

## CHORE-008 — Gate text-to-cad (2026-10-28)

Revisão de kill criteria — **não fazer agora** (data futura).

## FEAT-019 — Armário dos relógios

Hardware/BOM no cad-workshop — fora do SaaS.

## TASK-049 — Smoke Meshy non-logo

Depende de CHORE-007 (créditos).
