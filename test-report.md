# pcd2pgm_ui — Kapsamlı QA Raporu (test.md yönergesi)

**Tarih:** 2026-10-26  **Test edilen sürüm:** `fix/qa-report-defects` @ `b5012a9` (yerel, `python3 -m http.server`); karşılaştırma için canlı site `https://alitekes1.github.io/pcd2pgm_ui/` (= `main` @ `3e14520`)
**Tarayıcılar:** Playwright 1.64.1 → Chromium 156, Firefox 157, WebKit 27.2 (Safari motoru, Linux) · Linux x86-64, 16 çekirdek, 15 GB RAM
**Ek araçlar:** ROS 2 Humble `nav2_map_server`, referans `LihanChen2004/pcd2pgm` (@`750dc83`, yerelde derlendi) + `map_saver_cli`, Python numpy/PIL/PyYAML
**Veri:** `go2_mid360_new_office_route1.pcd` (399.429 nokta) + 71 sentetik fixture (`qa-evidence/make_fixtures.py`)
**Kanıt:** `qa-evidence/` — `merged.json` (415 kontrolün adım/beklenen/gerçek/sonuç kaydı), `nav2_reference_compare.json`, `LIVE.json`, `screens/`, `maps/`

## Düzeltme durumu (güncelleme)

| Kusur | Durum | Doğrulama |
|---|---|---|
| QA2-01 worker işi sürerken undo | **Düzeltildi** | Ctrl+Z / ↶ iş sürerken "Please wait…" ile reddediliyor; bloke edilmeyen yollar (ör. rotation slider) işi "the cloud changed while it ran" ile iptal ediyor. Önceki yeniden üretim (`D-11[Find noise]`) ve yeni `D-11g[*]` testleri Chromium/Firefox/WebKit'te PASS. |
| QA2-02 sayı alanları / virgül | **Düzeltildi** | Sayı alanları metin alanı; `,` ve `.` kabul ediliyor, aralık dışı ara değerler yazarken uygulanmıyor, alan bırakılınca kenetleniyor. `F-04-comma[*]` en-US/tr-TR ×3 tarayıcı PASS; crop/transform/rotation/canlı önizleme alan testleri (`FLD-*`) ×3 PASS; bölüm F regresyonu ×3 tarayıcı yeni FAIL yok; birim testi `parseNumberField`. |
| QA2-09 "Nothing to undone" | **Düzeltildi** (aynı satır) | Artık "Nothing to undo / redo". |
| QA2-03 ok tuşları kamerayı kaydırıyor | **Düzeltildi** | Odak input/select/textarea/dialog içindeyken keydown `document`'te durduruluyor, OrbitControls almıyor. `C-05[*]` (crop & rotation slider, sayı alanı, select) ×3 tarayıcı PASS: `defaultPrevented` yok, slider değeri değişiyor; odak yokken ok tuşu hâlâ kamerayı kaydırıyor (`C-05-pan` ×3 PASS). |
| QA2-04 zeminsiz bulutta hizalama | **Düzeltildi** (onaylı) | Kabul ölçütü pay değil yoğunluk karşıtlığı: düzlem bandındaki nokta sayısı, hemen üstündeki/altındaki eşit kalınlıktaki banttakinin 2 katından azsa `confirm()` soruluyor; iptal → "Floor alignment cancelled…". Ölçülen karşıtlık: gerçek PCD 3.08, eğik/düz/iki katlı oda 3.0–4.0, rampa ≫; yalnız-duvar 1.00, rastgele hacim 1.05. Pay (%13–%39) gerçek zemini (gerçek PCD %18) ayıramadığı için kullanılmadı. ×3 tarayıcı: zeminli 5 bulutta soru yok, zeminsiz 2 bulutta soru + iptal çalışıyor. Birim testi: yalnız-duvar bulutunda `inliers < 2·beside`. Küçük eğim (<0.2°) eşiği **uygulanmadı**: 0.07–0.14° RANSAC tahmini, drift değil (5 basışta sabit); kesmek 50 m'de ~12 cm hata bırakır. |
| QA2-05 worker yüklenemezse kilitlenme | **Düzeltildi** | `worker.onerror` kalıcı bayrak koyuyor, sonraki `runJob` hemen reddediliyor ("Background worker failed… Reload the page"). `G-05` ×3 PASS: panel açık, PGM paneli hata gösteriyor, ikinci işlem de aynı hatayla bitiyor. İş başına zaman aşımı eklenmedi (büyük bulutta meşru uzun işler). |
| QA2-06 WebGL yok | **Düzeltildi** | Renderer `try/catch`; karşılama ekranında kırmızı "This tool needs WebGL…" mesajı. `G-06` Chromium `--disable-webgl` PASS. |
| QA2-07 WebKit indirme adı | **Düzeltildi** | `baseName()` artık ASCII harf/rakam ve `_ . -` dışındaki her şeyi `_` yapıyor (arayüzdeki ad değişmiyor). `A-05[*]` (Türkçe, boşluk, `#`/`:`, XSS adı, çok noktalı) ×3 tarayıcı PASS, WebKit dahil. |
| Diğerleri (QA2-08, 10–15) | Açık | — |

