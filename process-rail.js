(function () {
  'use strict';

  function initProcessRail(container) {
    // --- 1. Selectors ---
    const rail = container.querySelector('[data-anm-prl-rail]');
    const bead = container.querySelector('[data-anm-prl-bead]');
    const paths = Array.from(container.querySelectorAll('[data-anm-prl-path]'));
    const stepEls = Array.from(container.querySelectorAll('[data-anm-prl-step]'));

    if (!rail || !bead || !paths.length || !stepEls.length) return;

    // --- 2. Config ---
    const scrubNum = parseFloat(container.dataset.anmScrub);
    const scrub = isNaN(scrubNum) ? 0.6 : (scrubNum > 0 ? scrubNum : true);
    const beadSize = parseFloat(container.dataset.anmBeadSize || '10');
    const sticky = container.dataset.anmSticky !== 'false';
    const stagger = parseFloat(container.dataset.anmStagger || '0.08');
    const disableList = (container.dataset.anmDisable || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    // --- 3. Constants ---
    CustomEase.create('annnimate', 'M0,0 C0.3,0.9 0.1,1 1,1');

    const EASE = 'annnimate';
    // extra scroll the sticky stage holds for, in viewport heights
    const TRACK_VH = 200;
    // a click scrolls just past the step's anchor, so the step is reached
    const ARRIVE = 0.02;
    // only the bead and the line are scrubbed; a step's arrival plays in seconds
    // when the bead reaches it and plays back when the page scrolls above it
    const CARD_DUR = 0.5;
    const MEDIA_DUR = 0.8;
    const ROLL_DUR = 0.6;
    const ROLL_STAGGER = 0.05;
    // opacity tiers: not reached yet, already passed, active is 1
    const UPCOMING = 0.42;
    const VISITED = 0.72;
    // a step's image scales up from MEDIA_FROM when the bead reaches it, then stays
    const MEDIA_FROM = 0.9;
    // on mobile the bead reaches a step's number as that number crosses this height
    // in the viewport (the stage does not stick there)
    const MOBILE_READ = '60%';
    const BREAKPOINTS = {
      mobile: '(max-width: 479px)',
      landscape: '(orientation: landscape) and (max-width: 767px)',
      tablet: '(max-width: 991px)',
      desktop: '(min-width: 992px)',
    };

    // --- 4. State ---
    let tl = null;
    let current = null;
    let active = -1;
    let reduced = false;
    let resizeTimer = null;
    const steps = [];
    const ghosts = new Map();
    const mm = gsap.matchMedia();

    // --- 5. Helpers ---
    // Where each step sits on the line, as path progress. layout() measures it:
    // desktop, the middle of each step's column; mobile, each step's number.
    function anchorAt(i) {
      return current && current.anchors ? current.anchors[i] : 0;
    }

    function pathFor(isMobile) {
      const want = isMobile ? 'mobile' : 'desktop';
      return paths.find(function (p) { return p.dataset.anmPrlPath === want; }) || paths[0];
    }

    // The index text becomes one column per digit: a 1em window over a strip
    // of glyphs 0..d that starts one glyph below the window (empty slot) and
    // rolls up until d is in view. Non-digits stay as plain text.
    function buildColumns(host) {
      const text = host.textContent.trim();
      const strips = [];
      const hidden = [];
      const targets = [];
      host.textContent = '';
      const match = text.match(/^([^0-9]+)(.*)$/);
      const prefix = match ? match[1] : '';
      const rest = match ? match[2] : text;
      if (prefix) {
        const col = document.createElement('span');
        col.className = 'prl_col';
        col.style.width = 'auto';
        const sizer = document.createElement('span');
        sizer.style.visibility = 'hidden';
        sizer.textContent = prefix.replace(/ /g, '\u00A0');
        col.appendChild(sizer);
        const strip = document.createElement('span');
        strip.className = 'prl_strip';
        const glyph = document.createElement('span');
        glyph.className = 'prl_glyph';
        glyph.textContent = prefix.replace(/ /g, '\u00A0');
        strip.appendChild(glyph);
        col.appendChild(strip);
        host.appendChild(col);
        strips.push(strip);
        hidden.push(100);
        targets.push(0);
      }
      rest.split('').forEach(function (ch) {
        if (!/[0-9]/.test(ch)) {
          const plain = document.createElement('span');
          plain.textContent = ch === ' ' ? '\u00A0' : ch;
          host.appendChild(plain);
          return;
        }
        const d = parseInt(ch, 10);
        const len = d + 1;
        const col = document.createElement('span');
        col.className = 'prl_col';
        const strip = document.createElement('span');
        strip.className = 'prl_strip';
        for (let g = 0; g <= d; g++) {
          const glyph = document.createElement('span');
          glyph.className = 'prl_glyph';
          glyph.textContent = String(g);
          strip.appendChild(glyph);
        }
        col.appendChild(strip);
        host.appendChild(col);
        strips.push(strip);
        hidden.push(100 / len);
        targets.push(-d * 100 / len);
      });
      return { strips: strips, hidden: hidden, targets: targets };
    }

    function ghostOf(path) {
      const ghost = path.cloneNode(false);
      ghost.removeAttribute('data-anm-prl-path');
      ghost.setAttribute('class', 'prl_path_ghost');
      path.parentNode.insertBefore(ghost, path);
      ghosts.set(path, ghost);
    }

    // Fits the line to the steps and measures where each step sits on it.
    function layout() {
      if (!current) return;
      const path = current.path;
      const svg = path.ownerSVGElement;
      const rr = rail.getBoundingClientRect();
      const sr = svg.getBoundingClientRect();
      const w = Math.max(1, Math.round(sr.width));
      const h = Math.max(1, Math.round(sr.height));
      const n = steps.length;
      let d;
      if (current.isMobile) {
        const ys = steps.map(function (s) {
          const r = (s.num || s.el).getBoundingClientRect();
          return Math.round(r.top - sr.top + r.height / 2);
        });
        d = 'M ' + w / 2 + ' ' + ys[0] + ' L ' + w / 2 + ' ' + ys[n - 1];
        current.anchors = steps.map(function (s, i) { return n > 1 ? i / (n - 1) : 0.5; });
      } else {
        d = 'M 0 ' + h / 2 + ' L ' + w + ' ' + h / 2;
        current.anchors = steps.map(function (s) {
          const r = s.el.getBoundingClientRect();
          return gsap.utils.clamp(0.02, 0.98, (r.left + 20 - sr.left) / w);
        });
      }
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      if (path.getAttribute('d') !== d) {
        path.setAttribute('d', d);
        const ghost = ghosts.get(path);
        if (ghost) ghost.setAttribute('d', d);
      }
      const raw = MotionPathPlugin.getRawPath(path);
      MotionPathPlugin.cacheRawPathMeasurements(raw);
      const toRail = function (pt) { return { x: sr.left - rr.left + pt.x, y: sr.top - rr.top + pt.y }; };
      current.pts = steps.map(function (s, i) { return toRail(MotionPathPlugin.getPositionOnPath(raw, anchorAt(i))); });
      current.start = toRail(MotionPathPlugin.getPositionOnPath(raw, 0));
      current.end = toRail(MotionPathPlugin.getPositionOnPath(raw, 1));
    }

    function stepIndexAt(progress) {
      // nothing is reached before the page has scrolled into the track, even where
      // the line starts exactly on the first step (mobile)
      if (!tl || progress <= 0) return -1;
      const t = progress * tl.duration();
      let idx = -1;
      steps.forEach(function (s, i) { if (t >= anchorAt(i) - 0.0001) idx = i; });
      return idx;
    }

    // The bead's position picks the active step; what a step does on arrival is a
    // normal tween, not scrubbed. Reached steps keep their number and image, and
    // scrolling back above a step plays its arrival back out.
    function setActive(i) {
      if (i === active) return;
      active = i;
      steps.forEach(function (s, k) {
        if (k === i) s.btn.setAttribute('aria-current', 'step');
        else s.btn.removeAttribute('aria-current');
        const reached = k <= i;
        setTier(s, k === i ? 1 : (reached ? VISITED : UPCOMING));
        showMedia(s, reached);
        rollNumber(s, reached);
      });
    }

    // Tear-down without playing anything back; the next build parks every step.
    function clearActive() {
      active = -1;
      steps.forEach(function (s) {
        s.btn.removeAttribute('aria-current');
        gsap.killTweensOf([s.el, s.media].concat(s.strips).filter(Boolean));
      });
    }

    function setTier(s, opacity) {
      if (s.tier === opacity) return;
      s.tier = opacity;
      if (reduced) {
        gsap.set(s.el, { opacity: opacity });
        return;
      }
      gsap.to(s.el, {
        opacity: opacity, duration: CARD_DUR, ease: EASE, overwrite: true,
        data: { label: 'Step card changes tier' },
      });
    }

    function showMedia(s, reached) {
      if (!s.media || s.shown === reached) return;
      s.shown = reached;
      const to = reached ? { opacity: 1, scale: 1 } : { opacity: 0, scale: MEDIA_FROM };
      if (reduced) {
        gsap.set(s.media, to);
        return;
      }
      gsap.to(s.media, Object.assign(to, {
        duration: reached ? MEDIA_DUR : MEDIA_DUR * 0.6,
        delay: reached ? stagger : 0,
        ease: EASE, overwrite: true, force3D: true,
        data: { label: 'Step image ' + (reached ? 'fades and scales in' : 'fades out') },
      }));
    }

    // Digits roll up into their slot when the step is reached and back down out
    // of it when the page scrolls above the step.
    function rollNumber(s, reached) {
      if (!s.strips.length || s.rolled === reached) return;
      s.rolled = reached;
      const to = function (k) { return reached ? s.targets[k] : s.hidden[k]; };
      if (reduced) {
        s.strips.forEach(function (strip, k) { gsap.set(strip, { yPercent: to(k) }); });
        return;
      }
      gsap.to(s.strips, {
        yPercent: function (k) { return to(k); },
        duration: ROLL_DUR,
        delay: reached ? stagger * 2 : 0,
        ease: EASE,
        stagger: reached ? ROLL_STAGGER : -ROLL_STAGGER,
        overwrite: true,
        force3D: true,
        data: { label: 'Step number rolls ' + (reached ? 'in' : 'out') },
      });
    }

    // The scrub stays the single source of truth: a click only moves the
    // page to the scroll position where that step has arrived.
    function scrollToStep(i) {
      if (!tl || !tl.scrollTrigger || i < 0 || i >= steps.length) return;
      const st = tl.scrollTrigger;
      const t = Math.min(tl.duration(), anchorAt(i) + ARRIVE);
      const top = st.start + (st.end - st.start) * (t / tl.duration());
      const scroller = st.scroller && st.scroller !== window ? st.scroller : window;
      scroller.scrollTo({ top: top, behavior: reduced ? 'auto' : 'smooth' });
    }

    // --- 6. Animation routines ---
    // No ScrollTrigger pin anywhere. Desktop (unless data-anm-sticky="false"): the
    // root is a tall track and the stage inside it is CSS position: sticky, so the
    // scrub simply runs from the track's top to its bottom. Phones never stick,
    // because four stacked steps with images are taller than the screen: the track
    // runs from the first step's number to the last crossing MOBILE_READ, clamped
    // to the page so a block near the top does not start part-way through.
    function makeTrigger() {
      const base = {
        scrub: scrub,
        invalidateOnRefresh: true,
        onRefreshInit: layout,
        onUpdate: function (self) { setActive(stepIndexAt(self.progress)); },
      };
      if (current.isMobile) {
        return Object.assign(base, {
          trigger: rail,
          start: function () { return 'clamp(top+=' + Math.round(current.pts[0].y) + ' ' + MOBILE_READ + ')'; },
          end: function () { return 'clamp(top+=' + Math.round(current.pts[current.pts.length - 1].y) + ' ' + MOBILE_READ + ')'; },
        });
      }
      if (sticky) {
        return Object.assign(base, { trigger: container, start: 'top top', end: 'bottom bottom' });
      }
      return Object.assign(base, { trigger: container, start: 'top 82%', end: 'bottom 45%' });
    }

    // Rest before the bead has reached a step: dim, empty number slot, image
    // hidden and scaled down.
    function parkRest() {
      steps.forEach(function (s) {
        gsap.killTweensOf([s.el, s.media].concat(s.strips).filter(Boolean));
        gsap.set(s.el, { opacity: UPCOMING });
        if (s.media) gsap.set(s.media, { opacity: 0, scale: MEDIA_FROM, force3D: true });
        s.strips.forEach(function (strip, k) { gsap.set(strip, { yPercent: s.hidden[k] }); });
        s.tier = UPCOMING;
        s.shown = false;
        s.rolled = false;
      });
    }

    // Everything readable at once: the disabled-viewport state. The line is drawn
    // in full and the bead sits at its end.
    function showAll() {
      steps.forEach(function (s) {
        gsap.killTweensOf([s.el, s.media].concat(s.strips).filter(Boolean));
        gsap.set(s.el, { opacity: 1 });
        if (s.media) gsap.set(s.media, { opacity: 1, scale: 1 });
        s.strips.forEach(function (strip, k) { gsap.set(strip, { yPercent: s.targets[k] }); });
        s.tier = 1;
        s.shown = true;
        s.rolled = true;
      });
      gsap.set(current.path, { drawSVG: '0% 100%' });
      gsap.set(bead, { x: current.end.x, y: current.end.y, xPercent: -50, yPercent: -50 });
    }

    // One scrubbed timeline. The bead's leg is a single explicit 0 -> 1 path
    // tween and the line draws 0% -> 100% over the same span, so the bead is
    // always the end of the line and each step's label sits exactly where the
    // bead reaches its anchor.
    function buildTimeline() {
      const path = current.path;
      const t = gsap.timeline({
        defaults: { ease: EASE, force3D: true },
        scrollTrigger: makeTrigger(),
      });

      t.to(bead, {
        motionPath: { path: path, align: path, alignOrigin: [0.5, 0.5], autoRotate: false, start: 0, end: 1 },
        ease: 'none',
        duration: 1,
        // render the start now, so the bead sits on the line before any scroll
        immediateRender: true,
        data: { label: 'Bead rides the line' },
      }, 0);

      t.fromTo(path,
        { drawSVG: '0% 0%' },
        {
          drawSVG: '0% 100%',
          ease: 'none',
          force3D: false,
          duration: 1,
          data: { label: 'Line draws up to the bead' },
        }, 0);

      // step arrivals are not on this timeline: onUpdate -> setActive plays them
      steps.forEach(function (s, i) {
        t.addLabel('step' + (i + 1), anchorAt(i));
      });

      return t;
    }

    // Reduced motion: no travel, no tweens. The scrub still jumps the bead to
    // the step it has reached with the line drawn up to it, and each step's
    // card, image and number switch without moving.
    function buildReduced() {
      const t = gsap.timeline({ scrollTrigger: makeTrigger() });
      steps.forEach(function (s, i) {
        const at = anchorAt(i);
        const when = i === 0 ? 0 : at;
        t.set(current.path, { drawSVG: '0% ' + at * 100 + '%' }, when);
        t.set(bead, {
          x: function () { return current.pts[i].x; },
          y: function () { return current.pts[i].y; },
          xPercent: -50, yPercent: -50,
        }, when);
      });
      return t;
    }

    // --- 7. Event listeners ---
    function onClick(e) {
      const li = e.target.closest('[data-anm-prl-step]');
      if (!li || !container.contains(li)) return;
      scrollToStep(stepEls.indexOf(li));
    }

    function relayout() {
      layout();
      ScrollTrigger.refresh();
    }

    // Lay out again once ScrollTrigger's refresh is done (sizes are final then).
    function onRefreshed() {
      if (current) layout();
    }

    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(relayout, 150);
    }

    function onVisibility() {
      if (document.hidden) gsap.globalTimeline.pause();
      else gsap.globalTimeline.resume();
    }

    container.addEventListener('click', onClick);
    window.addEventListener('resize', onResize);
    ScrollTrigger.addEventListener('refresh', onRefreshed);
    document.addEventListener('visibilitychange', onVisibility);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);

    // --- 8. Initial DOM state ---
    stepEls.forEach(function (el) {
      const numHost = el.querySelector('[data-anm-prl-num]');
      const cols = numHost ? buildColumns(numHost) : { strips: [], hidden: [], targets: [] };
      steps.push({
        el: el,
        btn: el.querySelector('button') || el,
        num: numHost,
        media: el.querySelector('[data-anm-prl-media]'),
        strips: cols.strips,
        hidden: cols.hidden,
        targets: cols.targets,
      });
    });
    paths.forEach(ghostOf);
    container.style.setProperty('--prl-bead', beadSize + 'px');

    // --- 9. Reduced motion ---
    // Mobile/desktop, reduced-motion and the disable-viewport list are tiled
    // into ONE matchMedia call, so any change tears down the previous build
    // (GSAP reverts the last callback's return value) before rebuilding.
    const conditions = {
      isMobile: '(max-width: 767px)',
      isDesktop: '(min-width: 768px)',
      isReduced: '(prefers-reduced-motion: reduce)',
      isFull: '(prefers-reduced-motion: no-preference)',
    };
    const disableQuery = disableList.map(function (k) { return BREAKPOINTS[k]; }).filter(Boolean).join(', ');
    if (disableQuery) conditions.isDisabledViewport = disableQuery;

    mm.add(conditions, function (context) {
      const isMobile = !!context.conditions.isMobile;
      const disabled = !!context.conditions.isDisabledViewport;
      reduced = !!context.conditions.isReduced;

      current = { isMobile: isMobile, path: pathFor(isMobile), pts: [] };
      // the track only grows tall where the stage sticks
      container.style.setProperty('--prl-track', !isMobile && sticky ? (100 + TRACK_VH) + 'vh' : 'auto');
      layout();

      if (disabled) {
        showAll();
      } else if (reduced) {
        parkRest();
        tl = buildReduced();
      } else {
        parkRest();
        tl = buildTimeline();
      }

      return function () {
        if (tl) {
          if (tl.scrollTrigger) tl.scrollTrigger.kill(true);
          tl.kill();
          tl = null;
        }
        gsap.set(bead, { clearProps: 'transform' });
        paths.forEach(function (p) { gsap.set(p, { clearProps: 'strokeDasharray,strokeDashoffset' }); });
        clearActive();
        current = null;
      };
    });

    // --- 10. Public API ---
    return {
      refresh: relayout,
      scrollTo: scrollToStep,
      kill: function () {
        clearTimeout(resizeTimer);
        container.removeEventListener('click', onClick);
        window.removeEventListener('resize', onResize);
        ScrollTrigger.removeEventListener('refresh', onRefreshed);
        document.removeEventListener('visibilitychange', onVisibility);
        mm.revert();
      },
    };
  }

  function waitForGSAP(cb, attempts) {
    attempts = attempts || 0;
    const ready = typeof gsap !== 'undefined'
      && typeof ScrollTrigger !== 'undefined'
      && typeof MotionPathPlugin !== 'undefined'
      && typeof DrawSVGPlugin !== 'undefined'
      && typeof CustomEase !== 'undefined';
    if (ready) { cb(); return; }
    if (attempts < 150) setTimeout(function () { waitForGSAP(cb, attempts + 1); }, 50);
    else console.error('[Annnimate] gsap/ScrollTrigger/MotionPathPlugin/DrawSVGPlugin/CustomEase failed to load');
  }

  waitForGSAP(function () {
    gsap.registerPlugin(ScrollTrigger, MotionPathPlugin, DrawSVGPlugin, CustomEase);
    const instances = [];
    document.querySelectorAll('[data-anm-process-rail]').forEach(function (el) {
      const api = initProcessRail(el);
      if (api) instances.push(api);
    });
    window.Anm = window.Anm || {};
    window.Anm.ProcessRail = {
      refresh: function () { instances.forEach(function (i) { i.refresh(); }); },
      scrollTo: function (index) { instances.forEach(function (i) { i.scrollTo(index); }); },
      kill: function () { instances.forEach(function (i) { i.kill(); }); instances.length = 0; },
    };
  });
})();
