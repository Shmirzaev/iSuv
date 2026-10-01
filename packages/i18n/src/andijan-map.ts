import type { Locale } from './index.js';

/**
 * Interface chrome for the supplied Andijan water-network reference map.
 * Feature names and popup content deliberately remain in the supplied source
 * data: they are evidence, not translated application copy. Layer display
 * labels are interface chrome and have their own dictionaries below.
 */
export type AndijanMapWord =
  | 'tab'
  | 'title'
  | 'detail'
  | 'confidentiality'
  | 'referenceNotice'
  | 'loading'
  | 'loadError'
  | 'retry'
  | 'district'
  | 'allDistricts'
  | 'districtsCount'
  | 'search'
  | 'searchPlaceholder'
  | 'clearSearch'
  | 'searchIdle'
  | 'searchResults'
  | 'searchEmpty'
  | 'searchMore'
  | 'selectedObject'
  | 'closeSelected'
  | 'showOnMap'
  | 'pilotHeading'
  | 'pilotDetail'
  | 'pilotFacts'
  | 'pilotGo'
  | 'pilotNote'
  | 'groupNetwork'
  | 'groupOfficial'
  | 'groupObjects'
  | 'groupZones'
  | 'groupScans'
  | 'groupStatistics'
  | 'groupBaseMap'
  | 'groupToggle'
  | 'scannedNote'
  | 'networkNote'
  | 'officialNote'
  | 'objectsNote'
  | 'opacity'
  | 'multiply'
  | 'street'
  | 'satellite'
  | 'light'
  | 'returnToArea'
  | 'mapAria'
  | 'mapContextAll'
  | 'layersCount'
  | 'noData'
  | 'statsDistrictTitle'
  | 'statsAllTitle'
  | 'statsCanals'
  | 'statsCollectors'
  | 'statsWells'
  | 'statsTotal'
  | 'statsMeasure'
  | 'statsUnit'
  | 'statsOther'
  | 'statsDistrictNote'
  | 'statsAllNote'
  | 'itbTitle'
  | 'pilotCheckbox'
  | 'selectedPilotDetail'
  | 'referenceOnly'
  | 'noLiveReadings'
  | 'tooltipLength'
  | 'tooltipArea'
  | 'tooltipDistrict'
  | 'tooltipSource'
  | 'featureType'
  | 'featureSize'
  | 'featureParts'
  | 'featureCount'
  | 'pilotContext'
  | 'zoomIn'
  | 'zoomOut'
  | 'itbSourceNote'
  | 'sourceItb'
  | 'sourceOsm'
  | 'sourceScheme'
  | 'seasonal'
  | 'mapControls';

export type AndijanMapWords = Record<AndijanMapWord, string>;

