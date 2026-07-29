// Pull every remote image the designs hotlink, optimise it, and store it locally.
//
// Why: the live designs point at www.acesknust.com and Cloudinary. Hotlinking the site
// we're replacing is fragile (it breaks if their host does), and the Cloudinary hero is
// 1.9 MB — unusable on Ghana mobile data. We self-host instead.
//
// Output lands in design-source/assets/remote/ and is committed, so the build is
// reproducible offline.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'design-source', 'assets', 'remote');

// Longest edge each image actually needs, based on how the designs use it.
const MAX_EDGE = {
  hero: 1600,
  card: 900,
  logo: 320,
};

const IMAGES = [
  ['https://res.cloudinary.com/dmgk37i6y/image/upload/v1756508620/aces-group-photo_zoxsvy.png', 'aces-group-photo', 'hero'],
  ['https://res.cloudinary.com/dmgk37i6y/image/upload/v1756508481/codefest_erdhpl.jpg', 'codefest', 'card'],
  ['https://res.cloudinary.com/dmgk37i6y/image/upload/v1756390037/robotics_meeting_avcz53.jpg', 'robotics-meeting', 'card'],
  ['https://res.cloudinary.com/dmgk37i6y/image/upload/v1756508481/aces_hangout_eywxew.jpg', 'aces-hangout', 'card'],
  ['https://res.cloudinary.com/dmgk37i6y/image/upload/v1756562742/dinner_night_uicikj.jpg', 'dinner-night', 'card'],
  ['https://res.cloudinary.com/dmgk37i6y/image/upload/v1756565095/executives_ahwozc.jpg', 'executives', 'card'],
  ['https://www.acesknust.com/images/logo-white.png', 'logo-white', 'logo'],
  ['https://www.acesknust.com/images/Gallery/Trip.jpg', 'gallery-trip', 'card'],
  ['https://www.acesknust.com/images/Gallery/Acesshirt.jpg', 'gallery-acesshirt', 'card'],
  ['https://www.acesknust.com/images/Gallery/codefest.jpg', 'gallery-codefest', 'card'],
  ['https://www.acesknust.com/images/Gallery/Jersey.jpg', 'gallery-jersey', 'card'],
  ['https://www.acesknust.com/images/club_images/Arduino_image.avif', 'club-arduino', 'card'],
  ['https://www.acesknust.com/images/club_images/coding.webp', 'club-coding', 'card'],
  ['https://www.acesknust.com/images/club_images/robotics_image.webp', 'club-robotics', 'card'],
];

async function download(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (aces-redesign asset fetcher)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = {};
  let before = 0;
  let after = 0;
  let failed = 0;

  for (const [url, name, kind] of IMAGES) {
    const dest = path.join(OUT, `${name}.webp`);
    try {
      const raw = await download(url);
      // The logo is white-on-transparent — keep the alpha channel.
      const out = await sharp(raw)
        .rotate()
        .resize({ width: MAX_EDGE[kind], height: MAX_EDGE[kind], fit: 'inside', withoutEnlargement: true })
        .webp({ quality: kind === 'logo' ? 92 : 80, effort: 5 })
        .toBuffer();
      fs.writeFileSync(dest, out);
      before += raw.length;
      after += out.length;
      manifest[url] = `assets/remote/${name}.webp`;
      const pct = Math.round((1 - out.length / raw.length) * 100);
      console.log(
        `  ${name.padEnd(20)} ${String(Math.round(raw.length / 1024)).padStart(5)} KB -> ${String(
          Math.round(out.length / 1024)
        ).padStart(4)} KB  (-${pct}%)`
      );
    } catch (e) {
      failed++;
      console.log(`  ${name.padEnd(20)} FAILED: ${e.message}`);
    }
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(
    `\n${Object.keys(manifest).length}/${IMAGES.length} images  ` +
      `${Math.round(before / 1024)} KB -> ${Math.round(after / 1024)} KB ` +
      `(-${Math.round((1 - after / before) * 100)}%)`
  );
  if (failed) process.exitCode = 1;
})();
