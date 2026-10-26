# GÖREV: pcd2pgm_ui için kapsamlı QA / hata avı testi

Sen deneyimli bir QA mühendisi ve exploratory tester'sın. Hedef: olası tüm hataları, çökmeleri, UX sorunlarını ve yanlış çıktıları bulmak. Kod yazmayacaksın, uygulamayı kırmaya çalışacaksın.

## Hedef uygulama
- URL: https://alitekes1.github.io/pcd2pgm_ui/
- Kaynak: https://github.com/alitekes1/pcd2pgm_ui (kodu okuyabilirsin, mantığı anlamak için)
- Ne yapar: Tarayıcıda çalışan (sunucuya yükleme yok) bir araç. SLAM point cloud (.pcd, .ply, .xyz) dosyasını alır, 2D occupancy map (map.pgm + map.yaml) üretir. Referans pipeline: https://github.com/LihanChen2004/pcd2pgm
- Akış: (1) Level the floor: zemini otomatik z=0'a hizala, (2) Crop: X/Y/Z slider'ları, (3) Clean up: gürültü temizleme, lasso ile obje silme, (4) PGM map: parametreleri canlı ayarla ve indir.
- Kontroller: Sol sürükle=orbit; orta tuş/Shift+sürükle/ok tuşları=pan; tekerlek=imlece zoom; nokta çift tık=odak; boşluk çift tık=görünümü sıfırla; sağ tık menüsü (focus, Z min/max, XY crop); kısayollar M/L/T/P (ölçüm/lasso/üst görünüm/PGM görünümü); Del/Enter (lasso sil/tut); Esc=iptal; Ctrl+Z / Ctrl+Shift+Z (10 adım undo/redo); PGM panelinde tekerlek/sürükle/çift tık.

## Ön hazırlık
1. Test verisi üret. Gerçek dosya yoksa Python ile sentetik dosyalar oluştur:
   - Küçük geçerli ASCII PCD (~1.000 nokta, zemin + duvar + kutu)
   - Orta boy (~500K nokta) ve büyük (2–5M nokta) PCD
   - Binary PCD, binary_compressed PCD
   - ASCII ve binary PLY (renkli ve renksiz)
   - XYZ (boşluk, virgül ve tab ayraçlı varyantlar)
   - Eğik zeminli (rotasyonlu) cloud; zemin z=0 değil, örn. z=-1.7
   - Büyük koordinatlı cloud (GPS/UTM, 1e5–1e6 mertebesi) ve çok küçük ölçekli (mm) cloud
2. Test ortamı: Chrome, Firefox, Safari (mümkünse), mobil/dar viewport. DevTools Console, Network ve Performance sekmelerini açık tut.

## Test alanları (hepsini sistematik şekilde yürüt)

### A. Dosya yükleme ve parsing
- Sürükle-bırak ve "Choose file" ile yükleme
- Desteklenen 3 format x alt varyantlar (ASCII/binary/binary_compressed, intensity/RGB alanlı, alan sırası farklı)
- Bozuk girdiler: boş dosya, 0 nokta, header var veri yok, header'daki POINTS sayısı gerçekle uyuşmuyor, truncated dosya, NaN/Inf içeren noktalar, yanlış uzantı (.txt/.png'yi .pcd diye), çok uzun satırlar, UTF-8 BOM, CRLF/LF farkı
- Desteklenmeyen format (.las, .e57, .zip) için anlamlı hata mesajı var mı?
- Aynı oturumda ikinci dosya yükleme (state sızıntısı, önceki crop/lasso/undo geçmişi sıfırlanıyor mu?)
- Çok büyük dosyada UI donması, progress göstergesi, tab crash, bellek (Performance/Memory sekmesinden izle)
- Dosya adında Türkçe/özel karakter, boşluk, çok uzun isim