const uz: AndijanMapWords = {
  tab: 'Andijon suv tarmog‘i',
  title: "Andijon viloyati suv tarmog'i",
  detail: 'Kanallar, zovurlar, daryolar, suv omborlari va gidroinshootlar',
  confidentiality: 'Maxfiy manba ma’lumotlari: ochiq internetga chiqarmang',
  referenceNotice:
    'Taqdim etilgan manbalardan olingan tarmoq geometriyasi: bu jonli o‘lchov emas. Skanerlangan/vektorlashtirilgan qatlamlar taxminan ±300–500 m, sxematik nuqtalar ±2–3 km, tizim hududlari ±1–3 km aniqlikda.',
  loading: 'Andijon suv tarmog‘i xaritasi yuklanmoqda',
  loadError: 'Xarita ma’lumotlarini yuklab bo‘lmadi.',
  retry: 'Qayta urinish',
  district: 'Hudud',
  allDistricts: 'Barcha tumanlar (14 ta)',
  districtsCount: 'tuman',
  search: 'Obyektni qidirish',
  searchPlaceholder: 'Kanal, zovur, quduq nomi...',
  clearSearch: 'Qidiruvni tozalash',
  searchIdle:
    '{count} nomlangan obyekt. Qidirish uchun nom yozing yoki xaritadagi obyektni bosing.',
  searchResults: 'ta natija',
  searchEmpty: 'Bu nomda obyekt topilmadi. Boshqa nom yoki qisqaroq so‘z kiriting.',
  searchMore: 'Yana {count} ta obyekt bor. Nomni aniqroq yozing.',
  selectedObject: 'Tanlangan obyekt',
  closeSelected: 'Tanlangan obyektni yopish',
  showOnMap: 'Xaritada ko‘rsatish',
  pilotHeading: 'Fayzobod kanali',
  pilotDetail:
    'Hujjatda Andijon tumani deb berilgan. KMZ konturining bir qismi xaritadagi Asaka tumani chegarasiga ham kiradi.',
  pilotFacts: '11,1 km · hujjat bo‘yicha | 10 m³/s · loyihaviy | 1 980 ga · xizmat hududi',
  pilotGo: 'Kanalga o‘tish',
  pilotNote:
    'Tajriba rejalashtirilgan. 17 ta suv chiqishi sxemada bor, ammo ularning aniq koordinatalari berilmagan.',
  groupNetwork: "Viloyat tarmog'i",
  groupOfficial: "Rasmiy ma'lumotlar",
  groupObjects: 'Suv obyektlari va inshootlar',
  groupZones: 'Chegaralar va hududlar',
  groupScans: 'Solishtirish uchun asl skanerlangan xaritalar',
  groupStatistics: 'Statistika va hisobotlar',
  groupBaseMap: 'Fon xarita',
  groupToggle: 'Bu guruhni yoqish/o‘chirish',
  scannedNote:
    'Faqat tekshirish uchun: asl rasmlar koordinatalarga bog‘langan. Tuman tanlanganda butun viloyat rasmlari yashiriladi.',
  networkNote:
    '14 ta tuman bo‘yicha KMZdan olingan kanal konturlari, zovurlar va kuzatuv quduqlari. Kanal konturlari uzunlik emas, maydon bilan ko‘rsatiladi; qatlamlar bir-birini takrorlashi mumkin.',
  officialNote: 'Asosan Baliqchi hududi bo‘yicha mavjud shapefile qatlamlari.',
  objectsNote:
    'OpenStreetMap ma’lumotiga ITB xaritasidan vektorlashtirilgan kanal, kollektor, nasos va dyuker/akveduklar qo‘shilgan (rasmiy va KMZ qatlamlari bilan takrorlanganlari olib tashlangan). Tooltip’da har bir obyekt manbasi ko‘rsatiladi; ITB xaritasidan olinganlar joylashuvi ±300–500 m taxminiy.',
  opacity: 'Shaffoflik',
  multiply: 'oq fonni yashirish',
  street: "Ko'cha",
  satellite: "Sun'iy yo'ldosh",
  light: 'Och',
  returnToArea: 'Hududga qaytish',
  mapAria: "Andijon suv tarmog'i xaritasi",
  mapContextAll: 'Barcha tumanlar',
  layersCount: 'qatlam',
  noData: 'Ma’lumot yo‘q',
  statsDistrictTitle: "bo'yicha suv tarmoqlari",
  statsAllTitle: 'Andijon viloyati tumanlari bo‘yicha suv tarmoqlari',
  statsCanals: 'Kanallar (KMZ), km',
  statsCollectors: 'Zovurlar, km',
  statsWells: 'Quduqlar',
  statsTotal: 'JAMI VILOYAT',
  statsMeasure: 'Ko‘rsatkich',
  statsUnit: 'Birlik',
  statsOther: 'Boshqa',
  statsDistrictNote:
    'Tuman chegarasi bo‘yicha kesilgan KMZ obyektlari; bir kanal qo‘shni tumanda ham davom etishi mumkin.',
  statsAllNote:
    'Manba: Google Earth KMZ (Andijon viloyati irrigatsiya va gidrogeologiya-melioratsiya tarmog‘i).',
  itbTitle: 'Irrigatsiya-melioratsiya tarmoqlari ko‘rsatkichlari (ITB)',
  pilotCheckbox: 'Pilot konturini ko‘rsatish',
  selectedPilotDetail:
    'Hujjatda: 11,1 km uzunlik, 10 m³/s loyihaviy quvvat. KMZda kanal konturi ko‘rsatilgan.',
  referenceOnly: 'Ma’lumotnoma geometriyasi',
  noLiveReadings: 'Jonli o‘qishlar ko‘rsatilmagan',
  tooltipLength: 'Uzunlik',
  tooltipArea: 'Maydon',
  tooltipDistrict: 'Tumani',
  tooltipSource: 'Manba',
  featureType: 'Obyekt turi',
  featureSize: 'O‘lchami',
  featureParts: 'bo‘lak',
  featureCount: '{count} ta',
  pilotContext: 'Fayzobod tajriba hududi',
  zoomIn: 'Kattalashtirish',
  zoomOut: 'Kichraytirish',
  itbSourceNote:
    'Manba: Norin–Qoradaryo ITB xaritasidagi jadval. GGME — gidrogeologik-melioratsiya ekspeditsiyasi, NSEAB — nasos stansiyalari boshqarmasi.',
  sourceItb: 'ITB xaritasidan vektorlashtirilgan, joylashuvi ±300–500 m taxminiy',
  sourceOsm: 'OpenStreetMap',
  sourceScheme: 'Gidrotexnik sxemadan, joylashuvi ±2–3 km taxminiy',
  seasonal: 'Mavsumiy',
  mapControls: 'Xarita boshqaruvlari',
};