Regresyon (Chromium): `test_BCD`, `test_D_guard`, `test_fields`, `test_F` çalıştırıldı; kalan FAIL'ler (B-01 0.12° regex'i, C-05 sayı alanı spinner'ı — QA2-02'nin bilinen yan etkisi, C-07 = QA2-08, D-01/F-01c/F-09b harness ilk-sürüm kontrolleri) `b5012a9` ve `466cdcc` üzerinde birebir aynı çıktıyla tekrarlanıyor, yeni kod kaynaklı değil.

Not: sayı alanlarının metin alanına çevrilmesiyle tarayıcının sayı spinner'ı ve fare tekerleğiyle değer değiştirme kalktı; sliderlar ve klavyeyle yazma aynı.

## 1. Özet

| | Toplam | PASS | FAIL | Doğrulanamadı/N.A. |
|---|---:|---:|---:|---:|
| Tarayıcı kontrolleri (3 tarayıcı) | 415 | 365 | 49 | 1 |
| Nav2 `map_server` hücre-hücre eşitlik | 3 | 3 | 0 | – |
| Referans pcd2pgm karşılaştırması | 2 | 2* | 0 | – |
| Birim testleri (`node --test tests/algorithms.test.mjs`) | 9 | 9 | 0 | – |
| Canlı site regresyon kontrolü | 4 | 1 | 3 | – |

Bölüm dağılımı (tarayıcı kontrolleri): A 171 (158/13) · B 12 (10/2) · C 18 (7/11) · D 29 (23/6) · E 25 (25/0) · F 135 (122/13) · G 9 (6/2/1) · H 11 (10/1) · I 5 (4/1). 49 FAIL, **15 benzersiz kusura** indirgenir: 1 Kritik, 1 Yüksek, 5 Orta, 8 Düşük.

\* Gerçek PCD'de byte-eşit; sentetik odada fark yalnızca belgelenmiş sınır kuralından (bkz. F-REF).

**Değerlendirme:** Çıktı çekirdeği sağlam: P5/YAML yapısı, origin (sol-alt), Y yönü, önizleme = indirme, yarış durumları ve büyük harita sınırları üç tarayıcıda doğru; Nav2 üç haritayı hücre hücre aynı yüklüyor ve gerçek PCD'de referans pcd2pgm + `map_saver_cli` çıktısıyla byte-eşit. En ciddi risk çıktı değil, **durum tutarlılığı**: bir worker işi sürerken Ctrl+Z/↶ serbest olduğu için biten işin silme listesi geri alınmış buluta uygulanıyor ve kullanıcının bulutundan rastgele noktalar siliniyor. İkinci risk, sayı alanlarının her tuş vuruşunda kenetlenip uygulanması: "0,05" yazmak sessizce 1 m (Chromium/WebKit) veya 0,01 m (Firefox) çözünürlük üretiyor. Klavye erişilebilirliği (ok tuşları kamerayı kaydırıyor, slider'lar klavyeyle kullanılamıyor) ve zeminsiz bulutta "başarılı" hizalama diğer önemli bulgular. **Canlı site önceki turun üç kusurunu hâlâ taşıyor**; branch yayına alınmalı.

## 2. Hata listesi (öncelik sırasıyla)

