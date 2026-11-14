(function () {
  'use strict';

  function initFloatingNavbar(header) {
    // --- 1. Selectors ---
    const bg       = header.querySelector('[data-anm-fnb-bg]');
    const nav      = header.querySelector('[data-anm-fnb-nav]');
    const logo     = header.querySelector('[data-anm-fnb-logo]');
    const logoText = header.querySelector('[data-anm-fnb-logo-text]');
    const cta      = header.querySelector('[data-anm-fnb-cta]');
    const links    = Array.from(header.querySelectorAll('[data-anm-fnb-link]'));
    // the section where hide-on-scroll-down starts; above it the header always shows
    const hideStart = document.querySelector('[data-anm-fnb-hide-start]');

    if (!bg || !nav || !logo || !logoText || !cta) return null;

    // logo first, CTA last - measure() reads the row's ends from these slots
    const items = [logo].concat(links, [cta]);

    // --- 2. Config ---
    const threshold = parseFloat(header.dataset.anmDockThreshold || '80');
    const duration  = parseFloat(header.dataset.anmDockDuration || '0.42');
    const offset    = parseFloat(header.dataset.anmDockOffset || '12');
    const ease      = header.dataset.anmDockEase || 'annnimate';
    const mode      = header.dataset.anmDockMode === 'scrub' ? 'scrub' : 'toggle';
    const markText  = header.dataset.anmDockMark || '';

    // --- 3. Constants ---
    const HYSTERESIS    = 24;
    const RELEASE_AT    = Math.max(1, threshold - HYSTERESIS);
    const SCRUB_SPAN    = threshold * 2;
    const SCRUB_SMOOTH  = 0.5;
    const CONTENT_LAG   = 0.04;
    // the row lifts a little faster than it travels, so each item bows into the pill
    const LIFT_SCALE    = 0.82;
    // the wordmark tail is folded away before the walls arrive
    const FOLD_SCALE    = 0.74;
    const PILL_PAD      = 6;
    // kept letters sit as far from the left wall as the CTA label sits from the right
    const MARK_INSET    = 22;
    const GLASS_FILL    = 0.86;
    const GLASS_BLUR    = 14;
    const GLASS_SAT     = 1.6;
    const RM_FADE       = 0.2;
    const DEMO_HOLD     = 0.9;
    const RESIZE_DEBOUNCE = 150;
    const MEASURE_CLASS = 'is-measuring';
    const DOCKED_CLASS  = 'is-docked';
    const HIDDEN_CLASS  = 'is-hidden';

    // --- 4. State ---
    let geo        = null;
    let tl         = null;
    let demoTl     = null;
    let rmFade     = null;
    let trigger    = null;
    let tailInner  = null;
    let isDocked   = false;
    let scrubbing  = false;
    let reducedMotion = false;
    let resizeTimer = null;
    let lastWidth  = 0;
    let isReady    = false;

    // --- 5. Helpers ---

    // Splits the wordmark into the kept letters and a tail that folds behind
    // them. The link keeps the full name as its accessible label.
    function splitWordmark() {
      const word = logoText.textContent.trim();
      const keep = markText && word.indexOf(markText) === 0 ? markText : word.charAt(0);
      const rest = word.slice(keep.length);
      if (!logo.getAttribute('aria-label')) logo.setAttribute('aria-label', word);
      logoText.setAttribute('aria-hidden', 'true');
      logoText.textContent = '';

      const markEl = document.createElement('span');
      markEl.className = 'fnb_logo_mark';
      markEl.textContent = keep;
      logoText.appendChild(markEl);

      if (!rest) return null;
      const tail = document.createElement('span');
      tail.className = 'fnb_logo_tail';
      const inner = document.createElement('span');
      inner.className = 'fnb_logo_tail_inner';
      inner.textContent = rest;
      tail.appendChild(inner);
      logoText.appendChild(tail);
      return inner;
    }

    function isShown(el) {
      return el.getClientRects().length > 0;
    }

    // Reads the top layout, then the docked layout (one synchronous class
    // swap, never painted), and turns the difference into transform deltas
    // plus the pill's clip geometry. Ratios of the real DOM, no typed px.
    function measure() {
      const width = header.getBoundingClientRect().width;
      const barH  = header.offsetHeight;
      const bgH   = bg.offsetHeight;
      const restB = Math.max(0, bgH - barH);

      gsap.set(items.concat([nav]), { x: 0, y: 0 });
      if (tailInner) gsap.set(tailInner, { xPercent: 0, opacity: 1 });
      gsap.set(bg, {
        '--fnb-ct': '0px',
        '--fnb-cx': '0px',
        '--fnb-cb': restB + 'px',
        '--fnb-cr': '0px',
        '--fnb-fill': 0,
        '--fnb-blur': '0px',
        '--fnb-sat': 1,
      });

      const tops  = items.map(function (el) { return el.getBoundingClientRect().left; });

      header.classList.add(MEASURE_CLASS);
      const docks = items.map(function (el) { return el.getBoundingClientRect(); });
      const ctaH  = cta.offsetHeight;
      header.classList.remove(MEASURE_CLASS);

      const rowLeft  = docks[0].left;
      const rowRight = docks[docks.length - 1].right;
      const pillW = rowRight - rowLeft + MARK_INSET + PILL_PAD;
      const pillH = ctaH + PILL_PAD * 2;
      const pillX = (width - pillW) / 2;
      const shift = pillX + MARK_INSET - rowLeft;

      return {
        dx: items.map(function (el, i) { return isShown(el) ? docks[i].left + shift - tops[i] : 0; }),
        dy: offset + pillH / 2 - barH / 2,
        clipX: pillX,
        clipTop: offset,
        clipBottom: Math.max(0, bgH - offset - pillH),
        restBottom: restB,
        radius: pillH / 2,
      };
    }

    function glassVars(p) {
      return {
        '--fnb-fill': GLASS_FILL * p,
        '--fnb-blur': GLASS_BLUR * p + 'px',
        '--fnb-sat': 1 + (GLASS_SAT - 1) * p,
      };
    }

    // One spec per visual event. The live timeline plays them forward; the
    // demo plays them forward, holds, then plays them back in reverse order.
    function dockSpecs() {
      const specs = [
        {
          target: bg, at: 0, dur: duration,
          label: 'Edges close into a pill', back: 'Edges open back to full width',
          from: { '--fnb-ct': '0px', '--fnb-cx': '0px', '--fnb-cb': geo.restBottom + 'px', '--fnb-cr': '0px' },
          to: { '--fnb-ct': geo.clipTop + 'px', '--fnb-cx': geo.clipX + 'px', '--fnb-cb': geo.clipBottom + 'px', '--fnb-cr': geo.radius + 'px' },
        },
        {
          target: bg, at: 0, dur: duration,
          label: 'Frosted glass fades in', back: 'Glass clears',
          from: glassVars(0), to: glassVars(1),
        },
        {
          target: logo, at: CONTENT_LAG, dur: duration,
          label: 'Wordmark rides the left edge', back: 'Wordmark rides back out',
          from: { x: 0 }, to: { x: geo.dx[0] },
        },
      ];
      if (tailInner) {
        specs.push({
          target: tailInner, at: CONTENT_LAG, dur: duration * FOLD_SCALE,
          label: 'Wordmark folds into its mark', back: 'Wordmark unfolds',
          from: { xPercent: 0, opacity: 1 }, to: { xPercent: -100, opacity: 0 },
        });
      }
      if (links.length) {
        specs.push({
          target: links, at: CONTENT_LAG, dur: duration,
          label: 'Links tighten toward the center', back: 'Links spread back out',
          from: { x: 0 }, to: { x: function (i) { return geo.dx[1 + i]; } },
        });
      }
      specs.push(
        {
          target: cta, at: CONTENT_LAG, dur: duration,
          label: 'Contact rides the right edge', back: 'Contact rides back out',
          from: { x: 0 }, to: { x: geo.dx[items.length - 1] },
        },
        {
          target: nav, at: CONTENT_LAG, dur: duration * LIFT_SCALE,
          label: 'Row lifts into the pill', back: 'Row settles back down',
          from: { y: 0 }, to: { y: geo.dy },
        }
      );
      return specs;
    }

    // --- 6. Animation routines ---

    function addSpec(timeline, spec, at, back) {
      const vars = Object.assign({}, back ? spec.from : spec.to, {
        duration: spec.dur,
        ease: ease,
        force3D: true,
        immediateRender: false,
        data: { label: back ? spec.back : spec.label },
      });
      timeline.fromTo(spec.target, back ? spec.to : spec.from, vars, at);
    }

    // Both timelines are built PAUSED: the live one waits for the scroll,
    // the demo one waits for the inspector. Nothing plays on load.
    function buildTimelines() {
      const specs = dockSpecs();
      tl = gsap.timeline({ paused: true });
      specs.forEach(function (s) { addSpec(tl, s, s.at, false); });

      const len = tl.duration();
      const backStart = len + DEMO_HOLD;
      demoTl = gsap.timeline({ paused: true });
      specs.forEach(function (s) { addSpec(demoTl, s, s.at, false); });
      specs.forEach(function (s) { addSpec(demoTl, s, backStart + len - (s.at + s.dur), true); });
    }

    // A real scroll during a demo pass continues from about the demo's frame:
    // the way back runs in reverse order, so its time maps onto the live
    // timeline's progress.
    function takeOverFromDemo() {
      if (!demoTl) return;
      const dp = demoTl.progress();
      if (dp <= 0 || dp >= 1) return;
      const len = tl.duration();
      const t = demoTl.time();
      let p = 1;
      if (t < len) p = t / len;
      else if (t > len + DEMO_HOLD) p = 1 - (t - len - DEMO_HOLD) / len;
      demoTl.pause();
      tl.progress(Math.max(0, Math.min(1, p)));
    }

    function swapReduced(p) {
      tl.pause().progress(p);
      if (rmFade) rmFade.kill();
      rmFade = gsap.fromTo(bg, glassVars(1 - p), Object.assign(glassVars(p), {
        duration: RM_FADE,
        ease: 'power1.out',
      }));
    }

    function dock() {
      if (scrubbing || isDocked) return;
      isDocked = true;
      header.classList.add(DOCKED_CLASS);
      takeOverFromDemo();
      if (reducedMotion) swapReduced(1);
      else tl.play();
    }

    function undock() {
      if (scrubbing || !isDocked) return;
      isDocked = false;
      header.classList.remove(DOCKED_CLASS);
      takeOverFromDemo();
      if (reducedMotion) swapReduced(0);
      else tl.reverse();
    }

    function currentScroll() {
      return window.pageYOffset || document.documentElement.scrollTop || 0;
    }

    // Renders a fresh timeline to a progress without playing it (1 then 0 first
    // so every child, delayed ones included, has initialized from its clean
    // undocked state before jumping to p).
    function setProgress(p) {
      tl.progress(1, true);
      tl.progress(0, true);
      if (p > 0) tl.progress(p, true);
    }

    // Measure -> build -> wire -> apply the state that matches the current
    // scroll instantly. Runs at init, on font load, on width changes and
    // when the motion preference flips.
    let isSettingUp = false;
    function setup() {
      isSettingUp = true;
      if (trigger) trigger.kill(false, true);
      trigger = null;
      if (tl) tl.kill();
      if (demoTl) demoTl.kill();
      if (rmFade) rmFade.kill();

      scrubbing = mode === 'scrub' && !reducedMotion;
      geo = measure();
      buildTimelines();
      lastWidth = header.getBoundingClientRect().width;

      const y = currentScroll();
      if (scrubbing) {
        isDocked = y >= threshold;
        setProgress(Math.min(1, y / SCRUB_SPAN));
      } else {
        isDocked = isDocked ? y >= RELEASE_AT : y >= threshold;
        setProgress(isDocked ? 1 : 0);
      }
      header.classList.toggle(DOCKED_CLASS, isDocked);
      wireScroll();
      isSettingUp = false;
    }

    // --- 7. Event listeners ---

    // Toggle mode: one passive trigger watches the scroll and flips state
    // with hysteresis, so jitter around the threshold never flickers it.
    function handleToggleScroll() {
      if (isSettingUp) return;
      const y = currentScroll();
      if (!isDocked && y >= threshold) dock();
      else if (isDocked && y < RELEASE_AT) undock();
    }

    function handleScrubUpdate(self) {
      if (isSettingUp) return;
      isDocked = self.progress >= 0.5;
      header.classList.toggle(DOCKED_CLASS, isDocked);
    }

    // The scroll source is rebuilt with the geometry, so it lives with setup.
    function wireScroll() {
      window.removeEventListener('scroll', handleToggleScroll);
      if (scrubbing) {
        trigger = ScrollTrigger.create({
          start: 0,
          end: SCRUB_SPAN,
          scrub: SCRUB_SMOOTH,
          animation: tl,
          onUpdate: handleScrubUpdate,
        });
      } else {
        window.addEventListener('scroll', handleToggleScroll, { passive: true });
        trigger = ScrollTrigger.create({
          start: 0,
          end: 'max',
          onUpdate: handleToggleScroll,
        });
      }
    }

    // Past the hide-start section the header hides on scroll down and comes
    // back on scroll up; the CSS class owns the slide.
    function handleHideScroll(self) {
      if (isSettingUp) return;
      header.classList.toggle(HIDDEN_CLASS, self.direction === 1);
    }

    function showHeader() {
      header.classList.remove(HIDDEN_CLASS);
    }

    const hideTrigger = hideStart ? ScrollTrigger.create({
      trigger: hideStart,
      start: 'top top',
      end: 'max',
      onUpdate: handleHideScroll,
      onLeaveBack: showHeader,
    }) : null;

    function handleResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        // height-only resizes (mobile URL bar) leave the geometry untouched
        if (header.getBoundingClientRect().width === lastWidth) return;
        setup();
      }, RESIZE_DEBOUNCE);
    }
    window.addEventListener('resize', handleResize);

    function handleVisibility() {
      if (document.hidden) gsap.globalTimeline.pause();
      else gsap.globalTimeline.resume();
    }
    document.addEventListener('visibilitychange', handleVisibility);

    // the browser can restore a scrolled position after init - re-apply the
    // matching state instantly rather than animating into it
    if (document.readyState !== 'complete') {
      window.addEventListener('load', function () {
        if (isReady && (!tl || !tl.isActive())) setup();
      }, { once: true });
    }

    // --- 8. Initial DOM state ---
    tailInner = splitWordmark();

    // --- 9. Reduced motion ---
    // Reduced motion swaps state instantly and only crossfades the glass.
    // The rebuild is deferred a frame so the trigger is not owned (and later
    // reverted) by the matchMedia context.
    const mm = gsap.matchMedia();
    mm.add({
      reduce: '(prefers-reduced-motion: reduce)',
      motion: '(prefers-reduced-motion: no-preference)',
    }, function (ctx) {
      const nextReduced = !!ctx.conditions.reduce;
      const changed = nextReduced !== reducedMotion;
      reducedMotion = nextReduced;
      if (isReady && changed) requestAnimationFrame(setup);
    });

    // first build once the motion preference is known
    setup();
    isReady = true;
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (!tl || !tl.isActive()) setup();
      });
    }

    // --- 10. Public API ---
    return {
      dock: dock,
      undock: undock,
      refresh: setup,
      // Timeline inspector demo (ADR-0011): one dock pass, a short hold,
      // then the way back - ends in the open top state. Pre-built
      // paused at setup, so it never autoplays.
      demo: function () {
        if (!demoTl || isDocked || tl.progress() > 0 || demoTl.isActive()) return null;
        demoTl.restart(true, false);
        return demoTl;
      },
      kill: function () {
        window.removeEventListener('scroll', handleToggleScroll);
        window.removeEventListener('resize', handleResize);
        document.removeEventListener('visibilitychange', handleVisibility);
        clearTimeout(resizeTimer);
        mm.revert();
        if (trigger) trigger.kill(false, true);
        if (hideTrigger) hideTrigger.kill();
        if (tl) tl.kill();
        if (demoTl) demoTl.kill();
        if (rmFade) rmFade.kill();
        gsap.set([bg, nav, tailInner].concat(items).filter(Boolean), { clearProps: 'all' });
        header.classList.remove(DOCKED_CLASS, HIDDEN_CLASS);
      },
    };
  }

  function waitForGSAP(cb, attempts) {
    attempts = attempts || 0;
    if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined' && typeof CustomEase !== 'undefined') {
      cb();
      return;
    }
    if (attempts < 100) setTimeout(function () { waitForGSAP(cb, attempts + 1); }, 50);
    else console.error('[Annnimate] gsap/ScrollTrigger/CustomEase failed to load');
  }

  waitForGSAP(function () {
    gsap.registerPlugin(ScrollTrigger, CustomEase);
    if (!CustomEase.get('annnimate')) {
      CustomEase.create('annnimate', 'M0,0 C0.3,0.9 0.1,1 1,1');
    }
    if (!CustomEase.get('annnimateInOut')) {
      CustomEase.create('annnimateInOut', 'M0,0 C0.7,0 0.16,1 1,1');
    }

    const instances = [];
    function initAll() {
      document.querySelectorAll('[data-anm-floating-navbar]').forEach(function (el) {
        const api = initFloatingNavbar(el);
        if (api) instances.push(api);
      });
    }
    initAll();

    window.Anm = window.Anm || {};
    window.Anm.FloatingNavbar = {
      refresh: function () {
        instances.forEach(function (i) { i.kill(); });
        instances.length = 0;
        initAll();
      },
      dock: function () { instances.forEach(function (i) { i.dock(); }); },
      undock: function () { instances.forEach(function (i) { i.undock(); }); },
      demo: function () { return instances[0] ? instances[0].demo() : null; },
    };
  });
})();
