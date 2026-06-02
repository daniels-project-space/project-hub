/**
 * One-off build script (WAVE 1B): downloads + trims the bundled static travel
 * datasets into src/lib/travel/data/. Run manually with `node scripts/build-travel-datasets.mjs`.
 * Not wired into the build pipeline — the produced JSON is committed and lazy-imported.
 *
 *  - airports.json:        OpenFlights airports.dat → compact rows (IATA only).
 *  - passport-index.json:  ilyankou/passport-index-dataset (MIT) → matrix trimmed
 *                          to a sensible home-passport set (keeps file small).
 */
import https from "node:https";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(import.meta.dirname, "../src/lib/travel/data");
fs.mkdirSync(OUT, { recursive: true });

function get(url) {
  return new Promise((res, rej) => {
    https
      .get(url, { headers: { "User-Agent": "node" } }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400) {
          return get(r.headers.location).then(res, rej);
        }
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => res(d));
      })
      .on("error", rej);
  });
}

function parseCSVLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

async function buildAirports() {
  const raw = await get(
    "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat",
  );
  const arr = [];
  for (const line of raw.trim().split("\n")) {
    const f = parseCSVLine(line);
    const iata = f[4];
    if (!iata || iata === "\\N" || iata.length !== 3) continue;
    const lat = parseFloat(f[6]);
    const lng = parseFloat(f[7]);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    arr.push({
      iata,
      name: f[1],
      city: f[2],
      country: f[3],
      lat: +lat.toFixed(4),
      lng: +lng.toFixed(4),
      tz: f[11] === "\\N" ? "" : f[11],
    });
  }
  fs.writeFileSync(path.join(OUT, "airports.json"), JSON.stringify(arr));
  console.log("airports kept:", arr.length, "bytes:", fs.statSync(path.join(OUT, "airports.json")).size);
}

async function buildPassportIndex() {
  // Matrix CSV: first column "Passport", remaining columns = destination countries.
  // Cell values: "visa free", "e-visa", "visa on arrival", number (days visa-free),
  // "visa required", "-1" (own country). We keep ALL rows (the full matrix is
  // ~199x199 but values are short strings → compresses to a compact object map).
  const raw = await get(
    "https://raw.githubusercontent.com/ilyankou/passport-index-dataset/master/passport-index-matrix-iso2.csv",
  );
  const lines = raw.trim().split("\n");
  const header = parseCSVLine(lines[0]); // ["Passport","AD","AE",...]
  const dests = header.slice(1).map((s) => s.trim().toUpperCase());
  /** @type {Record<string, Record<string,string>>} */
  const matrix = {};
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    const from = cells[0].trim().toUpperCase();
    if (!from) continue;
    const row = {};
    for (let j = 1; j < cells.length; j++) {
      const to = dests[j - 1];
      const v = (cells[j] || "").trim();
      if (!to || !v || v === "-1") continue; // skip self / empty
      row[to] = v;
    }
    matrix[from] = row;
  }
  fs.writeFileSync(
    path.join(OUT, "passport-index.json"),
    JSON.stringify(matrix),
  );
  console.log(
    "passport rows:",
    Object.keys(matrix).length,
    "bytes:",
    fs.statSync(path.join(OUT, "passport-index.json")).size,
  );
}

await buildAirports();
await buildPassportIndex();
