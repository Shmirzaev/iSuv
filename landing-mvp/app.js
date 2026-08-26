(() => {
  'use strict';

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const mapRange = (value, inMin, inMax, outMin = 0, outMax = 1) => {
    const normalized = clamp((value - inMin) / (inMax - inMin));
    return outMin + (outMax - outMin) * normalized;
  };
  const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const setOpacity = (element, value) => { if (element) element.style.opacity = String(clamp(value)); };
  const safeStorage = {
    get(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { window.localStorage.setItem(key, value); } catch { /* hardened browser */ } }
  };

  const body = document.body;
  const story = document.querySelector('.story');
  const network = document.getElementById('networkScene');
  const focusRing = document.getElementById('focusRing');
  const inspector = document.getElementById('inspector');
  const dashboard = document.getElementById('dashboard');
  const alarmCard = document.getElementById('alarmCard');
  const topbar = document.getElementById('topbar');
  const progressFill = document.getElementById('storyProgressFill');
  const storyStep = document.getElementById('storyStep');
  const storyTitle = document.getElementById('storyTitle');
  const storyDescription = document.getElementById('storyDescription');
  const indexItems = [...document.querySelectorAll('.story__index span')];
  const flowPaths = [...document.querySelectorAll('.flow-path')];
  const motionToggle = document.getElementById('motionToggle');
  const motionLabel = motionToggle?.querySelector('.motion-toggle__label');

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let motionEnabled = !reducedMotionQuery.matches && safeStorage.get('isuv-motion') !== 'off';
  let targetProgress = 0;
  let displayProgress = 0;
  let activeStep = -1;
  let ticking = 0;
  let currentLanguage = 'uz';

  const languageCopy = {
    uz: {
      title: 'iSuv — Har bir kub metr nazorat ostida',
      description: 'iSuv — hududiy suv operatsiyalari, hisob, monitoring va qaror qabul qilish platformasi.',
      motionOn: 'Motion yoqilgan', motionOff: 'Motion o‘chirilgan', motionOnAria: 'Animatsiyani yoqish', motionOffAria: 'Animatsiyani o‘chirish',
      skip: 'Asosiy kontentga o‘tish', nav: ['Platforma', 'Tarmoq', 'Monitoring', 'Xavfsizlik'], cta: 'Platformani ko‘rish',
      heroEyebrow: 'HUDUDIY SUV OPERATSIYALARI PLATFORMASI',
      heroTitle: 'Har bir kub metr —<br><span>nazorat ostida.</span>',
      heroLead: 'iSuv jonli o‘lchovlarni suv tarmog‘i bo‘yicha tushunadi, tasdiqlangan reja bilan solishtiradi va muhim og‘ishlarni vaqtida ko‘rsatadi.',
      heroPrimary: 'Suv oqimini kuzatish', heroSecondary: 'Jonli monitoringni ko‘rish',
      telemetry: [['Monitoring nuqtasi', '83'], ['Jonli telemetriya', '24/7'], ['Tillar', 'UZ · RU · EN']], scroll: 'Oqimni kuzatish uchun pastga suring',
      steps: [
        ['01 / 05', 'Butun tarmoqning jonli ishlashini ko‘ring.', 'Bitta hududiy manzara daryo, bosh kanal, tarmoqlar, stansiyalar va sensorlarni 83 ta alohida pin sifatida emas, o‘zaro bog‘langan tizim sifatida ko‘rsatadi.'],
        ['02 / 05', 'Hududdan aniq bir bo‘limgacha yaqinlashing.', 'Yumshoq spatial drill-down yuqori va quyi oqim kontekstini saqlagan holda A-07 bo‘limining jonli holatini ochadi.'],
        ['03 / 05', 'Telemetriyani operatsion aniqlikka aylantiring.', 'Sath, oqim va yetkazilgan hajm aralashtirilmaydi. Amaldagi yetkazib berish ayni davr uchun tasdiqlangan reja bilan solishtiriladi.'],
        ['04 / 05', 'Hozir nimaga e’tibor kerakligini ko‘rsating.', 'Command center og‘ishlar, ma’lumot ishonchliligi va faol signallarni tartiblaydi — operator uzilgan ekranlar orasidan izlamaydi.'],
        ['05 / 05', 'Signaldan harakatgacha bo‘lgan yo‘lni saqlang.', 'Davomiylik, ishonchlilik, biriktirish, tasdiqlash va tuzatish ishlari bitta auditga tayyor incident timeline’ga aylanadi.']
      ],
      index: ['Tarmoq', 'Stansiya', 'Markaz', 'Signal', 'Audit'],
      operationsEyebrow: 'SIGNALDAN QARORGACHA', operationsTitle: 'Bitta uzluksiz operatsion haqiqat.', operationsLead: 'iSuv o‘lchov, suv intellekti va davlat operatsiyalarini bog‘laydi — noaniqlikni yashirmaydi va sath, oqim hamda yetkazilgan hajmni aralashtirmaydi.',
      layers: [
        ['O‘lchov qatlami', 'Ishonchli dala telemetriyasi', 'Sath, oqim, hajm, qurilma identifikatori, vaqt, sifat va kelib chiqish.'],
        ['Suv intellekti', 'Signaldan oldin kontekst', 'Validatsiya, reja taqqoslash, topologik balans, davomiylik va ishonchlilik.'],
        ['Davlat operatsiyalari', 'Javobgar harakat', 'Signal lifecycle, biriktirish, tasdiqlar, versiyalangan hisobotlar va audit tarixi.']
      ],
      governanceEyebrow: 'AUDIT UCHUN LOYIHALANGAN', governanceTitle: 'Raqam faqat uni tushuntira olsangiz foydali.', governanceLead: 'Har bir tuzatilgan o‘lchov, reja versiyasi, signal qarori, tasdiq va hisobot snapshot’i kim, nima, qachon va nima uchun degan savollarga javobni saqlaydi.', governanceChecks: ['O‘zgarmas kuzatuv reviziyalari', 'Amal qilish sanasi bor reja versiyalari', 'Rol va hudud bo‘yicha nazorat', 'Qayta tiklanadigan hisobot snapshotlari'],
      closingEyebrow: 'HUDUDIY SUV OPERATSIYALARI — BOG‘LANGAN TIZIMDA', closingTitle: 'Tarmoqni ko‘ring.<br>Raqamlarga ishoning.<br><span>Vaqtida harakat qiling.</span>', closingButton: 'Interaktiv demoni ko‘rish', closingNote: 'MVP preview · sintetik telemetriya · jismoniy infratuzilma boshqaruvi yo‘q', footer: 'Hududiy suv operatsiyalari, hisob, monitoring va qaror qabul qilish.'
    },
    ru: {
      title: 'iSuv — каждый кубометр под контролем', description: 'iSuv — платформа региональных водных операций, учёта, мониторинга и поддержки решений.',
      motionOn: 'Анимация включена', motionOff: 'Анимация выключена', motionOnAria: 'Включить анимацию', motionOffAria: 'Выключить анимацию',
      skip: 'Перейти к содержанию', nav: ['Платформа', 'Сеть', 'Мониторинг', 'Надёжность'], cta: 'Открыть платформу',
      heroEyebrow: 'ПЛАТФОРМА РЕГИОНАЛЬНЫХ ВОДНЫХ ОПЕРАЦИЙ', heroTitle: 'Каждый кубометр —<br><span>под контролем.</span>', heroLead: 'iSuv понимает живые измерения в контексте водной сети, сравнивает их с утверждённым планом и вовремя показывает важные отклонения.', heroPrimary: 'Проследить поток', heroSecondary: 'Открыть живой мониторинг', telemetry: [['Точек мониторинга', '83'], ['Живая телеметрия', '24/7'], ['Языки', 'UZ · RU · EN']], scroll: 'Прокрутите, чтобы проследить поток',
      steps: [
        ['01 / 05', 'Увидьте всю сеть в живом состоянии.', 'Единая региональная картина связывает реки, каналы, станции и датчики вместо 83 изолированных точек.'],
        ['02 / 05', 'Перейдите от региона к точному участку.', 'Плавное приближение сохраняет контекст выше и ниже по течению и раскрывает состояние участка A-07.'],
        ['03 / 05', 'Превратите телеметрию в операционную ясность.', 'Уровень, расход и объём остаются раздельными; фактическая подача сравнивается с утверждённым планом того же периода.'],
        ['04 / 05', 'Покажите, что требует внимания сейчас.', 'Командный центр ранжирует отклонения, доверие к данным и тревоги, чтобы оператор не искал их в разрозненных экранах.'],
        ['05 / 05', 'Сохраните весь путь от тревоги до действия.', 'Длительность, доверие, назначение, подтверждение и корректирующее действие образуют единую аудируемую шкалу инцидента.']
      ],
      index: ['Сеть', 'Станция', 'Центр', 'Тревога', 'Аудит'],
      operationsEyebrow: 'ОТ СИГНАЛА К РЕШЕНИЮ', operationsTitle: 'Единая непрерывная операционная истина.', operationsLead: 'iSuv связывает измерения, водную аналитику и государственные операции, не скрывая неопределённость и не смешивая уровень, расход и объём.',
      layers: [['Слой измерений', 'Надёжная полевая телеметрия', 'Уровень, расход, объём, устройство, время, качество и происхождение.'], ['Водная аналитика', 'Контекст до тревоги', 'Валидация, план, топологический баланс, устойчивость и доверие.'], ['Государственные операции', 'Ответственное действие', 'Жизненный цикл тревоги, назначения, согласования, отчёты и аудит.']],
      governanceEyebrow: 'АУДИТ ЗАЛОЖЕН В СИСТЕМУ', governanceTitle: 'Число полезно только тогда, когда его можно объяснить.', governanceLead: 'Каждая корректировка, версия плана, решение по тревоге, подтверждение и снимок отчёта сохраняют кто, что, когда и почему.', governanceChecks: ['Неизменяемые ревизии наблюдений', 'Версии планов с датой действия', 'Контроль роли и территории', 'Воспроизводимые снимки отчётов'],
      closingEyebrow: 'РЕГИОНАЛЬНЫЕ ВОДНЫЕ ОПЕРАЦИИ — В ЕДИНОЙ СИСТЕМЕ', closingTitle: 'Увидьте сеть.<br>Доверяйте цифрам.<br><span>Действуйте вовремя.</span>', closingButton: 'Открыть интерактивное демо', closingNote: 'MVP preview · синтетическая телеметрия · без управления инфраструктурой', footer: 'Региональные водные операции, учёт, мониторинг и поддержка решений.'
    },
    en: {
      title: 'iSuv — every cubic metre under control', description: 'iSuv — regional water operations, accounting, monitoring and decision-support platform.',
      motionOn: 'Motion on', motionOff: 'Motion off', motionOnAria: 'Turn motion on', motionOffAria: 'Turn motion off',
      skip: 'Skip to content', nav: ['Platform', 'Network', 'Monitoring', 'Assurance'], cta: 'View platform',
      heroEyebrow: 'REGIONAL WATER OPERATIONS PLATFORM', heroTitle: 'Every cubic metre —<br><span>under control.</span>', heroLead: 'iSuv understands live measurements across the water network, compares them with the approved plan, and surfaces important deviations in time.', heroPrimary: 'Follow the water', heroSecondary: 'See live operations', telemetry: [['Monitoring points', '83'], ['Live telemetry', '24/7'], ['Languages', 'UZ · RU · EN']], scroll: 'Scroll to follow the water',
      steps: [
        ['01 / 05', 'See the entire network breathe.', 'One live regional picture connects rivers, main canals, branches, stations and sensors instead of treating 83 monitoring points as isolated pins.'],
        ['02 / 05', 'Move from the region to one exact section.', 'A smooth spatial drill-down keeps upstream and downstream context while revealing the live condition of Section A-07.'],
        ['03 / 05', 'Turn telemetry into operational clarity.', 'Stage, discharge and delivered volume remain distinct. Actual delivery is compared with the approved plan for the same interval.'],
        ['04 / 05', 'Surface what requires attention now.', 'The command center ranks deviations, data confidence and active alarms so operators can act without searching through disconnected screens.'],
        ['05 / 05', 'Preserve the full path from alarm to action.', 'Persistence, confidence, assignment, acknowledgement and corrective action become one auditable incident timeline.']
      ],
      index: ['Network', 'Station', 'Command', 'Alarm', 'Governance'],
      operationsEyebrow: 'FROM SIGNAL TO DECISION', operationsTitle: 'One continuous operational truth.', operationsLead: 'iSuv keeps measurement, intelligence and government operations connected—without hiding uncertainty or mixing water level, flow and delivered volume.',
      layers: [['Measurement layer', 'Trusted field telemetry', 'Stage, discharge, volume, device identity, timestamp, quality and provenance.'], ['Water intelligence', 'Context before alerts', 'Validation, allocation comparison, topology balance, persistence and confidence.'], ['Government operations', 'Accountable action', 'Alarm lifecycle, assignments, approvals, versioned reports and audit history.']],
      governanceEyebrow: 'AUDITABLE BY DESIGN', governanceTitle: 'The number is only useful when you can explain it.', governanceLead: 'Every corrected reading, plan version, alarm decision, acknowledgement and report snapshot retains who, what, when and why.', governanceChecks: ['Immutable observation revisions', 'Effective-dated allocation plans', 'Role and territory controls', 'Reproducible report snapshots'],
      closingEyebrow: 'REGIONAL WATER OPERATIONS, CONNECTED', closingTitle: 'See the network.<br>Trust the numbers.<br><span>Act in time.</span>', closingButton: 'View interactive demo', closingNote: 'MVP preview · synthetic telemetry · no physical infrastructure control', footer: 'Regional water operations, accounting, monitoring and decision support.'
    }
  };

  const text = (selector, value) => { const element = document.querySelector(selector); if (element && value !== undefined) element.textContent = value; };
  const html = (selector, value) => { const element = document.querySelector(selector); if (element && value !== undefined) element.innerHTML = value; };

  const ensureLanguageControls = () => {
    if (document.querySelector('.language-switcher')) return;
    const style = document.createElement('style');
    style.textContent = `
      .language-switcher{display:inline-flex;align-items:center;gap:2px;padding:3px;border:1px solid var(--line);border-radius:11px;background:rgba(8,23,28,.35)}
      .language-switcher button{width:29px;height:30px;padding:0;border:0;border-radius:8px;background:transparent;color:#728b91;cursor:pointer;font-size:.62rem;font-weight:750;letter-spacing:.05em}
      .language-switcher button.is-active{background:rgba(105,255,230,.11);color:var(--text);box-shadow:inset 0 0 0 1px rgba(105,255,230,.13)}
      .synthetic-chip{position:absolute;z-index:4;top:112px;left:50%;transform:translateX(-50%);display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border:1px solid rgba(105,255,230,.17);border-radius:999px;background:rgba(5,19,24,.55);color:#7f9ba1;font-size:.58rem;letter-spacing:.11em;text-transform:uppercase;backdrop-filter:blur(12px)}
      .synthetic-chip:before{content:"";width:6px;height:6px;border-radius:50%;background:var(--aqua);box-shadow:0 0 12px var(--aqua)}
      @media(max-width:720px){.language-switcher{margin-left:auto}.language-switcher button{width:28px}.synthetic-chip{top:91px;white-space:nowrap;font-size:.5rem}.topbar__cta{display:none}}
    `;
    document.head.appendChild(style);
    const switcher = document.createElement('div');
    switcher.className = 'language-switcher';
    switcher.setAttribute('role', 'group');
    switcher.setAttribute('aria-label', 'Til / Язык / Language');
    switcher.innerHTML = '<button type="button" data-language="uz">UZ</button><button type="button" data-language="ru">RU</button><button type="button" data-language="en">EN</button>';
    motionToggle?.parentElement?.insertBefore(switcher, motionToggle);
    switcher.addEventListener('click', (event) => {
      const button = event.target.closest('[data-language]');
      if (button) applyLanguage(button.dataset.language);
    });
    const chip = document.createElement('div');
    chip.className = 'synthetic-chip';
    chip.textContent = 'SINTETIK DEMO MA’LUMOTLARI';
    document.querySelector('.hero')?.appendChild(chip);
  };

  const ensureFourthNavigationItem = () => {
    const nav = document.querySelector('.topbar__nav');
    if (!nav || nav.children.length >= 4) return;
    const link = document.createElement('a');
    link.href = '#hero';
    nav.insertBefore(link, nav.firstElementChild);
  };

  const normalizeDemoValues = () => {
    text('.node--source text:first-of-type', 'REGIONAL INFLOW');
    text('.node--source .node__value', '24.50 m³/s');
    text('.node--a text:first-of-type', 'SECTION A-07');
    text('.node--a .node__value', '+6.8% OVER');
    text('.node--b text:first-of-type', 'SECTION B-12');
    const bValue = document.querySelector('.node--b .node__value');
    if (bValue) { bValue.textContent = '+8.7% OVER'; bValue.classList.add('node__value--over'); }
    text('.node--c text:first-of-type', 'SECTION C-04');
    text('.node--c .node__value', '−13.1% UNDER');
  };

  const applyCorePanelLanguage = (lang) => {
    const isUz = lang === 'uz';
    const isRu = lang === 'ru';
    const t = (uz, ru, en) => isUz ? uz : isRu ? ru : en;
    text('.node--source text:first-of-type', t('HUDUDIY KIRIM', 'РЕГИОНАЛЬНЫЙ ПРИТОК', 'REGIONAL INFLOW'));
    text('.node--junction text:first-of-type', t('TUGUN J-04', 'УЗЕЛ J-04', 'JUNCTION J-04'));
    text('.node--junction .node__value', t('JONLI TAQSIMOT', 'ЖИВОЕ РАСПРЕДЕЛЕНИЕ', 'LIVE SPLIT'));
    text('.node--a text:first-of-type', t('BO‘LIM A-07', 'УЧАСТОК A-07', 'SECTION A-07'));
    text('.node--b text:first-of-type', t('BO‘LIM B-12', 'УЧАСТОК B-12', 'SECTION B-12'));
    text('.node--c text:first-of-type', t('BO‘LIM C-04', 'УЧАСТОК C-04', 'SECTION C-04'));

    text('.inspector__header p', t('BO‘LIM A-07', 'УЧАСТОК A-07', 'SECTION A-07'));
    text('.inspector__header h3', t('Katta Andijon kanali', 'Канал Катта Андижон', 'Katta Andijon Canal'));
    text('.inspector__header .badge', t('Rejadan yuqori', 'Выше плана', 'Over plan'));
    const inspectorLabels = document.querySelectorAll('.inspector__metrics > div > span');
    [t('Joriy oqim', 'Текущий расход', 'Current discharge'), t('Maqsad oqimi', 'Целевой расход', 'Target discharge'), t('Bugun yetkazildi', 'Подано сегодня', 'Delivered today'), t('Farq', 'Отклонение', 'Variance')].forEach((value, index) => { if (inspectorLabels[index]) inspectorLabels[index].textContent = value; });
    const chartLegend = document.querySelectorAll('.inspector__chart-legend span');
    if (chartLegend[0]) chartLegend[0].lastChild.textContent = t('Amaldagi', 'Факт', 'Actual');
    if (chartLegend[1]) chartLegend[1].lastChild.textContent = t('Reja', 'План', 'Plan');
    const inspectorFooter = document.querySelectorAll('.inspector__footer span');
    if (inspectorFooter[0]) inspectorFooter[0].lastChild.textContent = t('Sensor ishonchliligi: yuqori', 'Доверие к датчику: высокое', 'Sensor confidence: high');
    if (inspectorFooter[1]) inspectorFooter[1].textContent = t('12 soniya oldin yangilandi', 'Обновлено 12 сек назад', 'Updated 12s ago');

    text('.dashboard__header p', t('HUDUDIY COMMAND CENTER', 'РЕГИОНАЛЬНЫЙ КОМАНДНЫЙ ЦЕНТР', 'REGIONAL COMMAND CENTER'));
    text('.dashboard__header h3', t('Andijon suv vaziyati', 'Водная ситуация Андижана', 'Andijon water situation'));
    text('.dashboard__live', t('● Jonli', '● В эфире', '● Live'));
    const kpiLabels = document.querySelectorAll('.dashboard__kpis > div > span');
    [t('Hududiy kirim', 'Региональный приток', 'Regional inflow'), t('Yetkazildi', 'Подано', 'Delivered'), t('Muvofiqlik', 'Соответствие', 'Compliance'), t('Kritik signallar', 'Критические тревоги', 'Critical alarms')].forEach((value, index) => { if (kpiLabels[index]) kpiLabels[index].textContent = value; });
    text('.dashboard__deviations header span', t('Ustuvor og‘ishlar', 'Приоритетные отклонения', 'Priority deviations'));
    text('.dashboard__deviations header small', t('Jonli', 'В эфире', 'Live'));
    text('.alarm-card__copy p', t('KRITIK SIGNAL · A-07', 'КРИТИЧЕСКАЯ ТРЕВОГА · A-07', 'CRITICAL ALARM · A-07'));
    text('.alarm-card__copy h3', t('Rejadan og‘ish 47 daqiqa davom etdi', 'Отклонение от плана сохраняется 47 минут', 'Allocation variance persisted for 47 minutes'));
    text('.alarm-card__copy span', t('Amaldagi 524,310 m³ · Reja 491,000 m³ · Ishonchlilik yuqori', 'Факт 524,310 м³ · План 491,000 м³ · Доверие высокое', 'Actual 524,310 m³ · Plan 491,000 m³ · Confidence high'));
    text('.alarm-card__state span', t('Tuman operatoriga biriktirildi', 'Назначено районному оператору', 'Assigned to district operator'));
  };

  const updateMotionCopy = () => {
    if (!motionToggle || !motionLabel) return;
    const copy = languageCopy[currentLanguage];
    motionLabel.textContent = motionEnabled ? copy.motionOn : copy.motionOff;
    motionToggle.setAttribute('aria-label', motionEnabled ? copy.motionOffAria : copy.motionOnAria);
  };

  const updateStepCopy = (stepIndex) => {
    if (activeStep === stepIndex) return;
    activeStep = stepIndex;
    const step = languageCopy[currentLanguage].steps[stepIndex];
    const copyElement = document.querySelector('.story__copy');
    if (copyElement?.animate) {
      copyElement.animate([{ opacity: .35, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: motionEnabled ? 420 : 1, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
    storyStep.textContent = step[0];
    storyTitle.textContent = step[1];
    storyDescription.textContent = step[2];
    indexItems.forEach((item, index) => item.classList.toggle('is-active', index === stepIndex));
  };

  const applyLanguage = (language) => {
    currentLanguage = languageCopy[language] ? language : 'uz';
    const copy = languageCopy[currentLanguage];
    document.documentElement.lang = currentLanguage;
    document.title = copy.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', copy.description);
    text('.skip-link', copy.skip);
    ensureFourthNavigationItem();
    document.querySelectorAll('.topbar__nav a').forEach((link, index) => { link.textContent = copy.nav[index] || copy.nav[copy.nav.length - 1]; });
    text('.topbar__cta', copy.cta);
    html('.hero__eyebrow', `<span class="status-dot"></span>${copy.heroEyebrow}`);
    html('.hero__title', copy.heroTitle);
    text('.hero__lead', copy.heroLead);
    text('.hero__actions .button--primary', copy.heroPrimary);
    text('.hero__actions .button--ghost', copy.heroSecondary);
    const telemetry = document.querySelectorAll('.hero__telemetry > div');
    copy.telemetry.forEach(([label, value], index) => { if (!telemetry[index]) return; text(`.hero__telemetry > div:nth-child(${index + 1}) span`, label); text(`.hero__telemetry > div:nth-child(${index + 1}) strong`, value); });
    text('.hero__scroll-hint span', copy.scroll);
    const chip = document.querySelector('.synthetic-chip');
    if (chip) chip.textContent = currentLanguage === 'ru' ? 'СИНТЕТИЧЕСКИЕ ДЕМО-ДАННЫЕ' : currentLanguage === 'en' ? 'SYNTHETIC DEMO DATA' : 'SINTETIK DEMO MA’LUMOTLARI';
    copy.index.forEach((value, index) => { if (indexItems[index]) indexItems[index].textContent = value; });

    text('.section-heading > p', copy.operationsEyebrow);
    text('#operations-title', copy.operationsTitle);
    text('.section-heading > span', copy.operationsLead);
    document.querySelectorAll('.layer-card').forEach((card, index) => {
      const layer = copy.layers[index]; if (!layer) return;
      text(`.layer-card:nth-child(${index + 1}) > p`, layer[0]);
      text(`.layer-card:nth-child(${index + 1}) h3`, layer[1]);
      text(`.layer-card:nth-child(${index + 1}) > span`, layer[2]);
    });
    text('.governance__copy > p', copy.governanceEyebrow);
    text('#governance-title', copy.governanceTitle);
    text('.governance__copy > span', copy.governanceLead);
    document.querySelectorAll('.governance__checks div span').forEach((element, index) => { element.textContent = copy.governanceChecks[index] || element.textContent; });
    text('.closing > p', copy.closingEyebrow);
    html('#closing-title', copy.closingTitle);
    text('.closing .button', copy.closingButton);
    text('.closing small', copy.closingNote);
    text('.footer p', copy.footer);
    document.querySelectorAll('[data-language]').forEach((button) => {
      const active = button.dataset.language === currentLanguage;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    safeStorage.set('isuv-language', currentLanguage);
    activeStep = -1;
    const stepIndex = displayProgress < .20 ? 0 : displayProgress < .40 ? 1 : displayProgress < .59 ? 2 : displayProgress < .78 ? 3 : 4;
    updateStepCopy(stepIndex);
    updateMotionCopy();
    applyCorePanelLanguage(currentLanguage);
  };

  const setMotionState = (enabled, { persist = true } = {}) => {
    motionEnabled = enabled && !reducedMotionQuery.matches;
    body.classList.toggle('motion-off', !motionEnabled);
    motionToggle?.setAttribute('aria-pressed', String(!motionEnabled));
    updateMotionCopy();
    const dot = motionToggle?.querySelector('.motion-toggle__dot');
    if (dot) {
      dot.style.background = motionEnabled ? 'var(--aqua)' : '#647a80';
      dot.style.boxShadow = motionEnabled ? '0 0 12px var(--aqua)' : 'none';
    }
    if (persist) safeStorage.set('isuv-motion', motionEnabled ? 'on' : 'off');
  };

  const renderStory = (progress) => {
    const p = clamp(progress);
    if (progressFill) progressFill.style.width = `${p * 100}%`;
    const pathDraw = easeOutCubic(mapRange(p, 0, .18));
    flowPaths.forEach((path, index) => {
      const delay = index === 0 ? 0 : .035 * index;
      path.style.strokeDashoffset = String(100 - clamp(pathDraw - delay) * 100);
    });
    const zoomIn = easeInOutCubic(mapRange(p, .17, .37));
    const zoomOut = easeInOutCubic(mapRange(p, .47, .62));
    const compact = window.innerWidth <= 720;
    const networkScale = 1 + zoomIn * (compact ? .38 : .92) - zoomOut * (compact ? .28 : .72);
    const translateX = (compact ? -5 : -15) * zoomIn + (compact ? 3 : 9) * zoomOut;
    const translateY = (compact ? 3 : 11) * zoomIn - (compact ? 2 : 7) * zoomOut;
    if (network) network.style.transform = `translate3d(${translateX}%, ${translateY}%, 0) scale(${networkScale})`;
    const focusIn = easeOutCubic(mapRange(p, .20, .31));
    const focusOut = easeOutCubic(mapRange(p, .38, .48));
    setOpacity(focusRing, focusIn * (1 - focusOut));
    if (focusRing) focusRing.style.transform = `translate(50%, -50%) scale(${.55 + focusIn * .55}) rotate(${focusIn * 14}deg)`;
    const inspectorIn = easeOutCubic(mapRange(p, .31, .45));
    const inspectorOut = easeInOutCubic(mapRange(p, .50, .62));
    setOpacity(inspector, inspectorIn * (1 - inspectorOut));
    if (inspector) inspector.style.transform = `translateY(${40 - inspectorIn * 40 + inspectorOut * 14}px) scale(${.86 + inspectorIn * .14 - inspectorOut * .06})`;
    const dashboardIn = easeOutCubic(mapRange(p, .52, .67));
    const dashboardOut = easeInOutCubic(mapRange(p, .78, .91));
    setOpacity(dashboard, dashboardIn * (1 - dashboardOut * .82));
    if (dashboard) dashboard.style.transform = `translateY(${38 - dashboardIn * 38 - dashboardOut * 5}px) scale(${.82 + dashboardIn * .18 + dashboardOut * .035})`;
    const alarmIn = easeOutCubic(mapRange(p, .70, .82));
    const alarmOut = easeInOutCubic(mapRange(p, .93, 1));
    setOpacity(alarmCard, alarmIn * (1 - alarmOut));
    if (alarmCard) alarmCard.style.transform = `translateY(${35 - alarmIn * 35 + alarmOut * 18}px) scale(${.92 + alarmIn * .08})`;
    updateStepCopy(p < .20 ? 0 : p < .40 ? 1 : p < .59 ? 2 : p < .78 ? 3 : 4);
  };

  const calculateTarget = () => {
    if (!story) return;
    const rect = story.getBoundingClientRect();
    const travel = story.offsetHeight - window.innerHeight;
    targetProgress = travel <= 0 ? 0 : clamp(-rect.top / travel);
    topbar?.classList.toggle('is-scrolled', window.scrollY > 30);
  };

  const loop = () => {
    calculateTarget();
    const damping = motionEnabled ? .085 : 1;
    displayProgress += (targetProgress - displayProgress) * damping;
    if (Math.abs(targetProgress - displayProgress) < .0001) displayProgress = targetProgress;
    renderStory(displayProgress);
    ticking = requestAnimationFrame(loop);
  };

  const revealObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.animate?.([{ opacity: 0, transform: 'translateY(28px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: motionEnabled ? 800 : 1, fill: 'both', easing: 'cubic-bezier(.22,1,.36,1)' });
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: .12 }) : null;

  ensureLanguageControls();
  ensureFourthNavigationItem();
  normalizeDemoValues();
  motionToggle?.addEventListener('click', () => setMotionState(!motionEnabled));
  reducedMotionQuery.addEventListener?.('change', (event) => setMotionState(!event.matches, { persist: false }));
  revealObserver && document.querySelectorAll('.layer-card, .governance__visual, .governance__copy').forEach((element) => revealObserver.observe(element));

  window.addEventListener('load', () => {
    body.classList.add('is-ready');
    setMotionState(motionEnabled, { persist: false });
    applyLanguage(safeStorage.get('isuv-language') || 'uz');
    renderStory(0);
    if (!ticking) loop();
  });

  window.addEventListener('beforeunload', () => cancelAnimationFrame(ticking));
})();