### B. Level the floor (otomatik hizalama)
- Eğik zeminde doğru düzleme oturuyor mu? Sonuçta zemin gerçekten z≈0 mu?
- Zemin olmayan cloud (sadece duvarlar, havadan çekim), birden fazla katlı bina, rampa, merdiven
- Zaten düz cloud'da gereksiz dönüş yapıyor mu? Tekrar tekrar uygulayınca drift var mı?
- Rastgele/determinist mi: aynı dosyada aynı sonuç çıkıyor mu?
- Undo ile geri alma

### C. Crop (X/Y/Z slider)
- Min > max yapma, min = max, uç değerler, çok hızlı slider sürükleme
- Canlı güncelleme gecikmesi/titreme, 0 nokta kalınca davranış (boş ekran, hata?)
- Sağ tık menüsünden "set Z min / Z max / crop XY around point" doğruluğu
- Crop sonrası PGM çıktısının güncellenmesi
- Slider'a klavye ile değer girme / ok tuşları (pan ile çakışıyor mu?)

### D. Clean up (gürültü + lasso)
- Gürültü temizleme parametreleri (radius/outlier benzeri): 0, negatif, çok büyük, ondalık, boş string, harf girişi
- Lasso: M/L/T/P kısayolları, serbest çizim, kendini kesen poligon, çok küçük/tek noktalı lasso, ekran dışına taşan lasso, Del ve Enter semantiği (sil vs. tut), Esc ile iptal
- Farklı kamera açılarında lasso doğruluğu (ön, üst, perspektif); arkada kalan noktalar seçiliyor mu?
- Büyük cloud'da lasso performansı
- Undo/Redo: 10 adım limiti, 11. adımda davranış, redo zincirinin yeni işlemden sonra temizlenmesi, tüm araç türleri arası karışık undo (crop + lasso + noise + level)

