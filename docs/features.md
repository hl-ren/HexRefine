# HexRefine Features

This document describes what the project supports from a user and integration
perspective. See `implementation.md` for algorithm details.

## Mesh Generation

HexRefine can generate structured unit meshes:

- `createQ1UnitSquareMesh(nx, ny)` for quadrilateral Q1 grids.
- `createHexUnitCubeMesh(nx, ny, nz)` for hexahedral H1 grids.

The browser workbench can scale these unit grids into model bounds and derive
grid counts from a target spacing.

## Mesh Import

The browser workbench can also import starting meshes for later refinement.

Supported imported meshes:

- JSON meshes with `nodes` and `elements`
- ASCII legacy VTK `UNSTRUCTURED_GRID`
- Pure 4-node quadrilateral Q1 meshes
- Pure 8-node hexahedral H1 meshes

Imported meshes are validated before the session is rebuilt. Common failures
such as mixed cell types, unsupported VTK cell types, missing node references,
repeated node ids inside one element, or malformed coordinate arrays are
reported with explicit error messages.

## Selection

Elements can be selected by:

- Explicit element ids.
- Axis-aligned coordinate boxes.
- Signed distance functions.
- Browser screen rectangles in the workbench.

Distance helpers include box, sphere, circle, half-space, band, union-like
`Or0`, intersection-like `And0`, and `Not0` composition.

## Local Refinement Templates

Q1 templates:

- `refineQ1To3x3`: selected quad refinement.
- `refineQ1To4Q1`: edge transition.
- `refineQ1To5Q1`: corner transition.

H1 templates:

- `refineHexTo27Hex`: selected hex refinement.
- `refineHexTo13Hex`: face transition.
- `refineHexTo5Hex` and `refineHexTo4Hex`: transition building blocks.

Template roles are encoded in refinement reports and VTK scalar output.

## Conforming Refinement

The high-level refinement APIs can add transition layers automatically:

- `refineByElementIdsWithReport`
- `refineByBoxWithReport`
- `refineByDistanceFunctionWithReport`
- Hex-specific `refineHex...` variants

Reports include:

- Number of selected parent elements.
- Number of face, edge, and corner transition parents.
- Output node and element counts.
- Per-output-cell metadata with parent id, role, and template code.

## Hex Selection Regularization

Hex refinement can regularize selected candidates into a complete uvw block.
This helps keep the refined core compatible with available transition templates.

Regularization reports:

- Original selected ids.
- Final selected ids.
- Added and removed ids.
- Inferred grid dimensions.
- Selected index range.
- Warnings when topology or coordinate lattice inference is imperfect.

The session-level regularizer works on active same-level cells and ignores
inactive or transition-layer cells.

## Hierarchical Refinement Sessions

`RefinementSession` keeps parent and child cell ids alive across refinements.
This supports:

- Refining one or more active cells.
- Patch refinement with selected and transition children.
- Undo and redo of refinement commands.
- Active mesh rebuilds with cell/node remap tables.
- Named cell and node set remapping during export.
- Local conformance checks around the latest command.

Session refinement is the preferred API for interactive tools because it keeps
identity stable.

## Export

HexRefine exports:

- Legacy VTK unstructured grids through `meshToLegacyVtk`.
- Abaqus-style INP text through `refinementSessionExportToInp`.

VTK export can include cell scalar arrays such as selection, role, template
code, and parent element id. INP export can include remapped node/cell sets and
elastic material sections for cell sets.

## Command Replay

The browser workbench records a command script with grid generation,
refinement, selection, set, material, undo, redo, and delete operations.

`replayHexRefineCommandScript` rebuilds the final session state and returns:

- The replayed session.
- The active mesh.
- Named cell and node sets.
- Cell set materials.
- Warnings.
- Replayed command count.
- The effective merge tolerance.

This makes browser sessions portable and testable.

## Browser Workbench

`examples/browser/hexrefine.html` opens the workbench. It supports:

- Q1 and H1 grid generation.
- Q1 and H1 mesh import from JSON and legacy VTK.
- Rotate, zoom, parallel plane views, and screen-box selection.
- Coordinate-box and slice-based selection.
- Preview and apply refinement.
- Undo and redo.
- Node and cell set saving.
- Material assignment.
- Hanging-node checks.
- VTK, INP, and command-script export.
- Command-script import and replay.

## Testing

The test suite covers:

- Template element and coordinate expectations.
- Q1 and H1 refinement counts.
- Repeated local refinement without node merge blowup.
- Session hierarchy and undo/redo.
- Active mesh remapping.
- Export set remapping.
- Command script replay.
- Local and global conformance checks.
- Hex regularization.
- Browser import path smoke checks.
