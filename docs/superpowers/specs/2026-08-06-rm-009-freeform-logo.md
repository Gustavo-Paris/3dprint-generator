# rm-009 — Freeform editable (paint + logo)

- **Roadmap:** rm-009
- **Date:** 2026-08-06

## Loop contract

- **spec:** Freeform (Meshy) and flexified meshes expose "Logo aqui" when they have meshBlobUrl. Client sends that URL as meshUrl with logoPlacement. Server loadBaseMesh accepts binary STL (Meshy format) in addition to 3MF/paint-bin. Paint already works client-side on freeform.
- **done:** Unit tests for hasLogoBase, latestLogoBaseMeshUrl, buildLogoPlacementBody baseMeshUrl, looksLikeBinaryStl + loadBaseMeshFromBytes STL path.
- **don't:** Do not force Meshy for parametric prompts; do not change joint math.
