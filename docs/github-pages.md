# GitHub Pages Deployment

HexRefine can be deployed as a static GitHub Pages site. The site contains the
browser workbench, compiled runtime modules, documentation, and generated VTK
examples. It does not require a backend service.

## Repository Setup

1. Push this project to a GitHub repository.
2. In GitHub, open `Settings` -> `Pages`.
3. Set `Build and deployment` -> `Source` to `GitHub Actions`.
4. Push to the `main` branch, or run the workflow manually from the `Actions`
   tab.

The workflow is defined in:

```txt
.github/workflows/pages.yml
```

## What The Workflow Does

On every push to `main`, the workflow:

1. Checks out the repository.
2. Installs locked Node dependencies with `npm ci`.
3. Runs `npm test`.
4. Runs `npm run pages:build`.
5. Uploads `release/pages/` as the Pages artifact.
6. Deploys the artifact to GitHub Pages.

The deployed URL will usually be:

```txt
https://<owner>.github.io/<repo>/
```

For this repository, the Pages URL is:

```txt
https://hl-ren.github.io/HexRefine/
```

For a user or organization site repository named `<owner>.github.io`, the URL is:

```txt
https://<owner>.github.io/
```

## Local Preview

Build the Pages bundle:

```bash
npm run pages:build
```

Serve it locally:

```bash
npm run pages:serve
```

Then open:

```txt
http://127.0.0.1:8080/
```

## Pages Bundle

`npm run pages:build` writes the stable Pages upload directory:

```txt
release/pages/
```

It also writes the versioned web bundle:

```txt
release/hexrefine-<version>/web/
```

The stable path is used by GitHub Actions so the workflow does not need to be
updated when the package version changes.

## Notes

- The site uses relative URLs, so it works under both root domains and
  project-page subpaths.
- `.nojekyll` is generated in the Pages bundle so GitHub Pages serves files
  without Jekyll processing.
- Generated release files are ignored by Git and should not be committed.
