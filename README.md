# VSM Worksheet

VolleyStation `.vsm` maç dosyalarından rakip analizi sayfaları hazırlayan, tarayıcıda çalışan ve telefona/bilgisayara kurulabilen bir uygulama (PWA).

## Ne yapar
- Bir veya birkaç `.vsm` dosyasını okur (sürükle-bırak ya da "+ .vsm ekle").
- Seçilen takım için oyuncu başına hücum kartlarını doldurur: çıkış bölgesi, iniş bölgeleri, ana ve alternatif yön, blok sayısı, sayı/hata yüzdeleri.
- Pasör dağılımını (pasör ön/arka sırada, side-out/transition) ve ilk altıyı gösterir.
- Kartlar elle düzenlenir: savunmacıları ve blokları sahada sürükleyin, sembol ekleyin (halka, tip kapama, adım oku, etiket), POS.5/1/6 ve not yazın.
- Açık / koyu tema, yazdır / PDF, yedekle / geri yükle.

## Gizlilik
`.vsm` dosyaları hiçbir sunucuya gönderilmez. Dosyalar tarayıcının kendi deposunda (IndexedDB) durur, düzenlemeler localStorage'dadır. Bu depoda maç verisi yoktur.

## Bilinen sınırlar
- Topun indiği bölge (hücumdan sonra topun rakip sahada düştüğü 1-9 arası bölge), scout'u yapan kişi her vuruş için girmediyse boş kalır. Kartlar bunu "Topun indiği bölge X vuruşun yalnızca Y tanesinde işaretlenmiş" uyarısıyla gösterir.
- Alt bölgeler (A/B/C/D) kullanılmıyor, yalnızca 1-9 bölgeleri.
- Oyuncu adları dosyada Türkçe karaktersiz gelir; isme tıklayıp düzeltebilirsiniz.
- Düzenlemeler tarayıcı verisiyle birlikte silinebilir; "Yedekle" ile dosyaya alın.

## Yerelde çalıştırma
Derleme adımı yok. Herhangi bir statik sunucu yeter:

```
python3 -m http.server 8000
```

Sonra `http://localhost:8000` adresini açın.

## Yayınlama (GitHub Pages)
Depo ayarlarında Pages → Source: `main` / root. Adres: `https://<kullanıcı>.github.io/vsm-worksheet/`

Uygulama dosyalarını değiştirdiğinizde `sw.js` içindeki `CACHE` adını artırın ki kurulu uygulamalar yeni sürümü alsın.

- Vuruşun iniş bölgesi işaretlenmemişse, hemen ardından gelen rakip savunma (D) kaydındaki bölge iniş bölgesi sayılır.
- Vuruşun başlangıç bölgesi işaretlenmemişse, hücum kodunun VolleyStation'daki başlangıç bölgesi ("start", örn. CF için 2B) kullanılır.
- Oyuncunun rolü (smaçör / orta / çapraz), vuruş kodlarının hedef oyuncusuna göre belirlenir; başlangıç bölgesi yalnızca yedek yöntemdir.

- Servis: takımın ve her servisçinin çıkış yeri ve topun indiği bölgeler (sol panelden açılıp kapanır). Servisin indiği bölge karşılayan takımın saha numarasıyla tutulur.


## Defans Planı (`defans.html`)

VolleyStation'ın heatmap PDF'inden oyuncu sayfaları üretip üzerlerine defans dairelerini yerleştirmek için ayrı bir sayfa. Ana uygulamadaki "Defans planı" düğmesinden açılır.

