// Section F: PGM generation and output correctness (highest priority).
import fs from "node:fs";
import path from "node:path";
import * as L from "./lib.mjs";
const { record, fx, OUT } = L;
const kind = process.argv[2] || "chromium";
const tag = (id) => (kind === "chromium" ? id : `${id}-${kind}`);

function checkArtifacts(a, expectName) {
  const p = a.pgm, y = a.yaml ? L.parseYaml(a.yaml) : null;
  const problems = [];
  if (!p) problems.push("no pgm");
  else {
    if (p.magic !== "P5") problems.push("magic " + p.magic);
    if (p.maxval !== 255) problems.push("maxval " + p.maxval);
    if (!p.payloadOk) problems.push(`payload ${p.payload} != ${p.width * p.height}`);
    if (p.values.some((v) => v !== 0 && v !== 254)) problems.push("values " + p.values);
  }
  if (!y) problems.push("no yaml");
  else {
    const pgmName = a.names.find((n) => n.endsWith(".pgm"));
    if (y.image !== pgmName) problems.push(`image '${y.image}' != '${pgmName}'`);
    if (y.mode !== "trinary") problems.push("mode " + y.mode);
    if (y.negate !== "0") problems.push("negate " + y.negate);
    if (y.occupied_thresh !== "0.65" || y.free_thresh !== "0.196") problems.push("thresh");
    if (!Array.isArray(y.origin) || y.origin.length !== 3 || y.origin[2] !== 0) problems.push("origin " + JSON.stringify(y.origin));
  }
  if (expectName && !a.names.includes(expectName)) problems.push(`names ${a.names}`);
  return problems;
}

