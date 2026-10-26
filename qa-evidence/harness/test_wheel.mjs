// Mouse wheel steps focused number fields.
import * as L from "./lib.mjs";
const kind = process.argv[2] || "chromium";
const tag = (id) => (kind === "chromium" ? id : `${id}-${kind}`);
const { browser, page, log } = await L.launch(kind);
const F = (b) => `input.num-input[data-bind="${b}"]`;
const val = (sel) => page.$eval(sel, (e) => e.value);
async function wheel(sel, notches, { focus = true } = {}) {
  if (focus) await page.click(sel);
  await L.sleep(300); // let any smooth panel scroll settle before aiming
  const box = await page.locator(sel).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < Math.abs(notches); i++) { await page.mouse.wheel(0, notches > 0 ? -100 : 100); await L.sleep(40); }
  await L.sleep(100);
}
try {
  await L.boot(page);
  await L.open(page, L.fx("room10_binary.pcd"));
  await L.click(page, "map-view-btn");
  await L.preview(page);

  // 1) not focused: value untouched
  await page.evaluate(() => document.activeElement?.blur());
  const r0 = await val(F("ops.mapResolution"));
  await wheel(F("ops.mapResolution"), 2, { focus: false });
  L.record(tag("W-01"), "W", "Odaksız alanda tekerlek değeri değiştirmez", "0.05 kalır", [r0, await val(F("ops.mapResolution"))], (await val(F("ops.mapResolution"))) === r0 ? "PASS" : "FAIL");

  // 2) focused: up 1, then down 3; the live map follows
  await L.sleep(2000); // Firefox keeps a wheel "transaction" on the scrolled panel for 1.5 s
  await wheel(F("ops.mapResolution"), 1);
  const up = await val(F("ops.mapResolution"));
  const infoUp = (await L.preview(page)).info;
  await wheel(F("ops.mapResolution"), -3);
  const down = await val(F("ops.mapResolution"));
  const infoDown = (await L.preview(page)).info;
  L.record(tag("W-02"), "W", "Odaklı Cell (m): ↑1 sonra ↓3", "0.06 sonra 0.03, PGM önizleme çözünürlüğü izler", { up, down, infoUp, infoDown }, up === "0.06" && down === "0.03" && /→ 1\d\d × 1\d\d cells/.test(infoUp) && /→ 3\d\d × 3\d\d cells/.test(infoDown) ? "PASS" : "FAIL");

  // 3) clamped at min; comma text is the starting point
  await page.fill(F("ops.mapResolution"), "0,01");
  await wheel(F("ops.mapResolution"), -2);
  const atMin = await val(F("ops.mapResolution"));
  await page.fill(F("ops.mapResolution"), "0,05");
  await wheel(F("ops.mapResolution"), 1);
  const fromComma = await val(F("ops.mapResolution"));
  L.record(tag("W-03"), "W", "Alt sınır ve virgüllü başlangıç", "0.01'de kalır; '0,05' + ↑ = 0.06", { atMin, fromComma }, atMin === "0.01" && fromComma === "0.06" ? "PASS" : "FAIL");

  // 4) crop X max text field: its slider follows
  await wheel(F("crop.xmax"), -2);
  const cx = [await val(F("crop.xmax")), await val('input[type=range][data-bind="crop.xmax"]')];
  L.record(tag("W-04"), "W", "Crop X max ↓2", "Alan ve slider aynı, 10'dan küçük", cx, cx[0] === cx[1] && +cx[0] < 10 ? "PASS" : "FAIL");

  // 5) rotation: 5 quick notches = one baked rotation = one undo step
  await page.click("#tb-orbit");
  const undoBefore = await page.$eval("#tb-undo", (e) => e.disabled);
  // fresh file so the only history entry is the rotation
  await L.open(page, L.fx("room10_binary.pcd"));
  await wheel(F("rot.yaw"), 5);
  await L.sleep(800); await L.idle(page);
  const yaw = await val(F("rot.yaw"));
  const ms = (await L.msgs(page)).filter((m) => m.startsWith("status-msg"));
  await page.evaluate(() => document.activeElement?.blur());
  await L.click(page, "tb-undo"); await L.sleep(300); await L.idle(page);
  const afterUndo = { yaw: await val(F("rot.yaw")), slider: await val('input[type=range][data-bind="rot.yaw"]'), undoDisabled: await page.$eval("#tb-undo", (e) => e.disabled) };
  L.record(tag("W-05"), "W", "Yaw alanında 5 hızlı tık", "Yaw 5; tek undo adımı (bir undo sonrası geçmiş boş)", { yaw, msgs: ms.slice(-3), afterUndo, undoBefore }, yaw === "5" && afterUndo.undoDisabled && afterUndo.yaw === "0" && afterUndo.slider === "0" ? "PASS" : "FAIL");
  L.record(tag("W-console"), "W", "Konsol hataları", "Yok", log.console.filter((m) => !m.startsWith("warning")), log.console.filter((m) => !m.startsWith("warning")).length ? "FAIL" : "PASS");
} finally {
  L.saveResults(`wheel-${kind}`);
  await browser.close();
}
