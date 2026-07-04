# Edition Strategy

HexRefine can reasonably use two editions:

## Community Edition

Purpose:

- free public use,
- teaching and research demos,
- lightweight customization,
- visibility for the project and author,
- a stable baseline that is easy for others to understand.

Recommended baseline:

- cut from an earlier, less optimized source snapshot,
- keep the implementation simpler,
- include MIT license, README, examples, tests, and GitHub Pages workflow,
- avoid promising very large mesh performance,
- describe large cases as experimental or custom-work territory.

Suggested positioning:

```txt
HexRefine Community Edition is a free TypeScript/browser workbench for
conforming Q1/H1 local mesh refinement on small and medium structured blocks.
```

## Performance / Custom Edition

Purpose:

- author's own large-mesh work,
- customized workflows,
- performance-sensitive offline replay,
- selected collaboration or service projects.

Recommended policy:

- keep this working tree private,
- keep `package.json` marked `private: true`,
- do not publish this edition to npm by accident,
- keep advanced performance work, large-model optimizations, and custom export
  paths here first,
- selectively backport safe, simple fixes to the community edition.

Current custom-edition performance directions:

- cached WebGL surface/edge rendering for million-cell visualization,
- chunked GUI selection/refine/delete workflows,
- element-center spatial indexes for coordinate and screen selection,
- stream-based VTK/INP file writing in offline scripts,
- native Q4/H8 session-stream export that avoids materializing flat element
  arrays,
- shared regularization domains and cached topology lattices for disconnected
  local refinement regions,
- shared GUI/offline refinement kernel so replayed jobs match interactive
  workflows,
- disconnected-region uvw regularization before local refinement.

Next private-edition targets:

- incremental native export plan reuse across repeated large exports,
- dirty-region active mesh rebuilds after local edits,
- typed-array topology/regularization caches for newly built large domains,
- worker-side or native acceleration for very large refinement batches,
- stronger quality metrics and batch job manifests.

## Practical Release Flow

1. Choose an older source snapshot as `community` baseline.
2. Restore it into a separate directory or git branch.
3. Keep MIT license and public-facing README there.
4. Tag it as the first community release.
5. Keep this current optimized line private as the performance/custom edition.
6. Backport only small, low-risk bug fixes from performance to community.

## Messaging

Avoid saying the free edition is artificially limited. A better message is:

```txt
The community edition focuses on clarity, reproducibility, and small-to-medium
mesh workflows. Larger production workflows are an active optimization area and
may require the custom performance edition or project-specific tuning.
```