const en: AndijanMapWords = {
  tab: 'Andijan water network',
  title: 'Andijan regional water network',
  detail: 'Canals, drains, rivers, reservoirs, and hydraulic structures',
  confidentiality: 'Confidential source data: do not publish',
  referenceNotice:
    'Reference network geometry from supplied sources; no live readings are shown. Approximate accuracy: scanned/vectorised layers ±300–500 m, schematic points ±2–3 km, and system zones ±1–3 km.',
  loading: 'Loading Andijan water-network map',
  loadError: 'Map data could not be loaded.',
  retry: 'Retry',
  district: 'Area',
  allDistricts: 'All districts (14)',
  districtsCount: 'districts',
  search: 'Search for an object',
  searchPlaceholder: 'Canal, drain, well name…',
  clearSearch: 'Clear search',
  searchIdle: '{count} named objects. Type a name or select an object on the map.',
  searchResults: 'results',
  searchEmpty: 'No object was found with this name. Try another name or a shorter word.',
  searchMore: '{count} more objects. Make the name more specific.',
  selectedObject: 'Selected object',
  closeSelected: 'Close selected object',
  showOnMap: 'Show on map',
  pilotHeading: 'Fayzobod canal',
  pilotDetail:
    'The document identifies it as Andijan district. Part of the KMZ contour also falls within the Asaka district boundary on the map.',
  pilotFacts: '11.1 km · according to document | 10 m³/s · design | 1,980 ha · service area',
  pilotGo: 'Go to canal',
  pilotNote:
    'The pilot is planned. The scheme shows 17 water outlets, but their exact coordinates were not supplied.',
  groupNetwork: 'Regional network',
  groupOfficial: 'Official data',
  groupObjects: 'Water objects and structures',
  groupZones: 'Boundaries and areas',
  groupScans: 'Original scanned maps for comparison',
  groupStatistics: 'Statistics and reports',
  groupBaseMap: 'Base map',
  groupToggle: 'Toggle this group',
  scannedNote:
    'For checking only: original images are georeferenced. Province-wide images are hidden when a district is selected.',
  networkNote:
    'KMZ canal contours, drains, and observation wells from 14 districts. Canal contours are shown by area, not length; layers can overlap.',
  officialNote: 'Shapefile layers available mainly for the Baliqchi area.',
  objectsNote:
    'The OpenStreetMap data includes canals, collectors, pumps, and siphon/aqueducts vectorised from the ITB map (duplicates with official and KMZ layers were removed). Each object’s source is shown in its tooltip; ITB-derived locations are approximate to ±300–500 m.',
  opacity: 'Opacity',
  multiply: 'hide white background',
  street: 'Street',
  satellite: 'Satellite',
  light: 'Light',
  returnToArea: 'Return to area',
  mapAria: 'Andijan water-network map',
  mapContextAll: 'All districts',
  layersCount: 'layers',
  noData: 'No data',
  statsDistrictTitle: 'water networks',
  statsAllTitle: 'Water networks by Andijan region districts',
  statsCanals: 'Canals (KMZ), km',
  statsCollectors: 'Drains, km',
  statsWells: 'Wells',
  statsTotal: 'REGION TOTAL',
  statsMeasure: 'Measure',
  statsUnit: 'Unit',
  statsOther: 'Other',
  statsDistrictNote:
    'KMZ objects are clipped by the district boundary; a canal can continue into a neighbouring district.',
  statsAllNote:
    'Source: Google Earth KMZ (Andijan region irrigation and hydrogeology–melioration network).',
  itbTitle: 'Irrigation and drainage network indicators (ITB)',
  pilotCheckbox: 'Show pilot contour',
  selectedPilotDetail:
    'Document: length 11.1 km, design capacity 10 m³/s. The KMZ shows the canal contour.',
  referenceOnly: 'Reference geometry',
  noLiveReadings: 'No live readings shown',
  tooltipLength: 'Length',
  tooltipArea: 'Area',
  tooltipDistrict: 'District',
  tooltipSource: 'Source',
  featureType: 'Object type',
  featureSize: 'Size',
  featureParts: 'parts',
  featureCount: '{count} items',
  pilotContext: 'Fayzobod pilot area',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  itbSourceNote:
    'Source: table on the Norin–Qoradaryo ITB map. GGME — hydrogeological and land-reclamation expedition; NSEAB — pumping-station administration.',
  sourceItb: 'Vectorised from the ITB map; location is approximate to ±300–500 m',
  sourceOsm: 'OpenStreetMap',
  sourceScheme: 'From hydraulic scheme; location is approximate to ±2–3 km',
  seasonal: 'Seasonal',
  mapControls: 'Map controls',
};

