# Import & Edit MVP — smoke test 2026-05-26

## Status
PENDING — run manually after `pnpm dev`.

## Test plan

### Setup
1. `pnpm dev` in the worktree
2. Open `http://localhost:3000`
3. Create a new project

### TC-1: Upload .3mf and scale down
1. Click the paperclip icon in the chat
2. Select `tests/fixtures/cube-30mm.3mf`
3. Verify: upload completes (200), violet "📦 .3mf carregado" badge appears
4. Wait ~500ms for "previews prontos" status
5. Type "diminui pra metade do tamanho" and Send
6. Expected: API returns `design.kind === "imported"`, new mesh in viewer is 15mm cube

### TC-2: Iterate on the same mesh (no re-upload)
1. Continuing from TC-1
2. Type "agora deixa do tamanho original" and Send
3. Expected: server reuses cached faces from iteration history, returns 30mm cube

### TC-3: Hole op
1. Upload `tests/fixtures/cube-30mm.3mf`
2. Type "faz um furo circular de 5mm no centro da face de cima"
3. Expected: viewer shows cube with a 5mm hole on the top face

### TC-4: Image upload still works (regression)
1. Click paperclip, select a PNG image
2. Verify: green "upload novo" badge (not violet mesh badge)
3. Send a message, verify normal generative flow still works

## Results

| TC | Result | Notes |
|----|--------|-------|
| TC-1 | TODO | |
| TC-2 | TODO | |
| TC-3 | TODO | |
| TC-4 | TODO | |

## Issues found
- (fill in after running)

## Next steps
- (fill in after running)
