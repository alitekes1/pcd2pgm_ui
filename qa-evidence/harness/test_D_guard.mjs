// QA2-01 regression: geometry changes while a worker job runs.
import * as L from "./lib.mjs";
const kind = process.argv[2] || "chromium";
const tag = (id) => (kind === "chromium" ? id : `${id}-${kind}`);
const info = (page) => page.evaluate(() => document.getElementById("file-info").textContent);
const statusMsgs = async (page) => (await L.msgs(page)).filter((m) => /^status-msg/.test(m));
const { browser, page } = await L.launch(kind);
try {
  await L.boot(page);
  // 1) Ctrl+Z / toolbar ↶ pressed the moment a downsample starts
  for (const [label, act] of [["Ctrl+Z", () => page.keyboard.press("Control+z")], ["toolbar ↶", () => page.evaluate(() => document.getElementById("tb-undo").click())]]) {
    await L.open(page, L.fx("large_3m.pcd"));
    await L.setBind(page, "ops.voxel", 0.01); await L.click(page, "voxel-btn"); await L.idle(page, 300000);
    const c1 = await info(page);
    await L.setBind(page, "ops.voxel", 0.02); await L.clearMsgs(page);
    await page.evaluate(() => document.getElementById("voxel-btn").click());
    await page.waitForFunction(() => document.body.classList.contains("busy"), null, { timeout: 5000, polling: 1 });
    await act();
    const afterUndo = await info(page);
    await L.idle(page, 300000); await L.sleep(200);
    const final = await info(page);
    const msgs = await statusMsgs(page);
    const ok = /Please wait/.test(msgs.join()) && afterUndo === c1 && final === "228,800 points";
    L.record(tag(`D-11g[${label}]`), "D", `Downsample başlarken ${label}`, "Undo reddedilir ('Please wait'), downsample 618,440 → 228,800 doğru buluta uygulanır", { afterCommit1: c1, rightAfterUndo: afterUndo, final, msgs }, ok ? "PASS" : "FAIL");
  }
  // 2) geometry changed by a path that is not blocked (rotation slider release) while the job runs
  await L.open(page, L.fx("large_3m.pcd"));
  await L.clearMsgs(page);
  await page.evaluate(() => document.getElementById("sor-btn").click());
  await page.waitForFunction(() => document.body.classList.contains("busy"), null, { timeout: 5000, polling: 1 });
  await L.sleep(1000); // SOR on 3 M points runs for seconds in the worker
  const busyAtRotation = await L.isBusy(page);
  await page.evaluate(() => { const el = document.querySelector('input[type=range][data-bind="rot.yaw"]'); el.value = "10"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await L.idle(page, 300000); await L.sleep(200);
  const msgs = await statusMsgs(page);
  const final = await info(page);
  L.record(tag("D-11g[rotation]"), "D", "Find noise sürerken rotation slider bırakılırsa", "Sonuç atılır, kullanıcı bilgilendirilir, kırmızı önizleme çıkmaz; bulut 3,000,000 nokta kalır", { final, busyAtRotation, bar: await page.$eval("#action-bar", (e) => (e.hidden ? "" : e.textContent)), msgs }, final === "3,000,000 points" && /changed while it ran/.test(msgs.join()) ? "PASS" : "FAIL");
  // 3) normal path still works and undo works afterwards
  await L.setBind(page, "ops.voxel", 0.05); await L.click(page, "voxel-btn"); await L.idle(page, 300000);
  const ds = await info(page);
  await page.keyboard.press("Control+z"); await L.sleep(200);
  const un = await info(page);
  await L.clearMsgs(page);
  await page.keyboard.press("Control+z"); await page.keyboard.press("Control+z"); await L.sleep(200);
  const nothing = (await statusMsgs(page)).pop();
  L.record(tag("D-11g[normal]"), "D", "Normal downsample + undo + boş undo mesajı", "Downsample uygulanır, undo geri alır, fazladan undo 'Nothing to undo'", { downsampled: ds, afterUndo: un, nothing }, ds !== "3,000,000 points" && /Nothing to undo$/.test(nothing || "") ? "PASS" : "FAIL");
} catch (e) {
  L.record(tag("D-11g-abort"), "D", "Harness", "-", e.stack, "ERROR");
} finally {
  L.saveResults(`Dguard-${kind}`);
  await browser.close();
}
