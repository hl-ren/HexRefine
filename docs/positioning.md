# HexRefine Positioning

HexRefine is not a general-purpose professional CAE preprocessor. It is a
focused conforming local-refinement kernel with a browser workbench.

Professional preprocessors usually cover the whole preparation workflow:

- CAD import, repair, defeaturing, and geometry cleanup.
- Surface and volume meshing with many algorithms.
- Element quality checks, smoothing, and optimization.
- Boundary condition and load authoring.
- Materials, sections, contacts, connectors, constraints, and assemblies.
- Solver-specific decks for multiple solvers.
- Batch automation, model databases, and large-team workflows.

HexRefine covers a much narrower slice:

- Structured Q1/Hex mesh generation.
- Local Q1/Hex refinement templates.
- Automatic transition layers for conforming refinement.
- Hanging-node detection.
- Hierarchical refinement sessions with undo/redo.
- Named cell/node set remapping.
- VTK and INP text export.
- Command replay.
- A lightweight browser workbench.

## Rough Coverage

For a full professional preprocessor, HexRefine is roughly a small single-digit
to low-teens percentage of the total feature surface. A fair estimate is:

```txt
General CAE preprocessing suite:      5% - 15%
Structured Hex local-refinement flow: 40% - 70%
Research/prototype refinement kernel: 70% - 90%
```

The exact number depends on the workflow. If the task is "prepare an industrial
solver model from CAD," HexRefine is only a small component. If the task is
"take a structured quad/hex mesh, refine local regions conformingly, preserve
sets, and export the result," it covers a large part of that specialized path.

## What Makes It Distinctive

The distinctive part is not that it has a browser UI or exports VTK. The
distinctive part is the combination of these properties:

- Local Hex refinement is conforming rather than leaving hanging nodes.
- Transition templates are explicit and reportable.
- The refinement history is hierarchical, not just a destructive flat mesh
  rewrite.
- Active mesh rebuilds return remap tables for cells and nodes.
- Sets survive refinement through session ids and export remapping.
- Command replay makes GUI sessions reproducible.
- The core is small enough to test and reason about directly.

Many general preprocessors can do far more overall, but their local Hex
refinement behavior is often hidden inside a large modeling system. HexRefine
keeps that behavior exposed as a programmable kernel.

## Strengths

- Good fit for algorithm research around Q1/Hex local refinement.
- Good fit for generating controlled benchmark meshes.
- Good fit for reproducible browser-driven mesh experiments.
- Good fit for workflows that need refinement reports and template labels.
- Small enough to embed in another tool or wrap with a different UI.

## Current Limits

HexRefine currently does not provide:

- CAD import or geometry healing.
- Unstructured tetrahedral, prism, pyramid, or mixed meshing.
- General hex-dominant meshing from arbitrary geometry.
- Advanced element-quality optimization.
- Boundary condition authoring beyond named sets and simple materials.
- Contact, connector, constraint, assembly, or load modeling.
- Solver deck completeness beyond basic INP-style nodes, elements, sets,
  sections, and elastic materials.
- Large-model persistence, model database features, or collaborative workflows.

## Best Mental Model

Think of HexRefine as a specialized mesh refinement engine plus workbench:

```txt
Structured mesh in
  -> local conforming Q1/Hex refinement
  -> transition layer generation
  -> conformance validation
  -> set-preserving flat export
  -> VTK/INP out
```

It is not trying to replace a professional preprocessor. It is the kind of
focused component that could sit inside one.

## Why It May Be Valuable

Hex local refinement with no hanging nodes is a narrow but important problem.
When implemented as a compact, replayable, tested library, it becomes useful for:

- Prototyping refinement strategies.
- Comparing template families.
- Building demos and teaching tools.
- Producing repeatable solver-input experiments.
- Serving as a refinement backend for a larger preprocessor.

That focus is the project's main character. It is small, but it is not generic.
