import type { Locale } from '@isuv/i18n';

const en = {
  view: 'Map view',
  pdf: 'Andijan · detailed map',
  irrigation: 'Andijan · irrigation areas',
  savay: 'Savay · local detail',
  find: 'Zoom to a district or place',
  all: 'Whole map',
  hint: 'Click a district name or any part of the map to zoom in. Drag to move.',
  reference: 'Original supplied map · not live telemetry',
  fidelity:
    'Original PDF linework and labels preserved. Locations are on the source page, not surveyed GPS coordinates. Historical names are retained.',
  raster:
    'Original supplied image. Fine detail is limited by its source resolution; this is not surveyed GIS.',
  selection: 'Map detail',
  districts: 'Districts',
  features: 'Places and water features',
  sourceLabel: 'On the source map',
  noLive: 'Reference location only. No live readings or operating status supplied.',
  failed: 'The source map could not load.',
  retry: 'Retry map',
  open: 'Open original map',
  loading: 'Loading detailed map…',
  related: 'Explore Savay detail',
  notice: 'Map notes',
};
type Words = { [K in keyof typeof en]: string };
const ru: Words = {
  view: 'Вид карты',
  pdf: 'Андижан · подробная карта',
  irrigation: 'Андижан · зоны орошения',
  savay: 'Савай · местная карта',
  find: 'Приблизить район или объект',
  all: 'Вся карта',
  hint: 'Нажмите на название района или любое место карты для приближения. Перетаскивайте для перемещения.',
  reference: 'Предоставленная исходная карта · не текущая телеметрия',
  fidelity:
    'Сохранены исходные линии и надписи PDF. Позиции относятся к странице, не к измеренным GPS-координатам. Исторические названия сохранены.',
  raster:
    'Предоставленное исходное изображение. Детализация ограничена его разрешением; это не точная ГИС.',
  selection: 'Объект карты',
  districts: 'Районы',
  features: 'Места и водные объекты',
  sourceLabel: 'На исходной карте',
  noLive:
    'Только справочное местоположение. Текущие показания и рабочее состояние не предоставлены.',
  failed: 'Не удалось загрузить исходную карту.',
  retry: 'Повторить загрузку',
  open: 'Открыть исходную карту',
  loading: 'Загрузка подробной карты…',
  related: 'Открыть карту Савая',
  notice: 'О карте',
};
const uz: Words = {
  view: 'Xarita ko‘rinishi',
  pdf: 'Andijon · batafsil xarita',
  irrigation: 'Andijon · sug‘orish hududlari',
  savay: 'Savay · mahalliy xarita',
  find: 'Tuman yoki joyni yaqinlashtirish',
  all: 'Butun xarita',
  hint: 'Yaqinlashtirish uchun tuman nomi yoki xaritaning istalgan joyini bosing. Siljitish uchun suring.',
  reference: 'Taqdim etilgan asl xarita · jonli telemetriya emas',
  fidelity:
    'PDFning asl chiziqlari va yozuvlari saqlangan. Joylashuvlar sahifaga tegishli, o‘lchangan GPS koordinatalari emas. Tarixiy nomlar saqlangan.',
  raster:
    'Taqdim etilgan asl rasm. Tafsilotlar asl rasm aniqligi bilan cheklangan; bu aniq GIS emas.',
  selection: 'Xarita tafsiloti',
  districts: 'Tumanlar',
  features: 'Joylar va suv obyektlari',
  sourceLabel: 'Asl xaritadagi yozuv',
  noLive: 'Faqat ma’lumot uchun joylashuv. Jonli o‘lchovlar yoki ish holati berilmagan.',
  failed: 'Asl xarita yuklanmadi.',
  retry: 'Qayta yuklash',
  open: 'Asl xaritani ochish',
  loading: 'Batafsil xarita yuklanmoqda…',
  related: 'Savay tafsilotlarini ochish',
  notice: 'Xarita haqida',
};
export const sourceMapWords: Record<Locale, Words> = { en, ru, uz };
