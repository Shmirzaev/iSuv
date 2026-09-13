/** Illustration-space paths traced approximately from supplied raster maps.
 * These are NOT longitude/latitude, cadastral boundaries, or an accounting graph.
 * Pixel coordinates always refer to the source image named by each scene.
 */
export type AtlasArea = {
  id: string;
  name: string;
  path: string;
  label: [number, number];
  bounds: [number, number, number, number];
  color: string;
};
export type AtlasWaterway = {
  id: string;
  name: string;
  path: string;
  label: [number, number];
  areas: string[];
  register?: 'savay' | 'oqbura';
  minor?: boolean;
};
export type AtlasScene = {
  id: 'andijan' | 'savay';
  name: string;
  source: string;
  width: number;
  height: number;
  areas: AtlasArea[];
  waterways: AtlasWaterway[];
};

export const andijanScene: AtlasScene = {
  id: 'andijan',
  name: 'Andijon',
  source: 'andijan-irrigation',
  width: 1280,
  height: 870,
  areas: [
    {
      id: 'ulugnor',
      name: 'Ulug‘nor · Mazgilsoy',
      color: '#e6ca66',
      label: [290, 310],
      bounds: [55, 180, 550, 330],
      path: 'M60 256 L95 217 L176 194 L237 222 L280 207 L339 227 L386 273 L400 315 L473 350 L536 370 L576 394 L519 431 L399 432 L324 492 L234 462 L193 404 L72 382 Z',
    },
    {
      id: 'qoradaryo',
      name: 'Qoradaryo · Maylisoy',
      color: '#9eb9cb',
      label: [566, 290],
      bounds: [350, 125, 455, 290],
      path: 'M381 263 L428 248 L458 229 L469 265 L536 200 L569 236 L622 181 L707 145 L686 214 L715 271 L747 312 L752 391 L674 359 L617 344 L576 371 L492 354 L432 331 L400 305 Z',
    },
    {
      id: 'andijonsoy',
      name: 'Andijonsoy',
      color: '#b6d685',
      label: [752, 490],
      bounds: [500, 335, 495, 300],
      path: 'M535 376 L580 369 L617 346 L674 352 L736 390 L757 430 L821 460 L881 478 L932 542 L973 600 L914 582 L875 601 L802 570 L725 542 L679 505 L614 490 L566 474 L522 489 L516 434 Z',
    },
    {
      id: 'shahrixon',
      name: 'Shahrixonsoy',
      color: '#e9adb2',
      label: [492, 563],
      bounds: [305, 405, 645, 310],
      path: 'M396 427 L442 416 L502 432 L522 487 L582 494 L646 510 L685 537 L719 558 L790 579 L875 601 L915 580 L943 603 L865 614 L792 597 L735 604 L694 595 L671 633 L641 651 L589 636 L553 665 L506 685 L457 689 L414 668 L383 625 L394 580 L419 549 L375 513 L323 506 Z',
    },
    {
      id: 'savay-area',
      name: 'Savay · Oqbura-soy',
      color: '#c8bf77',
      label: [741, 651],
      bounds: [545, 575, 380, 185],
      path: 'M584 635 L640 650 L667 614 L691 598 L732 606 L788 593 L858 612 L887 603 L855 641 L801 650 L767 666 L742 700 L710 692 L692 680 L659 688 L627 674 Z',
    },
  ],
  waterways: [
    {
      id: 'qoradaryo',
      name: 'Qoradaryo',
      path: 'M974 602 L949 556 L915 506 L860 465 L803 444 L752 413 L697 371 L653 349 L611 348 L583 370 L538 379 L485 362 L439 358 L407 335 L390 293 L374 259 L344 221 L285 199 L238 219 L176 190',
      label: [848, 449],
      areas: ['qoradaryo', 'andijonsoy', 'ulugnor'],
    },
    {
      id: 'maylisoy',
      name: 'Maylisoy',
      path: 'M712 140 L681 202 L663 253 L627 294 L600 340 L582 370',
      label: [652, 241],
      areas: ['qoradaryo'],
    },
    {
      id: 'shahrixonsoy',
      name: 'Shahrixonsoy',
      path: 'M972 602 L913 615 L850 608 L790 585 L728 583 L676 566 L605 572 L541 564 L488 550 L447 517 L421 474',
      label: [577, 552],
      areas: ['shahrixon', 'savay-area'],
    },
    {
      id: 'andijonsoy',
      name: 'Andijonsoy',
      path: 'M959 587 L905 560 L851 552 L794 539 L735 515 L690 487 L635 441 L603 408 L593 384',
      label: [775, 529],
      areas: ['andijonsoy'],
    },
    {
      id: 'savay',
      name: 'Savay',
      path: 'M922 619 L866 629 L807 627 L742 634 L694 650 L659 659',
      label: [789, 642],
      areas: ['savay-area'],
      register: 'savay',
    },
    {
      id: 'oqbura',
      name: 'Oqbura-soy',
      path: 'M792 720 L770 680 L743 650 L715 627 L698 600',
      label: [813, 700],
      areas: ['savay-area'],
      register: 'oqbura',
    },
    {
      id: 'mazgilsoy',
      name: 'Mazgilsoy',
      path: 'M430 349 L368 355 L322 358 L266 383 L201 403 L146 412 L100 439',
      label: [246, 400],
      areas: ['ulugnor'],
    },
    {
      id: 'naryn',
      name: 'Norin',
      path: 'M487 78 C442 112 428 141 384 151 S318 156 291 174 S215 198 176 190',
      label: [325, 155],
      areas: ['ulugnor', 'qoradaryo'],
    },
    {
      id: 'south-fergana',
      name: 'Janubiy Farg‘ona kanali',
      path: 'M698 599 C664 615 647 642 617 656 S567 671 522 667 S448 688 407 667 L351 642',
      label: [543, 692],
      areas: ['shahrixon', 'savay-area'],
      minor: true,
    },
    {
      id: 'aravonsoy',
      name: 'Aravonsoy',
      path: 'M718 706 Q685 689 654 679 T595 646 Q578 635 573 610',
      label: [621, 719],
      areas: ['savay-area', 'shahrixon'],
      minor: true,
    },
  ],
};

