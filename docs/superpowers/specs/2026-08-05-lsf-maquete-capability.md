# Spec: LSF maquete capability (IFC → steel-frame print)

**Status:** golden FROZEN (operator production cuts)  
**Date:** 2026-08-05  
**Golden:** `docs/references/steelprime-lsf/SteelPrime_LSF_GOLDEN_FINAL.3mf`  
**Operator source:** `~/Downloads/SteelPrime_LSF_PRINTABLE.3mf`

## Problem

Immersion demos for Light Steel Frame (e.g. SteelPrime / Casa Real Park) need a **scale skeleton** that:

1. Is **faithful** to the IFC member layout (studs, tracks, joists, trusses)  
2. **Survives** FDM support removal and bed removal  
3. Fits **Bambu H2D** and slices without becoming a solid architectural mass  

The chat SaaS today covers parametric jewelry/trophies + freeform Meshy. It does **not** yet own IFC → LSF maquete.

## Goals

- One product path: **upload IFC (or prebuilt LSF mesh) → maquete → H2D 3mf**  
- Geometry rules locked to the golden SteelPrime project  
- Print profile locked to golden `project_settings`  
- Extensible to “any steel frame house” with the same pipeline

## Non-goals (v1)

- Full BIM authoring / Revit plugin  
- Structural analysis  
- Multi-color per story (optional later)  
- Automatic multi-plate packing (operator may re-enable later)

## Geometry contract

| Rule | Value |
|---|---|
| Representation | Multi-body LSF members (not single solid) |
| Default architectural scale | 1:70 |
| Fit-to-bed | Uniform scale so longest XY ≤ H2D printable area (golden used **0.757** → ~1:92 effective) |
| Min member thickness | ≥ **2.0 mm** (golden p50 ≈ **2.2 mm**) |
| Base | Optional **2–3 mm** thin plate only |
| Watertight | Not required |
| Forbidden | Global voxel solid, roof decks, thick plinth |

## Print contract (H2D / PLA)

See `docs/references/steelprime-lsf/golden-recipe.json`. Highlights:

- Layer **0.24** / initial **0.20**  
- Walls **2**, infill **10% grid**  
- Brim outer **7 mm**  
- Tree support auto, **not** build-plate-only  
- Line width **0.42** / initial **0.5**  
- Profile id string: `0.24mm Standard @BBL H2D - Copy casas de steel`

## Architecture (phased)

### Phase A — freeze golden + profile (this session)

- [x] Store golden 3mf + settings + recipe under `docs/references/steelprime-lsf/`  
- [x] Document lessons and pipeline  
- [x] `buildProjectSettings(..., lsfMaquette: true)` overrides  
- [ ] Validity gate: allow multi-body non-watertight when strategy = `lsf_maquete`

### Phase B — offline worker (cad-workshop → callable)

- [x] CLI worker: `cad-workshop/parts/lsf-maquete/lsf_maquette.py` + `scripts/lsf-maquette.sh`  
- [x] SaaS spawn wrapper: `src/lib/lsf/run-worker.ts` (env `LSF_PYTHON` / `LSF_WORKER`)  
- [ ] Optional HTTP microservice + IFC-hash cache (later)

### Phase C — SaaS product surface

- [x] Strategy `lsf_maquette` + migration 0010  
- [x] Upload `.ifc` (sniff ISO-10303-21)  
- [x] `POST /api/lsf-maquete` + Chat IFC path  
- [x] Chat badge/summary LSF + Design schema  
- [x] 3MF embed LSF print profile on worker wrap  
- [x] Prompt-text routing without IFC file (wizard + scale)  

### Phase D — product polish

- [x] Progress UI for long IFC jobs (elapsed stages in chat)  
- [x] Scale picker (1:50 / 1:70 / 1:100 / fit bed)  
- [ ] Optional story coloring (later)  
- [ ] Client-facing PDF one-pager “do IFC à maquete”

## Acceptance (golden regression)

Given the SteelPrime IFC (or the frozen native STL):

1. Output remains multi-body with **≥ 1000** components (order of thousands)  
2. Mid-height section entity count **≫** solid-house baseline (dozens vs single polygon)  
3. Extents within 5% of golden native or as-printed (depending on scale mode)  
4. Slice with LSF profile produces tree supports + brim without requiring solid fill  
5. Visual fingerprint matches `plate_preview.png` (frame, not Minecraft mass)

## Risks

| Risk | Mitigation |
|---|---|
| Bambu crash on huge tree + fine resolution | Cap resolution ≥ 0.012; prefer golden; decimate only if required |
| Operator demands solid mass “for strength” | Offer thicker min_t, not voxel house |
| IFC tessellation timeouts | LOD / exclude furniture; cache |
| Validity gate rejects multi-body | Mode-specific allowlist |

## Open decisions

1. Worker in-process (heavy native deps) vs sidecar Docker (recommended)  
2. Default scale: always fit-bed, or fixed 1:70 then warn if oversized  
3. Whether tiny cut parts (26-face remnant in golden) should be auto-merged

## References

- Golden 3mf path (Desktop): `~/Desktop/SteelPrime-Print/SteelPrime_LSF versao final.3mf`  
- Repo mirror: `docs/references/steelprime-lsf/`  
- Workshop: `~/www/cad-workshop/parts/steelprime-casa-real-park/`