- **PDF açma:** `Heatmap PDF'i aç` (pdf.js, `vendor/`, tarayıcıda çalışır, dosya hiçbir yere gönderilmez). İki biçim okunur: (1) **VolleyStation raporu**: oyuncu başına bir başlık sayfası ("Players 3 ERTEK" filtresi) ve ardından tam saha heatmap'ler; tam sahadan file çizgisinin altındaki yarı saha, kod/istatistik şeridiyle birlikte kart olarak kırpılır. Başlık sayfaları (çoğu neredeyse boştur, VolleyStation'ın kendi sayfalamasıdır) kart üretmez, yalnız oyuncu adını verir. (2) Yarı saha kartlı sunum PDF'i: her sayfa bir oyuncudur, ad sayfadaki en büyük yazıdan alınır. Ad tıklanıp değiştirilir (VolleyStation filtresi yalnız soyadını ve Türkçe karakterleri kaybetmiş olarak verir).
- **Yanlış heatmap yüklendiyse:** oyuncu başlığındaki "Heatmap PDF'ini değiştir" o oyuncunun kartlarını doğru PDF'ten gelenlerle değiştirir (ad, fotoğraf ve boyut kalır; eski kartların daireleri silinir, geri alınamaz). Üst çubuktaki "PDF ekle" açık sayfaya yeni oyuncuları ekler.
- **Kart sırası:** kartın sol üst köşesindeki ⠿ tutamacı sürüklenerek aynı oyuncunun kartları yeniden sıralanır (kaydedilir, geri alınır, yazdırmaya ve PowerPoint'e yansır).
- **Kart kaldırma:** kartın köşesindeki ✕; oyuncu için "Oyuncuyu kaldır". Kaldırılanlar "Kaldırılanlar" panelinden geri gelir. Geri al/yinele hepsini kapsar.
- **Fotoğraf:** oyuncu adının üstünde; boyut kaydırıcısı (mm). "Arka planı temizle": renk tabanlı (yapay zekâ değil) otomatik temizleme + tıkla-sil + sil/geri getir fırçası. Zemin rengi kenarın en az 3 kenarında görülen baskın renk sayılır; nesneyle zemin arasındaki keskin kenarlar aşılmaz. Zemin ile nesne aynı renkteyse (beyaz forma/beyaz duvar) fırçayla düzeltilir. "Arka planı geri getir" orijinale döner.
- **Atak koduna göre başlangıç daireleri:** kartın sol üstündeki kod (C1, XS, PP …) önce PDF'in metin katmanından, yoksa etiketin görsel parmak iziyle (`defans-refs.js`) okunur. Kod tanınıyorsa, daha önce dokunulmamış kartlara o kodun referans daireleri konur. Yerleşik referans, MER NOS sunumundaki elle yerleştirilmiş 21 karttan çıkarıldı (kod başına en tipik yerleşim). Alt çubukta kartın kodu düzeltilebilir; **Referans yap** o kartın dairelerini kodun yeni referansı yapar (yedeğe girer), **Referansı uygula** kartı referansa döndürür.
- Daireler saha (turuncu alan) koordinatında (0–1) saklanır; PDF'in özeti + sayfa + kart sırasına bağlıdır, aynı PDF yeniden açılırsa yerinde durur.
- Sahaya dokun = daire ekle, sürükle = taşı, oval dairede döndürme tutamacı. Alt çubuk: numara, renk, daire/oval, sil, formasyon, kopyala/yapıştır, alt şerit notu (RIGHT TO RIGHT vb.). Numaralar varsayılan olarak kapalıdır.
- **Sıfırla** düğmesi: "Daireleri baştan yerleştir" (daire ve notlar silinir, referanslar yeniden konur; geri alınır) ya da "Her şeyi sil" (PDF, kartlar, daireler, adlar, fotoğraflar; kayıtlı referanslar isteğe bağlı; geri alınmaz).
- Otomatik kaydedilir (IndexedDB: PDF kartları, daireler, fotoğraflar). Yedekle/Geri yükle ile dosyaya alınır (fotoğraflar dahil).
- **Yazdır / PDF:** A4 yatay, oyuncu başına bir sayfa; "Sırada" ile kart sayısı 2–5. **PowerPoint (.pptx):** oyuncu başına slayt (kartlar 2 satırı aşarsa devam slaytı); fotoğraf ve kartlar görsel, daireler/oval/notlar düzenlenebilir şekiller.
- Kapsam: kart tespiti VolleyStation'ın heatmap görünümüne (turuncu saha, mavi çerçeve) dayanır; farklı bir görünümde kart bulunamazsa sayfa uyarı verir.

## Isı Haritası (`heatmap.html`)

VolleyStation'dan dışa aktarılan `.vsm` dosyalarından, bir takımın ataklarının **düştüğü yeri** oyuncu ve atak kombinasyonu başına ısı haritası olarak çizer.

- **Veri:** `.vsm` içindeki her atağın `travelPath` alanı (VolleyStation'da elle çizilen yön) başlangıç ve düşüş koordinatını (cm) verir. Çizilmemiş atakta düşüş alt bölgesi (A–D), o da yoksa bölge merkezi kullanılır; bunlar "yaklaşık" sayılır ve istenirse gizlenir. Dosyayı çizimleri yaptıktan sonra dışa aktarmak gerekir.
- **Sahalar:** her oyuncu için, o oyuncunun atak yaptığı her kombinasyon ayrı saha. Saha, savunan yarı sahadır (file üstte), 3 m çizgisi ve bölge çizgileri görünür. Saha VolleyStation gibi savunan takımın gözünden çizilir: ön sıra 4 3 2, orta 7 8 9, arka 5 6 1 (soldan sağa). VolleyStation'da seçili kombinasyonlar varsayılan gelir; soldaki listeden değiştirilir.
- **Görünüm:** VolleyStation'ın heatmap görünümü (mavi çevre, turuncu saha, beyaz çizgiler, mor hale → yeşil → sarı → turuncu/kırmızı çekirdek) ve başlıktaki Tot / Pts / E / Err / Blo değerleri aynen kullanılır.
- **Top tipi:** her oyuncunun başlığında H (sert), P (soft), T (tip) için tik kutusu ve opaklık çubuğu vardır. VolleyStation renklerinde seçili tipler tek yoğunlukta toplanır (çubuk tipin ağırlığıdır); tek tipi görmek için diğerlerinin tikini kaldırın. "Tip renkleri" düğmesiyle H yeşil, P kırmızı, T mor ayrı katmanlar olarak da çizilir.
- **Süzgeçler:** maç, oyuncu, kombinasyon, sonuç, atağın başladığı yer (4 / 3 / 2 / arka sıra), set. Yayılım çubuğu her atağın ısı yarıçapını, doygunluk çubuğu tam renk için atakların yüzde kaçının aynı yerde toplanması gerektiğini belirler (VolleyStation gibi kartın toplam atak sayısına göre ölçeklenir); "Bölge %" her bölgeye düşen atak oranını yazar.
- **Defans planı oluştur:** ekrandaki sahaları (oyuncu ve kombinasyon başına) Defans Planı sayfasına kart olarak aktarır; atak koduna göre referans daireleri otomatik yerleşir. Aynı oyuncu yeniden aktarılırsa kartlar yenilenir, daireler korunur.
- Beş atağın altındaki sahalar "az veri" diye işaretlenir. Dosyalar tarayıcıda saklanır, sunucuya gitmez.

## Saha görünümü: Bölge kutuları / Heatmap

Ayarlardaki "Saha görünümü" ile oyuncu kartlarındaki ana saha iki görünüm arasında değişir. Kartın geri kalanı (rakip yarı saha, ok yönleri, blok/savunma sembolleri, notlar) aynı kalır; yalnızca topun indiği yerin gösterimi değişir.
- **Bölge kutuları:** 1–9 bölgelerinin vuruş sayısına göre boyalı kutuları (önceki görünüm).
- **Heatmap:** VolleyStation tarzı yumuşak ısı lekeleri. Veri: topun indiği bölge ve varsa alt bölge; alt bölge işaretliyse o 1,5 m'lik hücreye, değilse bölgenin dört hücresine eşit yazılır (.vsm'de X/Y koordinatı yoktur). Dig kaydından türetilen iniş bölgeleri de sayılır. Renk ölçeği sabit: 3 üst üste vuruş kırmızı.
- Servis kartları şimdilik her iki görünümde de bölge kutularıyla çizilir.
