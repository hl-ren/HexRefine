# ComformHex Import Templates

These files are small starter meshes for the browser `Import Mesh` action.

- `quad-single.json`: one 4-node Q1 quadrilateral
- `hex-single.json`: one 8-node H1 hexahedron
- `quad-single.vtk`: the same quad in ASCII legacy VTK form
- `hex-single.vtk`: the same hex in ASCII legacy VTK form

Current browser import support:

- JSON meshes with `nodes` and `elements`
- ASCII legacy VTK `UNSTRUCTURED_GRID`
- Pure `CELL_TYPE 9` quad meshes
- Pure `CELL_TYPE 12` hex meshes
