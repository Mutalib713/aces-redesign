# ACES Redesign — project rules

CodeFest 2026 UI/UX Challenge entry. A mobile-first redesign of acesknust.com.

## Commands

```bash
npm run build          # design-source/ -> site/
npm run check          # gate: must pass before any deploy
npm run fetch-assets   # re-pull + re-optimise the hotlinked images (rarely needed)
npm start              # build, then serve site/ on :8123
```

## Sacred Rules

- **`design-source/*.dc.html` is the source of truth.** Never hand-edit `site/` — it is generated
  and wiped on every build.
- **The approved design ships as-is.** The build may repoint assets and inject the runtime. It may
  not rewrite markup, styling, copy, or layout. Visual changes happen in `design-source/`.
- **The brand is untouched.** ACES name, crest and the blue-and-white palette are a brief
  guardrail, not a design choice. `--brand #0B5FFF`, `--ink #0B1F3A`, `--brand-soft #EAF4FF`.
- **Nothing hotlinks off-site.** Every image is served locally. `npm run check` enforces this.
  Hotlinking the site we're replacing is exactly the fragility the case study criticises.
- **noindex stays on until Mutalib says launch.**

## Gotchas

- The `.dc.html` format is a template language (`sc-if`, `sc-for`, `{{ }}`) compiled to React at
  runtime by `support.js`, which needs `window.React` before it boots on `DOMContentLoaded`. The
  build injects vendored React ahead of it. React lives in `vendor-cache/`, committed, so builds
  work offline.
- The case study embeds the prototype with `<dc-import name="AcesPrototype">`, resolved at runtime
  by fetching `./AcesPrototype.dc.html` **as a sibling**. The prototype is therefore written out
  twice — once as `prototype.html`, once under its original name. Renaming it breaks section 03.
- Two marketplace product photos (`x1785230796086-1`, `1785230910153-2`) never made it out of the
  Claude Design project. The build detects absent files and blanks `img`, so `hasImg: !!p.img`
  goes false and the design's own placeholder tile renders. Do not "fix" this with a broken `<img>`.
- Don't add `cleanUrls` to `vercel.json` — it would mangle `AcesPrototype.dc.html`.
- Verify UI with JS measurements in the browser tool, not screenshots. Screenshots are flaky here.

## Standing rules

- Commit AND push after every meaningful change. Never wait for a green build.
- NEVER add AI attribution to commits, PRs, or pushes. No Co-Authored-By.
- Verify with evidence (check output, measurements, live URLs), not claims.
- Ghana users first: mobile, slow data. The image budget is real — the original site shipped
  12 MB of photos; we ship under 1 MB. Keep it that way.
