# Contributing To ComformHex Community Edition

The current working tree is the private/custom performance edition. This file
is intended for the future public community edition, which should be cut from a
simpler free baseline.

For that community edition, contributions are welcome, especially around
correctness tests, GUI usability, import/export compatibility, and
documentation.

## Development Setup

```bash
npm install
npm run typecheck
npm test
```

Useful commands:

```bash
npm run build
npm run pages:build
npm run pages:serve
```

## Contribution Guidelines

- Keep the shared TypeScript kernel as the source of truth for GUI and offline
  workflows.
- Add regression tests for geometry, refinement, replay, and export changes.
- Avoid introducing browser-only behavior into the core kernel.
- Prefer streaming or chunked processing for large meshes.
- Keep public APIs and command-script formats backward compatible when possible.
- Document performance tradeoffs when a change improves one workflow but costs
  another.

## Testing Expectations

Before proposing a change, run:

```bash
npm run typecheck
npm test
```

For browser or standalone changes, also run:

```bash
npm run pages:build
```

## Project Direction

The first open-source community line should prioritize:

- conforming Q1/H1 local refinement,
- repeatable GUI-to-offline workflows,
- clear examples and correctness checks,
- simple customization for research and engineering use.