const { browser, page, log } = await L.launch(kind);
try {
  // ---------- F-01 synthetic 10 m room, known geometry ----------
  await L.boot(page);
  await L.open(page, fx("room10_binary.pcd"));
  const a = await L.exportMap(page, path.join(OUT, kind, "room10"));
  const pr = checkArtifacts(a, "room10_binary_map.pgm");
  record(tag("F-01a"), "F", "10 m oda: P5/YAML yapısı", "P5, 255, payload=w*h, değerler {0,254}, YAML alanları ve image adı doğru", { status: a.status, problems: pr, pgm: { w: a.pgm.width, h: a.pgm.height, sha: a.pgm.sha }, yaml: a.yaml }, pr.length ? "FAIL" : "PASS");
  const y = L.parseYaml(a.yaml), g = a.pgm;
  const res = +y.resolution;
  const occ = (wx, wy) => { const i = Math.floor((wx - y.origin[0]) / res), j = Math.floor((wy - y.origin[1]) / res); return g.data[(g.height - 1 - j) * g.width + i] === 0; };
  record(tag("F-01b"), "F", "10 m oda @0.05: boyut", "test.md örneği 200×200; README floor(span/res)+1 = 201×201 belgeliyor", `${g.width}×${g.height}, origin ${JSON.stringify(y.origin)}`, g.width === 201 && g.height === 201 ? "PASS" : "FAIL");
  // walls must be occupied all along, interior free, box outline occupied at correct place (checks Y flip)
  const wallSamples = [];
  for (let t = 0.03; t < 10; t += 0.37) wallSamples.push([0.001, t], [9.999, t], [t, 0.001], [t, 9.999]);
  const wallHits = wallSamples.filter(([x, yy]) => occ(x, yy)).length;
  const boxSamples = [[4.5, 6.0], [4.5, 7.0], [4.0, 6.5], [5.0, 6.5]];
  const boxHits = boxSamples.filter(([x, yy]) => occ(x + 0.001, yy + 0.001)).length;
  const freeSamples = [[2, 2], [8, 3], [4.5, 6.5], [7, 8], [4.5, 3.5]]; // box interior is free too
  const freeOk = freeSamples.filter(([x, yy]) => !occ(x, yy)).length;
  const mirrored = occ(4.5 + 0.001, 10 - 6.0 + 0.001) || occ(4.5 + 0.001, 10 - 7.0 + 0.001); // box would be here if Y were flipped
  record(tag("F-01c"), "F", "10 m oda: duvar/kutu konumu ve Y yönü", "Duvar örneklerinin tamamı dolu, kutu kenarları (x4–5,y6–7) dolu, iç alan boş, Y-aynası boş", { wallHits: `${wallHits}/${wallSamples.length}`, boxHits: `${boxHits}/4`, freeOk: `${freeOk}/5`, mirroredBox: mirrored }, wallHits === wallSamples.length && boxHits === 4 && freeOk === 5 && !mirrored ? "PASS" : "FAIL");
  record(tag("F-01d"), "F", "Status mesajı Z bandını açıklıyor", "Doğrudan indirmede pcd2pgm varsayılanı (0.1…1.5) uygulanır", a.status, /Z 0\.1 … 1\.5 m/.test(a.status) ? "PASS" : "FAIL");

  // ---------- F-02 preview vs file: orientation and dimensions ----------
  await L.click(page, "map-view-btn");
  const pv = await L.preview(page);
  const dimOk = pv.info.includes(`${g.width} × ${g.height} cells`);
  // hover the PGM canvas at a pixel and read the reported cell, then compare with the file
  const box = await page.evaluate(() => { const r = document.getElementById("pgm-canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.move(box.x + box.w / 2, box.y + box.h * 0.25);
  const hover = await L.text(page, "status-xyz");
  const m = /x (-?[\d.]+)\s+y (-?[\d.]+)\s+cell \((\d+), (\d+)\) (occupied|free)/.exec(hover);
  let hoverOk = false;
  if (m) { const [i, j] = [+m[3], +m[4]]; hoverOk = (g.data[(g.height - 1 - j) * g.width + i] === 0) === (m[5] === "occupied") && +m[2] > 5; }
  await page.screenshot({ path: path.join(OUT, kind, "F-02-preview.png") });
  record(tag("F-02"), "F", "Önizleme ile indirilen dosya eşleşiyor (boyut, Y yönü, hücre durumu)", "Info satırı dosya boyutunu verir; pane üst yarısı = büyük y; hover hücre durumu dosyayla aynı", { info: pv.info, hover, dimOk, hoverOk }, dimOk && hoverOk ? "PASS" : "FAIL");
  const a2 = await L.exportMap(page, path.join(OUT, kind, "room10-preview"));
  record(tag("F-03"), "F", "Önizleme açıkken indirme = doğrudan indirme", "Aynı parametrelerle byte-eşit PGM", { direct: g.sha, preview: a2.pgm.sha }, g.sha === a2.pgm.sha ? "PASS" : "FAIL");

  // ---------- F-04 parameter edge values typed like a user ----------
  async function typeInto(bind, value) {
    const sel = `[data-bind="${bind}"]`;
    await page.click(sel, { clickCount: 3 });
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    if (value !== "") await page.keyboard.type(String(value));
    await page.keyboard.press("Tab");
    await L.sleep(250);
  }
  const resCases = [["0", 0.01], ["-1", 0.01], ["0.001", 0.01], ["10", 1], ["", null], ["0,05", null], ["abc", null], ["0.1", 0.1], ["1e-1", 0.1], ["0.0500000001", 0.0500000001]];
  for (const [input, expect] of resCases) {
    await typeInto("ops.mapResolution", "0.05");
    await typeInto("ops.mapResolution", input);
    const shown = await L.getBind(page, "ops.mapResolution");
    const ex = await L.exportMap(page, path.join(OUT, kind, "res"));
    const yr = ex.yaml ? +L.parseYaml(ex.yaml).resolution : null;
    const want = expect ?? 0.05; // invalid text keeps the previous value
    const ok = yr !== null && Math.abs(yr - want) < 1e-9 && ex.pgm.payloadOk;
    record(tag(`F-04-res[${input || "boş"}]`), "F", `Cell (m) = "${input}"`, `Kenetlenir/yok sayılır; YAML resolution = ${want}`, { shownAfterBlur: shown, yamlResolution: yr, dims: ex.pgm && `${ex.pgm.width}×${ex.pgm.height}`, status: ex.status }, ok ? "PASS" : "FAIL");
  }
  await typeInto("ops.mapResolution", "0.05");
  const radiusCases = [["0", "off"], ["-0.5", "off"], ["2", "big"], ["", "keep"], ["x", "keep"]];
  for (const [input] of radiusCases) {
    await typeInto("ops.radius", "0.1");
    await typeInto("ops.radius", input);
    const pvx = await L.preview(page);
    record(tag(`F-05-radius[${input || "boş"}]`), "F", `Radius (m) = "${input}"`, "Anlamlı sonuç; 0/negatif = filtre kapalı; boş/harf = önceki değer", { shown: await L.getBind(page, "ops.radius"), info: pvx.info, empty: pvx.empty }, pvx.info || pvx.empty ? "PASS" : "FAIL");
  }
  await typeInto("ops.radius", "0.1");
  for (const input of ["0", "-3", "2.7", "1000", ""]) {
    await typeInto("ops.minNeighbors", "10");
    await typeInto("ops.minNeighbors", input);
    const pvx = await L.preview(page);
    record(tag(`F-06-neigh[${input || "boş"}]`), "F", `Neighbours = "${input}"`, "0 = kapalı, negatif→0, >200→200, ondalık→taban; anlamlı mesaj", { shown: await L.getBind(page, "ops.minNeighbors"), info: pvx.info, empty: pvx.empty }, pvx.info || pvx.empty ? "PASS" : "FAIL");
  }
  await typeInto("ops.minNeighbors", "10");

  // ---------- F-07 race: rapid changes, final preview & export must match final params ----------
  const seq = [];
  for (let i = 0; i < 40; i++) seq.push(["ops.mapResolution", [0.05, 0.1, 0.2, 0.07][i % 4]], ["ops.radius", [0.1, 0.2, 0.05][i % 3]], ["band.min", [0.1, 0.3, 0.5][i % 3]]);
  for (const [b, v] of seq) await L.setBind(page, b, v);
  await L.setBind(page, "ops.mapResolution", 0.08);
  await L.setBind(page, "ops.radius", 0.15);
  await L.setBind(page, "band.min", 0.2);
  const raceInfo = (await L.preview(page)).info;
  const raceDl = await L.exportMap(page, path.join(OUT, kind, "race"));
  // fresh page, set the same final parameters slowly
  await L.boot(page);
  await L.open(page, fx("room10_binary.pcd"));
  await L.click(page, "map-view-btn");
  await L.preview(page);
  await L.setBind(page, "ops.mapResolution", 0.08); await L.preview(page);
  await L.setBind(page, "ops.radius", 0.15); await L.preview(page);
  await L.setBind(page, "band.min", 0.2);
  const calmInfo = (await L.preview(page)).info;
  const calmDl = await L.exportMap(page, path.join(OUT, kind, "calm"));
  record(tag("F-07"), "F", "Hızlı parametre değişiminde yarış durumu", "120 hızlı değişiklik sonrası önizleme ve indirme, aynı son parametrelerin sakin hesaplamasıyla aynı", { raceInfo, calmInfo, raceSha: raceDl.pgm.sha, calmSha: calmDl.pgm.sha }, raceInfo === calmInfo && raceDl.pgm.sha === calmDl.pgm.sha ? "PASS" : "FAIL");

  // export immediately after a change while the worker is still busy (no wait)
  await L.setBind(page, "ops.radius", 0.12);
  const immediate = await L.exportMap(page, path.join(OUT, kind, "immediate"));
  await L.boot(page);
  await L.open(page, fx("room10_binary.pcd"));
  await L.setBind(page, "ops.mapResolution", 0.08);
  await L.setBind(page, "band.min", 0.2);
  await L.setBind(page, "ops.radius", 0.12);
  await L.sleep(1500);
  const settled = await L.exportMap(page, path.join(OUT, kind, "settled"));
  record(tag("F-08"), "F", "Parametre değişikliğinin hemen ardından indirme", "Son parametrelerle üretilmiş dosya (eski önbellek değil)", { immediate: immediate.pgm?.sha, settled: settled.pgm?.sha, status: immediate.status }, immediate.pgm && immediate.pgm.sha === settled.pgm.sha ? "PASS" : "FAIL");

  // ---------- F-09 downloads: twice, empty map, radius removes everything ----------
  const d1 = await L.exportMap(page, path.join(OUT, kind, "twice1"));
  const d2 = await L.exportMap(page, path.join(OUT, kind, "twice2"));
  record(tag("F-09a"), "F", "Arka arkaya iki kez indirme", "Her tıklamada iki dosya, aynı içerik", { first: d1.names, second: d2.names, same: d1.pgm.sha === d2.pgm.sha }, d1.names.length === 2 && d2.names.length === 2 && d1.pgm.sha === d2.pgm.sha ? "PASS" : "FAIL");
  await L.setBind(page, "crop.xmin", 20, { which: 0 });
  await L.setBind(page, "crop.xmax", 20, { which: 0 });
  const empty = await L.exportMap(page, path.join(OUT, kind, "empty"));
  record(tag("F-09b"), "F", "Boş kırpma ile indirme", "Dosya inmez, anlamlı hata", { status: empty.status, files: empty.names }, /failed/.test(empty.status) && empty.names.length === 0 ? "PASS" : "FAIL");
  await L.click(page, "crop-reset");
  await L.setBind(page, "ops.minNeighbors", 200);
  await L.setBind(page, "ops.radius", 0.01);
  const allGone = await L.exportMap(page, path.join(OUT, kind, "allgone"));
  record(tag("F-09c"), "F", "Radius filtresi her noktayı silince indirme", "Dosya inmez, parametreyi öneren hata", { status: allGone.status, files: allGone.names }, /failed/.test(allGone.status) && allGone.names.length === 0 ? "PASS" : "FAIL");

  // ---------- F-10 origin with an offset room ----------
  await L.boot(page);
  await L.open(page, fx("room_offset.pcd"));
  const off = await L.exportMap(page, path.join(OUT, kind, "offset"));
  const oy = L.parseYaml(off.yaml);
  const originOk = Math.abs(oy.origin[0] - 12.5) < 1e-4 && Math.abs(oy.origin[1] + 7.25) < 1e-4;
  record(tag("F-10"), "F", "Offsetli odada origin sol-alt köşe", "origin ≈ [12.5, -7.25, 0]", { origin: oy.origin, dims: `${off.pgm.width}×${off.pgm.height}` }, originOk ? "PASS" : "FAIL");

  // ---------- F-11 very large maps ----------
  await L.boot(page);
  await L.open(page, fx("km_scale.pcd"));
  await L.setBind(page, "ops.minNeighbors", 0);
  const huge = await L.exportMap(page, path.join(OUT, kind, "km"));
  record(tag("F-11a"), "F", "2 km × 2 km @0.05 (1.6e9 hücre)", "Bellek ayırmadan anlamlı hata", huge.status, /too large/.test(huge.status) && huge.names.length === 0 ? "PASS" : "FAIL");
  await L.setBind(page, "ops.mapResolution", 0.21);
  const t0 = Date.now();
  const near = await L.exportMap(page, path.join(OUT, kind, "km-near"), 300000).catch((e) => ({ status: "EXCEPTION " + e.message, names: [] }));
  const heapMb = await L.heap(page).catch(() => "page crashed");
  record(tag("F-11b"), "F", "Sınırın hemen altı (9525² ≈ 90.7M hücre)", "Çökmeden indirilir; süre/bellek kaydedilir", { status: near.status, ms: Date.now() - t0, heapMb, pgm: near.pgm && { w: near.pgm.width, h: near.pgm.height, payloadOk: near.pgm.payloadOk } }, near.pgm?.payloadOk ? "PASS" : "FAIL");
  await L.click(page, "map-view-btn");
  const t1 = Date.now();
  const nearPv = await L.preview(page, 300000).catch((e) => ({ info: "EXCEPTION " + e.message }));
  record(tag("F-11c"), "F", "Sınırın altındaki dev haritanın canlı önizlemesi", "Sekme çökmez, önizleme oluşur", { ms: Date.now() - t1, info: nearPv.info, heapMb: await L.heap(page).catch(() => "page crashed"), console: log.console.slice(-3) }, /cells/.test(nearPv.info || "") ? "PASS" : "FAIL");

  // ---------- F-12 real PCD artifact for Nav2/reference ----------
  await L.boot(page);
  await L.open(page, L.REAL);
  const realA = await L.exportMap(page, path.join(OUT, kind, "real"));
  record(tag("F-12"), "F", "Gerçek PCD indirme yapısı", "P5/YAML kuralları", { status: realA.status, problems: checkArtifacts(realA), dims: `${realA.pgm.width}×${realA.pgm.height}` }, checkArtifacts(realA).length ? "FAIL" : "PASS");
  record(tag("F-console"), "F", "F boyunca console/ağ hataları", "error/pageerror/4xx yok", { console: log.console.filter((c) => !/GPU stall|GL Driver|WebGL: INVALID|ReadPixels/.test(c)), http: log.http, failed: log.failed }, log.console.some((c) => /error/.test(c) && !/GPU stall|GL Driver|ReadPixels/.test(c)) || log.http.length ? "FAIL" : "PASS");
} catch (e) {
  record(tag("F-abort"), "F", "Harness", "-", e.stack, "ERROR");
} finally {
  L.saveResults(`F-${kind}`);
  await browser.close();
}
