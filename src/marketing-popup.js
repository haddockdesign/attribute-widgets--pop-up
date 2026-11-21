/**
 * Marketing Pop-Up Engine v1.0.0
 * Zero-dependency, declarative marketing modal controller driven by HTML data-* attributes.
 * License: MIT
 */
(() => {
  'use strict';

  const STORAGE_PREFIX = 'mkt_popup_';
  const BREAKPOINT_PX = 768;
  const SCROLL_LOCK_CLASS = 'is-scroll-locked';
  const ALLOWED_ANIMATIONS = new Set(['fade', 'zoom-in']);
  const FOCUSABLE_SELECTORS = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');

  // Volatile fallback when localStorage/sessionStorage are blocked
  const memoryStorage = new Map();

  // Global state to enforce single active modal & restore focus
  let activeInstance = null;
  let lastFocusedElement = null;
  const instances = new Map();

  /* --------------------------------------------------------------------------
   * Storage Helpers (Fault-Tolerant)
   * ----------------------------------------------------------------------- */
  function getStorage(type) {
    try {
      const storage = type === 'session' ? window.sessionStorage : window.localStorage;
      const testKey = '__mkt_popup_test__';
      storage.setItem(testKey, '1');
      storage.removeItem(testKey);
      return storage;
    } catch {
      return null;
    }
  }

  function readState(id, frequency) {
    const key = STORAGE_PREFIX + id;
    const storageType = frequency === 'once-session' ? 'session' : 'local';
    const store = getStorage(storageType);

    try {
      const raw = store ? store.getItem(key) : memoryStorage.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeState(id, frequency, status) {
    const key = STORAGE_PREFIX + id;
    const payload = JSON.stringify({ status, timestamp: Date.now() });
    const storageType = frequency === 'once-session' ? 'session' : 'local';
    const store = getStorage(storageType);

    if (store) {
      try {
        store.setItem(key, payload);
        return;
      } catch {
        // Fall through to memory storage
      }
    }
    memoryStorage.set(key, payload);
  }

  /* --------------------------------------------------------------------------
   * Scroll Lock Helper
   * ----------------------------------------------------------------------- */
  function setScrollLock(locked) {
    document.documentElement.classList.toggle(SCROLL_LOCK_CLASS, locked);
    document.body.classList.toggle(SCROLL_LOCK_CLASS, locked);
  }

  /* --------------------------------------------------------------------------
   * Date & Environment Evaluation
   * ----------------------------------------------------------------------- */
  function parseScheduleTimestamp(dateStr, isEnd) {
    if (!dateStr) return null;
    const trimmed = dateStr.trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [y, m, d] = trimmed.split('-').map(Number);
      const dateObj = isEnd
        ? new Date(y, m - 1, d, 23, 59, 59, 999)
        : new Date(y, m - 1, d, 0, 0, 0, 0);
      return dateObj.getTime();
    }

    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? NaN : parsed;
  }

  function isWithinSchedule(el, id) {
    const startRaw = el.getAttribute('data-popup-start-date');
    const endRaw = el.getAttribute('data-popup-end-date');
    const now = Date.now();

    if (startRaw) {
      const startTs = parseScheduleTimestamp(startRaw, false);
      if (Number.isNaN(startTs)) {
        console.warn(`[MarketingPopup] Invalid start date "${startRaw}" on "${id}". Suppressing pop-up.`);
        return false;
      }
      if (now < startTs) return false;
    }

    if (endRaw) {
      const endTs = parseScheduleTimestamp(endRaw, true);
      if (Number.isNaN(endTs)) {
        console.warn(`[MarketingPopup] Invalid end date "${endRaw}" on "${id}". Suppressing pop-up.`);
        return false;
      }
      if (now > endTs) return false;
    }

    return true;
  }

  function matchesDeviceTarget(target) {
    if (target === 'desktop') return window.innerWidth >= BREAKPOINT_PX;
    if (target === 'mobile') return window.innerWidth < BREAKPOINT_PX;
    return true;
  }

  function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  /* --------------------------------------------------------------------------
   * Pop-Up Instance Controller
   * ----------------------------------------------------------------------- */
  class PopupInstance {
    constructor(el) {
      this.el = el;
      this.id = el.getAttribute('data-popup');
      this.config = this.parseConfig();
      this.isOpen = false;
      this.delayElapsed = false;
      this.triggerFired = false;
      this.cleanups = [];

      this.init();
    }

    parseConfig() {
      const attr = (name, fallback) => {
        const val = this.el.getAttribute(name);
        return val !== null && val.trim() !== '' ? val.trim() : fallback;
      };
      const boolAttr = (name, fallback) => {
        const val = this.el.getAttribute(name);
        if (val === null) return fallback;
        return val.trim().toLowerCase() !== 'false';
      };
      const numAttr = (name, fallback) => {
        const val = parseFloat(this.el.getAttribute(name));
        return Number.isFinite(val) ? val : fallback;
      };

      const rawAnimation = attr('data-popup-animation', 'fade').toLowerCase();
      const animation = ALLOWED_ANIMATIONS.has(rawAnimation) ? rawAnimation : 'fade';
      this.el.setAttribute('data-popup-animation', animation);

      return {
        trigger: attr('data-popup-trigger', 'delay'),
        delay: Math.max(0, numAttr('data-popup-delay', 3000)),
        scroll: Math.min(100, Math.max(1, numAttr('data-popup-scroll', 50))),
        triggerSelector: attr('data-popup-trigger-selector', null),
        frequency: attr('data-popup-frequency', 'once-session'),
        cooldownDays: Math.max(0, numAttr('data-popup-cooldown-days', 7)),
        convertDays: Math.max(0, numAttr('data-popup-convert-days', 30)),
        closeBackdrop: boolAttr('data-popup-close-backdrop', true),
        closeEsc: boolAttr('data-popup-close-esc', true),
        lockScroll: boolAttr('data-popup-lock-scroll', true),
        devices: attr('data-popup-devices', 'all'),
        activeClass: attr('data-popup-active-class', 'is-open'),
        animation
      };
    }

    init() {
      if (!isWithinSchedule(this.el, this.id)) return;
      if (!matchesDeviceTarget(this.config.devices)) return;

      this.bindInternalControls();

      if (this.config.trigger === 'click') {
        this.registerClickTrigger();
        return;
      }

      if (this.isSuppressed()) return;
      this.registerPassiveTrigger();
    }

    isSuppressed() {
      const { frequency, cooldownDays, convertDays } = this.config;
      if (frequency === 'always') return false;

      const state = readState(this.id, frequency);
      if (!state) return false;

      const now = Date.now();
      const msPerDay = 86400000;

      if (state.status === 'converted') {
        if (frequency === 'once-ever') return true;
        return now - state.timestamp < convertDays * msPerDay;
      }

      if (frequency === 'once-session' || frequency === 'once-ever') {
        return true;
      }

      if (frequency === 'cooldown') {
        return now - state.timestamp < cooldownDays * msPerDay;
      }

      return false;
    }

    bindInternalControls() {
      this.el.querySelectorAll('[data-popup-close]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          if (
            !this.config.closeBackdrop &&
            btn === e.target &&
            !btn.closest('button, a')
          ) {
            return;
          }
          this.close('dismissed');
        });
      });

      if (this.config.closeBackdrop) {
        this.el.addEventListener('click', (e) => {
          if (e.target === this.el) {
            this.close('dismissed');
          }
        });
      }

      this.el.querySelectorAll('[data-popup-action]').forEach((actionEl) => {
        actionEl.addEventListener('click', () => {
          this.convert();
        });
      });
    }

    registerClickTrigger() {
      if (!this.config.triggerSelector) return;
      document.querySelectorAll(this.config.triggerSelector).forEach((triggerEl) => {
        triggerEl.addEventListener('click', (e) => {
          e.preventDefault();
          if (!isWithinSchedule(this.el, this.id)) return;

          if (activeInstance && activeInstance !== this) {
            activeInstance.close('dismissed', false);
          }
          this.open('click');
        });
      });
    }

    registerPassiveTrigger() {
      const { trigger, delay, scroll } = this.config;

      if (trigger === 'immediate') {
        this.attemptPassiveOpen('immediate');
        return;
      }

      if (trigger === 'delay') {
        const timer = window.setTimeout(() => {
          this.attemptPassiveOpen('delay');
        }, delay);
        this.cleanups.push(() => clearTimeout(timer));
        return;
      }

      if (trigger === 'scroll') {
        const guardTimer = window.setTimeout(() => {
          this.delayElapsed = true;
          checkScroll();
        }, delay);

        let ticking = false;
        const checkScroll = () => {
          if (this.triggerFired || !this.delayElapsed) return;
          const docHeight =
            document.documentElement.scrollHeight - window.innerHeight;
          const percent =
            docHeight <= 0 ? 100 : (window.scrollY / docHeight) * 100;

          if (percent >= scroll) {
            this.triggerFired = true;
            this.attemptPassiveOpen('scroll');
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

        window.addEventListener('scroll', onScroll, { passive: true });
        this.cleanups.push(() => {
          clearTimeout(guardTimer);
          window.removeEventListener('scroll', onScroll);
        });
        return;
      }

      if (trigger === 'exit') {
        if (isTouchDevice()) {
          const fallbackTimer = window.setTimeout(() => {
            this.attemptPassiveOpen('exit-fallback-delay');
          }, delay);
          this.cleanups.push(() => clearTimeout(fallbackTimer));
          return;
        }

        const guardTimer = window.setTimeout(() => {
          this.delayElapsed = true;
        }, delay);

        const onMouseLeave = (e) => {
          if (this.triggerFired || !this.delayElapsed) return;
          if (e.clientY <= 10) {
            this.triggerFired = true;
            this.attemptPassiveOpen('exit');
          }
        };

        document.addEventListener('mouseleave', onMouseLeave);
        this.cleanups.push(() => {
          clearTimeout(guardTimer);
          document.removeEventListener('mouseleave', onMouseLeave);
        });
      }
    }

    attemptPassiveOpen(triggerType) {
      if (activeInstance) return;
      if (!isWithinSchedule(this.el, this.id)) return;
      this.open(triggerType);
    }

    open(triggerType = this.config.trigger) {
      if (this.isOpen) return;

      lastFocusedElement = document.activeElement;
      activeInstance = this;
      this.isOpen = true;

      this.el.removeAttribute('hidden');
      this.el.setAttribute('aria-hidden', 'false');
      this.el.setAttribute('aria-modal', 'true');

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
        this.el.setAttribute('tabindex', '-1');
        this.el.focus();
      }

      this.dispatchEvent('popup:open', {
        popupId: this.id,
        triggerType,
        animation: this.config.animation
      });
    }

    close(reason = 'dismissed', persist = true) {
      if (!this.isOpen) return;

      this.isOpen = false;
      if (activeInstance === this) {
        activeInstance = null;
      }

      this.el.classList.remove(this.config.activeClass);
      this.el.setAttribute('aria-hidden', 'true');
      this.el.removeAttribute('aria-modal');

      if (this.config.lockScroll) {
        setScrollLock(false);
      }

      const targetEl =
        this.config.animation === 'zoom-in'
          ? this.el.querySelector('.c-popup__dialog') || this.el
          : this.el;

      const finalizeHide = () => {
        if (!this.isOpen) {
          this.el.setAttribute('hidden', '');
        }
      };

      let settled = false;
      const onDone = (e) => {
        if (e && e.target !== targetEl) return;
        if (settled) return;
        settled = true;
        targetEl.removeEventListener('transitionend', onDone);
        clearTimeout(fallbackTimer);
        finalizeHide();
      };

      const fallbackTimer = window.setTimeout(() => onDone(null), 350);
      targetEl.addEventListener('transitionend', onDone);

      if (persist && this.config.frequency !== 'always') {
        const existing = readState(this.id, this.config.frequency);
        if (!existing || existing.status !== 'converted') {
          writeState(this.id, this.config.frequency, reason);
        }
      }

      if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
      }

      this.dispatchEvent('popup:close', {
        popupId: this.id,
        reason,
        animation: this.config.animation
      });
    }

    convert() {
      writeState(this.id, this.config.frequency, 'converted');
      this.dispatchEvent('popup:convert', { popupId: this.id });
      this.close('converted', false);
    }

    getFocusableElements() {
      return Array.from(this.el.querySelectorAll(FOCUSABLE_SELECTORS)).filter(
        (el) => el.offsetParent !== null
      );
    }

    trapFocus(e) {
      const focusables = this.getFocusableElements();
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    dispatchEvent(name, detail) {
      this.el.dispatchEvent(
        new CustomEvent(name, {
          bubbles: true,
          detail
        })
      );
    }

    destroy() {
      this.cleanups.forEach((fn) => fn());
      this.cleanups = [];
    }
  }

  /* --------------------------------------------------------------------------
   * Global Keyboard Handlers & Initialization
   * ----------------------------------------------------------------------- */
  document.addEventListener('keydown', (e) => {
    if (!activeInstance) return;

    if (e.key === 'Escape' && activeInstance.config.closeEsc) {
      e.preventDefault();
      activeInstance.close('dismissed');
    } else if (e.key === 'Tab') {
      activeInstance.trapFocus(e);
    }
  });

  function initPopups() {
    document.querySelectorAll('[data-popup]').forEach((el) => {
      const id = el.getAttribute('data-popup');
      if (!id || instances.has(id)) return;
      instances.set(id, new PopupInstance(el));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPopups);
  } else {
    initPopups();
  }

  window.MarketingPopup = {
    open: (id) => instances.get(id)?.open('programmatic'),
    close: (id) => (id ? instances.get(id)?.close('dismissed') : activeInstance?.close('dismissed')),
    refresh: initPopups
  };
})();
