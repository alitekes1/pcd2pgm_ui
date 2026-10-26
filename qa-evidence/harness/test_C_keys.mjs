import * as L from "./lib.mjs";
const kind = process.argv[2] || "chromium";
const tag = (id) => (kind === "chromium" ? id : `${id}-${kind}`);
const { browser, page } = await L.launch(kind);
try {
  await L.boot(page);
  await L.open(page, L.fx("room10_binary.pcd"));
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  // camera fingerprint = what the scene shows under three fixed pixels (status-xyz after hover)
  const shot = async () => (await page.locator("#scene canvas").first().screenshot()).toString("base64");
  const cases = [
    ['[data-bind="ops.radius"]', "ArrowUp", "number"],
    ['[data-bind="ops.mapResolution"]', "ArrowDown", "number"],
    ['input[type=range][data-bind="crop.xmin"]', "ArrowRight", "range"],
    ['input[type=range][data-bind="rot.yaw"]', "ArrowRight", "range (rotation)"],
    ['select[data-bind="view.colormap"]', "ArrowDown", "select"],
  ];
  for (const [sel, key, what] of cases) {
    await page.focus(sel); await L.sleep(400);
    const a = await shot(); const v0 = await page.$eval(sel, (e) => e.value);
    const p = page.evaluate(({ sel }) => new Promise((res) => document.querySelector(sel).addEventListener("keydown", (e) => setTimeout(() => res(e.defaultPrevented)), { once: true })), { sel });
    await page.keyboard.press(key);
    const dp = await p;
    await L.sleep(700);
    const b = await shot(); const v1 = await page.$eval(sel, (e) => e.value);
    L.record(tag(`C-05[${what} ${key}]`), "C", `Odaklı ${what} alanında ${key}`, "Alan değeri değişir, 3D görünüm kaymaz", { before: v0, after: v1, defaultPrevented: dp, viewChanged: a !== b, active: await page.evaluate(() => document.activeElement?.dataset?.bind) }, v0 !== v1 && a === b ? "PASS" : "FAIL");
  }
  // typing a letter shortcut inside a field must not toggle tools
  await page.focus('[data-bind="ops.radius"]');
  await page.keyboard.type("mlt");
  L.record(tag("C-05[shortcut in field]"), "C", "Alana odaklıyken M/L/T yazma", "Araç/görünüm değişmez", { activeTool: await page.evaluate(() => document.querySelector("#toolbar .active")?.id) }, (await page.evaluate(() => document.querySelector("#toolbar .active")?.id)) === "tb-orbit" ? "PASS" : "FAIL");
  // right-drag must not open the context menu
  const b = await L.sceneBox(page);
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2); // focus the canvas
  await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(b.x + b.w / 2 + 120, b.y + b.h / 2 + 60, { steps: 8 });
  await page.mouse.up({ button: "right" });
  await L.sleep(200);
  L.record(tag("C-07"), "C", "Sağ tuşla sürükleme sonrası menü", "Yardım: 'Right-click (without dragging)' → menü açılmamalı", { menuOpen: !(await page.$eval("#context-menu", (e) => e.hidden)) }, (await page.$eval("#context-menu", (e) => e.hidden)) ? "PASS" : "FAIL");
} finally {
  L.saveResults(`Ckeys-${kind}`);
  await browser.close();
}
