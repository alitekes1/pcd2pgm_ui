import path from "node:path";
import * as L from "./lib.mjs";
const { record, fx, OUT } = L;
const kind = process.argv[2] || "chromium";
const tag = (id) => (kind === "chromium" ? id : `${id}-${kind}`);

// F-01c re-check with walls sampled on their own columns (x = 0 and x = 10 exactly)
const g = L.readPgm(path.join(OUT, kind, "room10", "room10_binary_map.pgm"));
const occ = (wx, wy) => { const i = Math.floor(wx / 0.05), j = Math.floor(wy / 0.05); return g.data[(g.height - 1 - j) * g.width + i] === 0; };
const s = [];
for (let t = 0.03; t < 10; t += 0.37) s.push([0, t], [10, t], [t, 0], [t, 10]);
const hits = s.filter(([x, y]) => occ(x, y)).length;
const rowsOcc = [0, 200].map((r) => g.data.subarray(r * 201, r * 201 + 201).reduce((a, v) => a + (v === 0), 0));
const colsOcc = [0, 200].map((c) => { let n = 0; for (let r = 0; r < 201; r++) n += g.data[r * 201 + c] === 0; return n; });
record("F-01c", "F", "10 m oda: duvar/kutu konumu ve Y yönü (düzeltilmiş örnekleme)", "Dört duvar 201 hücre boyunca dolu; kutu kenarları dolu; iç alan boş", { wallSamples: `${hits}/${s.length}`, topBottomRowOccupied: rowsOcc, leftRightColOccupied: colsOcc }, hits === s.length && [...rowsOcc, ...colsOcc].every((n) => n === 201) ? "PASS" : "FAIL");

// F-04 decimal comma, typed by a real keyboard, en-US and tr-TR locales
for (const locale of ["en-US", "tr-TR"]) {
  const { browser, page } = await L.launch(kind, { locale });
  try {
    await L.boot(page);
    await L.open(page, fx("room10_binary.pcd"));
    const sel = '[data-bind="ops.mapResolution"]';
    const steps = [];
    for (const typed of ["0,05", "0,1", "0.07"]) {
      await page.click(sel, { clickCount: 3 });
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      for (const ch of typed) {
        await page.keyboard.type(ch);
        steps.push(`${typed}→after '${ch}': value="${await page.$eval(sel, (e) => e.value)}"`);
      }
      await page.keyboard.press("Tab");
      await L.sleep(250);
      const ex = await L.exportMap(page, path.join(OUT, kind, `comma-${locale}`));
      const r = +L.parseYaml(ex.yaml).resolution;
      const want = { "0,05": 0.05, "0,1": 0.1, "0.07": 0.07 }[typed];
      record(tag(`F-04-comma[${locale} ${typed}]`), "F", `Klavye ile "${typed}" yazma (${locale})`, `Ya ${want} olarak kabul edilir ya da reddedilip önceki değer korunur; asla başka bir değer değil`, { yamlResolution: r, shown: await L.getBind(page, "ops.mapResolution"), status: ex.status }, Math.abs(r - want) < 1e-9 || r === 0.05 || r === 0.07 && typed !== "0.07" ? "PASS" : "FAIL");
    }
    console.log(steps.join("\n"));
  } finally { await browser.close(); }
}

// F-09b empty crop: XY inside the room interior, Z band without the floor
{
  const { browser, page } = await L.launch(kind);
  try {
    await L.boot(page);
    await L.open(page, fx("room10_binary.pcd"));
    for (const [b, v] of [["crop.xmin", 2], ["crop.xmax", 3], ["crop.ymin", 2], ["crop.ymax", 3], ["band.min", 0.1], ["band.max", 1.5]]) await L.setBind(page, b, v);
    const e = await L.exportMap(page, path.join(OUT, kind, "empty"));
    record(tag("F-09b"), "F", "Boş kırpma (iç bölge, zemin hariç) ile indirme", "Dosya inmez, anlamlı hata", { status: e.status, files: e.names }, /failed/.test(e.status) && !e.names.length ? "PASS" : "FAIL");
    await L.click(page, "map-view-btn");
    const pv = await L.preview(page);
    record(tag("F-09d"), "F", "Boş kırpmada PGM önizlemesi", "Boş ekran yerine açıklayıcı mesaj", pv, /No points/.test(pv.empty) ? "PASS" : "FAIL");
    // crop beyond bounds is clamped (documenting behaviour)
    await L.click(page, "crop-reset");
    await L.setBind(page, "crop.xmin", 50);
    record(tag("F-09e"), "F", "Sınır dışı X min değeri", "Bulut sınırına kenetlenir", { xmin: await L.getBind(page, "crop.xmin"), xmax: await L.getBind(page, "crop.xmax") }, +(await L.getBind(page, "crop.xmin")) <= 10.01 ? "PASS" : "FAIL");
  } finally { await browser.close(); }
}
L.saveResults(`Ffollow-${kind}`);
