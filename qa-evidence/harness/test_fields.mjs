// QA2-02 regression: typing into every kind of bound number field.
import * as L from "./lib.mjs";
const kind = process.argv[2] || "chromium";
const tag = (id) => (kind === "chromium" ? id : `${id}-${kind}`);
const { browser, page } = await L.launch(kind);
const type = async (bind, text, which = 0) => {
  const el = page.locator(`[data-bind="${bind}"].num-input`).nth(which);
  await el.click(); await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace");
  await page.keyboard.type(text); await page.keyboard.press("Tab"); await L.sleep(250);
};
const stats = () => L.text(page, "status-stats");
try {
  await L.boot(page);
  await L.open(page, L.fx("room10_binary.pcd"));
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  // signed crop field with a decimal comma
  await type("crop.xmin", "2,5");
  const c = await page.evaluate(() => [document.querySelector('.num-input[data-bind="crop.xmin"]').value, document.querySelector('input[type=range][data-bind="crop.xmin"]').value]);
  L.record(tag("FLD-crop"), "C", "Crop X min alanına '2,5'", "2.5 uygulanır, slider da 2.5", c, c[0] === "2.5" && c[1] === "2.5" ? "PASS" : "FAIL");
  await L.click(page, "crop-reset");
  // negative manual transform, then apply
  await type("tf.z", "-0,5");
  await L.click(page, "tf-btn"); await L.sleep(200);
  const zb = await page.evaluate(() => [document.querySelector('.num-input[data-bind="band.min"]').value, document.querySelector('.num-input[data-bind="band.max"]').value]);
  L.record(tag("FLD-tf"), "B", "Manuel transform z = '-0,5' + Apply", "Bulut +0.5 m kayar (pcd2pgm tersini uygular): Z 0.5 … 3", zb, zb[0] === "0.5" && zb[1] === "3" ? "PASS" : "FAIL");
  await page.keyboard.press("Control+z"); await L.sleep(200);
  // rotation number field applies the rotation when the field is left
  await type("rot.yaw", "90");
  const s = await stats();
  const yaw = await page.evaluate(() => document.querySelector('input[type=range][data-bind="rot.yaw"]').value);
  L.record(tag("FLD-rot"), "B", "Yaw alanına '90' + Tab", "Döndürme uygulanır, slider 90, undo kullanılabilir", { yawSlider: yaw, undoEnabled: !(await page.$eval("#tb-undo", (e) => e.disabled)), stats: s, msg: (await L.msgs(page)).filter((m) => /Rotated/.test(m)).pop() }, yaw === "90" && /Rotated/.test((await L.msgs(page)).join()) ? "PASS" : "FAIL");
  await page.keyboard.press("Control+z"); await L.sleep(200);
  // half-typed values are not applied while typing; invalid text is restored on leave
  const el = page.locator('[data-bind="ops.mapResolution"]');
  await L.click(page, "map-view-btn"); await L.preview(page);
  await el.click(); await page.keyboard.press("Control+A"); await page.keyboard.type("0");
  await L.sleep(400);
  const mid = (await L.preview(page)).info;
  await page.keyboard.type(".1"); await L.sleep(400);
  const done = (await L.preview(page)).info;
  await page.keyboard.press("Control+A"); await page.keyboard.type("abc"); await page.keyboard.press("Tab"); await L.sleep(300);
  const restored = await el.inputValue();
  L.record(tag("FLD-live"), "F", "Cell alanında '0' → '0.1' yazarken canlı önizleme, sonra 'abc'", "'0' uygulanmaz (201×201 kalır), '0.1' canlı uygulanır (101×101), 'abc' bırakınca 0.1 geri gelir", { whileZero: mid, after01: done, afterAbc: restored }, /201 × 201/.test(mid) && /101 × 101/.test(done) && restored === "0.1" ? "PASS" : "FAIL");
  // keyboard shortcuts must not fire inside the (now text) fields
  await el.click(); await page.keyboard.type("mltp");
  const tool = await page.evaluate(() => [document.querySelector("#toolbar .active")?.id, !document.getElementById("pgm-pane").hidden]);
  L.record(tag("FLD-keys"), "E", "Alanda 'mltp' yazma", "Araç/görünüm değişmez", tool, tool[0] === "tb-orbit" && tool[1] === true ? "PASS" : "FAIL");
  L.record(tag("FLD-errors"), "G", "Yakalanmamış hata", "Yok", await page.evaluate(() => window.__errors), (await page.evaluate(() => window.__errors.length)) ? "FAIL" : "PASS");
} catch (e) {
  L.record(tag("FLD-abort"), "-", "Harness", "-", e.stack, "ERROR");
} finally {
  L.saveResults(`fields-${kind}`);
  await browser.close();
}
