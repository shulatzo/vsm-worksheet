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
