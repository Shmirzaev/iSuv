/** Visual reference detail digitized from the named source previews, in image pixels.
 * No landmark is a registered device, an observation, or a surveyed position.
 */
export type AtlasLandmark = {
  id: string;
  name: string;
  sourceLabel: string;
  kind: 'settlement' | 'pump' | 'point';
  at: [number, number];
  major: boolean;
};
type PlaceRow = [string, string, number, number, boolean?];
const places = (rows: PlaceRow[]): AtlasLandmark[] =>
  rows.map(([name, sourceLabel, x, y, major], index) => ({
    id: `place-${index}`,
    name,
    sourceLabel,
    at: [x, y],
    major: major ?? false,
    kind: 'settlement',
  }));
export const atlasDetail: Record<
  'andijan' | 'savay',
  {
    source: string;
    landmarks: AtlasLandmark[];
    roads: string[];
    lakes: { name: string; label: [number, number]; path: string }[];
  }
> = {
  andijan: {
    source: 'andijan-irrigation',
    landmarks: places([
      ['Andijon', 'Андижон', 586, 427, true],
      ['Asaka', 'Асака', 461, 530, true],
      ['Shahrixon', 'Шаҳрихон', 411, 413, true],
      ['Baliqchi', 'Балиқчи', 291, 220, true],
      ['Ulug‘nor', 'Улуғнор', 163, 272, true],
      ['Izboskan', 'Избоскан', 548, 302, true],
      ['Paxtaobod', 'Пахтаобод', 708, 316, true],
      ['Oltinko‘l', 'Олтинкўл', 490, 375, true],
      ['Jalalquduq', 'Жалалқудуқ', 786, 503, true],
      ['Xo‘jaobod', 'Хўжаобод', 644, 567, true],
      ['Buloqboshi', 'Булоқбоши', 603, 602],
      ['Marhamat', 'Марҳамат', 491, 656, true],
      ['Qo‘rg‘ontepa', 'Қўрғонтепа', 799, 597, true],
      ['Bo‘z', 'Бўз', 274, 390],
      ['Qorasuv', 'Қорасув', 877, 626],
      ['Namangan', 'Наманган', 264, 99, true],
    ]),
    roads: [
      'M39 99 L169 107 L281 77 L324 92 L369 86 L413 104 L482 94 L524 109 L541 208 L530 270 L533 340 L574 370 L591 430 L612 468 L665 522 L737 575 L794 601 L868 610 L952 600',
      'M94 297 L194 287 L275 302 L351 312 L386 359 L410 414 L461 530 L490 578 L492 656',
      'M276 389 L351 408 L412 414 L473 387 L490 375 L576 376 L659 352 L708 316 L752 317 L785 307',
      'M338 657 L403 640 L461 530 L526 510 L587 485 L644 568 L602 603 L491 656',
      'M528 872 L530 765 L592 685 L644 567 L703 575 L799 597 L878 626 L990 705',
      'M582 427 L622 401 L687 427 L737 477 L786 503 L842 544 L899 561 L965 597',
    ],
    lakes: [
      {
        name: 'Andijon suv ombori',
        label: [1064, 609] as [number, number],
        path: 'M971 590 C995 596 1009 580 1034 584 C1063 582 1092 585 1111 598 Q1124 612 1103 619 Q1092 631 1108 646 Q1107 664 1083 653 L1061 639 Q1046 622 1033 640 Q1015 666 1005 645 L1005 623 Q982 620 971 609 Z',
      },
      {
        name: 'Karkidon',
        label: [363, 644] as [number, number],
        path: 'M345 621 Q369 611 384 625 L379 637 L398 650 Q379 664 365 647 L349 643 Z',
      },
      {
        name: 'Nayman',
        label: [500, 843] as [number, number],
        path: 'M465 814 Q482 809 485 820 L510 827 Q512 845 494 845 L487 832 L461 830 Z',
      },
    ],
  },
  savay: {
    source: 'savay-area',
    landmarks: [
      ...places([
        ['Qo‘rg‘ontepa', 'КУРГОНТЕПА', 801, 94, true],
        ['Savay', 'Савай', 1116, 171, true],
        ['Mustaqillik', 'Мустакиллик', 912, 175, true],
        ['R. Boboxonov', 'Р.Бобохонов', 706, 155],
        ['Chorvador', 'Чорвадор', 786, 245],
        ['Yangi Bo‘ston', 'Янги-Бустон', 576, 240, true],
        ['Keshar', 'Кешар', 518, 137],
        ['Obodon', 'Обадан', 452, 203],
        ['G‘alaba', 'Галаба', 461, 322],
        ['Qo‘shtepa', 'Коштепа', 415, 419, true],
        ['Haqiqat', 'Хакикат', 725, 397, true],
        ['Paxtafront', 'Пахтафронт', 802, 384],
        ['Guliston', 'Гулистон', 247, 430, true],
        ['Salpi', 'Салпи', 242, 525],
        ['Egamberdiboy', 'Эгамбердибой', 390, 502, true],
        ['Besh tol', 'Бештол', 613, 539],
        ['Yorqishloq', 'Ёркишлок', 658, 516],
        ['Manak', 'Манак', 460, 580, true],
        ['Beshkovok', 'Бешковок', 256, 590],
        ['Karnaychi', 'Карнайчи', 398, 619],
        ['Elchibek', 'Элчибек', 353, 650],
        ['Chilchibod', 'Чилчибод', 508, 653],
        ['Turabobod', 'Турабобод', 716, 651],
        ['O‘qchi', 'Окчи', 730, 631],
        ['Uymavut', 'Уймаут', 262, 697, true],
        ['Bo‘ston', 'Бустон', 338, 725],
        ['Arday', 'Ардай', 429, 728],
        ['Tashat', 'Ташат', 290, 794],
        ['Imomota', 'Имамота', 313, 846],
        ['Qurpa', 'Курпа', 790, 724],
      ]),
      {
        id: 'pump-savay-1',
        name: 'Savay 1',
        sourceLabel: 'НС Савай 1',
        kind: 'pump',
        at: [860, 255],
        major: true,
      },
      {
        id: 'pump-savay-2',
        name: 'Savay 2',
        sourceLabel: 'НС Савай 2',
        kind: 'pump',
        at: [802, 400],
        major: true,
      },
      {
        id: 'pump-orom',
        name: 'Orom (Istiqlol)',
        sourceLabel: 'НС Ором (Истиклол)',
        kind: 'pump',
        at: [455, 491],
        major: true,
      },
      ...(
        [
          [904, 81],
          [741, 79],
          [704, 86],
          [671, 119],
          [763, 283],
          [497, 494],
          [527, 526],
          [555, 449],
          [587, 408],
          [675, 558],
          [657, 330],
          [724, 341],
          [718, 298],
          [822, 299],
          [872, 353],
          [449, 468],
          [322, 342],
          [342, 320],
          [365, 298],
          [433, 402],
          [451, 642],
          [433, 610],
          [396, 569],
          [269, 561],
          [214, 492],
          [355, 400],
          [498, 618],
          [308, 605],
          [568, 554],
          [270, 370],
          [221, 536],
          [321, 375],
          [462, 555],
        ] as [number, number][]
      ).map((at, index): AtlasLandmark => ({
        id: `point-${index + 1}`,
        name: String(index + 1),
        sourceLabel: String(index + 1),
        kind: 'point',
        at,
        major: false,
      })),
    ],
    roads: [
      'M120 189 L215 212 L295 235 L398 235 L452 203 L518 137 L598 129 L698 105 L801 94 L856 128 L912 175 L1018 178 L1116 171',
      'M280 37 L303 95 L400 76 L484 83 L548 97 L578 155 L619 218 L576 240 L612 283 L644 361 L679 414 L659 516 L614 539 L642 600 L715 651',
      'M439 232 L451 286 L461 322 L415 367 L415 419 L448 460 L485 482 L500 532 L460 580 L465 638 L429 728 L437 785',
      'M817 74 L814 149 L790 188 L786 245 L812 283 L796 331 L802 384 L798 463 L784 491 L758 538 L764 591 L790 724',
      'M342 276 L381 300 L404 345 L354 357 L319 401 L279 457 L242 525 L257 566 L256 590 L264 634 L262 697 L280 751 L290 794 L313 846',
      'M161 515 L198 510 L236 504 L278 505 L340 495 L390 502 L446 515 L507 544 L549 574 L614 579 L654 599 L714 625',
      'M206 640 L256 621 L302 627 L353 650 L398 619 L460 580 L523 579 L563 611 L609 628 L667 634 L715 651',
      'M324 772 L335 725 L380 699 L429 728 L470 688 L508 653 L556 660 L598 637',
      'M924 274 L884 303 L865 338 L840 366 L802 384 L760 379 L725 397 L685 401 L644 361',
      'M978 89 L961 133 L962 181 L971 231 M725 78 L704 151 L728 210 L725 261 M1074 266 L1044 303 L994 283',
    ],
    lakes: [],
  },
};

export function visibleLandmarks(
  scene: 'andijan' | 'savay',
  zoomed: boolean,
  towns: boolean,
  pumps: boolean,
  points: boolean,
) {
  return atlasDetail[scene].landmarks.filter((item) =>
    item.kind === 'point' ? points : item.kind === 'pump' ? pumps : towns && (item.major || zoomed),
  );
}
