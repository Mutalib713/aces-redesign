// Turn design-source/*.dc.html into a static site anyone can host.
//
// The .dc.html format is a small template language (sc-if / sc-for / {{ }}) that support.js
// compiles to React at runtime. It only ever ran inside Claude Design, which supplies React
// on window. Everything this build does is make that self-contained:
//
//   1. vendor React + ReactDOM locally (no CDN, works offline, no third-party dependency)
//   2. repoint hotlinked acesknust.com / Cloudinary images at our optimised local copies
//   3. convert the 50 marketplace PNGs to WebP and repoint the code that builds their paths
//   4. blank the src of any product whose image is genuinely missing, so the design's own
//      placeholder tile shows instead of a broken-image icon
//
// No markup or styling is rewritten. The design ships exactly as it was approved.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'design-source');
const SITE = path.join(ROOT, 'site');

// Each design file is written out under a clean URL. The prototype is ALSO written under its
// original filename, because the case study embeds it live via <dc-import name="AcesPrototype">
// and the runtime resolves that by fetching ./AcesPrototype.dc.html as a sibling. That embed is
// section 03 of the case study — dropping it would gut the "try it, everything works" section.
const PAGES = [
  ['ACES Home.dc.html', ['index.html']],
  ['AcesPrototype.dc.html', ['prototype.html', 'AcesPrototype.dc.html']],
  ['ACES Redesign Case Study.dc.html', ['case-study.html']],
];

const REACT_TAGS =
  '<script src="./vendor/react.production.min.js"></script>\n' +
  '<script src="./vendor/react-dom.production.min.js"></script>\n';

const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const kb = (n) => `${Math.round(n / 1024)} KB`;

async function convertProductImages() {
  const from = path.join(SRC, 'assets');
  const to = path.join(SITE, 'assets');
  let before = 0;
  let after = 0;
  const converted = new Set();

  for (const sub of ['mk', 'shop']) {
    const dir = path.join(from, sub);
    if (!fs.existsSync(dir)) continue;
    fs.mkdirSync(path.join(to, sub), { recursive: true });
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.png'))) {
      const raw = fs.readFileSync(path.join(dir, f));
      const out = await sharp(raw)
        .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78, effort: 5 })
        .toBuffer();
      const name = f.replace(/\.png$/, '.webp');
      fs.writeFileSync(path.join(to, sub, name), out);
      converted.add(`${sub}/${name}`);
      before += raw.length;
      after += out.length;
    }
  }

  // Already-optimised remote images just get copied across.
  const remoteFrom = path.join(from, 'remote');
  if (fs.existsSync(remoteFrom)) {
    fs.cpSync(remoteFrom, path.join(to, 'remote'), { recursive: true });
  }
  return { before, after, converted };
}

function loadRemoteManifest() {
  const p = path.join(SRC, 'assets', 'remote', 'manifest.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

/** Products whose image file doesn't exist get an empty src, so `hasImg: !!p.img` is false. */
function blankMissingProducts(html, converted) {
  const shots = /const SHOTS = \[([^\]]+)\]/.exec(html);
  if (!shots) return { html, missing: [] };
  const ids = shots[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  const missing = [];
  for (const id of ids) {
    for (let i = 0; i < 4; i++) {
      if (!converted.has(`mk/${id}-${i}.webp`)) missing.push(`${id}-${i}`);
    }
  }
  if (!missing.length) return { html, missing };

  // Wrap the generated path in a lookup that returns '' for images we don't have, so
  // `hasImg: !!p.img` goes false and the design's own placeholder tile renders instead.
  // The guard owns the extension too — otherwise a later .png -> .webp rewrite would turn
  // the empty string back into a truthy "/.webp" and we'd be back to a broken image.
  const guard = `const MISSING_IMG = new Set(${JSON.stringify(missing)});\n`;
  const before = html;
  html = html.replace(
    /img: 'assets\/mk\/' \+ (SHOTS\[[^\]]+\] \+ '-' \+ \(i % 4\)) \+ '\.png'/,
    (_m, expr) => `img: (k => MISSING_IMG.has(k) ? '' : 'assets/mk/' + k + '.webp')(${expr})`
  );
  if (html === before) throw new Error('build: product image path expression not found — did the design change?');
  html = html.replace(/const SHOTS = \[/, guard + 'const SHOTS = [');
  return { html, missing };
}

(async () => {
  rm(SITE);
  fs.mkdirSync(SITE, { recursive: true });

  // vendor/ survives the wipe because we re-download it only when absent
  const vendor = path.join(SITE, 'vendor');
  fs.mkdirSync(vendor, { recursive: true });
  for (const f of ['react.production.min.js', 'react-dom.production.min.js']) {
    const cached = path.join(ROOT, 'vendor-cache', f);
    if (fs.existsSync(cached)) fs.copyFileSync(cached, path.join(vendor, f));
  }

  for (const f of ['support.js', 'image-slot.js']) {
    fs.copyFileSync(path.join(SRC, f), path.join(SITE, f));
  }

  console.log('Converting product images to WebP...');
  const { before, after, converted } = await convertProductImages();
  console.log(`  ${converted.size} images  ${kb(before)} -> ${kb(after)} (-${Math.round((1 - after / before) * 100)}%)\n`);

  const remote = loadRemoteManifest();
  let totalMissing = [];

  for (const [srcName, outNames] of PAGES) {
    let html = fs.readFileSync(path.join(SRC, srcName), 'utf8');

    // 1. React, before support.js boots on DOMContentLoaded
    html = html.replace('<script src="./support.js"></script>', REACT_TAGS + '<script src="./support.js"></script>');

    // 2. hotlinked images -> local optimised copies
    let remoteHits = 0;
    for (const [url, local] of Object.entries(remote)) {
      const parts = html.split(url);
      remoteHits += parts.length - 1;
      html = parts.join(local);
    }

    // 3. guard the handful of products with no image file. Must run BEFORE the extension
    //    rewrite below, because the guard consumes the `+ '.png'` it replaces.
    const res = blankMissingProducts(html, converted);
    html = res.html;
    totalMissing = totalMissing.concat(res.missing);

    // 4. remaining product PNG paths -> WebP
    html = html
      .replace(/\+ '\.png'/g, "+ '.webp'")
      .replace(/assets\/shop\/codefest-shirt\.png/g, 'assets/shop/codefest-shirt.webp');

    for (const outName of outNames) {
      fs.writeFileSync(path.join(SITE, outName), html);
      console.log(`  ${outName.padEnd(24)} ${kb(Buffer.byteLength(html))}  (${remoteHits} remote refs localised)`);
    }
  }

  if (totalMissing.length) {
    console.log(`\n  note: ${new Set(totalMissing).size} product image(s) absent, placeholder tile will show:`);
    console.log(`        ${[...new Set(totalMissing)].join(', ')}`);
  }
  console.log('\nBuilt into site/');
})();