### QA2-01 — Worker işi sürerken undo/redo, işin sonucunu yanlış buluta uygulatıyor (veri kaybı)
- **Şiddet:** Kritik · **Ortam:** Chromium, Firefox, WebKit · `large_3m.pcd` (sentetik 3 M nokta)
- **Adımlar:** 1) Dosyayı aç. 2) Voxel 0.01 → Downsample (618.440 nokta kalır, undo'da 1 adım). 3) Find noise'a bas; "Looking for noise…" sürerken Ctrl+Z (veya toolbar ↶). 4) Çıkan kırmızı önizlemede "Remove them".
- **Beklenen:** Undo iş bitene kadar engellenir ya da iş sonucu atılır.
- **Gerçekleşen:** Undo hemen çalışır (bulut 3.000.000'a döner); ardından 618 k'lık buluttan hesaplanmış 25.662 indeks 3 M buluta uygulanır: `Noise removed: 25,662 points removed, 2,974,338 left` — üç tarayıcıda birebir aynı. Downsample'da da aynı yol (Chromium: `Downsampled to 0.02 m: 389,640 points removed, 2,610,360 left` geri alınmış 3 M buluta). Silinen noktalar rastgele; kullanıcı fark etmez, haritadan ve dışa aktarılan buluttan sessizce eksilir.
- **Kanıt:** `merged.json` → `D-11[Find noise (SOR)]` ×3, `D-11[Downsample]`; `screens/D-11-corrupt.png`.
- **Kök neden:** `busy()` (`js/app.js` ≈343) yalnızca `#panel button`'ları kapatıyor; klavye undo/redo (≈1723), toolbar (`TOOLBAR`, ≈1483) ve rotation slider'ları açık kalıyor. `workerKeep()` (≈694) ve `findNoise`/`downsample` `vis` indekslerini `await` öncesinde alıp sonucu `await` sonrasındaki geometriye uyguluyor. Kardeş yol: `alignFloor`/`detectGround` (≈590–627) aynı deseni taşıyor.
- **Düzeltme:** `step()` ve klavye/toolbar eylemlerinde `if (state.busy) return status("Please wait…")`; ayrıca `workerKeep` başında `state.geomVersion`'ı kaydedip `await` sonrası değiştiyse sonucu at (savunma ikinci katman). Bekleyen önizleme Ctrl+Z ile zaten iptal ediliyor (D-12 PASS) — aynı kural iş sürerken de uygulanmalı.

### QA2-02 — Sayı alanları her tuş vuruşunda kenetlenip uygulanıyor; "0,05" sessizce yanlış çözünürlük üretiyor
- **Şiddet:** Yüksek (yanlış harita) · **Ortam:** 3 tarayıcı, en-US ve tr-TR · `room10_binary.pcd`
- **Adımlar:** Cell (m) alanına klavyeyle `0,05` yaz, Tab, Download map.
- **Beklenen:** 0.05 olarak kabul ya da açık hata ve önceki değerin korunması.
- **Gerçekleşen:** Chromium & WebKit (en-US): alan sırayla `0 → 0 → 00 → 005`, değer 5 → 1'e kenetlenir → **11×11 @ 1 m** harita iner. Firefox: ilk `0` 0,01'e kenetlenir → **1001×1001 @ 0.01 m**. WebKit tr-TR virgülü kabul ediyor (PASS). `0,1` için de aynı. Hata mesajı yok; yalnızca status satırında çözünürlük görünüyor.
- **Kanıt:** `F-04-res[0,05]` ×3, `F-04-comma[*]` (toplam 13 FAIL).
- **Kök neden:** `[data-bind]` `input` dinleyicisi (≈1638) yarım yazılmış değeri `parseFloat` edip `ops` alanlarında min/max ile kenetleyerek her vuruşta modele yazıyor; virgül hiçbir yerde normalize edilmiyor.
- **Düzeltme:** Sayı alanlarında kenetleme + uygulamayı `change`'e (blur/Enter) taşı; `input`'ta yalnızca geçerli ve aralık içindeki değeri canlı uygula. `value.replace(",", ".")` ile virgülü kabul et veya alanı `:invalid` işaretle. Kardeş: radius/neighbours/voxel/SOR alanları aynı yol (ara değer `0` filtreyi geçici kapatıyor).

### QA2-03 — Odaklı input/slider/select'te ok tuşları alanı değiştirmiyor, 3D kamerayı kaydırıyor
- **Şiddet:** Orta (klavye erişilebilirliği, WCAG 2.1.1) · **Ortam:** 3 tarayıcı
- **Adımlar:** Crop X max slider'ına (veya Radius alanına, Colormap seçimine) Tab ile odaklan, ←/↑ bas.
- **Beklenen:** Alan değeri değişir, görünüm sabit kalır.
- **Gerçekleşen:** Değer değişmez (`10 → 10`), 3D görünüm pan edilir; number, range, rotation slider ve select'te aynı (`defaultPrevented: true`).
- **Kanıt:** `C-05[*]`, `C-05c` ×3.
- **Kök neden:** `controls.listenToKeyEvents(window)` (≈170) OrbitControls'un ok tuşlarını tüm pencerede yakalayıp `preventDefault` etmesine yol açıyor.
- **Düzeltme:** `listenToKeyEvents(renderer.domElement)` + canvas'a `tabIndex = 0`, ya da window dinleyicisinde `input, select, textarea` hedeflerini atla (uygulamanın kendi kısayolları bunu zaten yapıyor).

### QA2-04 — Zeminsiz bulutta "Floor aligned" ve her basışta yeniden döndürme
- **Şiddet:** Orta · **Ortam:** Chromium · `walls_only.pcd`, `no_floor_noise.pcd`
- **Adımlar:** Dosyayı aç, Align to floor'a iki kez bas.
- **Beklenen:** Güvenilir zemin yoksa uyarı/ret; tekrar basış ≈0° (idempotent).
- **Gerçekleşen:** Yalnız-duvar bulutunda en alttaki %13'ün "zemin" olduğu varsayılıp 0.84° döndürülüyor, ikinci basışta yine 0.83°; rastgele hacimde %1 inlier ile 6.08°, sonra 6.71°. Mesaj her seferinde "Floor is now z = 0" diyor. Eğik gerçek zeminde sonuç doğru (14.30° ölçülen / 14.37° gerçek, kalan 0.12°, 5 basışta drift yok); zaten düz odada gereksiz 0.07° (≤1.2 cm/10 m) dönüş yapılıyor.
- **Kanıt:** `B-01[*]`, `B-04[*]`.
- **Kök neden:** `detectGround()` (≈590) RANSAC sonucunu inlier oranına bakmadan kabul ediyor; `alignFloor` küçük eğimleri de uyguluyor.
- **Düzeltme:** İnlier oranı eşiği (ör. <%30 → "güvenilir zemin bulunamadı" uyarısı, uygulamadan önce onay) ve eğim <0.2° ise döndürmeyip yalnızca z ötelemesi uygula.

### QA2-05 — Web Worker yüklenemezse UI kalıcı olarak kilitleniyor
- **Şiddet:** Orta · **Ortam:** Chromium (worker.js isteği engellendi)
- **Adımlar:** `worker.js` yüklenemezken (ağ kesintisi, eklenti, CSP) dosya aç → Show PGM → Find noise.
- **Beklenen:** Anlamlı hata, UI kullanılabilir kalır.
- **Gerçekleşen:** 8 sn sonra hâlâ "Looking for noise…", tüm panel butonları devre dışı, PGM paneli sonsuza dek "Updating…"; sonraki tıklamalar "Please wait, another operation is still running…". Sayfa yenilenmeden çıkış yok.
- **Kanıt:** `G-05`.
- **Kök neden:** `worker.onerror` (≈253) yalnızca o an bekleyen işleri reddediyor; sonradan `runJob()` (≈257) ile gönderilen işler hiçbir zaman çözülmüyor, zaman aşımı yok.
- **Düzeltme:** Worker hatasında bayrak tut ve `runJob` yeni işleri hemen reddetsin; ek olarak iş başına zaman aşımı.

### QA2-06 — WebGL yoksa kullanıcıya hiçbir şey söylenmiyor
- **Şiddet:** Orta · **Ortam:** Chromium `--disable-webgl`
- **Gerçekleşen:** Karşılama ekranı normal görünür; dosya seçilince hiçbir şey olmaz. Yalnızca console'da `THREE.WebGLRenderer: A WebGL context could not be created`.
- **Kanıt:** `G-06`, `screens/G-06-nowebgl.png`.
- **Kök neden:** `new THREE.WebGLRenderer()` (≈138) modül en üstünde atıyor; `app.js`'in geri kalanı (dosya dinleyicileri dahil) hiç çalışmıyor.
- **Düzeltme:** Oluşturmayı `try/catch` içine al, `#welcome-status`'ta "Bu araç WebGL gerektirir" göster.

### QA2-07 — Bazı tarayıcılar indirme adını yeniden yazınca YAML `image:` eşleşmiyor
- **Şiddet:** Orta (Nav2 haritayı açamaz) · **Ortam:** WebKit 27.2 (Playwright/Linux); gerçek Safari doğrulanamadı
- **Adımlar:** `with spaces in name.pcd` (veya Türkçe/`#` içeren ad) aç, haritayı indir.
- **Gerçekleşen:** Dosya `with_spaces_in_name_map.pgm` olarak kaydediliyor, YAML `image: "with spaces in name_map.pgm"` diyor. Chromium ve Firefox adı koruyor (PASS); `b5012a9`'daki düzeltme yalnızca `:`/`"` gibi yasak karakterleri kapsıyor.
- **Kanıt:** `A-05[*]-webkit` (4 FAIL).
- **Kök neden:** `baseName()` (≈315) boşluk, `#` ve ASCII dışı karakterleri koruyor; tarayıcıların ad temizleme kuralları farklı.
- **Düzeltme:** İndirme adı için muhafazakâr küme kullan: `replace(/[^\w.-]+/g, "_")` (ASCII harf/rakam, `_ . -`); arayüzde gösterilen ad değişmeden kalabilir.

### QA2-08 — Sağ tuşla sürükleme sonrası da bağlam menüsü açılıyor
- **Şiddet:** Düşük · **Ortam:** 3 tarayıcı (Linux)
- **Gerçekleşen:** Yardım "Right-click (without dragging)" diyor; menü fare basılır basılmaz açılıyor ve sürükleme sonrası açık kalıyor.
- **Kök neden:** `contextmenu` (≈1544) sürükleme mesafesine bakmıyor; Linux/macOS'ta olay `mousedown`'da gelir.
- **Düzeltme:** Sağ tuş `pointerdown` konumunu sakla; `pointerup`'ta hareket >4 px ise menüyü kapat (veya menüyü `pointerup`'ta aç ve `contextmenu`'yu yalnızca `preventDefault` et).

### QA2-09 — "Nothing to undone" / "Nothing to redone"
- **Şiddet:** Düşük · **Kök neden:** `step()` (≈525) mesajı geçmiş zaman kelimesinden türetiyor. **Düzeltme:** fiili ayrı geçir ("undo"/"redo").

### QA2-10 — Birincil buton ve adım numarası kontrastı yetersiz
- **Şiddet:** Düşük · **Ölçüm:** beyaz metin / `#3b82f6` = **3.68:1** (AA için 4.5:1 gerekli) — "Align to floor", "Show PGM", "Download map", adım rozetleri 1–4.
- **Düzeltme:** `--accent: #2563eb` (5.17:1). Light mode yok (bilgi).

### QA2-11 — ASCII PCD'de POINTS ile veri satırı uyuşmazlığı uyarısız kabul ediliyor
- **Şiddet:** Düşük · **Fixture:** `POINTS 5`, 2 satır → "Opened … 2 points"; binary'de aynı durum (`points_more_than_data`) hata veriyor — tutarsız. **Düzeltme:** sayıyı karşılaştır, "dosya kesik olabilir: 5 bildirildi, 2 okundu" uyarısı.

### QA2-12 — Virgüllü XYZ ve bozuk PLY için yanıltıcı mesajlar
- **Şiddet:** Düşük · Virgüllü XYZ: "file contains no points"; tek-özellikli bozuk PLY: "file contains only NaN points". **Düzeltme:** XYZ için "boşluk/tab ayraçlı x y z bekleniyor", PLY için "x/y/z özelliği eksik".

### QA2-13 — Çoklu dosya bırakmada uyarı anında eziliyor
- **Şiddet:** Düşük · "Only one file can be open at a time…" mesajı (≈1713) aynı tick'te "Opening …" ile değişiyor; kullanıcı görmüyor. **Düzeltme:** uyarıyı açılış mesajına ekle.

### QA2-14 — Crop/Z değişiklikleri undo geçmişine girmiyor
- **Şiddet:** Düşük (beklenti uyuşmazlığı) · test.md karma undo'da crop'u bekliyor. Crop X min = 3 yapıp Ctrl+Z'ye basınca crop geri alınmıyor; bunun yerine bir önceki geometri işlemi (transform) geri alınıyor ve çerçeve değiştiği için crop tamamen sıfırlanıyor (X min 3 → −1.59). Kullanıcı hem beklemediği işlemi hem de crop'unu kaybediyor. **Düzeltme:** crop/Z'yi snapshot'a ekle ya da yardımda "undo yalnızca geometri işlemlerini geri alır, crop'u sıfırlar" de.

### QA2-15 — Harici CDN kodu için SRI/CSP yok
- **Şiddet:** Düşük · Three.js 0.166.1 jsDelivr'den import map ile yükleniyor; `integrity` yok, CSP yok (GitHub Pages yalnızca HSTS gönderiyor). **Düzeltme:** Three.js'i depoda barındır veya en azından `<meta http-equiv="Content-Security-Policy">` ile `script-src 'self' cdn.jsdelivr.net`.

### Canlı site (`main`) — yayına alınmamış düzeltmeler
Canlı sitede tekrar doğrulandı (`LIVE.json`): gerçek PCD doğrudan indirme **658×899** vs önizleme sonrası **546×896** (QA-001); `image: cloud # cropped: yes_map.pgm` tırnaksız ve kaydedilen ad `cloud # cropped_ yes_map.pgm` ile uyumsuz (QA-002); float64 binary PCD sessizce açılıyor (QA-003). Branch'te üçü de PASS. `fix/qa-report-defects` merge + deploy edilmeli.

## 3. Geçen testler (özet)

| Alan | Kapsam | Sonuç |
|---|---|---|
| A Parsing | PCD ascii/binary/binary_compressed, alan sırası değişik + rgb + intensity, PLY ascii/binLE/binBE renkli/renksiz, XYZ boşluk/tab/CRLF, BOM, CRLF, 2 MB satır, 200 k satırlık header, büyük harf uzantı, gerçek PCD — 3 tarayıcıda doğru nokta sayısı ve alanlar | PASS |
| A Bozuk girdi | boş dosya, 0 nokta, header-veri yok, POINTS>veri, kesik binary, NaN/Inf (4 atlandı mesajı), tümü NaN, PNG/TXT'yi .pcd yapma, alan yok, .las/.e57/.zip/uzantısız, I4/F8 binary → anlamlı hata, önceki bulut korunuyor | PASS (QA2-11/12 hariç) |
| A Durum | ikinci dosyada crop/Z/undo/PGM görünümü/araç sıfırlanıyor; 500 K (Chr 0.8 s, FF 0.2 s, WK 0.2 s) ve 3 M (Chr 4.1 s, FF 1.0 s, WK 0.8 s) yükleme, "Opening…" göstergesi; Türkçe/boşluk/200 karakter/HTML/`#:` ad; sürükle-bırak | PASS |
| B Zemin | 14.37° eğik oda (sonuç z≈0 ±2 cm, 5 basış drift yok), determinizm, Ctrl+Z, iki katlı bina, gerçek PCD | PASS |
| C Crop | min>max itme, min=max, 0 nokta mesajı, 200 olaylık hızlı sürükleme = sakin sonuç, sağ tık Z max/crop XY doğruluğu, ekran kenarında menü, dış tıklamada kapanma, alandayken M/L/T kısayolu tetiklenmiyor | PASS |
| D Temizlik | SOR 500/500 aykırıyı siliyor (bulut 49.9→10.0 m), parametre uçları kenetleniyor, lasso Esc/Del/Enter, tek tık/mikro/papyon/ekran dışı lasso, 3 M noktada lasso 0.86 s, karma 11 işlem → 10 undo + 11. ret, redo zinciri temizleniyor, önizleme açıkken undo önizlemeyi iptal ediyor | PASS |
| E Kamera | orbit, Shift/orta tuş pan, aşırı zoom, kutup üstü orbit, reset; M/L/T/P/?/Esc; Ctrl/Cmd+Z, Ctrl+Shift+Z, Ctrl+Y; çift tık odak/reset; **ölçüm 5.000 m (gerçek 5.000), açı 90.9°/91.7°**; yeniden boyutlandırma, %50/%200 zoom; dokunmatik döndürme ve pinch | PASS (Chromium + WebKit, dokunma Chromium) |
| F Çıktı | 10 m oda: P5, maxval 255, payload=w·h, değerler {0,254}, origin [0,0,0], dört duvar 201 hücre boyunca dolu, kutu doğru yerde, Y aynası yok; hover hücresi = dosya hücresi; önizleme = doğrudan indirme (byte-eşit); çözünürlük 0/−1/0.001→0.01, 10→1, boş/harf → önceki; radius/neighbours uçları; 120 hızlı değişim ve değişiklik anında indirme yarışsız; çift indirme; boş harita/filtre hepsini silince indirme yok + mesaj; offset odada origin [12.5, −7.25]; 2 km@0.05 (1.6e9 hücre) reddediliyor; 9524² (90.7 M) hücre 2.5 s'de iniyor (heap 193 MB, önizleme 452 MB) | PASS (3 tarayıcı) |
| F Nav2 | offset oda, 10 m oda, gerçek PCD: `map_server` configure/activate; yüklenen OccupancyGrid boyut, origin ve dolu/boş hücreler indirilen PGM ile **hücre-hücre aynı**, unknown=0; PyYAML tüm YAML'ları (tırnaklı `image` dahil) doğru okuyor | PASS |
| F Referans | Gerçek PCD, Z −0.3…1.1: referans pcd2pgm + `map_saver_cli` PGM'i ile **byte-eşit** (546×896, 7439 dolu) | PASS |
| G | yenilemede beforeunload uyarısı (iptal → veri kalır), geri tuşu, WebGL context lost→restore (çizim ve PGM devam), arka plan sekmesi, 10× yükle/kapat heap 8–41 MB arası sınırlı, ağ kapalıyken aç/hizala/indir/bulut indir çalışıyor ve **dosya açıldıktan sonra sıfır ağ isteği, hiç POST yok** | PASS |
| H | 390×844, 360×640, 320×568, 844×390: yatay taşma yok, toolbar/panel ekranda; Tab sırası mantıklı ve odak halkası görünür; 58 etkileşimli öğenin hepsinin erişilebilir adı var; yardım diyaloğu odağı alıyor; bulut yokken kısayol/tık/tekerlek etkisiz ve hatasız | PASS |
| I | header/alan adı/PLY yorumunda `<script>`/`<img onerror>` çalışmıyor, DOM'a basılmıyor; `__proto__`/`constructor` alanları prototype kirletmiyor | PASS |

## 4. Test edilemeyenler / sınırlı doğrulananlar

| Konu | Neden |
|---|---|
| Gerçek Safari (macOS/iOS) | Yalnızca Linux'ta Playwright WebKit 27.2 (eksik sistem kütüphaneleri sudo'suz, `apt-get download` + `dpkg -x` ile geçici olarak sağlandı); QA2-07'nin gerçek Safari'de oluşup oluşmadığı doğrulanamadı. |
| Markalı Google Chrome | Playwright Chromium 156 kullanıldı (aynı motor). |
| Fiziksel mobil, trackpad, gerçek tarayıcı zoom'u, tam ekran | Emülasyon (viewport/DPR/CDP touch); fiziksel cihaz ve tam ekran API'si headless'ta yok. Dokunmatikte uzun basma menü açmıyor; dokunmatikte sağ tık menüsüne alternatif yok (bilgi). |
| Çoklu indirme izin istemi | Headless tarayıcılar ikinci indirmeye izin istemi göstermiyor; gerçek Chrome'da "multiple downloads" istemi doğrulanamadı. |
| GPU belleği, saatler süren açık kalma | Ölçülebilir API yok / süre dışı. |
| Çevrimdışı ilk açılış | Service worker yok; sayfa ve Three.js ağdan gelir (README bunu belirtiyor). |
| Ekran okuyucu ile kullanım | AX ağacı adları doğrulandı; gerçek NVDA/VoiceOver denemesi yapılmadı. |
| PGM "unknown" hücre davranışı | Uygulama ve referans unknown (205) üretmiyor; test edilecek durum yok. |

