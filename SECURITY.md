# Security Policy

ComformHex is a local mesh-processing and browser-workbench project. It is not
designed to process untrusted files in a hardened sandbox.

## Supported Version

The current supported line is:

- `0.1.x`

## Reporting A Vulnerability

Please report security issues privately to:

```txt
Huilong Ren <hlren@tongji.edu.cn>
```

Include:

- the affected version or commit,
- steps to reproduce,
- the input file or workflow if it can be shared,
- expected and actual behavior.

## Notes For Users

- Treat imported mesh files and command scripts as local code/data inputs.
- Do not open untrusted workflows in privileged environments.
- Prefer offline export in a dedicated working directory for very large jobs.

