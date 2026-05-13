# Mesh Import

The browser workbench can import starting meshes before refinement.

Supported formats:

- JSON meshes with `nodes` and `elements`
- ASCII legacy VTK `UNSTRUCTURED_GRID`

Supported element families:

- `Q1`: 4-node quadrilaterals
- `H1`: 8-node hexahedra

The mesh must be pure Quad or pure Hex. Mixed cell types are rejected with an
explicit error.

## JSON Shape

```json
{
  "kind": "H1",
  "nodes": [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  "elements": [[1, 2, 3, 4, 5, 6, 7, 8]]
}
```

Notes:

- Node ids in `elements` are 1-based.
- `kind` is optional when it matches the element node count.
- Q1 points may be 2D or 3D. H1 points must contain 3 coordinates.

## VTK Shape

The importer expects legacy ASCII VTK with:

- `DATASET UNSTRUCTURED_GRID`
- `POINTS`
- `CELLS`
- `CELL_TYPES`

Supported cell types:

- `9` for Quad
- `12` for Hexahedron

## Templates

Starter files are in:

```txt
examples/input/
```

Use these to quickly test browser import and follow-on refinement.