## 5. İyileştirme önerileri (hata değil)

- **Referansla sınır farkı (F-REF):** 10 m odada uygulama 201×201, referans 200×200; referans `map_resolution_`'ı `float` tuttuğu için 10/0.05f = 199.999997 → x=10'daki duvar 199. kolona düşüyor, uygulama doğru şekilde 200. kolona koyuyor (78 hücre karşılıklı kayma, iç alan aynı). README'deki "floor+1" farkı bunu kapsıyor; "Same output as map_saver_cli" rozeti "gerçek bulutlarda byte-eşit, tam sınır noktalarında 1 hücre fark olabilir" diye inceltilebilir. `map_saver_cli` `free_thresh: 0.25` ve 1 ondalıklı origin yazıyor, uygulama 0.196 ve 6 ondalık — trinary 0/254 haritada davranış aynı.
- **Ana thread donması:** 3 M noktalı PCD Chromium'da 3.4 s tek kare donması yaratıyor, PGM önizlemesi 11.4 s (WebKit 3.8 s). Parse'ı worker'a taşımak veya ilerleme yüzdesi göstermek UX'i iyileştirir.
- **Dev harita belleği:** 100 M hücre sınırı altındaki 90.7 M hücrelik önizleme 452 MB heap kullanıyor; düşük bellekli cihazlar için sınırı ~25 M'ye çekmek veya önizlemeyi küçültülmüş çizmek.
- **Lasso semantiği:** Üst görünümde kutunun altındaki zemin de siliniyor (projeksiyon seçimi, D-03b: +276 nokta). Yardımda "görünen derinlikten bağımsız olarak çizgi içindeki tüm noktalar" diye belirtilmeli veya "yalnızca görünen" seçeneği.
- **Dosyalar arası kalıcı ayarlar:** Manuel transform (`tf.x=0.5`), radius vb. yeni dosyada korunuyor; bilinçli bir tercihse görünür kılınmalı.
- **Sınır dışı crop değeri:** X min = 50 yazılınca bulut sınırına kenetlenmiyor, boş seçim + mesaj oluşuyor; kenetlemek daha anlaşılır.
- **SOR varsayılanı:** k=8, std=1.0 PCL semantiğiyle odanın %8.4'ünü (9.761 geçerli nokta) da işaretliyor; önizleme olduğu için güvenli, ama varsayılan std 2.0 daha az sürpriz yaratır.
- **Light mode / yüksek kontrast:** Yalnızca koyu tema var.
- **Rampa:** Yalnızca rampadan oluşan bulut "zemin" olarak düzleniyor (max tilt 20°); rampa+zemin bulutlarında sorun yok.

## Yöntem notları

- Testler kara kutu olarak DOM üzerinden (gerçek fare/klavye/dosya girişi, gerçek indirme) yapıldı; çıktı dosyaları indirilip Python/Node ile ayrıştırıldı.
- El ile incelenmesi gereken 91 kontrol (69'u üç tarayıcıdaki A-02 bozuk-girdi mesajları) tek tek değerlendirilip PASS/FAIL'e çevrildi (`merged.json` → `final` alanı); harness kaynaklı hatalı ilk sonuçlar hedefli yeniden testlerle değiştirildi (ör. F-01c duvar örneklemesi, F-09b boş kırpma, C-05/C-07 klavye/menü, D-11 zamanlama).
- Tarayıcı kapsamı: A, C (klavye/menü), D (yarış), F üç tarayıcıda; E Chromium + WebKit; B, G, H, I Chromium'da koşuldu.
- Geçici harness `/tmp/pcd2pgm-qa` altında; repository'de yalnızca bu rapor ve `qa-evidence/` (izlenmeyen dosyalar) bırakıldı.
