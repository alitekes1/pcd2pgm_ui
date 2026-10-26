import * as L from "./lib.mjs";
const kind = process.argv[2] || "chromium";
const tag = (id) => (kind === "chromium" ? id : `${id}-${kind}`);
const info = (page) => page.evaluate(() => document.getElementById("file-info").textContent);
const statusMsgs = async (page) => (await L.msgs(page)).filter((m) => /^status-msg/.test(m) && !/…$/.test(m));
const bounds = (page) => page.evaluate(() => document.getElementById("status-stats").textContent);
const { browser, page } = await L.launch(kind);
try {
  await L.boot(page);
  for (const [job, btn, settle] of [["Find noise (SOR)", "sor-btn", true], ["Downsample", "voxel-btn", false]]) {
    await L.open(page, L.fx("large_3m.pcd"));
    // commit #1: lasso-free size change so indices of the two clouds differ
    await L.setBind(page, "ops.voxel", 0.01); await L.click(page, "voxel-btn"); await L.idle(page, 300000);
    const c1 = await info(page);
    await L.setBind(page, "ops.voxel", 0.02);
    await L.clearMsgs(page);
    await L.click(page, btn);
    await page.waitForFunction(() => document.body.classList.contains("busy"), null, { timeout: 5000 });
    await L.sleep(120);
    const busy = await L.isBusy(page);
    await page.keyboard.press("Control+z");
    const afterUndo = await info(page);
    await L.idle(page, 300000); await L.sleep(300);
    let bar = await page.$eval("#action-bar", (e) => (e.hidden ? "" : e.textContent));
    if (settle && bar) { await page.click("#action-bar button:has-text('Remove')"); await L.sleep(500); }
    const final = await info(page);
    const msgs = await statusMsgs(page);
    // After undo the cloud is the original 3,000,000 points. Anything applied afterwards was computed on the 618 k cloud.
    const appliedToWrongCloud = afterUndo.startsWith("3,000,000") && final !== "3,000,000 points";
    L.record(tag(`D-11[${job}]`), "D", `${job} worker'da çalışırken Ctrl+Z`, "Undo engellenir ya da biten iş sonucu atılır; geri alınmış buluta eski indekslerle silme uygulanmaz", { afterCommit1: c1, busyWhenUndo: busy, afterUndo, pendingBar: bar.slice(0, 80), final, stats: await bounds(page), msgs }, appliedToWrongCloud ? "FAIL" : busy ? "PASS" : "REVIEW");
  }
} finally {
  L.saveResults(`Drace2-${kind}`);
  await browser.close();
}
