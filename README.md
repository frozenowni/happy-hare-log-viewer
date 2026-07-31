# Happy Hare Log Viewer

A free, static web app for analyzing [Happy Hare](https://github.com/moggieuk/Happy-Hare) MMU `mmu.log` files — charts, diagrams, a searchable raw log viewer, and predefined searches for the content that matters most.

Runs entirely in your browser. Your log is never uploaded anywhere.

## Running it

**Hosted (e.g. GitHub Pages):** just visit the page — no setup, no build step.

**Locally:** don't double-click `index.html` directly. Browsers block loading JS modules (`<script type="module">`) from a `file://` URL for security reasons, so opening the file that way leaves the page blank with a console error. Instead, serve the folder over HTTP with anything you have on hand, for example:

```bash
node scripts/dev-server.js   # zero-dependency, included in this repo
# or
python3 -m http.server 4173
```

Then open `http://localhost:4173`. This is a one-time browser restriction on the `file://` origin, not a build step — nothing is compiled or bundled either way.

## Status

In development. See [docs/agents/spec-draft.md](docs/agents/spec-draft.md) for the v1 spec.

## Project docs

- [CONTEXT.md](CONTEXT.md) — domain glossary
- [docs/adr/](docs/adr/) — architecture decision records

## License

GPLv3 — see [LICENSE](LICENSE).
