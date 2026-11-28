(function () {
  'use strict';

  // Modal & form wiring
  const md = document.getElementById('md');
  if (md) {
    document.querySelectorAll('[data-open]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        md.classList.add('on');
      });
    });
    const cl = document.getElementById('cl');
    if (cl) cl.onclick = function () { md.classList.remove('on'); };
    md.addEventListener('click', function (e) {
      if (e.target === md) md.classList.remove('on');
    });
    const form = document.getElementById('f');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        const fb = document.getElementById('fb');
        if (fb) {
          fb.innerHTML = '<h3>Thank you.</h3><p style="color:#58585a">We\'ll send your 3 free studio ads within 48 hours.</p>';
        }
      });
    }
  }

  // Collapsible "More info" drawers (Branded Agency style)
  function initMoreInfo() {
    const collapsedHeight = window.innerWidth <= 900 ? 290 : 260;

    document.querySelectorAll('[data-cs-more]').forEach(function (wrap) {
      const body = wrap.querySelector('[data-cs-more-body]');
      const btn = wrap.querySelector('[data-cs-more-btn]');
      const label = btn ? btn.querySelector('[data-cs-more-label]') : null;
      if (!body || !btn || !label) return;

      const fullH = body.scrollHeight;
      if (fullH <= collapsedHeight + 48) {
        btn.style.display = 'none';
        const fade = wrap.querySelector('.cs_more_fade');
        if (fade) fade.style.display = 'none';
        return;
      }

      body.style.height = collapsedHeight + 'px';
      let isOpen = false;

      btn.addEventListener('click', function () {
        isOpen = !isOpen;
        wrap.classList.toggle('is-open', isOpen);
        btn.setAttribute('aria-expanded', String(isOpen));

        if (isOpen) {
          body.style.height = body.scrollHeight + 'px';
          body.addEventListener('transitionend', function onEnd() {
            if (isOpen) body.style.height = 'auto';
            if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh();
          }, { once: true });
          label.textContent = 'Less info';
        } else {
          body.style.height = body.scrollHeight + 'px';
          requestAnimationFrame(function () {
            body.style.height = collapsedHeight + 'px';
          });
          body.addEventListener('transitionend', function () {
            if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh();
          }, { once: true });
          label.textContent = 'More info';
        }
      });
    });
  }

  // Play/pause inline case study videos when visible
  function initVideoPlayback() {
    const videos = Array.from(document.querySelectorAll('.cs_video'));
    if (!videos.length || !('IntersectionObserver' in window)) return;

    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        const vid = entry.target;
        if (entry.isIntersecting) {
          vid.play().catch(function () {});
        } else if (!vid.paused) {
          vid.pause();
        }
      });
    }, { threshold: 0.15 });

    videos.forEach(function (v) { io.observe(v); });
  }

  function initAnimations() {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
      document.querySelectorAll('.cs_media_curtain').forEach(function (c) { c.style.display = 'none'; });
      return;
    }

    gsap.registerPlugin(ScrollTrigger);
    if (typeof CustomEase !== 'undefined') {
      gsap.registerPlugin(CustomEase);
      CustomEase.create('annnimate', 'M0,0 C0.3,0.9 0.1,1 1,1');
      CustomEase.create('annnimateInOut', 'M0,0 C0.7,0 0.16,1 1,1');
    }
    if (typeof SplitText !== 'undefined') {
      gsap.registerPlugin(SplitText);
    }

    const easeOut = typeof CustomEase !== 'undefined' ? 'annnimate' : 'power3.out';
    const easeMask = typeof CustomEase !== 'undefined' ? 'annnimateInOut' : 'expo.inOut';

    // 1. Hero headline SplitText line reveal + metadata slide-in
    const heroTitle = document.querySelector('[data-cs-hero-title]');
    if (heroTitle && typeof SplitText !== 'undefined') {
      const split = new SplitText(heroTitle, { type: 'lines', linesClass: 'cs_split_line' });
      split.lines.forEach(function (line) {
        const inner = document.createElement('span');
        inner.className = 'cs_split_inner';
        while (line.firstChild) inner.appendChild(line.firstChild);
        line.appendChild(inner);
      });
      const inners = heroTitle.querySelectorAll('.cs_split_inner');
      gsap.fromTo(inners,
        { yPercent: 115 },
        { yPercent: 0, duration: 0.95, stagger: 0.08, ease: easeOut, delay: 0.06, clearProps: 'transform' }
      );
    }

    const heroItems = document.querySelectorAll('[data-cs-hero-item]');
    if (heroItems.length) {
      gsap.fromTo(heroItems,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.85, stagger: 0.09, ease: easeOut, delay: 0.18, clearProps: 'transform' }
      );
    }

    // 2. Scroll-triggered text & card slide-in reveals (.cs_reveal)
    document.querySelectorAll('[data-cs-reveal]').forEach(function (el) {
      const delay = parseFloat(el.getAttribute('data-cs-delay') || '0');
      gsap.fromTo(el,
        { opacity: 0, y: 28 },
        {
          opacity: 1,
          y: 0,
          duration: 0.85,
          delay: delay,
          ease: easeOut,
          clearProps: 'transform',
          scrollTrigger: {
            trigger: el,
            start: 'top 88%',
            once: true,
          },
        }
      );
    });

    // 3. Per-image & video curtain mask reveal + scale settle (Branded Agency style)
    document.querySelectorAll('[data-cs-media]').forEach(function (wrap) {
      const curtain = wrap.querySelector('.cs_media_curtain');
      const media = wrap.querySelector('img, video');
      const tag = wrap.querySelector('.cs_media_tag');
      const delay = parseFloat(wrap.getAttribute('data-cs-delay') || '0');

      const tl = gsap.timeline({
        delay: delay,
        scrollTrigger: {
          trigger: wrap,
          start: 'top 86%',
          once: true,
        },
      });

      if (media) {
        gsap.set(media, { scale: 1.09 });
        tl.to(media, {
          scale: 1,
          duration: 1.2,
          ease: easeOut,
          clearProps: 'transform',
        }, 0);
      }
      if (curtain) {
        tl.to(curtain, {
          scaleY: 0,
          duration: 0.95,
          ease: easeMask,
          onComplete: function () { curtain.style.display = 'none'; },
        }, 0);
      }
      if (tag) {
        gsap.set(tag, { opacity: 0, y: 10 });
        tl.to(tag, { opacity: 1, y: 0, duration: 0.5, ease: easeOut, clearProps: 'transform' }, 0.45);
      }
    });

    // 4. Staggered metric cards
    const metrics = document.querySelectorAll('.cs_metric');
    if (metrics.length) {
      gsap.fromTo(metrics,
        { opacity: 0, y: 24 },
        {
          opacity: 1,
          y: 0,
          duration: 0.75,
          stagger: 0.08,
          ease: easeOut,
          clearProps: 'transform',
          scrollTrigger: {
            trigger: metrics[0].parentElement,
            start: 'top 88%',
            once: true,
          },
        }
      );
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initMoreInfo();
    initVideoPlayback();
    initAnimations();
  });
})();
