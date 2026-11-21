(() => {
  const STORAGE_PREFIX = "mkt_popup_";
  const MOBILE_BREAKPOINT = 768;
  const SCROLL_LOCK_CLASS = "is-scroll-locked";
  const ANIMATIONS = new Set(["fade", "zoom-in"]);
  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const memoryStorage = new Map();
  let activeInstance = null;
  let lastFocusedElement = null;
  const instances = new Map();

  function getStorage(scope) {
    try {
      const storage = scope === "session" ? window.sessionStorage : window.localStorage;
      const testKey = "__mkt_popup_test__";
      storage.setItem(testKey, "1");
      storage.removeItem(testKey);
      return storage;
    } catch {
      return null;
    }
  }

  function readState(id, frequency) {
    const key = STORAGE_PREFIX + id;
    const storage = getStorage(frequency === "once-session" ? "session" : "local");
    try {
      const raw = storage ? storage.getItem(key) : memoryStorage.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeState(id, frequency, status) {
    const key = STORAGE_PREFIX + id;
    const payload = JSON.stringify({ status, timestamp: Date.now() });
    const storage = getStorage(frequency === "once-session" ? "session" : "local");
    if (storage) {
      try {
        storage.setItem(key, payload);
        return;
      } catch {}
    }
    memoryStorage.set(key, payload);
  }

  function setScrollLock(locked) {
    document.documentElement.classList.toggle(SCROLL_LOCK_CLASS, locked);
    document.body.classList.toggle(SCROLL_LOCK_CLASS, locked);
  }

  function parseDateBound(value, endOfDay) {
    if (!value) return null;
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [year, month, day] = trimmed.split("-").map(Number);
      return (
        endOfDay
          ? new Date(year, month - 1, day, 23, 59, 59, 999)
          : new Date(year, month - 1, day, 0, 0, 0, 0)
      ).getTime();
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? NaN : parsed;
  }

  function isWithinSchedule(el, id) {
    const startAttr = el.getAttribute("data-popup-start-date");
    const endAttr = el.getAttribute("data-popup-end-date");
    const now = Date.now();

    if (startAttr) {
      const startMs = parseDateBound(startAttr, false);
      if (Number.isNaN(startMs)) {
        console.warn(`[MarketingPopup] Invalid start date "${startAttr}" on "${id}". Suppressing pop-up.`);
        return false;
      }
      if (now < startMs) return false;
    }

    if (endAttr) {
      const endMs = parseDateBound(endAttr, true);
      if (Number.isNaN(endMs)) {
        console.warn(`[MarketingPopup] Invalid end date "${endAttr}" on "${id}". Suppressing pop-up.`);
        return false;
      }
      if (now > endMs) return false;
    }

    return true;
  }

  function matchesDevice(deviceMode) {
    if (deviceMode === "desktop") return window.innerWidth >= MOBILE_BREAKPOINT;
    if (deviceMode === "mobile") return window.innerWidth < MOBILE_BREAKPOINT;
    return true;
  }

  function isTouchDevice() {
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
  }

  class PopupInstance {
    constructor(el) {
      this.el = el;
      this.id = el.getAttribute("data-popup");
      this.config = this.parseConfig();
      this.isOpen = false;
      this.delayElapsed = false;
      this.triggerFired = false;
      this.cleanups = [];
      this.init();
    }

    parseConfig() {
      const getStr = (attr, fallback) => {
        const val = this.el.getAttribute(attr);
        return val !== null && val.trim() !== "" ? val.trim() : fallback;
      };
      const getBool = (attr, fallback) => {
        const val = this.el.getAttribute(attr);
        return val === null ? fallback : val.trim().toLowerCase() !== "false";
      };
      const getNum = (attr, fallback) => {
        const val = parseFloat(this.el.getAttribute(attr));
        return Number.isFinite(val) ? val : fallback;
      };

      const rawAnim = getStr("data-popup-animation", "fade").toLowerCase();
      const animation = ANIMATIONS.has(rawAnim) ? rawAnim : "fade";
      this.el.setAttribute("data-popup-animation", animation);

      return {
        trigger: getStr("data-popup-trigger", "delay"),
        delay: Math.max(0, getNum("data-popup-delay", 3000)),
        scroll: Math.min(100, Math.max(1, getNum("data-popup-scroll", 50))),
        triggerSelector: getStr("data-popup-trigger-selector", null),
        frequency: getStr("data-popup-frequency", "once-session"),
        cooldownDays: Math.max(0, getNum("data-popup-cooldown-days", 7)),
        convertDays: Math.max(0, getNum("data-popup-convert-days", 30)),
        closeBackdrop: getBool("data-popup-close-backdrop", true),
        closeEsc: getBool("data-popup-close-esc", true),
        lockScroll: getBool("data-popup-lock-scroll", true),
        devices: getStr("data-popup-devices", "all"),
        activeClass: getStr("data-popup-active-class", "is-open"),
        animation
      };
    }

    init() {
      if (!isWithinSchedule(this.el, this.id) || !matchesDevice(this.config.devices)) {
        return;
      }
      this.bindInternalControls();
      if (this.config.trigger !== "click") {
        if (!this.isSuppressed()) {
          this.registerPassiveTrigger();
        }
      } else {
        this.registerClickTrigger();
      }
    }

    isSuppressed() {
      const { frequency, cooldownDays, convertDays } = this.config;
      if (frequency === "always") return false;
      const saved = readState(this.id, frequency);
      if (!saved) return false;
      const now = Date.now();

      if (saved.status === "converted") {
        return frequency === "once-ever" || now - saved.timestamp < 864e5 * convertDays;
      }
      return (
        frequency === "once-session" ||
        frequency === "once-ever" ||
        (frequency === "cooldown" ? now - saved.timestamp < 864e5 * cooldownDays : false)
      );
    }

    bindInternalControls() {
      this.el.querySelectorAll("[data-popup-close]").forEach((closeEl) => {
        closeEl.addEventListener("click", (event) => {
          if (
            !this.config.closeBackdrop &&
            closeEl === event.target &&
            !closeEl.closest("button, a, [data-popup-close]")
          ) {
            return;
          }
          this.close("dismissed");
        });
      });

      if (this.config.closeBackdrop) {
        this.el.addEventListener("click", (event) => {
          if (event.target === this.el) {
            this.close("dismissed");
          }
        });
      }

      this.el.querySelectorAll("[data-popup-action]").forEach((actionEl) => {
        actionEl.addEventListener("click", () => {
          this.convert();
        });
      });
    }

    registerClickTrigger() {
      if (!this.config.triggerSelector) return;
      document.querySelectorAll(this.config.triggerSelector).forEach((triggerEl) => {
        triggerEl.addEventListener("click", (event) => {
          event.preventDefault();
          if (isWithinSchedule(this.el, this.id)) {
            if (activeInstance && activeInstance !== this) {
              activeInstance.close("dismissed", false);
            }
            this.open("click");
          }
        });
      });
    }

    registerPassiveTrigger() {
      const { trigger, delay, scroll } = this.config;

      if (trigger === "immediate") {
        this.attemptPassiveOpen("immediate");
        return;
      }

      if (trigger === "delay") {
        const timer = window.setTimeout(() => {
          this.attemptPassiveOpen("delay");
        }, delay);
        this.cleanups.push(() => clearTimeout(timer));
        return;
      }

      if (trigger === "scroll") {
        const timer = window.setTimeout(() => {
          this.delayElapsed = true;
          checkScroll();
        }, delay);
        let ticking = false;

        const checkScroll = () => {
          if (!this.triggerFired && this.delayElapsed) {
            const scrollable = document.documentElement.scrollHeight - window.innerHeight;
            const pct = scrollable <= 0 ? 100 : (window.scrollY / scrollable) * 100;
            if (pct >= scroll) {
              this.triggerFired = true;
              this.attemptPassiveOpen("scroll");
            }
          }
        };

        const onScroll = () => {
          if (!ticking) {
            window.requestAnimationFrame(() => {
              checkScroll();
              ticking = false;
            });
            ticking = true;
          }
        };

        window.addEventListener("scroll", onScroll, { passive: true });
        this.cleanups.push(() => {
          clearTimeout(timer);
          window.removeEventListener("scroll", onScroll);
        });
        return;
      }

      if (trigger === "exit") {
        if (isTouchDevice()) {
          const timer = window.setTimeout(() => {
            this.attemptPassiveOpen("exit-fallback-delay");
          }, delay);
          this.cleanups.push(() => clearTimeout(timer));
          return;
        }

        const timer = window.setTimeout(() => {
          this.delayElapsed = true;
        }, delay);

        const onMouseLeave = (event) => {
          if (!this.triggerFired && this.delayElapsed && event.clientY <= 10) {
            this.triggerFired = true;
            this.attemptPassiveOpen("exit");
          }
        };

        document.addEventListener("mouseleave", onMouseLeave);
        this.cleanups.push(() => {
          clearTimeout(timer);
          document.removeEventListener("mouseleave", onMouseLeave);
        });
      }
    }

    attemptPassiveOpen(triggerType) {
      if (!activeInstance && isWithinSchedule(this.el, this.id)) {
        this.open(triggerType);
      }
    }

    open(triggerType = this.config.trigger) {
      if (this.isOpen) return;
      lastFocusedElement = document.activeElement;
      activeInstance = this;
      this.isOpen = true;

      this.el.removeAttribute("hidden");
      this.el.setAttribute("aria-hidden", "false");
      this.el.setAttribute("aria-modal", "true");

      if (this.config.lockScroll) {
        setScrollLock(true);
      }

      window.requestAnimationFrame(() => {
        this.el.classList.add(this.config.activeClass);
      });

      const focusables = this.getFocusableElements();
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        this.el.setAttribute("tabindex", "-1");
        this.el.focus();
      }

      this.dispatchEvent("popup:open", {
        popupId: this.id,
        triggerType,
        animation: this.config.animation
      });
    }

    close(reason = "dismissed", persist = true) {
      if (!this.isOpen) return;
      this.isOpen = false;
      if (activeInstance === this) {
        activeInstance = null;
      }

      this.el.classList.remove(this.config.activeClass);
      this.el.setAttribute("aria-hidden", "true");
      this.el.removeAttribute("aria-modal");

      if (this.config.lockScroll) {
        setScrollLock(false);
      }

      const animTarget =
        this.config.animation === "zoom-in"
          ? this.el.querySelector(".c-popup__dialog") || this.el
          : this.el;

      let finished = false;
      const fallbackTimer = window.setTimeout(() => onTransitionEnd(null), 350);

      const onTransitionEnd = (event) => {
        if (event && event.target !== animTarget) return;
        if (finished) return;
        finished = true;
        animTarget.removeEventListener("transitionend", onTransitionEnd);
        clearTimeout(fallbackTimer);
        if (!this.isOpen) {
          this.el.setAttribute("hidden", "");
        }
      };

      animTarget.addEventListener("transitionend", onTransitionEnd);

      if (persist && this.config.frequency !== "always") {
        const existing = readState(this.id, this.config.frequency);
        if (!existing || existing.status !== "converted") {
          writeState(this.id, this.config.frequency, reason);
        }
      }

      if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
        lastFocusedElement.focus();
      }

      this.dispatchEvent("popup:close", {
        popupId: this.id,
        reason,
        animation: this.config.animation
      });
    }

    convert() {
      writeState(this.id, this.config.frequency, "converted");
      this.dispatchEvent("popup:convert", { popupId: this.id });
      this.close("converted", false);
    }

    getFocusableElements() {
      return Array.from(this.el.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null
      );
    }

    trapFocus(event) {
      const focusables = this.getFocusableElements();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    dispatchEvent(name, detail) {
      this.el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
    }

    destroy() {
      this.cleanups.forEach((fn) => fn());
      this.cleanups = [];
    }
  }

  function initPopups() {
    document.querySelectorAll("[data-popup]").forEach((el) => {
      const id = el.getAttribute("data-popup");
      if (id && !instances.has(id)) {
        instances.set(id, new PopupInstance(el));
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (!activeInstance) return;
    if (event.key === "Escape" && activeInstance.config.closeEsc) {
      event.preventDefault();
      activeInstance.close("dismissed");
    } else if (event.key === "Tab") {
      activeInstance.trapFocus(event);
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPopups);
  } else {
    initPopups();
  }

  window.MarketingPopup = {
    open: (id) => instances.get(id)?.open("programmatic"),
    close: (id) => (id ? instances.get(id)?.close("dismissed") : activeInstance?.close("dismissed")),
    refresh: initPopups
  };
})();