const ru: AndijanMapWords = {
  tab: 'Водная сеть Андижана',
  title: 'Водная сеть Андижанской области',
  detail: 'Каналы, коллекторы, реки, водохранилища и гидросооружения',
  confidentiality: 'Конфиденциальные исходные данные: не публиковать',
  referenceNotice:
    'Справочная геометрия сети из предоставленных источников; живые показания не отображаются. Приблизительная точность: сканированные/векторизованные слои ±300–500 м, схематические точки ±2–3 км, границы систем ±1–3 км.',
  loading: 'Загрузка карты водной сети Андижана',
  loadError: 'Не удалось загрузить данные карты.',
  retry: 'Повторить',
  district: 'Территория',
  allDistricts: 'Все районы (14)',
  districtsCount: 'районов',
  search: 'Поиск объекта',
  searchPlaceholder: 'Название канала, коллектора, скважины…',
  clearSearch: 'Очистить поиск',
  searchIdle: '{count} именованных объектов. Введите название или выберите объект на карте.',
  searchResults: 'результатов',
  searchEmpty: 'Объект с таким названием не найден. Попробуйте другое или более короткое слово.',
  searchMore: 'Ещё {count} объектов. Уточните название.',
  selectedObject: 'Выбранный объект',
  closeSelected: 'Закрыть выбранный объект',
  showOnMap: 'Показать на карте',
  pilotHeading: 'Канал Файзобод',
  pilotDetail:
    'В документе указан Андижанский район. Часть контура KMZ на карте также входит в границу Асакинского района.',
  pilotFacts: '11,1 км · по документу | 10 м³/с · проектная | 1 980 га · зона обслуживания',
  pilotGo: 'Перейти к каналу',
  pilotNote:
    'Пилот запланирован. На схеме есть 17 водовыпусков, но их точные координаты не предоставлены.',
  groupNetwork: 'Областная сеть',
  groupOfficial: 'Официальные данные',
  groupObjects: 'Водные объекты и сооружения',
  groupZones: 'Границы и территории',
  groupScans: 'Исходные сканированные карты для сравнения',
  groupStatistics: 'Статистика и отчёты',
  groupBaseMap: 'Базовая карта',
  groupToggle: 'Включить или выключить группу',
  scannedNote:
    'Только для проверки: исходные изображения имеют геопривязку. При выборе района изображения всей области скрываются.',
  networkNote:
    'Контуры каналов KMZ, коллекторы и наблюдательные скважины по 14 районам. Контуры каналов показаны по площади, а не по длине; слои могут перекрываться.',
  officialNote: 'Слои shapefile имеются преимущественно для территории Балыкчи.',
  objectsNote:
    'К данным OpenStreetMap добавлены каналы, коллекторы, насосы и дюкеры/акведуки, векторизованные с карты ИТБ (дубликаты с официальными и KMZ-слоями удалены). Источник каждого объекта указан во всплывающей подсказке; положение объектов из карты ИТБ приблизительно с точностью ±300–500 м.',
  opacity: 'Прозрачность',
  multiply: 'скрыть белый фон',
  street: 'Улицы',
  satellite: 'Спутник',
  light: 'Светлая',
  returnToArea: 'Вернуться к территории',
  mapAria: 'Карта водной сети Андижана',
  mapContextAll: 'Все районы',
  layersCount: 'слоёв',
  noData: 'Нет данных',
  statsDistrictTitle: 'водные сети',
  statsAllTitle: 'Водные сети по районам Андижанской области',
  statsCanals: 'Каналы (KMZ), км',
  statsCollectors: 'Коллекторы, км',
  statsWells: 'Скважины',
  statsTotal: 'ИТОГО ПО ОБЛАСТИ',
  statsMeasure: 'Показатель',
  statsUnit: 'Единица',
  statsOther: 'Другие',
  statsDistrictNote:
    'Объекты KMZ обрезаны границей района; канал может продолжаться в соседнем районе.',
  statsAllNote:
    'Источник: Google Earth KMZ (ирригационная и гидрогеолого-мелиоративная сеть Андижанской области).',
  itbTitle: 'Показатели ирригационно-мелиоративных сетей (ИТБ)',
  pilotCheckbox: 'Показать контур пилота',
  selectedPilotDetail:
    'По документу: длина 11,1 км, проектная пропускная способность 10 м³/с. В KMZ показан контур канала.',
  referenceOnly: 'Справочная геометрия',
  noLiveReadings: 'Живые показания не отображаются',
  tooltipLength: 'Длина',
  tooltipArea: 'Площадь',
  tooltipDistrict: 'Район',
  tooltipSource: 'Источник',
  featureType: 'Тип объекта',
  featureSize: 'Размер',
  featureParts: 'частей',
  featureCount: '{count} шт.',
  pilotContext: 'Пилотная территория Файзобод',
  zoomIn: 'Увеличить',
  zoomOut: 'Уменьшить',
  itbSourceNote:
    'Источник: таблица карты Норин–Карадарьинского ИТБ. ГГМЭ — гидрогеолого-мелиоративная экспедиция; НСЭАБ — управление насосных станций.',
  sourceItb: 'Векторизовано по карте ИТБ; положение приблизительно с точностью ±300–500 м',
  sourceOsm: 'OpenStreetMap',
  sourceScheme: 'По гидротехнической схеме; положение приблизительно с точностью ±2–3 км',
  seasonal: 'Сезонный',
  mapControls: 'Элементы управления картой',
};