### E. Kamera ve etkileşim
- Orbit/pan/zoom, sınır değerler (aşırı zoom in/out, kamera cloud'un içine girmesi, gimbal lock/ters dönme)
- Tüm kısayollar: M, L, T, P, Del, Enter, Esc, Ctrl+Z, Ctrl+Shift+Z. Ayrıca Mac'te Cmd+Z, input alanına odaklıyken kısayolların yanlışlıkla tetiklenmesi
- Çift tık nokta odağı (boş alana yakın tıklama), çift tık boşluk reset
- Sağ tık menüsü: sürükleme sonrası açılmaması, ekran kenarında konumlanma, menü dışı tıklayınca kapanma
- Ölçüm (M): iki nokta arası mesafe doğruluğu (bilinen mesafeli sentetik veriyle doğrula), birimler, ölçümü iptal/temizleme
- Dokunmatik (touch) cihaz ve trackpad davranışı, tarayıcı zoom (%50 / %200)
- Pencere yeniden boyutlandırma, tam ekran, split-view oranı

### F. PGM üretimi ve çıktı doğruluğu (EN KRİTİK)
- Parametreler (resolution, occupancy eşikleri, yükseklik aralığı, yarıçap filtreleri vb.) için uç değerler: 0, negatif, çok küçük resolution (0.001), çok büyük (10), boş, ondalık ayraç (virgül vs nokta)
- Canlı önizleme parametre değişimine tutarlı tepki veriyor mu, yarış durumu (hızlı değişimde eski sonuç yeni sonucun üstüne yazılıyor mu)?
- İndirilen map.pgm: geçerli P5 header, genişlik/yükseklik, maxval 255, piksel verisi boyutu = w*h
- İndirilen map.yaml: image adı pgm ile uyumlu mu, resolution, origin [x, y, 0] DOĞRU mu (en kritik: origin sol-alt köşe konvansiyonu, Nav2/map_server ile uyumlu), negate, occupied_thresh, free_thresh, mode alanları
- PGM'in y ekseni ters mi? (PGM üstten alta, harita alttan yukarı: görsel önizleme ile indirilen dosyayı karşılaştır)
- Sentetik veriyle doğrulama: bilinen boyutta (örn. 10m x 10m oda, 0.05 res) cloud'dan 200x200 piksel ve doğru duvar konumu beklenir; sapma var mı?
- Mümkünse çıktıyı gerçekten doğrula: `map_server` ile yükle veya Python (PIL/numpy) ile oku. Referans pcd2pgm (LihanChen2004) aynı parametrelerle aynı sonucu veriyor mu? Fark varsa raporla.
- İndirme: iki dosyanın ikisi de iniyor mu, dosya adı, tekrar indirme, popup/multi-download engeli, boş harita indirmeye çalışma
- Çok geniş alanlı cloud'da (km ölçeği) çok büyük PGM üretimi: limit, bellek, tarayıcı çökmesi

### G. State, performans, dayanıklılık
- Sayfa yenileme, geri/ileri tuşu, sekme arka plana gidip gelme (WebGL context lost), uzun süre açık bırakma
- Bellek sızıntısı: 5-10 kez farklı dosya yükle, heap büyümesini izle
- WebGL desteği yoksa/devre dışıysa fallback mesajı
- Web Worker kullanılıyorsa hata durumunda UI kilitleniyor mu
- Console'da herhangi bir error/warning, yakalanmamış promise rejection, 404 kaynak
- Offline çalışma (yükleme sonrası ağı kapat; "Nothing is uploaded" iddiasını Network sekmesinden doğrula: dosya içeriği hiçbir isteğe gitmemeli)

### H. UI / UX / erişilebilirlik
- Mobil ve dar ekranda layout bozulması, taşan elemanlar
- Dark/light mod (varsa), kontrast, klavye ile gezinme (Tab sırası, focus göstergesi), buton/etiket metinleri, yazım hataları
- Hata durumlarında kullanıcıya anlamlı mesaj gösteriliyor mu yoksa sessiz mi başarısız oluyor
- Yükleme/işleme sırasında loading göstergesi
- Şu an cloud yokken ("Drop the point cloud to open it") butonların/araçların davranışı: dosya yokken slider, M/L/Del, indirme tetiklenirse ne olur

### I. Güvenlik / gizlilik (hafif)
- Dosya içeriğinden XSS: header'da `<script>`, `<img onerror>` içeren alan adı/comment satırları UI'a basılıyor mu
- Çok büyük header, prototype pollution benzeri anahtarlar (`__proto__`)
- Harici kaynak yükleniyor mu (CDN bağımlılıkları, SRI), CSP

## Çalışma yöntemi
1. Önce uygulamayı ve (varsa) kaynak kodunu incele, bir test planı çıkar.
2. Her test için: adımlar, beklenen sonuç, gerçek sonuç, PASS/FAIL.
3. Bir hata bulduğunda: tekrarlanabilir minimum adımları çıkar, ekran görüntüsü + console log kaydet, mümkünse kök nedeni kaynak kodda ara.
4. Sadece "çalışıyor" deme; çıktı dosyalarını gerçekten indirip doğrula.
5. Bulduğun hatanın çevresini de zorla (aynı kök neden başka yerde de var mı).
6. Varsayım yapma. Emin olmadığın şeyi "doğrulanamadı" olarak işaretle.

## Rapor formatı
Sonunda şunu üret:

**1. Özet:** toplam test sayısı, PASS/FAIL/doğrulanamadı sayıları, genel kalite değerlendirmesi (3-5 cümle).

**2. Hata listesi** (öncelik sırasıyla), her biri için:
- ID, başlık
- Şiddet: Kritik (yanlış çıktı/veri kaybı/çökme) / Yüksek / Orta / Düşük
- Ortam (tarayıcı, OS, dosya)
- Tekrar adımları
- Beklenen vs. gerçekleşen
- Kanıt (log, ekran görüntüsü, dosya)
- Olası kök neden ve düzeltme önerisi

**3. Geçen testler tablosu** (kısa).

**4. Test edilemeyenler ve nedenleri.**

**5. İyileştirme önerileri** (hata olmayan UX/performans/özellik önerileri).

Önce "map.pgm/map.yaml doğruluğu" (bölüm F) ve "parsing" (bölüm A) alanlarına öncelik ver. Yanlış harita üretmek, robotun yanlış navigasyonuna yol açabileceği için en yüksek riskli alan bu.
