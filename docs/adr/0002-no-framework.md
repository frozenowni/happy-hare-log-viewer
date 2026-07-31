# Plain HTML/CSS/JS, no framework, no build step

The app has several linked views (charts, timeline, gate map, job-state diagram, raw log) that could justify a component framework's state management. We chose plain HTML/CSS/JS with no build tooling instead, using Chart.js from a CDN only for the numeric charts, because this is a community-forked hobbyist tool: `git clone` + open `index.html` with no `npm install`/bundler config lowers the bar for contributors to read, fork, and PR against it. State is coordinated through a single in-memory parsed-log object that each view reads from and updates the DOM against directly.

Consequence: as the app grows, cross-view state coordination is manual rather than framework-managed. If the view count or interaction complexity grows substantially, this decision should be revisited.
