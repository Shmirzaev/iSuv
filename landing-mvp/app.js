(() => {
  'use strict';

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const mapRange = (value, inMin, inMax, outMin = 0, outMax = 1) => {
    const normalized = clamp((value - inMin) / (inMax - inMin));
    return outMin + (outMax - outMin) * normalized;
  };
  const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const setOpacity = (element, value) => { element.style.opacity = String(clamp(value)); };

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
  const motionLabel = motionToggle.querySelector('.motion-toggle__label');

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let motionEnabled = !reducedMotionQuery.matches;
  let targetProgress = 0;
  let displayProgress = 0;
  let activeStep = -1;
  let ticking = false;

  const steps = [
    {
      step: '01 / 05',
      title: 'See the entire network breathe.',
      description: 'One live regional picture connects rivers, main canals, branch canals, stations and sensors instead of treating 83 monitoring points as isolated pins.'
    },
    {
      step: '02 / 05',
      title: 'Move from the region to one exact section.',
      description: 'A smooth spatial drill-down keeps upstream and downstream context while revealing the live condition of Section A-07.'
    },
    {
      step: '03 / 05',
      title: 'Turn telemetry into operational clarity.',
      description: 'Stage, discharge and delivered volume remain distinct. Actual delivery is compared with the approved plan for the same interval.'
    },
    {
      step: '04 / 05',
      title: 'Surface what requires attention now.',
      description: 'The command center ranks deviations, data confidence and active alarms so operators can act without searching through disconnected screens.'
    },
    {
      step: '05 / 05',
      title: 'Preserve the full path from alarm to action.',
      description: 'Persistence, confidence, assignment, acknowledgement and corrective action become one auditable incident timeline.'
    }
  ];

  const setMotionState = (enabled) => {
    motionEnabled = enabled;
    body.classList.toggle('motion-off', !enabled);
    motionToggle.setAttribute('aria-pressed', String(!enabled));
    motionToggle.setAttribute('aria-label', enabled ? 'Turn motion off' : 'Turn motion on');
    motionLabel.textContent = enabled ? 'Motion on' : 'Motion off';
    const dot = motionToggle.querySelector('.motion-toggle__dot');
    dot.style.background = enabled ? 'var(--aqua)' : '#647a80';
    dot.style.boxShadow = enabled ? '0 0 12px var(--aqua)' : 'none';
  };

  motionToggle.addEventListener('click', () => setMotionState(!motionEnabled));
  reducedMotionQuery.addEventListener?.('change', (event) => setMotionState(!event.matches));

  const updateStepCopy = (stepIndex) => {
    if (activeStep === stepIndex) return;
    activeStep = stepIndex;
    const step = steps[stepIndex];
    const copy = document.querySelector('.story__copy');
    copy.animate(
      [
        { opacity: .35, transform: 'translateY(7px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ],
      { duration: motionEnabled ? 420 : 1, easing: 'cubic-bezier(.22,1,.36,1)' }
    );
    storyStep.textContent = step.step;
    storyTitle.textContent = step.title;
    storyDescription.textContent = step.description;
    indexItems.forEach((item, index) => item.classList.toggle('is-active', index === stepIndex));
  };

  const renderStory = (progress) => {
    const p = clamp(progress);
    progressFill.style.width = `${p * 100}%`;

    const pathDraw = easeOutCubic(mapRange(p, 0.00, 0.18));
    flowPaths.forEach((path, index) => {
      const delay = index === 0 ? 0 : .035 * index;
      path.style.strokeDashoffset = String(100 - clamp(pathDraw - delay) * 100);
    });

    const zoomIn = easeInOutCubic(mapRange(p, .17, .37));
    const zoomOut = easeInOutCubic(mapRange(p, .47, .62));
    const compactLayout = window.innerWidth <= 720;
    const zoomAmount = compactLayout ? .38 : .92;
    const zoomRelease = compactLayout ? .28 : .72;
    const networkScale = 1 + (zoomIn * zoomAmount) - (zoomOut * zoomRelease);
    const translateX = ((compactLayout ? -5 : -15) * zoomIn) + ((compactLayout ? 3 : 9) * zoomOut);
    const translateY = ((compactLayout ? 3 : 11) * zoomIn) - ((compactLayout ? 2 : 7) * zoomOut);
    network.style.transform = `translate3d(${translateX}%, ${translateY}%, 0) scale(${networkScale})`;

    const focusIn = easeOutCubic(mapRange(p, .20, .31));
    const focusOut = easeOutCubic(mapRange(p, .38, .48));
    const focusVisibility = focusIn * (1 - focusOut);
    setOpacity(focusRing, focusVisibility);
    focusRing.style.transform = `translate(50%, -50%) scale(${.55 + focusIn * .55}) rotate(${focusIn * 14}deg)`;

    const inspectorIn = easeOutCubic(mapRange(p, .31, .45));
    const inspectorOut = easeInOutCubic(mapRange(p, .50, .62));
    const inspectorVisibility = inspectorIn * (1 - inspectorOut);
    setOpacity(inspector, inspectorVisibility);
    inspector.style.transform = `translateY(${40 - inspectorIn * 40 + inspectorOut * 14}px) scale(${.86 + inspectorIn * .14 - inspectorOut * .06})`;

    const dashboardIn = easeOutCubic(mapRange(p, .52, .67));
    const dashboardOut = easeInOutCubic(mapRange(p, .78, .91));
    const dashboardVisibility = dashboardIn * (1 - dashboardOut * .82);
    setOpacity(dashboard, dashboardVisibility);
    dashboard.style.transform = `translateY(${38 - dashboardIn * 38 - dashboardOut * 5}px) scale(${.82 + dashboardIn * .18 + dashboardOut * .035})`;

    const alarmIn = easeOutCubic(mapRange(p, .70, .82));
    const alarmOut = easeInOutCubic(mapRange(p, .93, 1));
    const alarmVisibility = alarmIn * (1 - alarmOut);
    setOpacity(alarmCard, alarmVisibility);
    alarmCard.style.transform = `translateY(${35 - alarmIn * 35 + alarmOut * 18}px) scale(${.92 + alarmIn * .08})`;

    const stepIndex = p < .20 ? 0 : p < .40 ? 1 : p < .59 ? 2 : p < .78 ? 3 : 4;
    updateStepCopy(stepIndex);
  };

  const calculateTarget = () => {
    const rect = story.getBoundingClientRect();
    const travel = story.offsetHeight - window.innerHeight;
    targetProgress = travel <= 0 ? 0 : clamp(-rect.top / travel);
    topbar.classList.toggle('is-scrolled', window.scrollY > 30);
  };

  const loop = () => {
    calculateTarget();
    const damping = motionEnabled ? .085 : 1;
    displayProgress += (targetProgress - displayProgress) * damping;
    if (Math.abs(targetProgress - displayProgress) < .0001) displayProgress = targetProgress;
    renderStory(displayProgress);
    ticking = requestAnimationFrame(loop);
  };

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.animate(
        [
          { opacity: 0, transform: 'translateY(28px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ],
        { duration: motionEnabled ? 800 : 1, fill: 'both', easing: 'cubic-bezier(.22,1,.36,1)' }
      );
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: .12 });

  document.querySelectorAll('.layer-card, .governance__visual, .governance__copy').forEach((element) => revealObserver.observe(element));

  window.addEventListener('load', () => {
    body.classList.add('is-ready');
    setMotionState(motionEnabled);
    renderStory(0);
    if (!ticking) loop();
  });

  window.addEventListener('beforeunload', () => cancelAnimationFrame(ticking));
})();
