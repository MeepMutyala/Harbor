# Web Agent Control Demos (Extension 2)

Self-contained demos that exercise active-tab interaction APIs. Each step increases complexity and uses the same-tab security model.

## Demos

- **Basic Actions** (`step-1-basic-actions/`) — Click, fill, and select on a simple form.
- **Multi-step Form** (`step-2-multi-step-form/`) — Validation + delayed transitions with `waitForSelector`.
- **Scroll & Wait** (`step-3-scroll-and-wait/`) — Long list scrolling, load-more, and delayed reveal elements.

## APIs Covered

- `agent.browser.activeTab.click(selector)`
- `agent.browser.activeTab.fill(selector, value)`
- `agent.browser.activeTab.select(selector, value)`
- `agent.browser.activeTab.scroll(options)`
- `agent.browser.activeTab.waitForSelector(selector)`

## Permissions & Flags

- `browser:activeTab.interact` — Required for click/fill/select/scroll.
- `browser:activeTab.read` — Required for `waitForSelector`.
- Feature flag: `browserInteraction` must be enabled in Harbor settings.
