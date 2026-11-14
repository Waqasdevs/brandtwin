(function () {
  'use strict';

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function readNumber(value, fallback) {
    const n = parseFloat(value);
    return isNaN(n) ? fallback : n;
  }

  function isDisabledOnViewport(el) {
    const disable = el.dataset.anmDisable;
    if (!disable) return false;
    const breakpoints = {
      mobile: '(max-width: 479px)',
      landscape: '(orientation: landscape) and (max-width: 767px)',
      tablet: '(max-width: 991px)',
      desktop: '(min-width: 992px)',
    };
    return disable.split(',').some((v) => {
      const q = breakpoints[v.trim()];
      return q && window.matchMedia(q).matches;
    });
  }

  function initElasticDivider(container) {
    // --- 1. Selectors ---
    const svg  = container.querySelector('[data-anm-elastic-divider-svg]');
    const path = container.querySelector('[data-anm-elastic-divider-path]');
    if (!svg || !path || isDisabledOnViewport(container)) return null;

    // --- 2. Config ---
    const lineColor    = container.dataset.anmColor || '#101010';
    const weight       = clamp(readNumber(container.dataset.anmWeight, 1), 0.25, 8);
    const frequency    = clamp(readNumber(container.dataset.anmFrequency, 2.6), 0.1, 12);
    const damping      = clamp(readNumber(container.dataset.anmDamping, 0.72), 0.05, 6);
    const sensitivity  = Math.max(0, readNumber(container.dataset.anmSensitivity, 1));
    const maxAmplitude = Math.max(0, readNumber(container.dataset.anmMaxAmplitude, 38));

    // --- 3. Constants ---
    // Swing (px) the string gains per px/s of pointer speed. 800px/s, an ordinary sweep, gives about 11px.
    const SPEED_TO_AMP = 0.014;
    const AMP_MIN      = 3;
    // The string leaves fast and takes its time coming back. The ring lasts a few damping times,
    // and the elastic period is set so it swings at the configured frequency.
    const ATTACK_DUR   = 0.09;
    const ATTACK_EASE  = 'sine.out';
    const RING_TAUS    = 4.5;
    const RING_DUR     = damping * RING_TAUS;
    const RING_EASE    = 'elastic.out(1, ' + clamp(1 / (frequency * RING_DUR), 0.05, 1).toFixed(3) + ')';
    // The ends are pinned, so a flick right at an end would fold the line on itself.
    const FLICK_X_MIN  = 0.12;
    // A sideways swipe never crosses a horizontal line, so a finger close to it flicks it once per swipe.
    const TOUCH_REACH  = 26;
    const SWIPE_MIN    = 14;
    const SPEED_DT_MIN = 0.004;
    const RM_GAIN      = 0.4;
    const RM_DUR       = 0.6;
    const RESIZE_DEBOUNCE = 150;
    const DEMO_X       = 0.36;
    const DEMO_GAIN    = 0.7;

    // --- 4. State ---
    // bend is the one thing that moves: where the string is held (x) and how far off its rest line (y).
    const bend = { x: 0, y: 0 };
    let width      = 0;
    let midY       = 0;
    let isReduced  = false;
    let liveTl     = null;
    let demoTl     = null;
    let prevX      = null;
    let prevY      = null;
    let prevT      = 0;
    let touchStart = null;
    let touchDone  = false;
    let resizeTimer = null;

    // --- 5. Helpers ---
    // One quadratic curve, pinned at both ends. The curve passes halfway to its control point,
    // so the control point sits at twice the bend.
    function draw() {
      path.setAttribute('d', 'M0,' + midY + ' Q' + bend.x.toFixed(2) + ',' + (midY + bend.y * 2).toFixed(2) + ' ' + width + ',' + midY);
    }

    function measure() {
      width = container.clientWidth;
      const height = container.clientHeight;
      // Half-pixel centre, so an odd-width hairline lands on the pixel grid and stays sharp.
      midY = Math.round(height / 2) + (Math.round(weight) % 2 ? 0.5 : 0);
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      bend.x = clamp(bend.x || width / 2, width * FLICK_X_MIN, width * (1 - FLICK_X_MIN));
      draw();
    }

    // --- 6. Animation routines ---
    // Away fast, back on an elastic ease. Starting from wherever the string is right now means a
    // second flick while it still rings never snaps it.
    function buildFlick(x, amp, paused) {
      const tl = gsap.timeline({ paused: !!paused, onUpdate: draw });
      if (isReduced) {
        tl.to(bend, { x: x, y: amp * RM_GAIN, duration: ATTACK_DUR, ease: ATTACK_EASE, data: { label: 'String bends' } })
          .to(bend, { y: 0, duration: RM_DUR, ease: 'expo.out', data: { label: 'String settles' } });
        return tl;
      }
      tl.to(bend, { x: x, y: amp, duration: ATTACK_DUR, ease: ATTACK_EASE, data: { label: 'String pulled away' } })
        .to(bend, { y: 0, duration: RING_DUR, ease: RING_EASE, data: { label: 'String rings back to rest' } });
      return tl;
    }

    // x in px along the string, strength 0-1 of the max amplitude, direction +1 down / -1 up.
    function flick(x, strength, direction) {
      const at  = clamp(x === undefined ? width / 2 : x, width * FLICK_X_MIN, width * (1 - FLICK_X_MIN));
      const amp = clamp((strength === undefined ? 0.6 : strength) * maxAmplitude, 0, maxAmplitude) * (direction < 0 ? -1 : 1);
      if (demoTl) demoTl.pause();
      if (liveTl) liveTl.kill();
      liveTl = buildFlick(at, amp, false);
    }

    function buildDemo() {
      if (demoTl) demoTl.kill();
      demoTl = buildFlick(width * DEMO_X, maxAmplitude * DEMO_GAIN, true);
    }

    // One pass for the Timeline inspector: pre-built and paused, never played on its own.
    function demo() {
      if (!demoTl || (liveTl && liveTl.isActive())) return null;
      if (liveTl) liveTl.kill();
      bend.y = 0;
      demoTl.restart(true, false);
      return demoTl;
    }

    function onPointerMove(e) {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const t = e.timeStamp / 1000;
      if (prevY !== null) {
        const dt    = Math.max(t - prevT, SPEED_DT_MIN);
        const speed = Math.hypot(x - prevX, y - prevY) / dt;
        const amp   = clamp(speed * SPEED_TO_AMP * sensitivity, AMP_MIN, maxAmplitude);
        const crossed = (prevY - midY) * (y - midY) < 0;
        if (crossed) {
          flick(x, amp / (maxAmplitude || 1), y > prevY ? 1 : -1);
        } else if (e.pointerType === 'touch' && !touchDone && touchStart !== null
          && Math.abs(y - midY) < TOUCH_REACH && Math.abs(x - touchStart) > SWIPE_MIN) {
          touchDone = true;
          flick(x, amp / (maxAmplitude || 1), y > midY ? -1 : 1);
        }
      } else if (e.pointerType === 'touch') {
        touchStart = x;
        touchDone = false;
      }
      prevX = x;
      prevY = y;
      prevT = t;
    }

    function onPointerEnd() {
      prevX = null;
      prevY = null;
      touchStart = null;
    }

    // --- 7. Event listeners ---
    const ac = new AbortController();
    const listen = { signal: ac.signal };
    container.addEventListener('pointermove', onPointerMove, listen);
    container.addEventListener('pointerleave', onPointerEnd, listen);
    container.addEventListener('pointercancel', onPointerEnd, listen);
    container.addEventListener('pointerup', onPointerEnd, listen);

    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (liveTl) liveTl.kill();
        bend.y = 0;
        measure();
        buildDemo();
      }, RESIZE_DEBOUNCE);
    }
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    // A hidden tab should not keep a ring going; it picks up where it left off.
    document.addEventListener('visibilitychange', () => {
      if (!liveTl) return;
      if (document.hidden) liveTl.pause(); else liveTl.resume();
    }, listen);

    // --- 8. Initial DOM state ---
    path.setAttribute('stroke', lineColor);
    path.setAttribute('stroke-width', weight);
    measure();

    // --- 9. Reduced motion ---
    // One small bend, no ringing.
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: reduce)', () => {
      isReduced = true;
      buildDemo();
      return () => { isReduced = false; buildDemo(); };
    });
    buildDemo();

    // --- 10. Public API ---
    return {
      flick: flick,
      demo: demo,
      kill: function () {
        if (liveTl) liveTl.kill();
        if (demoTl) demoTl.kill();
        clearTimeout(resizeTimer);
        ac.abort();
        ro.disconnect();
        mm.revert();
      },
    };
  }

  function waitForGSAP(cb, attempts) {
    attempts = attempts || 0;
    if (typeof gsap !== 'undefined') { cb(); return; }
    if (attempts < 100) setTimeout(() => waitForGSAP(cb, attempts + 1), 50);
    else console.error('[Annnimate] gsap failed to load');
  }

  waitForGSAP(() => {
    const instances = [];

    function mount() {
      document.querySelectorAll('[data-anm-elastic-divider]').forEach((el) => {
        const api = initElasticDivider(el);
        if (api) instances.push(api);
      });
    }

    mount();

    window.Anm = window.Anm || {};
    window.Anm.ElasticDivider = {
      refresh: () => {
        instances.forEach((i) => i.kill());
        instances.length = 0;
        mount();
      },
      flick: (x, strength, direction) => instances.forEach((i) => i.flick(x, strength, direction)),
      demo: () => (instances[0] ? instances[0].demo() : null),
    };
  });
})();
