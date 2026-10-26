import * as L from "./lib.mjs";
const kind = process.argv[2] || "chromium";
const tag = (id) => (kind === "chromium" ? id : `${id}-${kind}`);
const info = (page) => page.evaluate(() => ({ info: document.getElementById("file-info").textContent, stats: document.getElementById("status-stats").textContent, undo: document.getElementById("tb-undo").disabled, redo: document.getElementById("tb-redo").disabled }));
const statusMsgs = async (page) => (await L.msgs(page)).filter((m) => /^status-msg/.test(m) && !/…$/.test(m));
const { browser, page } = await L.launch(kind);
try {
  await L.boot(page);
  // Exact reproduction with numbers: 3 M cloud, downsample 0.05, then downsample 0.3 + undo while it runs
  for (const [label, how] of [["Ctrl+Z", () => page.keyboard.press("Control+z")], ["toolbar ↶", () => page.click("#tb-undo")]]) {
    await L.open(page, L.fx("large_3m.pcd"));
    await L.setBind(page, "ops.voxel", 0.05); await L.click(page, "voxel-btn"); await L.idle(page, 180000);
    const a = await info(page);
    await L.setBind(page, "ops.voxel", 0.3); await L.clearMsgs(page);
    await L.click(page, "voxel-btn"); await L.sleep(30);
    const busy = await L.isBusy(page);
    await how(); await L.sleep(50);
    const mid = await info(page);
    await L.idle(page, 180000); await L.sleep(300);
    const end = await info(page);
    // what a clean run gives: downsample 0.3 of the 3 M cloud
    const corrupt = /2,950,005|2,9\d\d,\d\d\d points/.test(end.info);
    L.record(tag(`D-11[${label}]`), "D", `Downsample çalışırken ${label}`, "Undo engellenir/ertelenir ya da worker sonucu atılır; bulut tutarlı kalır, redo korunur", { afterFirst: a.info, busyWhenUndo: busy, rightAfterUndo: mid.info, final: end.info, redoDisabledAtEnd: end.redo, msgs: await statusMsgs(page) }, corrupt ? "FAIL" : "PASS");
  }
  // Sibling: floor alignment computed on one geometry, applied to another
  await L.open(page, L.fx("tilted_room.pcd"));
  await L.setBind(page, "tf.z", 1); await L.click(page, "tf-btn"); await L.idle(page);
  await L.clearMsgs(page);
  await L.click(page, "align-btn"); await L.sleep(5);
  const busyA = await L.isBusy(page);
  await page.keyboard.press("Control+z");
  await L.idle(page); await L.sleep(200);
  const zA = await page.evaluate(() => [+document.querySelectorAll('[data-bind="band.min"]')[0].value, +document.querySelectorAll('[data-bind="band.max"]')[1].value]);
  L.record(tag("D-11[align+undo]"), "D", "Zemin hizalama sürerken Ctrl+Z", "Hizalama ya iptal edilir ya da doğru geometri üzerinde yapılır", { busyWhenUndo: busyA, msgs: await statusMsgs(page), zAfter: zA }, "REVIEW");
  // Sibling: noise preview computed, then undo, then Remove
  await L.open(page, L.fx("room_with_outliers.pcd"));
  await L.setBind(page, "ops.voxel", 0.2); await L.click(page, "voxel-btn"); await L.idle(page);
  const n1 = await info(page);
  await L.click(page, "sor-btn"); await L.idle(page);
  const bar = await page.$eval("#action-bar", (e) => e.textContent);
  await page.keyboard.press("Control+z"); await L.sleep(150);
  const barAfterUndo = await page.$eval("#action-bar", (e) => (e.hidden ? "(hidden)" : e.textContent));
  L.record(tag("D-12"), "D", "Gürültü önizlemesi açıkken Ctrl+Z", "Bekleyen önizleme iptal edilir (eski indeksler yeni buluta uygulanamaz)", { before: n1.info, bar, barAfterUndo, after: (await info(page)).info }, /hidden/.test(barAfterUndo) ? "PASS" : "FAIL");
} finally {
  L.saveResults(`Drace-${kind}`);
  await browser.close();
}
