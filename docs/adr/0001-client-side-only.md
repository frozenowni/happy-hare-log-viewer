# Process mmu.log entirely client-side, no backend

This tool is published for the wider Happy Hare / Voron community, so it will run on other people's printer logs, not just the author's. We decided all parsing, analysis, and rendering happens in the browser via the File API — the log is never uploaded anywhere. This keeps the tool trustworthy by construction (no server ever sees anyone's log data) and lets it be hosted for free as static files (GitHub Pages etc.), with no backend to run or secure.

Consequence: features that would need a server — persistent shareable result links, or offloading parsing of extremely large logs — are out of scope unless a future decision explicitly reintroduces a backend.
