// Core output checks against the deployed site (test.md target URL).
import path from "node:path";
import * as L from "./lib.mjs";
const { record, fx, OUT } = L;
const { browser, page, log } = await L.launch("chromium");
try {
  await L.boot(page);
  await L.open(page, L.REAL);
  const direct = await L.exportMap(page, path.join(OUT, "live", "direct"));
  await L.boot(page);
  await L.open(page, L.REAL);
  await L.click(page, "map-view-btn"); await L.preview(page);
  const prev = await L.exportMap(page, path.join(OUT, "live", "preview"));
  record("LIVE-01", "F", "Canlı site: doğrudan indirme = önizleme sonrası indirme", "Aynı PGM", { direct: [direct.pgm.width, direct.pgm.height, direct.pgm.sha], preview: [prev.pgm.width, prev.pgm.height, prev.pgm.sha] }, direct.pgm.sha === prev.pgm.sha ? "PASS" : "FAIL");
  await L.boot(page);
  await L.open(page, fx("cloud # cropped: yes.pcd"));
  const h = await L.exportMap(page, path.join(OUT, "live", "hostile"));
  record("LIVE-02", "F", "Canlı site: '#' ve ':' içeren dosya adı", "YAML image = kaydedilen PGM adı", { saved: h.names, yamlLine: h.yaml.split("\n")[0] }, L.parseYaml(h.yaml).image === h.names.find((n) => n.endsWith(".pgm")) ? "PASS" : "FAIL");
  await L.boot(page);
  const f64 = await L.open(page, fx("f64_binary.pcd"));
  record("LIVE-03", "A", "Canlı site: float64 binary PCD", "Açık hata", f64.filter((m) => /status|welcome/.test(m)).pop(), /failed/.test(f64.join()) ? "PASS" : "FAIL");
  record("LIVE-04", "G", "Canlı site: başlangıçta 4xx kaynak", "Yok", log.http, log.http.length ? "FAIL" : "PASS");
} finally {
  L.saveResults("LIVE");
  await browser.close();
}