export const andijanMapWords: Record<Locale, AndijanMapWords> = { uz, ru, en };

export type AndijanMapLayerId =
  | 'pilot'
  | 'kmz_canals'
  | 'kmz_lines'
  | 'kollektor_xa'
  | 'quduq'
  | 'kak'
  | 'aro'
  | 'ich'
  | 'tuman'
  | 'itb'
  | 'systems'
  | 'adir'
  | 'o_river'
  | 'o_canal'
  | 'o_ditch'
  | 'o_drain'
  | 'o_stream'
  | 'o_dam'
  | 'o_lake'
  | 'o_pond'
  | 'o_ww'
  | 'o_pt';

/** Display labels only. Model LAYERS keeps the supplied Uzbek source literals. */
export const andijanMapLayerLabels: Record<Locale, Record<AndijanMapLayerId, string>> = {
  uz: {
    pilot: 'Pilot konturini ko‘rsatish',
    kmz_canals: 'Nomlangan kanallar (KMZ)',
    kmz_lines: "Qo'lda chizilgan kanal izlari (KMZ)",
    kollektor_xa: "Xo'jaliklararo zovurlar",
    quduq: 'Gidrogeologik kuzatuv quduqlari',
    kak: 'Katta Andijon kanali (BAK)',
    aro: "Xo'jaliklararo kanallar (shapefile)",
    ich: "Xo'jalik ichi kanallari (shapefile)",
    tuman: 'Tuman chegaralari',
    itb: 'ITB hududlari',
    systems: "Sug'orish tizimlari (tarixiy sxema, taxminiy)",
    adir: "Adir yerlar (o'zlashtirilmagan)",
    o_river: 'Daryo va soylar',
    o_canal: 'Kanallar (OSM + ITB xaritasi)',
    o_ditch: 'Ariqlar va tarmoq kanallari',
    o_drain: 'Zovur / kollektorlar (OSM + ITB)',
    o_stream: 'Sel va kichik oqimlar',
    o_dam: "To'g'on va to'siqlar",
    o_lake: "Suv omborlari, ko'l va suv havzalari",
    o_pond: 'Hovuzlar',
    o_ww: 'Oqava suv havzalari',
    o_pt: 'Inshootlar (nasos, gidrouzel, GES, minora…)',
  },
  en: {
    pilot: 'Show pilot contour',
    kmz_canals: 'Named canals (KMZ)',
    kmz_lines: 'Manually drawn canal traces (KMZ)',
    kollektor_xa: 'Inter-farm drains',
    quduq: 'Hydrogeological observation wells',
    kak: 'Greater Andijan canal (GAC)',
    aro: 'Inter-farm canals (shapefile)',
    ich: 'On-farm canals (shapefile)',
    tuman: 'District boundaries',
    itb: 'ITB areas',
    systems: 'Irrigation systems (historic scheme, approximate)',
    adir: 'Adir lands (undeveloped)',
    o_river: 'Rivers and streams',
    o_canal: 'Canals (OSM + ITB map)',
    o_ditch: 'Ditches and network canals',
    o_drain: 'Drains / collectors (OSM + ITB)',
    o_stream: 'Runoff and minor streams',
    o_dam: 'Dams and barriers',
    o_lake: 'Reservoirs, lakes, and water bodies',
    o_pond: 'Ponds',
    o_ww: 'Wastewater ponds',
    o_pt: 'Structures (pumps, hydro nodes, small HPP, towers…)',
  },
  ru: {
    pilot: 'Показать контур пилота',
    kmz_canals: 'Именованные каналы (KMZ)',
    kmz_lines: 'Нарисованные вручную следы каналов (KMZ)',
    kollektor_xa: 'Межхозяйственные коллекторы',
    quduq: 'Гидрогеологические наблюдательные скважины',
    kak: 'Большой Андижанский канал (БАК)',
    aro: 'Межхозяйственные каналы (shapefile)',
    ich: 'Внутрихозяйственные каналы (shapefile)',
    tuman: 'Границы районов',
    itb: 'Территории ИТБ',
    systems: 'Оросительные системы (историческая схема, приблизительно)',
    adir: 'Адырные земли (неосвоенные)',
    o_river: 'Реки и ручьи',
    o_canal: 'Каналы (OSM + карта ИТБ)',
    o_ditch: 'Арыки и сетевые каналы',
    o_drain: 'Дренажи / коллекторы (OSM + ИТБ)',
    o_stream: 'Селевые и малые водотоки',
    o_dam: 'Плотины и препятствия',
    o_lake: 'Водохранилища, озёра и водоёмы',
    o_pond: 'Пруды',
    o_ww: 'Пруды сточных вод',
    o_pt: 'Сооружения (насосы, гидроузлы, малые ГЭС, башни…)',
  },
};

