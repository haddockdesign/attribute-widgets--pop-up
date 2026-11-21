# Marketing Pop-Up Engine

A zero-dependency, lightweight (~1.9 KB gzipped) JavaScript and CSS module that controls marketing modals and pop-ups declaratively via HTML `data-*` attributes.

## Repository Structure

```text
marketing-popup/
├── dist/
│   ├── marketing-popup.min.js    # Production minified JS (~5.8 KB raw / ~1.9 KB gzipped)
│   └── marketing-popup.min.css   # Production minified CSS
├── src/
│   ├── marketing-popup.js        # Unminified source JS
│   └── marketing-popup.css       # Unminified source CSS
├── examples/
│   └── index.html                # Working multi-popup demo
├── package.json
├── LICENSE
└── README.md
```

## Quick Start

### 1. Include CSS & JS (Local or via jsDelivr CDN)

**Local:**
```html
<link rel="stylesheet" href="dist/marketing-popup.min.css" />
<script src="dist/marketing-popup.min.js" defer></script>
```

**Via GitHub + jsDelivr CDN** (after pushing to `your-username/marketing-popup`):
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/your-username/marketing-popup@v1.0.0/dist/marketing-popup.min.css" />
<script src="https://cdn.jsdelivr.net/gh/your-username/marketing-popup@v1.0.0/dist/marketing-popup.min.js" defer></script>
```

### 2. Add Pop-Up HTML Markup

```html
<div
  class="c-popup"
  hidden
  aria-hidden="true"
  role="dialog"
  aria-labelledby="popup-title"
  data-popup="promo-spring-2026"
  data-popup-trigger="exit"
  data-popup-delay="5000"
  data-popup-animation="zoom-in"
  data-popup-frequency="cooldown"
  data-popup-cooldown-days="14"
  data-popup-convert-days="60"
  data-popup-start-date="2026-04-01"
  data-popup-end-date="2026-04-30T23:59:59-04:00"
>
  <div class="c-popup__backdrop" data-popup-close></div>
  <div class="c-popup__dialog">
    <button type="button" class="c-popup__close-btn" data-popup-close aria-label="Close">&times;</button>
    <h2 id="popup-title">Wait! Get 20% Off</h2>
    <p>Subscribe for your instant discount code.</p>
    <button type="button" data-popup-action>Claim Discount</button>
  </div>
</div>
```

## Selector Hooks

| Selector | Required | Purpose |
| :--- | :--- | :--- |
| `[data-popup="<id>"]` | Yes | Root container with a unique ID used for storage keys and programmatic control. |
| `[data-popup-close]` | Optional | Any button, icon, or backdrop element that dismisses the pop-up. |
| `[data-popup-action]` | Optional | Primary CTA element that records a `"converted"` state and applies `data-popup-convert-days`. |

## Data Attribute Reference

| Attribute | Allowed Values | Default | Description |
| :--- | :--- | :--- | :--- |
| `data-popup` | Unique string ID | *Required* | Unique instance identifier. |
| `data-popup-trigger` | `"delay"` \| `"scroll"` \| `"exit"` \| `"click"` \| `"immediate"` | `"delay"` | Condition that opens the pop-up. |
| `data-popup-delay` | Integer (ms) | `3000` | Delay before opening (`delay`), or minimum time-on-page guard (`scroll`, `exit`). |
| `data-popup-scroll` | Integer (`1`–`100`) | `50` | Vertical scroll depth percentage required when `trigger="scroll"`. |
| `data-popup-trigger-selector` | CSS selector | *None* | Target selector for external trigger elements when `trigger="click"`. |
| `data-popup-animation` | `"fade"` \| `"zoom-in"` | `"fade"` | `"fade"` fades the whole container; `"zoom-in"` fades `.c-popup__backdrop` and scales `.c-popup__dialog`. |
| `data-popup-frequency` | `"always"` \| `"once-session"` \| `"once-ever"` \| `"cooldown"` | `"once-session"` | Suppression behavior after dismissal. |
| `data-popup-cooldown-days` | Number (days) | `7` | Suppression duration in days when `frequency="cooldown"`. |
| `data-popup-convert-days` | Number (days) | `30` | Suppression duration in days after `[data-popup-action]` is clicked. |
| `data-popup-start-date` | ISO 8601 date/time | *None* | Earliest date/time the pop-up can initialize or trigger. |
| `data-popup-end-date` | ISO 8601 date/time | *None* | Expiration date/time after which the pop-up will not initialize or trigger. |
| `data-popup-close-backdrop` | `"true"` \| `"false"` | `"true"` | Closes pop-up when clicking the backdrop overlay. |
| `data-popup-close-esc` | `"true"` \| `"false"` | `"true"` | Closes pop-up when pressing `Escape`. |
| `data-popup-lock-scroll` | `"true"` \| `"false"` | `"true"` | Toggles `.is-scroll-locked` on `<html>` and `<body>` while open. |
| `data-popup-devices` | `"all"` \| `"desktop"` \| `"mobile"` | `"all"` | Viewport filter (`mobile < 768px`, `desktop >= 768px`). |
| `data-popup-active-class` | Class string | `"is-open"` | Class toggled onto the container when active. |

## Events & JavaScript API

### DOM Events
Listen on `document` or the container element for analytics hooks (GTM, GA4, Segment):
- `popup:open` — `e.detail`: `{ popupId, triggerType, animation }`
- `popup:close` — `e.detail`: `{ popupId, reason, animation }`
- `popup:convert` — `e.detail`: `{ popupId }`

### Programmatic API
```javascript
window.MarketingPopup.open('promo-spring-2026');
window.MarketingPopup.close('promo-spring-2026'); // or close() with no args to close active modal
window.MarketingPopup.refresh(); // Re-scan DOM for dynamically injected [data-popup] elements
```

## License

MIT
