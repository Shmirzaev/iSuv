const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const range = (value, start, end) => clamp((value - start) / (end - start));
const lerp = (from, to, amount) => from + (to - from) * amount;

const body = document.body;
const header = document.querySelector('[data-header]');
const story = document.querySelector('[data-story]');
const stage = document.querySelector('[data-story-stage]');
const progressBar = document.querySelector('[data-story-progress]');
const stepIndex = document.querySelector('[data-step-index]');
const steps = [...document.querySelectorAll('[data-story-step]')];
const network = document.querySelector('[data-network-wrap]');
const inspector = document.querySelector('[data-station-inspector]');
const dashboard = document.querySelector('[data-dashboard-morph]');
const alarm = document.querySelector('[data-alarm-card]');
const architecture = document.querySelector('[data-architecture]');
const pathElements = [...document.querySelectorAll('[data-path]')];
const branchLabels = [...document.querySelectorAll('.branch-label')];
const flowLayer = document.querySelector('#flow-layer');
const motionToggle = document.querySelector('[data-motion-toggle]');
const motionLabel = document.querySelector('[data-motion-label]');
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');

let motionEnabled = !prefersReduced.matches;
let storyProgress = 0;
let ticking = false;
let pathMeta = [];
let particles = [];
let lastFrame = performance.now();

const setStyles = (element, styles) => {
  if (!element) return;
  Object.assign(element.style, styles);
};

