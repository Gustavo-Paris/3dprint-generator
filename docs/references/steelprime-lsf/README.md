# SteelPrime LSF — GOLDEN FINAL (canonical)

**Status:** FROZEN — operator-approved production model  
**Date:** 2026-08-05  
**Source file:** `~/Downloads/SteelPrime_LSF_PRINTABLE.3mf` (with production cuts)

This is the **only** reference geometry + print profile for future Light Steel Frame house maquetes of this pattern in 3dprint-generator / Prior D immersion demos.

---

## Canonical files

| File | Role |
|---|---|
| `SteelPrime_LSF_GOLDEN_FINAL.3mf` | **Authoritative** Bambu project (geometry + settings) |
| `SteelPrime_LSF_GOLDEN_FINAL.stl` | Same mesh, STL |
| `project_settings.golden.json` | Full H2D process dump from that 3mf |
| `golden-recipe.json` | Condensed product contract |

Desktop mirror:

- `~/Desktop/SteelPrime-Print/SteelPrime_LSF_GOLDEN_FINAL.3mf`
- `~/Desktop/SteelPrime-Print/SteelPrime_LSF_PRINTABLE.3mf` (same bytes)

---

## Measured facts (this golden)

| Metric | Value |
|---|---|
| Extents | **127.3 × 204.6 × 103.4 mm** |
| Faces | **79 980** |
| Bodies / members | **~6 665** |
| Min member section | **~1.9 mm** (p10 = p50 ≈ 1.9) |
| Base | **Single flat plate ~2.5 mm** (no multi-step podium) |
| Look | Solid-member LSF skeleton (openings visible) |
| Origin scale | IFC 1:70 × plate scale **~0.757** |

---

## Print profile (H2D / PLA)

| Setting | Value |
|---|---|
| Profile id | `0.24mm Standard @BBL H2D - LSF PRINTABLE` |
| Layer | **0.24** (initial 0.2) |
| Walls | **3** |
| Infill | **15%** |
| Line width | **0.42** |
| Brim | outer **8 mm** |
| Support | **tree(auto)** ON |
| On build plate only | **OFF** |
| Detect thin wall | **ON** |
| Resolution | **0.02** |

---

## Pipeline for the next house (same pattern)

1. IFC → tessellate LSF members (Beam / Column / Member / Plate)  
2. Scale to maquete (1:70 → fit H2D bed)  
3. **Per-member solid OBB**, min cross-section **~1.9 mm** (not global voxel solid)  
4. Drop low foundation mega-slabs; **one** flat base 2.5 mm  
5. Optional **operator cuts** in Bambu for production  
6. Apply this print profile  
7. If approved, replace/extend golden for that project  

### Forbidden (learned the hard way)

- Voxel-fill whole building (“Minecraft”)  
- Thousands of stilts under every member  
- Multi-step fake foundation  
- Min thickness ≲ 1.5 mm on 0.4 nozzle  

---

## Product mapping

| SaaS surface | Use this golden as |
|---|---|
| Visual QA | Thumbnail / size / multi-body count |
| Print profile | `lsfMaquette: true` → same process keys |
| Regression | Extents ±5%, min thick ≥ 1.8 mm, not solid mass |
| Worker IFC→maquete | Target shape of this recipe |

See also: `docs/superpowers/specs/2026-08-05-lsf-maquete-capability.md`