export const savayScene: AtlasScene = {
  id: 'savay',
  name: 'Savay · Oqbura-soy',
  source: 'savay-area',
  width: 1280,
  height: 905,
  areas: [
    {
      id: 'qorgontepa',
      name: 'Qo‘rg‘ontepa',
      color: '#bbd5b0',
      label: [766, 180],
      bounds: [310, 30, 830, 470],
      path: 'M324 311 L352 267 L419 226 L483 153 L551 112 L685 70 L839 38 L953 67 L1090 84 L1134 83 L1136 180 L1103 265 L1002 251 L942 253 L868 247 L801 262 L736 281 L666 321 L601 366 L565 383 L526 424 L454 490 L400 428 L354 377 Z',
    },
    {
      id: 'jalalquduq',
      name: 'Jalalquduq',
      color: '#e2afb3',
      label: [666, 385],
      bounds: [302, 242, 625, 380],
      path: 'M326 312 L364 350 L402 429 L456 490 L525 421 L570 381 L604 366 L666 321 L737 281 L803 262 L867 247 L921 254 L891 291 L895 333 L915 355 L876 389 L848 471 L813 535 L793 595 L755 609 L704 579 L638 568 L564 551 L503 522 L453 491 L375 424 L306 342 Z',
    },
    {
      id: 'xojaobod',
      name: 'Xo‘jaobod',
      color: '#a9cbdc',
      label: [370, 655],
      bounds: [147, 345, 675, 510],
      path: 'M307 346 L368 422 L453 491 L503 523 L562 551 L638 568 L704 580 L755 609 L795 664 L811 711 L775 740 L751 679 L705 681 L670 704 L637 731 L612 707 L586 659 L548 688 L555 750 L508 789 L451 805 L397 764 L351 780 L299 854 L265 788 L220 768 L172 722 L151 686 L172 612 L167 503 L179 445 L239 402 Z',
    },
  ],
  waterways: [
    {
      id: 'savay',
      name: 'Savay',
      path: 'M1258 229 L1190 268 L1150 275 L1089 266 L1005 252 L943 254 L909 248 L866 247 L803 262 L737 281 L666 321 L606 365 L570 382 L527 422 L453 491 L429 542 L417 588',
      label: [562, 399],
      areas: ['qorgontepa', 'jalalquduq', 'xojaobod'],
      register: 'savay',
    },
    {
      id: 'oqbura',
      name: 'Oqbura-soy',
      path: 'M305 320 L328 365 L372 417 L454 491 L505 523 L565 551 L639 569 L705 588 L758 621 L794 667 L833 707 L865 741 L899 805',
      label: [853, 727],
      areas: ['jalalquduq', 'xojaobod'],
      register: 'oqbura',
    },
    {
      id: 'shahrixonsoy',
      name: 'Shahrixonsoy',
      path: 'M17 223 L69 258 L118 278 L178 298 L244 309 L302 303 L347 264 L416 228 L479 165 L551 114 L687 75 L840 36 L956 71 L1089 85 L1195 74 L1257 46',
      label: [963, 59],
      areas: ['qorgontepa'],
    },
    {
      id: 'south-fergana',
      name: 'Janubiy Farg‘ona kanali',
      path: 'M17 716 L60 718 L112 695 L146 698 L157 655 L153 594 L169 535 L169 482 L182 446 L227 410 L271 368 L304 321',
      label: [180, 453],
      areas: ['xojaobod', 'jalalquduq'],
    },
    {
      id: 'mashkanal',
      name: 'Mashkanal',
      path: 'M864 254 L873 323 L879 380 L804 399 L749 420 L691 454 L629 480 L562 517 L541 536',
      label: [709, 461],
      areas: ['jalalquduq'],
    },
    {
      id: 'kuyukmozor',
      name: 'Kuyukmozor',
      path: 'M747 334 L755 407 L722 450 L718 514 L706 564 L735 607',
      label: [764, 521],
      areas: ['jalalquduq'],
    },
    {
      id: 'rob don',
      name: 'Robdon 1',
      path: 'M798 647 L749 628 L693 608 L637 599 L557 608 L485 608 L424 619 L371 647 L333 655',
      label: [554, 594],
      areas: ['xojaobod'],
    },
    {
      id: 'yangi-nishob',
      name: 'Yangi Nishob',
      path: 'M421 542 L411 570 L356 580 L317 585 L279 577',
      label: [344, 566],
      areas: ['xojaobod'],
    },
    {
      id: 'salpi',
      name: 'Solpi',
      path: 'M220 452 Q234 473 234 500 L253 529 L267 550 Q281 565 282 578',
      label: [272, 516],
      areas: ['xojaobod'],
      minor: true,
    },
    {
      id: 'beshtol',
      name: 'Besh tol',
      path: 'M588 454 Q604 489 608 527 L630 549 Q659 565 685 591 L722 604 L755 628 L791 649',
      label: [663, 578],
      areas: ['jalalquduq', 'xojaobod'],
      minor: true,
    },
    {
      id: 'kandva',
      name: 'Kandva',
      path: 'M384 712 Q412 690 452 673 L488 652 Q515 633 550 622',
      label: [411, 690],
      areas: ['xojaobod'],
      minor: true,
    },
    {
      id: 'chilpi',
      name: 'Chilpi shod',
      path: 'M556 657 L584 634 Q612 631 635 640 L671 645 Q695 633 738 646',
      label: [600, 660],
      areas: ['xojaobod'],
      minor: true,
    },
    {
      id: 'kattastroy',
      name: 'Kattastroy tashlamasi',
      path: 'M1091 82 Q1083 116 1085 146 L1080 192 L1072 258',
      label: [1098, 219],
      areas: ['qorgontepa'],
      minor: true,
    },
  ],
};

export function viewForArea(area: AtlasArea): [number, number, number, number] {
  const [x, y, width, height] = area.bounds;
  return [x - 40, y - 40, width + 80, height + 80];
}

/** Round drawn river elbows only. Does not alter the stored source tracing or infer direction. */
export function displayWaterwayPath(path: string): string {
  if (/[^ML\d\s.,-]/.test(path)) return path;
  const points = Array.from(
    path.matchAll(/[ML]\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/g),
    (match) => [Number(match[1]), Number(match[2])] as const,
  );
  if (points.length < 3) return path;
  let result = `M${points[0]![0]} ${points[0]![1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const current = points[i]!,
      before = points[i - 1]!,
      after = points[i + 1]!;
    const x1 = current[0] + (before[0] - current[0]) * 0.16;
    const y1 = current[1] + (before[1] - current[1]) * 0.16;
    const x2 = current[0] + (after[0] - current[0]) * 0.16;
    const y2 = current[1] + (after[1] - current[1]) * 0.16;
    result += ` L${x1} ${y1} Q${current[0]} ${current[1]} ${x2} ${y2}`;
  }
  return `${result} L${points.at(-1)![0]} ${points.at(-1)![1]}`;
}