const initPaths = () => {
  pathMeta = pathElements.map((path) => {
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length}`;
    return { path, length, name: path.dataset.path };
  });

  const particleCounts = { main: 4, a: 3, b: 3, c: 2 };
  pathMeta.forEach((meta) => {
    const count = particleCounts[meta.name] ?? 2;
    for (let index = 0; index < count; index += 1) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', index === 0 ? '4.5' : '3');
      circle.setAttribute('class', 'flow-particle');
      circle.style.opacity = '0';
      flowLayer.append(circle);
      particles.push({ circle, meta, offset: index / count, speed: 0.036 + index * 0.004 });
    }
  });
};

const drawPath = (name, amount) => {
  const meta = pathMeta.find((entry) => entry.name === name);
  if (!meta) return;
  meta.path.style.strokeDashoffset = `${meta.length * (1 - clamp(amount))}`;
};

const activeStepForProgress = (progress) => {
  if (progress < 0.19) return 0;
  if (progress < 0.39) return 1;
  if (progress < 0.59) return 2;
  if (progress < 0.79) return 3;
  return 4;
};

const updateStory = () => {
  if (!story) return;
  const rect = story.getBoundingClientRect();
  const distance = Math.max(1, story.offsetHeight - window.innerHeight);
  storyProgress = clamp(-rect.top / distance);
  const progress = storyProgress;

  progressBar.style.transform = `scaleX(${progress})`;
  const activeStep = activeStepForProgress(progress);
  stepIndex.textContent = String(activeStep + 1).padStart(2, '0');
  steps.forEach((step, index) => step.classList.toggle('is-active', index === activeStep));

  drawPath('main', range(progress, 0.01, 0.16));
  drawPath('a', range(progress, 0.15, 0.32));
  drawPath('b', range(progress, 0.17, 0.34));
  drawPath('c', range(progress, 0.19, 0.36));

  branchLabels.forEach((label, index) => {
    const show = range(progress, 0.20 + index * 0.018, 0.31 + index * 0.018);
    label.style.opacity = `${show * (1 - range(progress, 0.46, 0.55))}`;
    label.style.transform = `translateY(${lerp(10, 0, show)}px)`;
  });

  const zoom = range(progress, 0.40, 0.56);
  const fadeNetwork = range(progress, 0.52, 0.63);
  stage.style.setProperty('--network-scale', `${lerp(1, 2.28, zoom)}`);
  stage.style.setProperty('--network-x', `${lerp(0, -115, zoom)}px`);
  stage.style.setProperty('--network-y', `${lerp(0, 76, zoom)}px`);
  network.style.opacity = `${1 - fadeNetwork * 0.88}`;
  network.style.filter = `blur(${fadeNetwork * 5}px)`;

  const inspectorIn = range(progress, 0.46, 0.56);
  const inspectorOut = range(progress, 0.60, 0.69);
  const inspectorVisibility = inspectorIn * (1 - inspectorOut);
  setStyles(inspector, {
    opacity: `${inspectorVisibility}`,
    transform: `translate(-50%, ${lerp(-42, -50, inspectorIn)}%) scale(${lerp(.78, 1, inspectorIn) - inspectorOut * .12})`,
    pointerEvents: inspectorVisibility > .8 ? 'auto' : 'none'
  });

  const dashboardIn = range(progress, 0.61, 0.70);
  const dashboardOut = range(progress, 0.82, 0.90);
  const dashboardVisibility = dashboardIn * (1 - dashboardOut);
  setStyles(dashboard, {
    opacity: `${dashboardVisibility}`,
    transform: `translate(-50%, ${lerp(-42, -50, dashboardIn)}%) scale(${lerp(.79, 1, dashboardIn) - dashboardOut * .08}) rotateX(${lerp(7, 0, dashboardIn)}deg)`,
    pointerEvents: dashboardVisibility > .8 ? 'auto' : 'none'
  });

  const alarmIn = range(progress, 0.72, 0.79);
  const alarmOut = range(progress, 0.85, 0.91);
  const alarmVisibility = alarmIn * (1 - alarmOut);
  setStyles(alarm, {
    opacity: `${alarmVisibility}`,
    transform: `translate(-50%, ${lerp(45, 0, alarmIn) + alarmOut * 20}px)`,
    pointerEvents: alarmVisibility > .75 ? 'auto' : 'none'
  });

  const layersIn = range(progress, 0.87, 0.96);
  setStyles(architecture, {
    opacity: `${layersIn}`,
    transform: `translate(-50%, ${lerp(-35, -50, layersIn)}%) scale(${lerp(.86, 1, layersIn)})`,
    pointerEvents: layersIn > .8 ? 'auto' : 'none'
  });
};

const updateParticles = (now) => {
  const delta = Math.min(40, now - lastFrame);
  lastFrame = now;
  if (motionEnabled && document.visibilityState === 'visible') {
    particles.forEach((particle) => {
      particle.offset = (particle.offset + particle.speed * delta / 1000) % 1;
      const visibleThreshold = particle.meta.name === 'main' ? 0.06 : 0.21;
      const isVisible = storyProgress > visibleThreshold && storyProgress < 0.57;
      particle.circle.style.opacity = isVisible ? `${Math.min(1, range(storyProgress, visibleThreshold, visibleThreshold + .08))}` : '0';
      if (!isVisible) return;
      const point = particle.meta.path.getPointAtLength(particle.meta.length * particle.offset);
      particle.circle.setAttribute('cx', point.x.toFixed(2));
      particle.circle.setAttribute('cy', point.y.toFixed(2));
    });
  }
  requestAnimationFrame(updateParticles);
};

const updateViewport = () => {
  header?.classList.toggle('is-scrolled', window.scrollY > 24);
  updateStory();
  ticking = false;
};

const requestViewportUpdate = () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(updateViewport);
};

window.addEventListener('scroll', requestViewportUpdate, { passive: true });
window.addEventListener('resize', requestViewportUpdate);

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add('is-visible');
  });
}, { threshold: 0.13 });
document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));

const setMotion = (enabled) => {
  motionEnabled = enabled;
  body.classList.toggle('motion-off', !enabled);
  motionToggle?.setAttribute('aria-pressed', String(!enabled));
  if (motionLabel) motionLabel.textContent = `Motion: ${enabled ? 'ON' : 'OFF'}`;
};
motionToggle?.addEventListener('click', () => setMotion(!motionEnabled));
prefersReduced.addEventListener?.('change', (event) => setMotion(!event.matches));

const ackButton = document.querySelector('[data-acknowledge]');
ackButton?.addEventListener('click', () => {
  alarm.classList.add('is-acknowledged');
  alarm.querySelector('.alarm-icon').textContent = '✓';
  ackButton.textContent = 'Tasdiqlandi';
  ackButton.disabled = true;
  document.querySelector('[data-ack-state]').textContent = 'Mas’ul: Shift operator · 14:33';
});

const overviewDialog = document.querySelector('[data-overview-dialog]');
document.querySelectorAll('[data-open-overview]').forEach((button) => {
  button.addEventListener('click', () => overviewDialog?.showModal());
});
document.querySelector('[data-dialog-close]')?.addEventListener('click', () => overviewDialog?.close());
document.querySelector('[data-dialog-go]')?.addEventListener('click', () => overviewDialog?.close());
overviewDialog?.addEventListener('click', (event) => {
  if (event.target === overviewDialog) overviewDialog.close();
});

const panelTitles = {
  command: 'Hududiy suv holati',
  live: 'Jonli stansiya operatsiyalari',
  map: 'GIS va gidrologik tarmoq',
  analytics: 'Yetkazib berish analitikasi',
  reports: 'Hisobot va audit markazi'
};
document.querySelectorAll('[data-panel]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-panel]').forEach((item) => item.classList.remove('is-selected'));
    button.classList.add('is-selected');
    const title = document.querySelector('[data-panel-title]');
    if (title) title.textContent = panelTitles[button.dataset.panel];
  });
});

const tiltElements = document.querySelectorAll('.tilt');
tiltElements.forEach((element) => {
  element.addEventListener('pointermove', (event) => {
    if (!motionEnabled || window.innerWidth < 900) return;
    const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - .5;
    const y = (event.clientY - rect.top) / rect.height - .5;
    element.style.transform = `perspective(700px) rotateX(${-y * 5}deg) rotateY(${x * 7}deg) translateY(-4px)`;
  });
  element.addEventListener('pointerleave', () => { element.style.transform = ''; });
});

const heroVisual = document.querySelector('[data-hero-visual]');
window.addEventListener('pointermove', (event) => {
  if (!motionEnabled || window.innerWidth < 900 || !heroVisual) return;
  const x = event.clientX / window.innerWidth - .5;
  const y = event.clientY / window.innerHeight - .5;
  heroVisual.style.transform = `translate3d(${x * 10}px, ${y * 7}px, 0)`;
}, { passive: true });

initPaths();
setMotion(motionEnabled);
updateViewport();
requestAnimationFrame(updateParticles);
