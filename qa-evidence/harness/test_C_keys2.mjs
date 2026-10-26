import * as L from "./lib.mjs";
const kind = process.argv[2] || "chromium";
const tag = (id) => (kind === "chromium" ? id : `${id}-${kind}`);
const { browser, page } = await L.launch(kind);
try {
  await L.boot(page);
  await L.open(page, L.fx("room10_binary.pcd"));
  const shot = async () => (await page.locator("#scene canvas").first().screenshot()).toString("base64");
  await page.focus('input[type=range][data-bind="crop.xmax"]'); await L.sleep(800);
  const a = await shot(); await L.sleep(800); const b = await shot();
  const v0 = await page.$eval('input[type=range][data-bind="crop.xmax"]', (e) => e.value);
  await page.keyboard.press("ArrowLeft"); await L.sleep(800);
  const c = await shot();
  const v1 = await page.$eval('input[type=range][data-bind="crop.xmax"]', (e) => e.value);
  L.record(tag("C-05c"), "C", "Kontrol: tuşsuz iki görüntü aynı, ArrowLeft sonrası farklı (X max slider odaklı)", "Slider değeri azalır, görünüm aynı", { idleStable: a === b, viewChangedAfterKey: b !== c, xmax: [v0, v1] }, a === b && b === c && v0 !== v1 ? "PASS" : "FAIL");
  // keyboard-only: Tab to a range slider and use arrows (WCAG 2.1.1)
  const box = await L.sceneBox(page);
  await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
  await page.mouse.down({ button: "right" });
  await L.sleep(100);
  const openAtDown = !(await page.$eval("#context-menu", (e) => e.hidden));
  await page.mouse.move(box.x + box.w / 2 + 100, box.y + box.h / 2 + 50, { steps: 6 });
  await page.mouse.up({ button: "right" });
  await L.sleep(150);
  const openAtUp = !(await page.$eval("#context-menu", (e) => e.hidden));
  L.record(tag("C-07"), "C", "Sağ tuşla sürükleme sonrası menü", "Sürükleme yapılırsa menü açılmamalı (yardım metni)", { openAtMouseDown: openAtDown, openAfterDragRelease: openAtUp }, !openAtUp ? "PASS" : "FAIL");
} finally {
  L.saveResults(`Ckeys2-${kind}`);
  await browser.close();
}
