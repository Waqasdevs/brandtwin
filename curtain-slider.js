(function () {
  'use strict';

  // Curtain Slider - full-bleed drop-in video & image slider. Each slide is
  // built from N vertical column strips. Advancing wipes the OUTGOING slide's
  // columns away IN PLACE: each column's clip edge sweeps sideways (side
  // and stagger both follow travel direction) - the curtain - revealing the
  // incoming slide zoom-settling beneath. Per-slide title/label/index roll
  // via masked chars. House pill navigation + drag/swipe + keyboard +
  // optional auto-advance.

  function initCurtainSlider(container) {
    // --- 1. Selectors ---
    const stage = container.querySelector('[data-anm-cs-stage]');
    const slideEls = Array.prototype.slice.call(container.querySelectorAll('[data-anm-cs-slide]'));

    if (!stage || !slideEls.length) return null;
    if (isDisabledOnViewport(container)) return null;

    // --- 2. Config ---
    const duration = parseFloat(container.dataset.anmDuration || '1.1');
    const easeName = container.dataset.anmEase || 'annnimate';
    const columns = Math.max(2, Math.min(24, parseInt(container.dataset.anmColumns || '12', 10) || 12));
    const autoSeconds = parseFloat(container.dataset.anmAuto || '0');
    const dragEnabled = container.dataset.anmDrag !== 'false';
    const charStagger = parseFloat(container.dataset.anmStagger || '0.0125');
    const ease = typeof CustomEase !== 'undefined' && (easeName === 'annnimate' || easeName === 'annnimateInOut')
      ? easeName
      : (easeName || 'expo.out');

    // --- 3. Constants ---
    const STRIP_DUR_RATIO = 0.62;
    const INCOMING_SHADE = 0.18;
    const OUT_SHADE = 0.3;
    const ZOOM_FROM = 1.3;
    const TITLE_OUT_DUR = 0.55;
    const TITLE_IN_DUR = 0.95;
    const LABEL_DUR = 0.5;
    const DIGIT_DUR = 0.7;
    const BAR_DUR = duration * 0.8;
    const SWIPE_THRESHOLD_RATIO = 0.12;
    const ARROW_HOVER_DUR = 0.35;
    const ARROW_PRESS_DUR = 0.15;
    const AUTO_RESUME_DELAY = 5;

    // --- 4. State ---
    const slides = slideEls.map(function (el, idx) {
      const video = el.querySelector('video');
      const source = video ? video.querySelector('source') : null;
      const img = el.querySelector('img');
      const videoSrc = video
        ? (video.getAttribute('src') || (source ? source.getAttribute('src') : '') || video.currentSrc || video.src)
        : '';
      const posterSrc = video
        ? (video.getAttribute('poster') || (img ? (img.currentSrc || img.src) : ''))
        : '';
      const imgSrc = img ? (img.currentSrc || img.src) : posterSrc;

      let videoEl = null;
      let posterImg = null;

      if (videoSrc) {
        videoEl = document.createElement('video');
        videoEl.src = videoSrc;
        if (posterSrc) videoEl.poster = posterSrc;
        videoEl.muted = true;
        videoEl.defaultMuted = true;
        videoEl.loop = true;
        videoEl.playsInline = true;
        videoEl.setAttribute('muted', '');
        videoEl.setAttribute('playsinline', '');
        videoEl.setAttribute('loop', '');
        videoEl.preload = idx < 2 ? 'auto' : 'metadata';
        videoEl.load();
      }

      if (posterSrc) {
        posterImg = new Image();
        posterImg.decoding = 'async';
        posterImg.src = posterSrc;
      }

      return {
        title: el.dataset.title || '',
        label: el.dataset.label || '',
        src: imgSrc,
        videoSrc: videoSrc,
        posterSrc: posterSrc,
        videoEl: videoEl,
        posterImg: posterImg,
        alt: img ? img.alt || '' : (el.dataset.title || ''),
      };
    });

    let currentIndex = 0;
    let refs = null;
    let zTop = 0;
    let goToSeq = 0;
    let inFlight = null;
    let lastGoTo = 0;
    let dragStart = 0;
    let dragActive = false;
    let dragAxisSize = 1;
    let autoTimer = null;
    let reducedMotion = false;
    let stageWidth = 1;
    let stageHeight = 1;

    // --- 5. Helpers ---

    function isDisabledOnViewport(el) {
      const disable = el.dataset.anmDisable;
      if (!disable) return false;
      const breakpoints = {
        mobile: '(max-width: 479px)',
        tablet: '(max-width: 991px)',
        landscape: '(orientation: landscape) and (max-width: 767px)',
        desktop: '(min-width: 992px)',
      };
      return disable.split(',').some(function (v) {
        const q = breakpoints[v.trim()];
        return q && window.matchMedia(q).matches;
      });
    }

    function indexLabel(i) {
      return String(i + 1).padStart(2, '0');
    }

    function buildCharLine(text, lineClass, charClass) {
      const line = document.createElement('span');
      line.className = lineClass;
      text.split('').forEach(function (ch) {
        const span = document.createElement('span');
        span.className = charClass;
        span.textContent = ch === ' ' ? '\xA0' : ch;
        line.appendChild(span);
      });
      return line;
    }

    function splitChars(el, text, lineClass, charClass) {
      el.innerHTML = '';
      const line = buildCharLine(text, lineClass, charClass);
      el.appendChild(line);
      return Array.from(line.querySelectorAll('.' + charClass));
    }

    function swapChars(el, newText, lineClass, charClass, outVars, inVars) {
      const oldLine = el.querySelector('.' + lineClass + ':not(.cs_line_out)');
      if (oldLine) {
        oldLine.classList.add('cs_line_out');
        const oldChars = oldLine.querySelectorAll('.' + charClass);
        gsap.to(oldChars, Object.assign({
          onComplete: function () { oldLine.remove(); },
        }, outVars));
      }
      const line = buildCharLine(newText, lineClass, charClass);
      el.appendChild(line);
      const chars = Array.from(line.querySelectorAll('.' + charClass));
      gsap.set(chars, inVars.from);
      gsap.to(chars, inVars.to);
      return chars;
    }

    function buildDigitColumn(digitChar) {
      const wrap = document.createElement('span');
      wrap.className = 'cs_digit_wrap';
      const roller = document.createElement('span');
      roller.className = 'cs_digit_roller';
      for (let d = 0; d <= 9; d++) {
        const s = document.createElement('span');
        s.textContent = String(d);
        roller.appendChild(s);
      }
      wrap.appendChild(roller);
      wrap._digit = parseInt(digitChar, 10);
      wrap._roller = roller;
      return wrap;
    }

    function setIndexDisplay(el, valueString) {
      el.innerHTML = '';
      valueString.split('').forEach(function (ch) {
        const col = buildDigitColumn(ch);
        gsap.set(col._roller, { y: -col._digit + 'em' });
        el.appendChild(col);
      });
      const divider = document.createElement('span');
      divider.className = 'cs_index_divider';
      divider.textContent = '/';
      el.appendChild(divider);
      const total = document.createElement('span');
      total.className = 'cs_index_total';
      total.textContent = indexLabel(slides.length - 1);
      el.appendChild(total);
    }

    function rollIndex(el, value) {
      const cols = Array.from(el.querySelectorAll('.cs_digit_wrap'));
      value.split('').forEach(function (d, i) {
        const col = cols[i];
        if (!col) return;
        const target = parseInt(d, 10);
        col._digit = target;
        gsap.to(col._roller, {
          y: -target + 'em',
          duration: DIGIT_DUR,
          ease: 'expo.inOut',
          force3D: true,
          overwrite: true,
        });
      });
    }

    function drawSlideLayer(slideIdx) {
      if (!refs || !refs.layerParts[slideIdx]) return;
      const slide = slides[slideIdx];
      const parts = refs.layerParts[slideIdx];
      if (!parts.canvases.length) return;

      const videoEl = slide.videoEl;
      const posterImg = slide.posterImg;
      let source = null;
      let mediaW = 0;
      let mediaH = 0;

      if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        source = videoEl;
        mediaW = videoEl.videoWidth;
        mediaH = videoEl.videoHeight;
      } else if (posterImg && posterImg.complete && posterImg.naturalWidth > 0) {
        source = posterImg;
        mediaW = posterImg.naturalWidth;
        mediaH = posterImg.naturalHeight;
      }

      if (!source || !mediaW || !mediaH) return;

      const w = stageWidth || 1;
      const h = stageHeight || 1;
      const scale = Math.max(w / mediaW, h / mediaH);
      const cropW = w / scale;
      const cropH = h / scale;
      const cropX = (mediaW - cropW) * 0.5;
      const cropY = (mediaH - cropH) * 0.5;

      for (let c = 0; c < columns; c++) {
        const ctx = parts.ctxs[c];
        const canvas = parts.canvases[c];
        if (!ctx || !canvas) continue;
        const stripLeft = parts.stripLefts[c];
        const stripWidth = parts.stripWidths[c];
        const sx = cropX + (stripLeft / w) * cropW;
        const sw = (stripWidth / w) * cropW;
        try {
          ctx.drawImage(source, sx, cropY, sw, cropH, 0, 0, canvas.width, canvas.height);
        } catch (err) {
          // Ignore transient decode frame errors
        }
      }
    }

    function tickVideos() {
      if (!refs) return;
      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        if (!slide.videoEl) continue;
        const isVisible = refs.layers[i].style.visibility !== 'hidden';
        if (isVisible) {
          if (slide.videoEl.paused) {
            slide.videoEl.play().catch(function () {});
          }
          drawSlideLayer(i);
        } else {
          if (!slide.videoEl.paused) {
            slide.videoEl.pause();
          }
        }
      }
    }

    function layoutStrips() {
      const w = stage.clientWidth || 1;
      const h = stage.clientHeight || 1;
      stageWidth = w;
      stageHeight = h;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const edges = [];
      for (let c = 0; c <= columns; c++) edges.push(Math.round((c * w) / columns));

      refs.layerParts.forEach(function (parts, idx) {
        for (let c = 0; c < columns; c++) {
          const strip = parts.strips[c];
          const inner = parts.inners[c];
          const overlap = c < columns - 1 ? 1 : 0;
          const stripLeft = edges[c];
          const stripW = edges[c + 1] - edges[c] + overlap;
          strip.style.left = stripLeft + 'px';
          strip.style.width = stripW + 'px';
          parts.stripLefts[c] = stripLeft;
          parts.stripWidths[c] = stripW;

          if (inner) {
            inner.style.left = (-stripLeft) + 'px';
            inner.style.width = w + 'px';
          }
          if (parts.canvases[c]) {
            parts.canvases[c].width = Math.max(1, Math.round(stripW * dpr));
            parts.canvases[c].height = Math.max(1, Math.round(h * dpr));
          }
        }
        if (slides[idx].videoSrc) {
          drawSlideLayer(idx);
        }
      });
    }

    function setLayerVisible(layer, visible) {
      layer.style.visibility = visible ? '' : 'hidden';
    }

    function clearStripClips(parts) {
      for (let s = 0; s < parts.strips.length; s++) {
        parts.strips[s].style.clipPath = 'none';
        parts.strips[s].style.removeProperty('--csc');
      }
    }

    // --- 6. Animation routines ---

    function buildStage() {
      stage.innerHTML = '';

      const layerWrap = document.createElement('div');
      layerWrap.className = 'cs_layers';
      const layerParts = [];
      const layers = slides.map(function (slide, i) {
        const layer = document.createElement('div');
        layer.className = 'cs_layer';
        layer.style.zIndex = String(i);
        layer.style.visibility = i === currentIndex ? '' : 'hidden';
        const parts = {
          strips: [],
          inners: [],
          imgs: [],
          canvases: [],
          ctxs: [],
          shades: [],
          stripLefts: [],
          stripWidths: [],
        };

        for (let c = 0; c < columns; c++) {
          const strip = document.createElement('div');
          strip.className = 'cs_strip';

          if (slide.videoSrc) {
            const canvas = document.createElement('canvas');
            canvas.className = 'cs_strip_canvas';
            const ctx = canvas.getContext('2d', { alpha: false });
            strip.appendChild(canvas);
            parts.canvases.push(canvas);
            parts.ctxs.push(ctx);
            parts.inners.push(null);
            parts.imgs.push(null);
          } else {
            const inner = document.createElement('div');
            inner.className = 'cs_strip_inner';
            const img = document.createElement('img');
            img.className = 'cs_layer_img';
            img.src = slide.src;
            img.alt = c === 0 ? slide.alt : '';
            img.loading = 'eager';
            inner.appendChild(img);
            strip.appendChild(inner);
            parts.inners.push(inner);
            parts.imgs.push(img);
            parts.canvases.push(null);
            parts.ctxs.push(null);
          }

          const shade = document.createElement('div');
          shade.className = 'cs_shade';
          shade.setAttribute('aria-hidden', 'true');
          strip.appendChild(shade);
          layer.appendChild(strip);

          parts.strips.push(strip);
          parts.shades.push(shade);
          parts.stripLefts.push(0);
          parts.stripWidths.push(1);
        }

        if (slide.posterImg) {
          slide.posterImg.addEventListener('load', function () {
            drawSlideLayer(i);
          });
        }
        if (slide.videoEl) {
          slide.videoEl.addEventListener('loadeddata', function () {
            drawSlideLayer(i);
          });
        }

        layerParts.push(parts);
        layerWrap.appendChild(layer);
        return layer;
      });

      const scrim = document.createElement('div');
      scrim.className = 'cs_scrim';
      scrim.setAttribute('aria-hidden', 'true');

      const labelEl = document.createElement('div');
      labelEl.className = 'cs_label';

      const titleEl = document.createElement('h2');
      titleEl.className = 'cs_title';

      const indexEl = document.createElement('div');
      indexEl.className = 'cs_index';
      indexEl.setAttribute('aria-hidden', 'true');

      const progress = document.createElement('div');
      progress.className = 'cs_progress';
      progress.setAttribute('aria-hidden', 'true');
      const progressFill = document.createElement('div');
      progressFill.className = 'cs_progress_fill';
      progress.appendChild(progressFill);

      const pill = document.createElement('div');
      pill.className = 'cs_pill';
      pill.setAttribute('role', 'group');
      pill.setAttribute('aria-label', 'Slide controls');

      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'cs_arrow';
      prevBtn.setAttribute('aria-label', 'Previous slide');
      prevBtn.innerHTML = '<svg class="cs_arrow_icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'cs_arrow';
      nextBtn.setAttribute('aria-label', 'Next slide');
      nextBtn.innerHTML = '<svg class="cs_arrow_icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

      pill.appendChild(prevBtn);
      pill.appendChild(nextBtn);

      const liveRegion = document.createElement('div');
      liveRegion.className = 'cs_live';
      liveRegion.setAttribute('aria-live', 'polite');

      stage.appendChild(layerWrap);
      stage.appendChild(scrim);
      stage.appendChild(labelEl);
      stage.appendChild(titleEl);
      stage.appendChild(indexEl);
      stage.appendChild(progress);
      stage.appendChild(pill);
      stage.appendChild(liveRegion);

      refs = {
        layers: layers,
        layerParts: layerParts,
        labelEl: labelEl,
        titleEl: titleEl,
        indexEl: indexEl,
        progressFill: progressFill,
        prevBtn: prevBtn,
        nextBtn: nextBtn,
        liveRegion: liveRegion,
      };

      layoutStrips();
      settleCurrent();
      gsap.ticker.add(tickVideos);
      return { prevBtn: prevBtn, nextBtn: nextBtn };
    }

    function settleCurrent() {
      const slide = slides[currentIndex];

      const titleChars = splitChars(refs.titleEl, slide.title, 'cs_title_line', 'cs_title_char');
      gsap.set(titleChars, { yPercent: 0, y: 0 });

      const labelChars = splitChars(refs.labelEl, slide.label, 'cs_label_line', 'cs_title_char');
      gsap.set(labelChars, { yPercent: 0, y: 0 });

      setIndexDisplay(refs.indexEl, indexLabel(currentIndex));

      gsap.set(refs.progressFill, {
        scaleX: (currentIndex + 1) / slides.length,
        transformOrigin: 'left center',
      });

      drawSlideLayer(currentIndex);
      announce();
    }

    function announce() {
      refs.liveRegion.textContent = 'Slide ' + (currentIndex + 1) + ' of ' + slides.length + ': ' + slides[currentIndex].title;
    }

    function animateArrowHover(btn, dir) {
      const icon = btn.querySelector('.cs_arrow_icon');
      btn.addEventListener('mouseenter', function () {
        gsap.to(icon, { x: dir * 3, duration: ARROW_HOVER_DUR, ease: 'back.out(2)', overwrite: 'auto', force3D: true });
      });
      btn.addEventListener('mouseleave', function () {
        gsap.to(icon, { x: 0, duration: ARROW_HOVER_DUR, ease: 'expo.out', overwrite: 'auto', force3D: true });
      });
      btn.addEventListener('pointerdown', function () {
        gsap.to(btn, { scale: 0.92, duration: ARROW_PRESS_DUR, ease: 'power2.out', overwrite: 'auto', force3D: true });
      });
      btn.addEventListener('pointerup', function () {
        gsap.to(btn, { scale: 1, duration: ARROW_PRESS_DUR, ease: 'back.out(2.5)', overwrite: 'auto', force3D: true });
      });
      btn.addEventListener('pointerleave', function () {
        gsap.to(btn, { scale: 1, duration: ARROW_PRESS_DUR, ease: 'power2.out', overwrite: 'auto', force3D: true });
      });
    }

    // direction: 1 = next, -1 = prev
    function goTo(newIndex, direction) {
      if (newIndex === currentIndex) return;
      const now = performance.now();
      if (now - lastGoTo < 150) return;
      lastGoTo = now;

      if (inFlight && newIndex === inFlight.outIndex) {
        inFlight.tl.progress(1);
        inFlight = null;
      }

      const outIndex = currentIndex;
      currentIndex = newIndex;
      const slide = slides[newIndex];

      // Preload & prime incoming video frame immediately
      if (slide.videoEl) {
        if (slide.videoEl.preload !== 'auto') slide.videoEl.preload = 'auto';
        if (slide.videoEl.paused) slide.videoEl.play().catch(function () {});
        drawSlideLayer(newIndex);
      }
      // Also warm up next slide's video
      const nextWarmIdx = (newIndex + 1) % slides.length;
      if (slides[nextWarmIdx] && slides[nextWarmIdx].videoEl && slides[nextWarmIdx].videoEl.preload !== 'auto') {
        slides[nextWarmIdx].videoEl.preload = 'auto';
        slides[nextWarmIdx].videoEl.load();
      }

      const seq = ++goToSeq;
      const tl = gsap.timeline({
        onComplete: function () { if (inFlight && inFlight.tl === tl) inFlight = null; },
      });
      inFlight = { tl: tl, outIndex: outIndex };

      const outLayer = refs.layers[outIndex];
      const inLayer = refs.layers[newIndex];
      const outParts = refs.layerParts[outIndex];
      const inParts = refs.layerParts[newIndex];

      zTop += 2;
      outLayer.style.zIndex = String(slides.length + zTop + 1);
      inLayer.style.zIndex = String(slides.length + zTop);
      setLayerVisible(outLayer, true);
      setLayerVisible(inLayer, true);

      gsap.killTweensOf(inParts.strips);
      gsap.killTweensOf(inParts.shades);
      gsap.killTweensOf(inLayer);
      clearStripClips(inParts);
      gsap.set(inLayer, { scale: ZOOM_FROM, transformOrigin: '50% 50%', force3D: true });
      gsap.set(inParts.shades, { opacity: INCOMING_SHADE });

      const stripDur = duration * STRIP_DUR_RATIO;
      const stripStagger = (duration - stripDur) / Math.max(1, columns - 1);

      gsap.killTweensOf(outParts.strips);
      for (let s = 0; s < outParts.strips.length; s++) {
        outParts.strips[s].style.clipPath = direction > 0
          ? 'inset(0% 0% 0% var(--csc, 0%))'
          : 'inset(0% var(--csc, 0%) 0% 0%)';
      }
      gsap.set(outParts.strips, { '--csc': '0%' });
      tl.to(outParts.strips, {
        '--csc': '105%',
        duration: stripDur,
        ease: ease,
        stagger: direction > 0 ? stripStagger : -stripStagger,
        overwrite: true,
        data: { label: 'Curtain columns wipe away' },
      }, 0);
      gsap.killTweensOf(outParts.shades);
      tl.to(outParts.shades, {
        opacity: OUT_SHADE,
        duration: stripDur * 0.8,
        ease: 'power1.in',
        stagger: direction > 0 ? stripStagger : -stripStagger,
        overwrite: 'auto',
        data: { label: 'Outgoing slide dims' },
      }, 0);

      tl.to(inLayer, {
        scale: 1,
        duration: duration * 1.05,
        ease: ease,
        force3D: true,
        data: { label: 'Incoming plate zoom-settles' },
      }, 0);
      tl.to(inParts.shades, {
        opacity: 0,
        duration: duration * 1.05,
        ease: ease,
        data: { label: 'Incoming brightens to full' },
      }, 0);

      tl.call(function () {
        if (seq !== goToSeq) return;
        refs.layers.forEach(function (layer, i) {
          const parts = refs.layerParts[i];
          gsap.killTweensOf(parts.strips);
          gsap.killTweensOf(parts.shades);
          gsap.killTweensOf(layer);
          clearStripClips(parts);
          gsap.set(layer, { scale: 1 });
          gsap.set(parts.shades, { opacity: 0 });
          setLayerVisible(layer, i === newIndex);
          layer.style.zIndex = i === newIndex ? String(slides.length) : String(i);
        });
      }, null, duration);

      swapChars(refs.titleEl, slide.title, 'cs_title_line', 'cs_title_char', {
        yPercent: direction > 0 ? -120 : 120,
        y: 0,
        duration: TITLE_OUT_DUR,
        ease: 'annnimateInOut',
        stagger: direction > 0 ? charStagger : -charStagger,
        force3D: true,
        overwrite: true,
      }, {
        from: { yPercent: direction > 0 ? 120 : -120, y: 0 },
        to: { yPercent: 0, y: 0, duration: TITLE_IN_DUR, ease: 'annnimateInOut', stagger: direction > 0 ? charStagger : -charStagger, force3D: true, overwrite: true },
      });

      swapChars(refs.labelEl, slide.label, 'cs_label_line', 'cs_title_char', {
        yPercent: direction > 0 ? -110 : 110,
        y: 0,
        duration: LABEL_DUR * 0.7,
        ease: 'annnimateInOut',
        force3D: true,
        overwrite: true,
      }, {
        from: { yPercent: direction > 0 ? 110 : -110, y: 0 },
        to: { yPercent: 0, y: 0, duration: LABEL_DUR, ease: 'annnimateInOut', force3D: true, overwrite: true },
      });

      rollIndex(refs.indexEl, indexLabel(newIndex));

      gsap.set(refs.progressFill, { transformOrigin: 'left center' });
      tl.to(refs.progressFill, {
        scaleX: (newIndex + 1) / slides.length,
        duration: BAR_DUR,
        ease: ease,
        force3D: true,
        overwrite: 'auto',
        data: { label: 'Progress bar advances' },
      }, 0);

      announce();
    }

    function next() {
      const i = (currentIndex + 1) % slides.length;
      goTo(i, 1);
    }

    function prev() {
      const i = (currentIndex - 1 + slides.length) % slides.length;
      goTo(i, -1);
    }

    // --- 7. Event listeners ---

    const { prevBtn, nextBtn } = buildStage();

    prevBtn.addEventListener('click', function () { prev(); armAutoResume(); });
    nextBtn.addEventListener('click', function () { next(); armAutoResume(); });
    animateArrowHover(prevBtn, -1);
    animateArrowHover(nextBtn, 1);

    function handleKeydown(e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { next(); armAutoResume(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { prev(); armAutoResume(); }
    }
    container.setAttribute('tabindex', container.getAttribute('tabindex') || '0');
    container.addEventListener('keydown', handleKeydown);

    function handlePointerDown(e) {
      if (!dragEnabled) return;
      if (e.target.closest('.cs_pill') || e.target.closest('button') || e.target.closest('a')) {
        dragActive = false;
        return;
      }
      dragActive = true;
      dragStart = e.clientX;
      dragAxisSize = stage.clientWidth || 1;
    }
    function handlePointerUp(e) {
      if (!dragActive) return;
      dragActive = false;
      const pos = e.clientX;
      const delta = pos - dragStart;
      const threshold = dragAxisSize * SWIPE_THRESHOLD_RATIO;
      if (Math.abs(delta) < threshold) return;
      if (delta < 0) next(); else prev();
      armAutoResume();
    }
    container.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerUp);

    function stopAuto() {
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    }
    function startAuto() {
      stopAuto();
      if (autoSeconds > 0 && !reducedMotion) {
        autoTimer = setInterval(next, autoSeconds * 1000);
      }
    }
    let resumeTimer = null;
    function armAutoResume() {
      if (autoSeconds <= 0) return;
      stopAuto();
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(startAuto, AUTO_RESUME_DELAY * 1000);
    }
    container.addEventListener('mouseenter', stopAuto);
    container.addEventListener('mouseleave', startAuto);
    container.addEventListener('focusin', stopAuto);
    container.addEventListener('focusout', startAuto);

    // --- 8. Initial DOM state ---
    container.setAttribute('role', 'region');
    container.setAttribute('aria-roledescription', 'carousel');
    container.setAttribute('aria-label', slides[currentIndex].title);

    // --- 9. Reduced motion ---
    gsap.matchMedia().add('(prefers-reduced-motion: reduce)', function () {
      reducedMotion = true;
      gsap.globalTimeline.timeScale(20);
    });

    // --- 10. Public API ---

    let resizeTimer = null;
    function handleResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        layoutStrips();
      }, 150);
    }
    window.addEventListener('resize', handleResize);

    function handleVisibility() {
      if (document.hidden) { gsap.globalTimeline.pause(); stopAuto(); }
      else { gsap.globalTimeline.resume(); startAuto(); }
    }
    document.addEventListener('visibilitychange', handleVisibility);

    startAuto();

    return {
      refresh: function () { layoutStrips(); settleCurrent(); },
      next: function () { next(); armAutoResume(); },
      prev: function () { prev(); armAutoResume(); },
      goTo: function (i) {
        if (i === currentIndex || i < 0 || i >= slides.length) return;
        goTo(i, i > currentIndex ? 1 : -1);
        armAutoResume();
      },
      demo: function () {
        next();
        return inFlight ? inFlight.tl : null;
      },
      kill: function () {
        stopAuto();
        clearTimeout(resumeTimer);
        gsap.ticker.remove(tickVideos);
        window.removeEventListener('resize', handleResize);
        document.removeEventListener('visibilitychange', handleVisibility);
        container.removeEventListener('keydown', handleKeydown);
        container.removeEventListener('pointerdown', handlePointerDown);
        window.removeEventListener('pointerup', handlePointerUp);
      },
    };
  }

  function waitForGSAP(cb, attempts) {
    attempts = attempts || 0;
    const ready = typeof gsap !== 'undefined' && typeof CustomEase !== 'undefined';
    if (ready) { cb(); return; }
    if (attempts < 100) setTimeout(function () { waitForGSAP(cb, attempts + 1); }, 50);
    else console.error('[Annnimate] gsap/CustomEase failed to load');
  }

  waitForGSAP(function () {
    gsap.registerPlugin(CustomEase);
    CustomEase.create('annnimate', 'M0,0 C0.3,0.9 0.1,1 1,1');
    CustomEase.create('annnimateInOut', 'M0,0 C0.7,0 0.16,1 1,1');

    const instances = [];
    document.querySelectorAll('[data-anm-curtain-slider]').forEach(function (el) {
      const api = initCurtainSlider(el);
      if (api) instances.push(api);
    });
    window.Anm = window.Anm || {};
    window.Anm.CurtainSlider = {
      refresh: function () { instances.forEach(function (i) { i.refresh(); }); },
      next: function () { instances.forEach(function (i) { i.next(); }); },
      prev: function () { instances.forEach(function (i) { i.prev(); }); },
      goTo: function (i) { instances.forEach(function (inst) { inst.goTo(i); }); },
      demo: function () { return instances[0] ? instances[0].demo() : null; },
    };
  });
})();
