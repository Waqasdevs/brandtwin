'use strict';

if (typeof gsap !== "undefined" && typeof SplitText !== "undefined") {
  gsap.registerPlugin(SplitText);
}

function initAccordion() {
  // Skip if reduced motion is preferred
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const sections = document.querySelectorAll("[data-anm-accordion]");
  if (!sections.length) return;

  // Default configuration
  const defaults = {
    duration: 0.5,
    ease: "expo.inOut",
    iconRotation: -180,
    allowMultiple: false,
    // Text stagger defaults
    staggerDuration: 0.4,
    staggerDelay: 0.08,
    staggerEase: "expo.out",
    staggerYPercent: 110,
  };

  // Helper: Get config from element attributes
  const getConfig = (el, attr, defaultValue) => {
    const value = el.getAttribute(`data-anm-${attr}`);
    if (value === null) return defaultValue;
    if (value === "true") return true;
    if (value === "false") return false;
    return isNaN(value) ? value : parseFloat(value);
  };

  // Helper: Check if disabled on current viewport
  const isDisabled = (el) => {
    const disable = el.dataset.anmDisable;
    if (!disable) return false;

    const breakpoints = {
      mobile: "(max-width: 479px)",
      tablet: "(max-width: 991px)",
      landscape: "(orientation: landscape) and (max-width: 767px)",
      desktop: "(min-width: 992px)",
    };

    return disable
      .split(",")
      .some(
        (v) =>
          breakpoints[v.trim()] &&
          window.matchMedia(breakpoints[v.trim()]).matches
      );
  };

  // Setup each accordion section
  sections.forEach((section) => {
    if (isDisabled(section)) return;

    const allowMultiple =
      getConfig(section, "allow-multiple", defaults.allowMultiple) === true;
    const items = section.querySelectorAll("[data-anm-accordion-item]");
    let openItems = [];

    items.forEach((item) => {
      if (isDisabled(item)) return;

      const trigger = item.querySelector("[data-anm-accordion-trigger]");
      const content = item.querySelector("[data-anm-accordion-content]");
      const icon = item.querySelector("[data-anm-accordion-icon]");
      const verticalBar = icon?.querySelector(
        "[data-anm-accordion-icon-vertical]"
      );
      const horizontalBar = icon?.querySelector(
        "[data-anm-accordion-icon-horizontal]"
      );

      if (!trigger || !content) return;

      // Get item-specific configuration with fallbacks
      let isOpen = getConfig(item, "open", false) === true;
      const duration = getConfig(item, "duration", defaults.duration);
      const delay = getConfig(item, "delay", 0);
      const ease = getConfig(item, "ease", defaults.ease);
      // Read icon-mode from section (accordion container) first, then icon, then default
      const iconMode = getConfig(section, "icon-mode", null) ||
        (icon ? getConfig(icon, "icon-mode", "both") : "both");
      const iconRotation = icon
        ? getConfig(icon, "icon-rotation", defaults.iconRotation)
        : defaults.iconRotation;

      // Text stagger configuration
      const hasStaggerText = content.hasAttribute(
        "data-anm-accordion-stagger-text"
      );
      const staggerDuration = getConfig(
        content,
        "stagger-duration",
        defaults.staggerDuration
      );
      const staggerDelay = getConfig(
        content,
        "stagger-delay",
        defaults.staggerDelay
      );
      const staggerEase = getConfig(
        content,
        "stagger-ease",
        defaults.staggerEase
      );
      const staggerYPercent = getConfig(
        content,
        "stagger-y-percent",
        defaults.staggerYPercent
      );

      // Track SplitText instance and animation state
      let splitInstance = null;
      let textAnimated = false;
      let textTl = null;
      let staggerTimer = null;

      // Set initial state - content hidden
      gsap.set(content, {
        height: 0,
        overflow: "hidden",
        force3D: true,
        willChange: "height",
      });

      // Create timeline for this item
      const tl = gsap.timeline({
        paused: true,
        defaults: { duration, ease },
      });

      // Content animation - smooth height expansion
      tl.to(
        content,
        {
          height: "auto",
          duration,
          ease,
        },
        0
      );

      // Icon animation based on mode
      if (icon) {
        // Rotate animation (for "rotate" and "both" modes)
        if (iconMode === "rotate" || iconMode === "both") {
          tl.to(
            icon,
            {
              rotation: iconRotation,
              duration,
              ease,
            },
            0
          );
        }

        // Fade vertical bar animation (for "fade" and "both" modes)
        // Starts at 25% of animation, uses power2.inOut for smoother fade
        if ((iconMode === "fade" || iconMode === "both") && verticalBar) {
          tl.to(
            verticalBar,
            {
              opacity: 0,
              duration: duration * 0.5,
              ease: "power2.inOut",
            },
            duration * 0.25
          );
        }
      }

      // Function to create and play text stagger animation
      const animateTextStagger = () => {
        if (!hasStaggerText || textAnimated || !isOpen || typeof SplitText === "undefined")
          return;

        // Find text elements within content
        const textElements = content.querySelectorAll(
          ".accordion_text, p, span"
        );
        if (!textElements.length) return;

        textElements.forEach((textElement) => {
          gsap.set(textElement, { visibility: "visible" });
          // Create SplitText with line masking
          splitInstance = SplitText.create(textElement, {
            type: "lines",
            mask: "lines",
            linesClass: "accordion_split_line",
            onSplit: function (instance) {
              const lines = instance.lines;

              // Set initial state - lines hidden below mask
              gsap.set(lines, {
                yPercent: staggerYPercent,
                force3D: true,
              });

              // Create text animation timeline
              textTl = gsap.timeline();
              textTl.to(lines, {
                yPercent: 0,
                duration: staggerDuration,
                stagger: staggerDelay,
                ease: staggerEase,
                force3D: true,
              });
            },
          });
        });

        textAnimated = true;
      };

      // Function to reset text stagger animation
      const resetTextStagger = () => {
        if (staggerTimer) {
          clearTimeout(staggerTimer);
          staggerTimer = null;
        }
        if (!hasStaggerText || !splitInstance) return;

        // Kill any running text animation
        if (textTl) {
          textTl.kill();
          textTl = null;
        }

        // Revert split and reset state
        if (splitInstance && splitInstance.revert) {
          splitInstance.revert();
        }
        splitInstance = null;
        textAnimated = false;
      };

      // Handle initially open items
      if (isOpen) {
        tl.progress(1);
        openItems.push(item);
        trigger.setAttribute("aria-expanded", "true");

        // Animate text on load if stagger enabled
        if (hasStaggerText) {
          document.fonts.ready.then(() => {
            setTimeout(animateTextStagger, 100);
          });
        }
      } else {
        trigger.setAttribute("aria-expanded", "false");
      }

      // Set up ARIA
      content.setAttribute("aria-hidden", isOpen ? "false" : "true");
      if (!trigger.hasAttribute("aria-controls")) {
        const contentId =
          content.id ||
          `accordion-content-${Math.random().toString(36).substr(2, 9)}`;
        content.id = contentId;
        trigger.setAttribute("aria-controls", contentId);
      }

      // Click handler
      const toggle = () => {
        if (!isOpen) {
          // Opening this item
          // Close other items if not allowing multiple
          if (!allowMultiple) {
            openItems.forEach((openItem) => {
              if (openItem !== item) {
                const openTrigger = openItem.querySelector(
                  "[data-anm-accordion-trigger]"
                );
                if (openTrigger) {
                  openTrigger.click();
                }
              }
            });
          }

          isOpen = true;
          openItems.push(item);
          if (hasStaggerText) {
            content.querySelectorAll(".accordion_text, p, span").forEach((el) => {
              gsap.set(el, { visibility: "hidden" });
            });
          }
          tl.play();
          trigger.setAttribute("aria-expanded", "true");
          content.setAttribute("aria-hidden", "false");

          // Trigger text stagger animation after accordion starts opening
          if (hasStaggerText) {
            const staggerStartDelay = getConfig(
              content,
              "stagger-start-delay",
              120
            );
            staggerTimer = setTimeout(() => {
              document.fonts.ready.then(animateTextStagger);
            }, staggerStartDelay);
          }

          // Dispatch custom event
          item.dispatchEvent(
            new CustomEvent("anm-accordion-open", {
              detail: { item, content },
              bubbles: true,
            })
          );
        } else {
          // Closing this item
          isOpen = false;
          openItems = openItems.filter((i) => i !== item);
          tl.reverse();
          trigger.setAttribute("aria-expanded", "false");
          content.setAttribute("aria-hidden", "true");

          // Reset text stagger after close completes
          if (staggerTimer) {
            clearTimeout(staggerTimer);
            staggerTimer = null;
          }
          staggerTimer = setTimeout(resetTextStagger, duration * 1000);

          // Dispatch custom event
          item.dispatchEvent(
            new CustomEvent("anm-accordion-close", {
              detail: { item, content },
              bubbles: true,
            })
          );
        }
      };

      // Attach event listeners
      trigger.addEventListener("click", toggle);

      // Keyboard accessibility
      trigger.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      });
    });
  });

  // Pause animations when tab is hidden (performance)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      sections.forEach((section) => {
        gsap.killTweensOf(section);
      });
    }
  });
}

// Wait for GSAP and optionally SplitText to load
function waitForGSAP(callback, attempts = 0) {
  if (typeof gsap !== "undefined") {
    // SplitText is optional, proceed even if not loaded
    callback();
  } else if (attempts < 50) {
    setTimeout(() => waitForGSAP(callback, attempts + 1), 100);
  } else {
    console.warn("GSAP not found");
  }
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () =>
    waitForGSAP(initAccordion)
  );
} else {
  waitForGSAP(initAccordion);
}

// Public API
window.Anm = window.Anm || {};
window.Anm.Accordion = {
  refresh: initAccordion,
};