export type AndijanMapPointId =
  | 'pump'
  | 'tower'
  | 'works'
  | 'sewage'
  | 'tank'
  | 'well'
  | 'dam'
  | 'fall'
  | 'dyuker'
  | 'gu'
  | 'head'
  | 'ges'
  | 'post';

export const andijanMapPointLabels: Record<Locale, Record<AndijanMapPointId, string>> = {
  uz: {
    pump: 'Nasos stansiyasi',
    tower: 'Suv minorasi',
    works: 'Suv tozalash / inshoot',
    sewage: 'Oqava suv tozalash',
    tank: "Suv sig'imi (rezervuar)",
    well: "Kuzatuv qudug'i",
    dam: "To'g'on / to'siq",
    fall: 'Sharshara',
    dyuker: 'Dyuker / akveduk',
    gu: 'Gidrouzel',
    head: 'Bosh inshoot',
    ges: 'GES (kichik)',
    post: 'Post',
  },
  en: {
    pump: 'Pump station',
    tower: 'Water tower',
    works: 'Water treatment / structure',
    sewage: 'Wastewater treatment',
    tank: 'Water storage (reservoir)',
    well: 'Observation well',
    dam: 'Dam / barrier',
    fall: 'Waterfall',
    dyuker: 'Siphon / aqueduct',
    gu: 'Hydraulic node',
    head: 'Headworks',
    ges: 'Small hydropower plant',
    post: 'Post',
  },
  ru: {
    pump: 'Насосная станция',
    tower: 'Водонапорная башня',
    works: 'Очистка воды / сооружение',
    sewage: 'Очистка сточных вод',
    tank: 'Водохранилище (резервуар)',
    well: 'Наблюдательная скважина',
    dam: 'Плотина / препятствие',
    fall: 'Водопад',
    dyuker: 'Дюкер / акведук',
    gu: 'Гидроузел',
    head: 'Головное сооружение',
    ges: 'Малая ГЭС',
    post: 'Пост',
  },
};
