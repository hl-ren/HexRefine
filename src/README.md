# HexRefine Source

This folder is the source boundary for HexRefine.

The HexRefine mesh kernel and refinement implementation are now project-local.
This project tsconfig only includes `src/**/*.ts`.

Project-facing module map:

- `index.ts`: full HexRefine public entry
- `mesh-selection.ts`: mesh-only selection, first migrated implementation
- `types.ts`, `mesh.ts`, `topology.ts`, `vector.ts`: mesh kernel
- `distance.ts`: signed distance selection utilities
- `conformance.ts`: no-hanging check
- `grid.ts`: structured Q1/Hex grid generators
- `command-script.ts`: command replay
- `refinement-ops.ts`: non-field refine/preview operations, migrated implementation
- `refinement-session.ts`: hierarchical refinement session, migrated implementation
- `refinement-planner.ts`: default Q1/Hex planner, migrated implementation
- `hex-core.ts`: pure Hex refinement APIs, migrated implementation
- `transitions.ts`: Hex selected/face/edge transition planner, migrated implementation
- `regularization.ts`: Hex uvw/block regularization, migrated implementation
- `session-regularization.ts`: same-level session block regularization, migrated implementation
- `templates.ts`: Q1/Hex local templates, migrated implementation
- `export.ts`: VTK/INP export, migrated implementation
