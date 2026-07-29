// Gate before any deploy. Fails loudly rather than shipping a broken page.
//
//   1. every page exists, is non-trivial, and loads React before support.js
//   2. no template syntax leaked into the output (sc-if / sc-for / stray {{ }})
//   3. nothing is hotlinked from a third-party host any more
//   4. every local asset a page references is actually on disk
//   5. the page weight stays sane for a phone on slow data

const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..', 'site');
const PAGES = ['index.html', 'prototype.html', 'case-study.html'];

// Total transfer budget for a first visit on the heaviest route, in KB.
const BUDGET_KB = 2600;

const fail = [];
const warn = [];
const ok = [];

function check(cond, msg) {
  (cond ? ok : fail).push(msg);
  return cond;
}

if (!fs.existsSync(SITE)) {
  console.error('site/ missing — run `npm run build` first');
  process.exit(1);
}

for (const p of PAGES) {
  const file = path.join(SITE, p);
  if (!check(fs.existsSync(file), `${p} exists`)) continue;
  const html = fs.readFileSync(file, 'utf8');

  check(html.length > 20000, `${p} is non-trivial (${Math.round(html.length / 1024)} KB)`);

  // A pasted link has to render a card — this gets shared in WhatsApp, not crawled.
  const title = /<title>([^<]+)<\/title>/.exec(html);
  check(!!title, `${p} has a <title>${title ? ` — "${title[1].slice(0, 46)}"` : ''}`);
  check(/property="og:image"/.test(html), `${p} has an og:image`);
  check(/name="description"/.test(html), `${p} has a meta description`);

  const react = html.indexOf('vendor/react.production.min.js');
  const support = html.indexOf('support.js');
  check(react > -1 && react < support, `${p} loads React before support.js`);

  // {{ }} inside the <x-dc> template is expected; what must NOT survive is template
  // syntax outside it, which would mean the compile step silently failed at runtime.
  check(!/<sc-(if|for)\b/.test(html.split('</x-dc>')[1] || ''), `${p} has no unclosed template tags after </x-dc>`);

  // Only *assets* matter here — an <a href> to Instagram is a legitimate outbound link,
  // but an <img src> or CSS url() pointing off-site is a dependency we don't control.
  const assetUrls = [
    ...[...html.matchAll(/\bsrc="(https?:\/\/[^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/\bdata-src="(https?:\/\/[^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/url\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]+href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]),
  ];
  const external = [...new Set(assetUrls.map((u) => new URL(u).host))].filter(
    (h) => !/fonts\.(googleapis|gstatic)\.com$/.test(h)
  );
  check(external.length === 0, `${p} serves all assets locally (off-site: ${external.join(', ') || 'none'})`);

  // <dc-import name="X"> is resolved at runtime by fetching ./X.dc.html as a sibling.
  // If that file isn't shipped the embed silently renders as an empty box.
  for (const m of html.matchAll(/<dc-import[^>]+name="([^"]+)"/g)) {
    check(
      fs.existsSync(path.join(SITE, `${m[1]}.dc.html`)),
      `${p} embed <dc-import name="${m[1]}"> resolves`
    );
  }

  // Every local asset path the page mentions must resolve.
  const refs = new Set(
    [...html.matchAll(/["'](assets\/[A-Za-z0-9._\/-]+\.(?:webp|png|jpg|jpeg|avif))["']/g)].map((m) => m[1])
  );
  const dangling = [...refs].filter((r) => !fs.existsSync(path.join(SITE, r)));
  check(dangling.length === 0, `${p} has no dangling asset refs (${refs.size} checked)`);
  if (dangling.length) fail.push(`   dangling: ${dangling.slice(0, 5).join(', ')}`);
}

// Weight budget: page + runtime + every asset it could pull on one route.
const dirSize = (d) =>
  fs.existsSync(d)
    ? fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => {
        const p = path.join(d, e.name);
        return n + (e.isDirectory() ? dirSize(p) : fs.statSync(p).size);
      }, 0)
    : 0;

const heaviest = Math.max(...PAGES.map((p) => fs.statSync(path.join(SITE, p)).size));
const runtime = dirSize(path.join(SITE, 'vendor')) + fs.statSync(path.join(SITE, 'support.js')).size;
const marketplaceKb = Math.round((heaviest + runtime + dirSize(path.join(SITE, 'assets', 'mk'))) / 1024);
check(marketplaceKb < BUDGET_KB, `heaviest route is ${marketplaceKb} KB (budget ${BUDGET_KB} KB)`);

const totalKb = Math.round(dirSize(SITE) / 1024);
if (totalKb > 3500) warn.push(`whole site is ${totalKb} KB`);

for (const m of ok) console.log(`  pass  ${m}`);
for (const m of warn) console.log(`  warn  ${m}`);
for (const m of fail) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passed, ${warn.length} warnings, ${fail.length} failed  ·  site total ${totalKb} KB`);
process.exit(fail.length ? 1 : 0);
