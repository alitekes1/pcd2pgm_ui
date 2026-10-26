// Sections E (camera/interaction), G (state/robustness), H (UI/a11y), I (security).
import fs from "node:fs";
import path from "node:path";
import * as L from "./lib.mjs";
const { record, fx, OUT } = L;
const kind = process.argv[2] || "chromium";
const only = process.argv[3];
const tag = (id) => (kind === "chromium" ? id : `${id}-${kind}`);
const shot = async (page) => (await page.locator("#scene canvas").first().screenshot()).toString("base64");
const active = (page) => page.evaluate(() => ({ tool: document.querySelector("#toolbar .active:not(#tb-top):not(#tb-map)")?.id || "none", top: document.getElementById("tb-top").classList.contains("active"), pgm: !document.getElementById("pgm-pane").hidden, help: document.getElementById("help-dialog").open, bar: document.getElementById("action-bar").hidden ? "" : document.getElementById("action-bar").textContent.slice(0, 60) }));
const winErr = (page) => page.evaluate(() => window.__errors.slice());
fs.mkdirSync(path.join(OUT, kind), { recursive: true });

let { browser, page, log, ctx } = await L.launch(kind);
try {
  await L.boot(page);
  if (!only || only === "E") {
    // ---------- E-01 orbit / pan / zoom extremes ----------
    await L.open(page, fx("room10_binary.pcd"));
    const b = await L.sceneBox(page);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const s0 = await shot(page);
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 200, cy + 50, { steps: 10 }); await page.mouse.up(); await L.sleep(800);
    const s1 = await shot(page);
    await page.keyboard.down("Shift"); await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 100, cy - 80, { steps: 10 }); await page.mouse.up(); await page.keyboard.up("Shift"); await L.sleep(800);
    const s2 = await shot(page);
    await page.mouse.move(cx, cy); await page.mouse.down({ button: "middle" }); await page.mouse.move(cx + 90, cy, { steps: 8 }); await page.mouse.up({ button: "middle" }); await L.sleep(800);
    const s3 = await shot(page);
    record(tag("E-01a"), "E", "Orbit / Shift+sürükle pan / orta tuş pan", "Her hareket görünümü değiştirir", { orbit: s0 !== s1, shiftPan: s1 !== s2, middlePan: s2 !== s3 }, s0 !== s1 && s1 !== s2 && s2 !== s3 ? "PASS" : "FAIL");
    for (let i = 0; i < 150; i++) await page.mouse.wheel(0, -400);
    await L.sleep(1200);
    await page.mouse.move(cx + 3, cy + 3); await L.sleep(100);
    const inPick = await L.picked(page), inErr = (await winErr(page)).length;
    for (let i = 0; i < 300; i++) await page.mouse.wheel(0, 400);
    await L.sleep(1200);
    const outShot = await shot(page);
    // extreme vertical orbit (try to flip over the pole)
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy + 2000, { steps: 30 }); await page.mouse.up(); await L.sleep(800);
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy - 4000, { steps: 40 }); await page.mouse.up(); await L.sleep(800);
    await page.dblclick("#tb-reset").catch(() => {}); await L.click(page, "tb-reset"); await L.sleep(1200);
    await page.mouse.move(cx, cy); await L.sleep(150);
    const afterReset = await L.picked(page);
    record(tag("E-01b"), "E", "Aşırı zoom in/out, kutup üstünden orbit, sonra Reset", "NaN/hata yok, çok uzakta bulut görünür kalır, Reset sonrası seçim çalışır", { zoomInPick: inPick, errorsAfterZoomIn: inErr, zoomOutBlank: outShot === s0 ? "same as start" : "rendered", afterResetPick: afterReset, errors: await winErr(page) }, (await winErr(page)).length === 0 && afterReset ? "PASS" : "FAIL");
    // ---------- E-02 all shortcuts ----------
    await page.mouse.click(b.x + 5, b.y + b.h - 5); await page.keyboard.press("Escape");
    const seq = [];
    for (const k of ["m", "m", "l", "Escape", "t", "t", "p", "p", "?"]) { await page.keyboard.press(k); await L.sleep(150); seq.push([k, await active(page)]); if (k === "?") { await page.keyboard.press("Escape"); await L.sleep(100); seq.push(["Escape(dialog)", await active(page)]); } }
    const exp = [["m", "tb-measure"], ["m", "none"], ["l", "tb-lasso"], ["Escape", "tb-orbit"]];
    const shortcutOk = seq[0][1].tool === "tb-measure" && seq[1][1].tool === "tb-orbit" && seq[2][1].tool === "tb-lasso" && seq[3][1].tool === "tb-orbit" && seq[4][1].top && !seq[5][1].top && seq[6][1].pgm && !seq[7][1].pgm && seq[8][1].help && !seq[9][1].help;
    record(tag("E-02a"), "E", "M/L/T/P/?/Esc kısayolları", "Araç ve görünümler beklenen şekilde açılıp kapanır", seq.map(([k, s]) => `${k}:${s.tool}${s.top ? "+top" : ""}${s.pgm ? "+pgm" : ""}${s.help ? "+help" : ""}`), shortcutOk ? "PASS" : "FAIL");
    void exp;
    await L.setBind(page, "tf.z", 0.1); await L.click(page, "tf-btn"); await L.click(page, "tf-btn");
    const us = [];
    for (const k of ["Control+z", "Control+Shift+z", "Control+y", "Meta+z", "Meta+Shift+z", "Control+Z"]) { await L.clearMsgs(page); await page.keyboard.press(k); await L.sleep(120); us.push(`${k} → ${((await L.msgs(page)).find((m) => /status-msg/.test(m)) || "-").replace("status-msg: ", "")}`); }
    record(tag("E-02b"), "E", "Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / Cmd+Z (Meta)", "Undo/redo her kombinasyonda çalışır", us, us.every((u) => /Undone|Redone/.test(u)) ? "PASS" : "FAIL");
    // ---------- E-03 dblclick focus / reset ----------
    await L.click(page, "tb-reset"); await L.sleep(1000);
    await page.keyboard.press("t"); await L.sleep(400);
    const T = await L.calibrateTop(page);
    const [px, py] = T.toScreen(4.5, 6.0);
    await page.mouse.move(px, py); await L.sleep(100);
    const target = await L.picked(page);
    await page.mouse.dblclick(px, py); await L.sleep(1200);
    await page.mouse.move(cx, cy); await L.sleep(150);
    const centre = await L.picked(page);
    const focusOk = target && centre && Math.hypot(target[0] - centre[0], target[1] - centre[1]) < 0.3;
    await page.mouse.dblclick(b.x + 4, b.y + 4); await L.sleep(1200);
    await page.mouse.move(cx, cy); await L.sleep(150);
    const reset = await L.picked(page);
    record(tag("E-03"), "E", "Noktaya çift tık = odak; boşluğa çift tık = reset", "Odak sonrası ekran merkezi seçilen noktadadır; reset sonrası merkez odanın ortasına döner", { target, centreAfterFocus: centre, centreAfterReset: reset }, focusOk && reset && Math.hypot(reset[0] - 5, reset[1] - 5) < 1.5 ? "PASS" : "FAIL");
    await page.keyboard.press("t");
    // ---------- E-04 measurement accuracy ----------
    await L.open(page, fx("measure_5m.pcd"));
    await page.keyboard.press("t"); await L.sleep(400);
    const TM = await L.calibrateTop(page);
    await page.keyboard.press("m");
    const clickAt = async (x, y) => { const [sx, sy] = TM.toScreen(x, y); await page.mouse.click(sx, sy); await L.sleep(150); };
    await clickAt(0, 0); await clickAt(5, 0);
    const bar2 = (await active(page)).bar;
    const d = +/([\d.]+) m/.exec(bar2)?.[1];
    await clickAt(5, 0.8);
    const bar3 = await page.$eval("#action-bar", (e) => e.textContent);
    const ang = +/angle ([\d.]+)°/.exec(bar3)?.[1];
    const labels = await page.$$eval(".measure-label", (ls) => ls.map((l) => l.textContent));
    await page.click("#action-bar button:has-text('Clear')"); await L.sleep(100);
    const cleared = await page.$$eval(".measure-label", (ls) => ls.length);
    await page.keyboard.press("Escape"); await L.sleep(100);
    record(tag("E-04"), "E", "Ölçüm: 5.000 m bilinen mesafe ve 3 noktada açı", "|d−5| < 2 cm, açı ≈ 90° (±3°), birim 'm', Clear etiketleri siler, Esc aracı kapatır", { distanceText: bar2, angleText: bar3.slice(0, 120), labels, clearedLabels: cleared, toolAfterEsc: (await active(page)).tool }, Math.abs(d - 5) < 0.02 && Math.abs(ang - 90) < 3 && cleared === 0 && (await active(page)).tool === "tb-orbit" ? "PASS" : "FAIL");
    await page.keyboard.press("t");
    // ---------- E-05 resize / split ----------
    const sizes = [];
    for (const [w, h] of [[800, 600], [1920, 1080], [1024, 700]]) {
      await page.setViewportSize({ width: w, height: h }); await L.sleep(400);
      sizes.push(await page.evaluate(() => { const c = document.querySelector("#scene canvas"), s = document.getElementById("scene"); return { win: [innerWidth, innerHeight], canvas: [c.clientWidth, c.clientHeight], scene: [s.clientWidth, s.clientHeight], overflowX: document.documentElement.scrollWidth > innerWidth }; }));
    }
    await page.keyboard.press("p"); await L.sleep(500);
    sizes.push(await page.evaluate(() => { const c = document.querySelector("#scene canvas"), s = document.getElementById("scene"), p = document.getElementById("pgm-canvas"); return { split: true, canvas: [c.clientWidth, c.clientHeight], scene: [s.clientWidth, s.clientHeight], pgm: [p.clientWidth, p.clientHeight] }; }));
    await page.keyboard.press("p");
    await page.setViewportSize({ width: 1440, height: 900 });
    record(tag("E-05"), "E", "Pencere yeniden boyutlandırma ve PCD|PGM bölünmesi", "Canvas her boyutta sahne alanını doldurur, yatay taşma yok", sizes, sizes.every((s) => s.canvas[0] === s.scene[0] && s.canvas[1] === s.scene[1] && !s.overflowX) ? "PASS" : "FAIL");
    // ---------- E-06 browser zoom 50 % / 200 % (emulated: CSS viewport + devicePixelRatio) ----------
    for (const [label, vp, dsf] of [["%200", { width: 720, height: 450 }, 2], ["%50", { width: 2880, height: 1800 }, 0.5]]) {
      if (kind === "firefox" && dsf < 1) continue;
      const z = await L.launch(kind, { viewport: vp, deviceScaleFactor: dsf });
      try {
        await L.boot(z.page); await L.open(z.page, fx("room10_binary.pcd"));
        const r = await z.page.evaluate(() => ({ overflowX: document.documentElement.scrollWidth > innerWidth, panelScrollable: document.getElementById("panel").scrollHeight > document.getElementById("panel").clientHeight, dpr: devicePixelRatio, canvasPx: [document.querySelector("#scene canvas").width, document.querySelector("#scene canvas").height] }));
        await z.page.screenshot({ path: path.join(OUT, kind, `E-06-zoom${label}.png`) });
        record(tag(`E-06[${label}]`), "E", `Tarayıcı zoom ${label}`, "Yatay taşma yok, panel kaydırılabilir, canvas DPR'a göre çizilir", r, !r.overflowX ? "PASS" : "FAIL");
      } finally { await z.browser.close(); }
    }
    // ---------- E-07 touch ----------
    if (kind === "chromium") {
      const t = await L.launch(kind, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
      try {
        await L.boot(t.page); await L.open(t.page, fx("room10_binary.pcd"));
        const cdp = await t.ctx.newCDPSession(t.page);
        const bx = await L.sceneBox(t.page);
        const mx = bx.x + bx.w / 2, my = bx.y + bx.h / 2;
        const touch = async (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
        const a0 = await shot(t.page);
        await touch("touchStart", [[mx, my]]); for (let i = 1; i <= 10; i++) await touch("touchMove", [[mx + i * 12, my]]); await touch("touchEnd", []); await L.sleep(900);
        const a1 = await shot(t.page);
        await touch("touchStart", [[mx - 20, my], [mx + 20, my]]); for (let i = 1; i <= 10; i++) await touch("touchMove", [[mx - 20 - i * 8, my], [mx + 20 + i * 8, my]]); await touch("touchEnd", []); await L.sleep(900);
        const a2 = await shot(t.page);
        await touch("touchStart", [[mx, my]]); await touch("touchEnd", []); await L.sleep(60); await touch("touchStart", [[mx, my]]); await touch("touchEnd", []); await L.sleep(600);
        await t.page.screenshot({ path: path.join(OUT, kind, "E-07-touch.png") });
        record(tag("E-07"), "E", "Dokunmatik: tek parmak döndürme, iki parmak pinch", "Her iki jest görünümü değiştirir, hata yok", { oneFingerRotate: a0 !== a1, pinchZoom: a1 !== a2, errors: await winErr(t.page) }, a0 !== a1 && a1 !== a2 && !(await winErr(t.page)).length ? "PASS" : "FAIL");
        // long-press = context menu on touch devices
        await touch("touchStart", [[mx, my]]); await L.sleep(900); await touch("touchEnd", []); await L.sleep(200);
        record(tag("E-07b"), "E", "Dokunmatikte uzun basma (sağ tık menüsü yerine)", "Menü veya alternatif bir yol", { menuOpen: !(await t.page.$eval("#context-menu", (e) => e.hidden)) }, "REVIEW");
      } finally { await t.browser.close(); }
    }
  }
  if (!only || only === "G") {
    // ---------- G-01 reload / back with a cloud open ----------
    await L.boot(page); await L.open(page, fx("room10_binary.pcd"));
    const dialogs = [];
    page.removeAllListeners("dialog");
    page.on("dialog", (dlg) => { dialogs.push(dlg.type()); dlg.dismiss(); });
    await page.reload({ timeout: 5000 }).catch((e) => dialogs.push("reload: " + e.message.split("\n")[0]));
    const stillOpen = await page.evaluate(() => !document.getElementById("panel").hidden).catch(() => "nav");
    record(tag("G-01a"), "G", "Bulut açıkken sayfa yenileme", "beforeunload uyarısı; iptal edilirse veri kalır", { dialogs, cloudStillOpenAfterDismiss: stillOpen }, dialogs.includes("beforeunload") && stillOpen === true ? "PASS" : "FAIL");
    page.removeAllListeners("dialog");
    page.on("dialog", (dlg) => dlg.accept());
    await page.goto("about:blank").catch(() => {});
    await page.goBack().catch(() => {});
    await L.sleep(1500);
    const back = await page.evaluate(() => ({ welcome: !document.getElementById("welcome").hidden, panel: !document.getElementById("panel").hidden })).catch((e) => e.message);
    record(tag("G-01b"), "G", "Geri tuşu sonrası dönüş", "Bulut kaybolur (beklenen) ve uygulama temiz açılır; hata yok", back, back.welcome ? "PASS" : "FAIL");
    // ---------- G-02 WebGL context loss / restore ----------
    await L.boot(page); await L.open(page, fx("room10_binary.pcd"));
    const before = await shot(page);
    const lost = await page.evaluate(() => { const c = document.querySelector("#scene canvas"); const gl = c.getContext("webgl2") || c.getContext("webgl"); const ext = gl.getExtension("WEBGL_lose_context"); window.__ext = ext; ext.loseContext(); return !!ext; });
    await L.sleep(500);
    await page.evaluate(() => window.__ext.restoreContext()); await L.sleep(800);
    const b2 = await L.sceneBox(page);
    await page.mouse.move(b2.x + b2.w / 2, b2.y + b2.h / 2); await page.mouse.wheel(0, -50); await L.sleep(800);
    const after = await shot(page);
    await page.mouse.move(b2.x + b2.w / 2 + 2, b2.y + b2.h / 2 + 2); await L.sleep(150);
    fs.writeFileSync(path.join(OUT, kind, "G-02-before.png"), Buffer.from(before, "base64"));
    fs.writeFileSync(path.join(OUT, kind, "G-02-after.png"), Buffer.from(after, "base64"));
    await L.click(page, "map-view-btn"); const pv = await L.preview(page);
    record(tag("G-02"), "G", "WebGL context lost → restored", "Bulut yeniden çizilir, PGM çalışır, hata yok (görsel: G-02-after.png)", { extension: lost, pickAfterRestore: await L.picked(page), pgm: pv.info, errors: await winErr(page), console: log.console.filter((c) => /context|WebGL/i.test(c)).slice(-4) }, "REVIEW");
    // ---------- G-03 background tab ----------
    const other = await ctx.newPage(); await other.goto("about:blank"); await other.bringToFront(); await L.sleep(1500);
    await page.bringToFront(); await L.sleep(500);
    record(tag("G-03"), "G", "Sekme arka plana gidip gelme", "Hata yok, etkileşim sürer", { errors: await winErr(page), pick: await (async () => { const bb = await L.sceneBox(page); await page.mouse.move(bb.x + bb.w * 0.3, bb.y + bb.h * 0.5); await L.sleep(150); return L.picked(page); })() }, (await winErr(page)).length ? "FAIL" : "PASS");
    await other.close();
    // ---------- G-04 memory over repeated loads ----------
    const files = ["medium_500k.pcd", "room10_binary.pcd", L.REAL, "room_binle_rgb.ply", "room_space.xyz"];
    const heaps = [];
    await L.boot(page);
    for (let i = 0; i < 10; i++) {
      const f = files[i % files.length];
      await L.open(page, f.startsWith("/") ? f : fx(f));
      if (i % 2) { await L.click(page, "map-view-btn"); await L.preview(page); await L.click(page, "map-view-btn"); }
      await L.click(page, "close-btn").catch(() => {}); await L.sleep(200);
      heaps.push(await L.heap(page));
    }
    const dom = await page.evaluate(() => document.getElementsByTagName("*").length);
    record(tag("G-04"), "G", "10 kez farklı dosya yükle/kapat (GC sonrası JS heap)", "Heap sınırlı kalır", { heapsMb: heaps, domNodes: dom }, heaps[0] === null ? "REVIEW" : heaps[9] - heaps[0] < 15 ? "PASS" : "FAIL");
    // ---------- G-05 worker unavailable ----------
    const w = await L.launch(kind);
    try {
      await w.page.route(/worker\.js/, (r) => r.abort());
      await L.boot(w.page); await L.open(w.page, fx("room10_binary.pcd"));
      await w.page.evaluate(() => document.getElementById("map-view-btn").click());
      await L.click(w.page, "sor-btn"); await L.sleep(8000);
      const st = await w.page.evaluate(() => ({ busy: document.body.classList.contains("busy"), status: document.getElementById("status-msg").textContent, pgmBusy: !document.getElementById("pgm-busy").hidden, panelDisabled: [...document.querySelectorAll("#panel button")].every((b) => b.disabled) }));
      await L.clearMsgs(w.page); await L.click(w.page, "voxel-btn"); await L.sleep(300);
      const second = (await L.msgs(w.page)).pop();
      record(tag("G-05"), "G", "Web Worker yüklenemezse", "Anlamlı hata, UI kilitlenmez", { after8s: st, secondClick: second, errors: await winErr(w.page) }, st.busy || st.pgmBusy ? "FAIL" : "PASS");
    } finally { await w.browser.close(); }
    // ---------- G-06 WebGL disabled ----------
    if (kind === "chromium") {
      const { chromium } = await import("playwright");
      const nb = await chromium.launch({ args: ["--disable-webgl", "--disable-3d-apis", "--disable-gpu"] });
      const np = await nb.newPage(); const errs = [];
      np.on("pageerror", (e) => errs.push(e.message)); np.on("console", (m) => m.type() === "error" && errs.push(m.text()));
      await np.goto(L.APP); await L.sleep(2500);
      await np.setInputFiles("#file-input", fx("small_ascii.pcd")).catch(() => {}); await L.sleep(1500);
      await np.screenshot({ path: path.join(OUT, kind, "G-06-nowebgl.png") });
      const v = await np.evaluate(() => ({ welcomeText: document.getElementById("welcome-status").textContent, panel: !document.getElementById("panel").hidden, bodyText: document.body.innerText.slice(0, 80) }));
      record(tag("G-06"), "G", "WebGL devre dışı", "Kullanıcıya görünür bir 'WebGL gerekli' mesajı", { visible: v, errors: errs.slice(0, 3) }, /webgl/i.test(v.welcomeText) ? "PASS" : "FAIL");
      await nb.close();
    }
    // ---------- G-07 offline after load + privacy ----------
    await L.boot(page);
    const reqStart = log.requests.length;
    await ctx.setOffline(true);
    await L.open(page, L.REAL);
    await L.click(page, "align-btn"); await L.idle(page);
    const off = await L.exportMap(page, path.join(OUT, kind, "offline"));
    await L.click(page, "cloud-btn"); await L.sleep(800);
    const newReqs = log.requests.slice(reqStart).filter((r) => !/^(blob|data):/.test(r.url));
    await ctx.setOffline(false);
    const allHosts = [...new Set(log.requests.map((r) => new URL(r.url).host).filter(Boolean))];
    const posts = log.requests.filter((r) => r.method !== "GET" || r.post > 0);
    record(tag("G-07"), "G", "Yükleme sonrası ağ kapalı: aç, hizala, indir; dosya içeriği hiçbir isteğe gitmez", "Tümü çalışır; dosya açıldıktan sonra yeni ağ isteği yok; hiç POST yok", { exportOffline: off.status, newRequestsAfterLoad: newReqs.map((r) => r.url), hostsContacted: allHosts, nonGetOrBody: posts.length }, /Saved/.test(off.status) && !newReqs.length && !posts.length ? "PASS" : "FAIL");
    const o2 = await L.launch(kind);
    try {
      await L.boot(o2.page); await o2.ctx.setOffline(true);
      await o2.page.reload({ waitUntil: "load" }).catch(() => {}); await L.sleep(1500);
      const r = await o2.page.evaluate(() => ({ appLoaded: !!document.getElementById("color-mode")?.options.length || !!window.__msgs, text: document.body.innerText.slice(0, 60) })).catch((e) => e.message);
      record(tag("G-07b"), "G", "Çevrimdışıyken sayfayı (yeniden) açma", "README: ilk açılış CDN gerektirir; kullanıcıya hata gösterilmesi beklenir", { r, failed: o2.log.failed.slice(0, 3) }, "REVIEW");
    } finally { await o2.browser.close(); }
  }
  if (!only || only === "H") {
    // ---------- H-01 mobile / narrow layouts ----------
    for (const [label, vp] of [["390x844", { width: 390, height: 844 }], ["360x640", { width: 360, height: 640 }], ["844x390 yatay", { width: 844, height: 390 }], ["320x568", { width: 320, height: 568 }]]) {
      const m = await L.launch(kind, { viewport: vp, isMobile: kind === "chromium", hasTouch: true });
      try {
        await L.boot(m.page);
        const w0 = await m.page.evaluate(() => ({ overflowX: document.documentElement.scrollWidth > innerWidth }));
        await m.page.screenshot({ path: path.join(OUT, kind, `H-01-welcome-${vp.width}x${vp.height}.png`) });
        await L.open(m.page, fx("room10_binary.pcd"));
        await m.page.keyboard.press("p"); await L.sleep(800);
        const r = await m.page.evaluate(() => {
          const out = []; const vw = innerWidth;
          for (const el of document.querySelectorAll("#toolbar button, #panel button, #panel input, #panel select, #statusbar span")) {
            const b = el.getBoundingClientRect(); if (!b.width || getComputedStyle(el).visibility === "hidden") continue;
            if (b.right > vw + 1 || b.left < -1) out.push(`${el.id || el.dataset.bind || el.textContent.trim().slice(0, 12)} ${Math.round(b.left)}..${Math.round(b.right)}`);
          }
          const tb = document.getElementById("toolbar").getBoundingClientRect(), sc = document.getElementById("scene").getBoundingClientRect();
          return { overflowX: document.documentElement.scrollWidth > vw, offscreen: out.slice(0, 8), toolbarFits: tb.right <= vw + 1 && tb.width <= sc.width + 1, scene: [Math.round(sc.width), Math.round(sc.height)], pgm: [document.getElementById("pgm-canvas").clientWidth, document.getElementById("pgm-canvas").clientHeight], panelScroll: document.getElementById("panel").scrollHeight > document.getElementById("panel").clientHeight };
        });
        await m.page.screenshot({ path: path.join(OUT, kind, `H-01-${vp.width}x${vp.height}.png`) });
        record(tag(`H-01[${label}]`), "H", `Dar ekran ${label}`, "Yatay taşma yok, toolbar/panel elemanları ekranda, sahne ve PGM kullanılabilir boyutta", { welcome: w0, ...r }, !w0.overflowX && !r.overflowX && !r.offscreen.length && r.toolbarFits && r.scene[1] > 120 ? "PASS" : "FAIL");
      } finally { await m.browser.close(); }
    }
    // ---------- H-02 light mode / contrast ----------
    const lm = await L.launch(kind, { colorScheme: "light" });
    try {
      await L.boot(lm.page); await L.open(lm.page, fx("room10_binary.pcd"));
      await lm.page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
      const c = await lm.page.evaluate(() => {
        const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number);
        const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c; } return [11, 13, 16]; };
        const bad = [], seen = new Set(); let checked = 0;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const t = walker.currentNode; const el = t.parentElement; if (!t.textContent.trim() || !el || seen.has(el)) continue; seen.add(el);
          const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); if (!r.width || cs.visibility === "hidden" || el.closest("[hidden]")) continue;
          const fg = parse(cs.color); const a = fg[3] ?? 1; const bg = bgOf(el); const mix = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a) * (+cs.opacity || 1));
          const L1 = lum(mix), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
          checked++; if (ratio < (large ? 3 : 4.5)) bad.push(`${ratio.toFixed(2)} "${t.textContent.trim().slice(0, 28)}" ${cs.fontSize}`);
        }
        return { scheme: matchMedia("(prefers-color-scheme: light)").matches, bodyBg: getComputedStyle(document.body).backgroundColor, checked, below: bad.length, worst: bad.sort().slice(0, 12) };
      });
      record(tag("H-02"), "H", "Light mode tercihi ve metin kontrastı (WCAG AA)", "Light mode yoksa sorun değil; tüm metinler ≥4.5:1 (büyük ≥3:1)", c, c.below === 0 ? "PASS" : "FAIL");
    } finally { await lm.browser.close(); }
    // ---------- H-03 keyboard navigation / focus visibility / names ----------
    await L.boot(page);
    const order0 = [];
    for (let i = 0; i < 8; i++) { await page.keyboard.press("Tab"); order0.push(await page.evaluate(() => { const a = document.activeElement; return a === document.body ? "body" : `${a.tagName.toLowerCase()}#${a.id || a.className || a.textContent.trim().slice(0, 10)}`; })); }
    await page.keyboard.press("Enter"); // on the drop zone label? opening the file chooser cannot be observed headless
    await L.open(page, fx("room10_binary.pcd"));
    await page.evaluate(() => document.body.focus());
    const seq = [];
    for (let i = 0; i < 90; i++) {
      await page.keyboard.press("Tab");
      seq.push(await page.evaluate(() => {
        const a = document.activeElement; if (!a || a === document.body) return { id: "body" };
        const cs = getComputedStyle(a); const r = a.getBoundingClientRect();
        const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
        return { id: a.id || a.dataset.bind || a.textContent.trim().slice(0, 14) || a.tagName, ring, visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight, inViewport: r.top >= 0 && r.bottom <= innerHeight };
      }));
    }
    const noRing = [...new Set(seq.filter((s) => s.id !== "body" && !s.ring).map((s) => s.id))];
    const invisible = [...new Set(seq.filter((s) => s.id !== "body" && !s.visible).map((s) => s.id))];
    record(tag("H-03a"), "H", "Tab sırası ve odak göstergesi", "Mantıklı sıra; her odaklanan öğede görünür odak halkası; gizli öğeye odak yok", { welcomeTabOrder: order0, firstAfterLoad: seq.slice(0, 14).map((s) => s.id), uniqueFocused: new Set(seq.map((s) => s.id)).size, noFocusRing: noRing.slice(0, 12), focusedButInvisible: invisible.slice(0, 8) }, !noRing.length && !invisible.length ? "PASS" : "FAIL");
    if (kind === "chromium") {
      const cdp = await ctx.newCDPSession(page);
      await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
      const { nodes } = await cdp.send("Accessibility.getFullAXTree");
      const interactive = new Set(["button", "textbox", "spinbutton", "slider", "combobox", "checkbox", "menuitem", "link", "ListBox".toLowerCase()]);
      const unnamed = nodes.filter((n) => !n.ignored && interactive.has(n.role?.value) && !n.name?.value?.trim()).map((n) => `${n.role.value}`);
      const named = nodes.filter((n) => !n.ignored && interactive.has(n.role?.value)).length;
      record(tag("H-03b"), "H", "Etkileşimli öğelerin erişilebilir adı (Chromium AX ağacı)", "Hepsinin adı var", { interactive: named, unnamed }, unnamed.length ? "FAIL" : "PASS");
      const dlgFocus = await (async () => { await page.keyboard.press("?"); await L.sleep(200); const f = await page.evaluate(() => document.activeElement?.closest("dialog") ? "inside dialog" : document.activeElement?.tagName); await page.keyboard.press("Escape"); return f; })();
      record(tag("H-03c"), "H", "Yardım diyaloğu odak yönetimi", "Odak diyaloğa taşınır, Esc kapatır", dlgFocus, dlgFocus === "inside dialog" ? "PASS" : "FAIL");
    }
    // ---------- H-04 typos / texts ----------
    const allText = await page.evaluate(() => document.body.innerText + "\n" + [...document.querySelectorAll("[title]")].map((e) => e.title).join("\n"));
    const words = [...new Set(allText.toLowerCase().match(/[a-z]{3,}/g))];
    fs.writeFileSync(path.join(OUT, kind, "H-04-words.txt"), words.sort().join("\n"));
    record(tag("H-04"), "H", "Arayüz metinleri (yazım)", "Bilinen yazım hatası yok", { uniqueWords: words.length, knownIssues: ["Nothing to undone/redone (D-08b)"] }, "REVIEW");
    // ---------- H-05 no cloud loaded ----------
    await L.boot(page);
    for (const k of ["m", "l", "t", "p", "Delete", "Enter", "Control+z", "Control+Shift+z", "Escape", "?"]) { await page.keyboard.press(k); await L.sleep(60); }
    await page.keyboard.press("Escape");
    const nc = await page.evaluate(() => ({ welcome: !document.getElementById("welcome").hidden, panel: !document.getElementById("panel").hidden, toolbar: !document.getElementById("toolbar").hidden, help: document.getElementById("help-dialog").open, focusableHiddenButtons: [...document.querySelectorAll("#panel button, #toolbar button")].filter((b) => b.offsetParent !== null).length }));
    const b0 = await page.evaluate(() => { const r = document.querySelector("#scene canvas").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(b0.x, b0.y, { button: "right" }); await page.mouse.dblclick(b0.x, b0.y); await page.mouse.wheel(0, -500);
    record(tag("H-05"), "H", "Bulut yokken kısayollar, tıklama, tekerlek", "Hiçbir şey olmaz, hata yok, gizli araçlara erişilemez", { ...nc, contextMenu: !(await page.$eval("#context-menu", (e) => e.hidden)), errors: await winErr(page) }, !nc.panel && !nc.toolbar && !nc.focusableHiddenButtons && !(await winErr(page)).length ? "PASS" : "FAIL");
    // ---------- H-06 loading indicator on a 3 M cloud ----------
    await L.clearMsgs(page);
    await L.open(page, fx("large_3m.pcd"));
    const ms = await L.msgs(page);
    record(tag("H-06"), "H", "Büyük dosyada yükleme göstergesi", "'Opening …' mesajı ve busy durumu gösterilir", ms.filter((m) => /status|welcome/.test(m)).slice(0, 4), ms.some((m) => /Opening large_3m\.pcd…/.test(m)) ? "PASS" : "FAIL");
  }
  if (!only || only === "I") {
    // ---------- I-01..03 hostile content ----------
    await L.boot(page);
    for (const f of ["xss_header.pcd", "xss_field.pcd", "xss_comment.ply", "proto_fields.pcd"]) {
      const ms = await L.open(page, fx(f));
      const r = await page.evaluate(() => ({ xss: window.__xss ?? null, injected: document.querySelectorAll("img[src=x], #panel script, #scene script").length, protoPolluted: Object.keys(Object.prototype).length > 0 || ({}).x !== undefined, select: [...document.querySelectorAll("#color-mode option")].map((o) => o.textContent) }));
      await L.click(page, "map-view-btn"); const pv = await L.preview(page); await L.click(page, "map-view-btn");
      const e = await L.exportMap(page, path.join(OUT, kind, "xss"));
      record(tag(`I-01[${f}]`), "I", `Kötü niyetli içerik: ${f}`, "Script/handler çalışmaz, DOM'a HTML enjekte edilmez, prototype kirlenmez, çıktı normal", { msg: ms.filter((m) => /status-msg/.test(m)).pop(), ...r, map: pv.info?.slice(0, 50), export: e.status }, !r.xss && !r.injected && !r.protoPolluted ? "PASS" : "FAIL");
    }
    // ---------- I-04 external resources / SRI / CSP ----------
    const res = await page.evaluate(() => ({ scripts: [...document.scripts].map((s) => ({ src: s.src || "(inline)", type: s.type, integrity: s.integrity || "" })), importmap: [...document.querySelectorAll('script[type="importmap"]')].map((s) => s.textContent), csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || null, links: [...document.querySelectorAll("link[rel=stylesheet]")].map((l) => l.href) }));
    const hosts = [...new Set(log.requests.map((r) => new URL(r.url).host).filter(Boolean))];
    record(tag("I-04"), "I", "Harici kaynaklar, SRI, CSP", "Yalnızca beklenen CDN; mümkünse SRI ve CSP", { hosts, cdnRequests: [...new Set(log.requests.filter((r) => /jsdelivr/.test(r.url)).map((r) => r.url))].length, scriptsWithIntegrity: res.scripts.filter((s) => s.integrity).length, cspMeta: res.csp, importmap: res.importmap[0]?.slice(0, 200) }, "REVIEW");
  }
  record(tag(`EGHI-console${only ? "-" + only : ""}`), "EGHI", "Yakalanmamış hata", "pageerror/unhandledrejection yok", { winErrors: await winErr(page).catch(() => []), pageErrors: log.console.filter((c) => /pageerror/.test(c)) }, log.console.some((c) => /pageerror/.test(c)) ? "FAIL" : "PASS");
} catch (e) {
  record(tag("EGHI-abort"), "EGHI", "Harness", "-", e.stack, "ERROR");
  await page.screenshot({ path: path.join(OUT, kind, `EGHI-abort-${only || "all"}.png`) }).catch(() => {});
} finally {
  L.saveResults(`EGHI-${kind}${only ? "-" + only : ""}`);
  await browser.close();
}
