# Andijan water-network map sources

## Provenance and handling

The Andijan water-network data below was supplied in `tmp/andijon-source` at source commit recorded in VERSION.txt. It is committed to this repository only by the user's explicit decision. The source marks both code and data confidential and says not to publish them. Geometry and source accuracy caveats remain those of the supplier; the map is reference geometry and provides no live readings.

The data files at `apps/web/public/andijon-map/` are extracted by `scripts/extract-andijan-map-data.mjs`. The script reads the self-contained `index.html` without evaluating it, parses its four JSON literals, remaps overlay paths for static serving, and copies the supplied PNG overlays.

## README.md (verbatim)

# Andijon suv tarmog'i interaktiv xaritasi (maxfiy — ochiq internetga chiqarilmasin)

Interaktiv veb-xarita: `index.html` (Leaflet, barcha ma'lumotlar ichiga joylangan, bir dona self-contained fayl; skanerlangan qatlamlar `overlays/` papkasida).

## Yopiq havola orqali ulashish

Xaritaning kirish cheklangan manzili: https://andijon-suv-xaritasi.spectrumiya.chatgpt.site

Saytga hozir loyiha egasi kira oladi. Boshqa odamlarga kirish berish uchun ularning elektron pochta manzillarini ruxsat etilganlar ro'yxatiga qo'shish kerak. Havolaning o'zi ruxsat bermaydi. Saytni ommaga ochmang: xaritada batafsil kanal va inshoot ma'lumotlari bor.

`python3 tools/package_share.py` faqat `index.html` va unda ishlatiladigan `overlays/` rasmlarini `dist/` hamda alohida `site-deploy/` nusxasiga yig'adi. `share-artifacts/andijon-suv-xaritasi.zip` zaxira ulashish to'plamidir. `dist/`, `site-deploy/` va `share-artifacts/` versiya nazoratiga kiritilmaydi. Saytdagi ma'lumotlarni yangilash uchun xaritani qayta yig'ish, shu paketlash buyrug'ini bajarish va yopiq saytning yangi versiyasini joylashtirish kerak.

## Ma'lumot manbalari

1. **Rasmiy shapefile'lar (Baliqchi hududi)**:
   - `КАК` — Katta Andijon kanali (34.5 km)
   - `Х_А_каналлар` — Xo'jaliklararo kanallar (98.5 km)
   - `Х_И_каналлар` — Xo'jalik ichi kanallari (350.0 km)
   - Koordinatalar: UTM 42N → WGS84 ga o'girilgan.

2. **Viloyat irrigatsiya tarmog'i (`каналлар.kmz`)**:
   - Andijon viloyatining 14 ta tumani bo'yicha **398 ta nomlangan kanal konturi**.
   - Tumanlar kesimida: Andijon, Asaka, Baliqchi, Buloqboshi, Bo'ston, Jalaquduq, Izboskan, Qo'rg'ontepa, Marhamat, Oltinko'l, Paxtaobod, Ulug'nor, Xo'jaobod, Shahrixon.
   - `tools/import_kmz_canals.py` orqali `derived_canals.json` ga o'tkazilgan. Ko'rsatilgan qiymat — kontur maydoni. KMZdagi `км` ustuni 398 yozuvning barchasida poligon perimetrining yarmiga teng; uni kanalning tasdiqlangan uzunligi sifatida ishlatmaymiz. KMZ geometriyasi boshqa qatlamlar bilan ustma-ust kelishi mumkin.

3. **Viloyat melioratsiya tarmog'i va quduqlar (`Коллекторлар.kmz`)**:
   - **Xo'jaliklararo kollektor-zovurlar (XA)**: 14 ta tuman bo'yicha **829 ta kollektor** (KMZdan olingan jami **2802.9 km**, alohida tekshiruv talab etadi).
   - **Gidrogeologik kuzatuv quduqlari**: yer osti sizot suvlari sathi va sho'rlanishini kuzatuvchi **1999 ta monitoring qudug'i**.
   - `tools/import_kmz_collectors.py` orqali `derived_kollektor_xa.json` va `derived_quduq.json` ga o'tkazilgan.

4. **OpenStreetMap (Overpass)**:
   - Magistral kanallar (Katta Farg'ona kanali — BFK, Janubiy Farg'ona kanali — JFK, Shahrixonsoy, Savay kanali, Paxtaobod kanali).
   - Daryolar (Qoradaryo, Andijonsoy, Oqbo'rasoy, Aravonsoy, Maylisoy, Qoraunkur).
   - Ariqlar, selxonalar, to'g'onlar (Kampirravot to'g'oni), suv omborlari, hovuzlar va suv xo'jaligi inshootlari (nasos stansiyalari, suv minoralari).

5. **Skanerlangan xaritalar va hududlar**:
   - `overlays/` papkasidagi georeferensiyalangan xaritalar: Norin-Qoradaryo ITB ma'muriy xaritasi, gidrotexnika inshootlari sxemasi, sug'orish tizimlari va topoxarita.
   - `derived_itb.json` (5 ta ITB hududi: Andijonsoy, Qoradaryo–Mayliysoy, Savay–Oqburasoy, Shahrixonsoy, Ulug'nor–Mazgilsoy).
   - `derived_adir.json` (Adir yerlar).
   - `osm/adm/` (14 ta tuman ma'muriy chegaralari).

## Qayta yig'ish (Build)

Talab qilinadigan kutubxonalar: `pyshp`, `pyproj`, `shapely`.

1. Virtual muhitni faollashtirish:
   ```bash
   source .venv/bin/activate
   ```
2. Yangi KMZ ma'lumotlarini import qilish (zarur bo'lsa):
   ```bash
   python tools/import_kmz_canals.py ~/Downloads/каналлар.kmz
   python tools/import_kmz_collectors.py ~/Downloads/Коллекторлар.kmz
   ```
3. Xaritani yig'ish:
   ```bash
   python build.py
   ```
   Natijada ma'lumotlarni o'z ichiga olgan `index.html` hosil bo'ladi; skanerlangan rasmlar esa `overlays/` papkasida qoladi.

## Interfeys imkoniyatlari
- **Tumanlar bo'yicha filter**: tanlangan tuman chegarasi bo'yicha barcha vektor qatlamlari (kanal, zovur, daryo, suv havzasi, inshoot va boshqalar) geometriyasi kesiladi. Qidiruv, qatlam sonlari va statistika ham shu tuman uchun yangilanadi. Butun viloyatni ko'rsatadigan skanerlangan rasmlar tuman tanlanganda yashiriladi; "Barcha tumanlar" tanlansa avvalgi ko'rinish qaytadi.
- **Qidiruv**: yuqoridagi qidiruvga nom yozilganda natijalar chiqadi; tanlangan obyektning turi, tumani va o'lchami alohida kartada ko'rinadi. `Enter` birinchi natijani ochadi, `Esc` qidiruvni tozalaydi.
- **Obyektga o'tish**: qidiruv natijasi yoki xaritadagi obyekt tanlanganda silliq animatsiya bilan unga yaqinlashadi. Uzun kanalning barcha bo'laklarini bir ekranga sig'dirish juda uzoq ko'rinish bersa, yaqin bo'lak 12-masshtabda ochiladi; xaritada bosilgan bo'lak ustuvor. Harakatni kamaytirish tizim sozlamasi yoqilgan bo'lsa, animatsiya ishlatilmaydi.
- **Qatlamlar**: qatlamlar ixcham guruhlarga yig'ilgan; xaritadagi "Hududga qaytish" tugmasi tanlangan tumanni yana ekranga sig'diradi. Mobil ekranda xarita yuqorida, boshqaruvlar pastda joylashadi.
- **Statistika**: 14 ta tuman kesimida kanal konturi maydoni, KMZ kollektor uzunliklari va quduqlar soni jadvali. Turli manba qatlamlari takrorlanishi mumkin.

## Fayzobod aqlli suv tajriba hududi

- `~/Downloads/Файзобод.kmz` dagi **Файзобод** konturi `tools/import_fayzobod.py` orqali `derived_fayzobod.json` ga olingan. Xaritada alohida pushti qatlam va "Kanalga o'tish" tugmasi bor. "Fayzobod", "Fayziobod" hamda kirillcha yozilishlar qidiruvda shu qatlamni topadi.
- Oldingi umumiy `derived_canals.json` dagi ayni Andijon konturi (`source_id=133`) xaritada ikkinchi marta ko'rsatilmaydi. Asaka tumanidagi `Файзаобод (Корасон конди)` kanali va Paxtaoboddagi `Файзобод` zovuri alohida obyektlar bo'lib qoladi.
- `Файзиобод каналини бетонлаш. 2027.docx` kanalni 11,1 km, loyihaviy o'tkazuvchanligini 10 m³/s, xizmat hududini 1 980 ga deb beradi. `Ирригация_файзабод_гоог_ва_чизиқли_схемаси.pptx` da ПК 0+00 dan ПК 111+00 gacha 17 ta dahana ko'rsatilgan. Dahanalarning aniq koordinatalari berilmagani uchun xaritaga taxminiy nuqta qo'shilmadi.
- KMZ **kanal konturi** (taxminan 4,95 ga) bo'lib, uning poligon perimetri yoki maydoni hujjatdagi 11,1 km kanal uzunligini o'lchamaydi. 2027 rekonstruksiya dasturiga kiritish hujjatlari tayyorlanayotgani qayd etilgan; xaritadagi pilot belgisi texnologiya tajribasi uchun tanlangan hududni bildiradi, ishlar boshlanganini anglatmaydi.

## Qo'shimcha tekshirilgan kanal nomlari

- Baliqchi tumani [Mazgilsoy va Chinobodsoy](https://gov.uz/oz/baliqchi/pages/about) mavjudligini bildiradi. KMZda Chinobodsoy hamda Shimoliy Mazgil va Mazgil tashlama konturlari bor; oxirgi ikkisini to'liq Mazgilsoy deb birlashtirishga asos yo'q.
- Suv xo'jaligi agentligi [Shahrixonsoyning Bo'ston tumanidagi qismini](https://gov.uz/oz/suvobekt/news/view/208326) kanal deb qayd etgan. Uning ayrim bo'laklari OSM va KMZda mavjud.
- Suv xo'jaligi vazirligi [Xila, Kampirobod, Savay va Paxtaobod](https://gov.uz/oz/suvchi/news/view/166291) kanallarini tilga olgan. Savay va Paxtaobodning ayrim bo'laklari xaritada bor; Xila va Kampirobod uchun aniq GIS geometriyasi topilmadi, shu sabab taxminiy chiziq chizilmadi.

Bu internet manbalari kanal mavjudligi va nomini tasdiqlaydi, aniq yo'nalishini emas. KMZ ma'lumoti mahalliy fayldan import qilingan; unga alohida rasmiylik darajasi berilmagan.

## ITB xaritasidan vektorlashtirish

`tools/vectorize_itb.py` Norin–Qoradaryo ITB xaritasidagi (rasm) ko'k kanal, yashil kollektor, moviy soy chiziqlarini va nasos/dyuker/akveduk belgilarini rangi bo'yicha ajratib, `derived_itb_vec.json` ga yozadi.
`build.py` (`merge_itb`) ularni: (1) rasmiy Katta Andijon kanali bo'yicha o'lchangan ~330 m siljish bilan tuzatadi, (2) silliqlaydi, (3) rasmiy shapefile, OSM va KMZ qatlamlari bilan 350 m ichida takrorlanganlarini olib tashlaydi va mavjud qatlamlarga (`osm_canal`, `osm_ditch`, `osm_drain`, `osm_stream`, `osm_pt`) `src: "itb"` bilan qo'shadi. Aniqlik ±300–500 m (taxminiy).

## Gidrotexnik sxemadan nomlangan nuqtalar

`tools/make_hydro_nodes.py` gidrotexnik inshootlar sxemasidagi (rasm 4) nomlangan gidrouzellar, kichik GES va nasos stansiyalarini shaharlar bo'yicha (thin-plate spline) koordinatalarga o'tkazadi va gidrouzellarni eng yaqin daryo/kanalga (≤1,5 km) yopishtiradi. Natija `derived_hydro_nodes.json` (17 nuqta, joylashuv ±2–3 km, `src: "sxema"`), `build.py` uni `osm_pt` qatlamiga qo'shadi.

Qo'shilmagan (ishonchli ajratib bo'lmadi): 15 ta sug'orish tizimi hududlari (rasm 6, qo'lda bo'yalgan juda o'xshash ranglar), ITB xaritasidagi "yirik suv inshootlari" belgilari (4–5 piksel, JPEG'da ranglari buzilgan), nasos nomlari (yozuvlari o'qib bo'lmaydi).

## Sug'orish tizimlari hududlari (tarixiy sxema, rasm 6)

`tools/make_systems_manual.py` qo'lda belgilangan seed nuqtalar (`tools/systems_seeds.json`, har bir tizim uchun rasmdagi joylar) dan haqiqiy ranglarni olib, hududlarni tasniflaydi, mayda bo'laklarni tozalaydi va shaharlar bo'yicha (13 GCP, thin-plate spline, LOO xato ~1,4 km) koordinatalarga o'tkazadi → `derived_systems.json` (13 tizim). Chegaralar taxminiy (±1–3 km); "Mayliysoy" va "LNK" ranglari ajralmadi.

## каналлар.kmz: o'q chiziqlar (tools/kmz_centerlines.py)

KMZdagi 398 "kontur" aslida ingichka poligonlar (median kengligi ~3,7 m, kanalni borib-kelib chizilgan). `kmz_centerlines.py` ularning 377 tasini o'q chiziqqa (LineString) aylantiradi, 21 ta shoxlangani kontur holida qoladi; natija `derived_canal_lines.json` (nom, tuman, haqiqiy uzunlik; jami ~1857 km). Statistikada "kanal konturi, ga" o'rniga endi km ko'rsatiladi.
KMZdagi qo'lda chizilgan 73 ta chiziq (`derived_kmz_lines.json`, ~48 km) alohida qatlam; "33 пост" nuqtasi inshootlar qatlamida.

## VERSION.txt (verbatim)

Git commit: 1ff7235a82aff9f2dbe677df90a31529046a154e
Bu manba kodi va xarita ma’lumotlari maxfiy. Ochiq saytga joylamang.
