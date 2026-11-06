# OceanMind pitch-demo director — authoring API

The director drives the real app during the pitch. The presenter only presses a
clicker; each press runs one **beat** (type, click, slide, drag, wait…). There is
**no cursor and no on-screen control**: every action is made legible on the
element itself (accent spotlight, the app's own hover/press look, a ripple,
a glowing caret or slider thumb). This document is everything a story author
(`beats.js`, `blockDrivers.js`) needs.

## Files

| File | Owner | What |
|---|---|---|
| `beats.js` | B2 | The story: `export const chapters = [...]`. Currently a 2-beat placeholder. |
| `blockDrivers.js` | B2 | Optional: per-block helpers `(ctx, root, opts) => Promise`, imported by `beats.js`. |
| `director.js` | B1 | Engine (chapters → beats, queue, abort, back/jump/resume/restart) + presenter keys. |
| `drivers.js` | B1 | The toolkit handed to every beat as `ctx`. |
| `runtime.js` | B1 | Abort-aware sleep, storage, `@id` selector shorthand, slider maths. |
| `Hud.jsx`, `DemoRoot.jsx`, `demo.css` | B1 | Presenter HUD, mount point, visuals. |

Demo mode turns on when `GET /api/demo/status` returns `{ demo: true, persona, speed }`.
`App.jsx` then stamps `<html data-demo="1">` (so `isDemo()` is true from the first
render) and lazy-loads `DemoRoot` (normal builds never download it).

## Presenter keys

Captured at window capture phase, only for real (trusted) key presses.

| Key | Action |
|---|---|
| → PageDown Space ↓ Enter | **next**: run the next beat. Pressed while something runs → queues exactly **one** advance. |
| ← PageUp ↑ | **back** (see "Back" below) |
| 1 – 9 | **jump** to chapter N: aborts what runs, runs that chapter's `enter()` |
| + / = and − | tempo up / down: 0.5 · 0.75 · **1** · 1.25 · 1.5 · 2 · 3 (persisted) |
| Esc | abort the running beat (pointer moves past it) |
| h | toggle the HUD (hidden by default; top-right under the nav) |
| r, r (within 1.5 s) | full restart: sign out, clear demo storage and cached rows, reload at `#/` |

Keys pass through untouched only when a **person** focused a text field (a real
click or Tab right before focus moved). Fields focused by the app (`autoFocus` on
sign-in and Home) or by the director keep the clicker working. Keys with
Ctrl/Alt/Meta are never touched. A held key counts as one press.

## Writing the story (`beats.js`)

```js
export const chapters = [
  {
    id: 'dive1',                 // free-form
    title: 'Dive 1 — AI Agents', // shown in the HUD
    timeout: 60000,              // optional: limit for enter() (default 60 s)
    async enter(ctx) { … },      // optional but strongly recommended (see below)
    beats: [
      {
        title: 'Type the goal and press Dive in', // HUD + logs
        async run(ctx) { … },                      // required
        undo: async (ctx) => { … },                // optional: makes "back" step back one beat
        auto: false,                               // true = runs right after the previous beat, no press
        timeout: 120000,                           // optional (default 120 s)
        undoTimeout: 30000,                        // optional (default 30 s)
      },
    ],
  },
];
```

### Engine rules

- **Pointer.** The director points at the next beat. `next` runs it and moves the
  pointer past it — also when the beat **fails, times out or is aborted** (the show
  never freezes; the next press continues). An error clears the queued press.
- **Chapters flow linearly.** Finishing a chapter's last beat points at the next
  chapter's first beat; its `enter()` does **not** run in linear flow.
- **`enter(ctx)`** runs on: a digit jump, "back" into a chapter, an accidental page
  refresh (the pointer is in sessionStorage; the show resumes at the start of the
  chapter it was in), and after the app's error screen (it reloads into the chapter).
  It must put the app into the chapter's start state **idempotently and fast**,
  from any state (signed out, another route, a modal open, mid-lesson…). It runs at
  2× the presenter tempo; use `ctx.fast(fn)` to go faster still.
- **Back.** Target = the running beat (aborted first) or the last beat that ran. If
  it has `undo`, `undo(ctx)` runs and the pointer returns to that beat (so the next
  press replays it); `undo` must cope with a beat that was interrupted halfway.
  Otherwise the chapter that beat belongs to is re-entered (`enter()`, pointer at
  its beat 0). "Back" at the start of a chapter re-enters the previous chapter.
- **`auto: true`** beats run as soon as the previous beat succeeds. A press made
  meanwhile stays queued and advances after the chain.
- **Before the first press** nothing happens: the app sits in its natural start
  state. `r r` is the clean way to rehearse from the top.
- Every task is time-limited (beat 120 s, enter 60 s, undo 30 s by default).

### Abort rules (important)

Escape, back, jump, restart and timeouts abort the running task through
`ctx.signal`. Every `ctx` helper rejects immediately when that happens, so:

1. **Await only through `ctx`** (`ctx.wait`, `ctx.pause`, `ctx.waitFor`, `ctx.find`, …).
   Never `await new Promise(r => setTimeout(r, …))` or `sleep()` from motion.js.
2. In any loop you write yourself, call `ctx.check()` each iteration (throws when aborted).
3. Don't swallow errors with a bare `try {} catch {}` around toolkit calls — you
   would swallow the abort too. If you must, rethrow when `ctx.signal.aborted`.
4. Never use `requestAnimationFrame`; everything runs on setTimeout clocks.
5. Visual leftovers (spotlights, hover/press classes, glows) are cleaned up by the
   engine after every task, finished or not. Drags always release the pointer.

Even a beat that ignores the rules can't freeze the show (the engine stops
waiting on abort), but it may keep acting in the background until its next
`ctx` call.

## Targets

Every action takes a **target**:

| Form | Meaning |
|---|---|
| `'@ask-input'` | `[data-demo="ask-input"]`. Works anywhere in a selector: `'@quiz-option[data-idx="2"]'`, `'[data-block="memory"] @slider'`, `'@signin-name, #si-name'` (fallbacks) |
| any CSS selector | `'.suggest-pill'`, `'form.ask-row button[type="submit"]'` |
| `'text=Dive in'` | the clickable element whose text or aria-label contains it (case/space-insensitive; exact and shortest matches first) |
| `{ text, selector }` | text match restricted to `selector` |
| an `Element` | used as is |
| `(root) => Element \| Element[] \| null` | your own query |

Common options: `within` (Element or selector: search inside it), `timeout`
(ms, how long `find` waits; default 8000), `visible` (default true: connected,
non-zero box, not hidden), `enabled` (click/type/slide wait until not disabled),
`index` (nth match; negative counts from the end). Invalid selectors throw at once.

## The `ctx` object

`tempo` = presenter tempo × task factor (enter/undo ×2, `ctx.fast` ×3). Durations
marked *(tempo)* are divided by it. `pause` is never scaled.

### Task

| Member | |
|---|---|
| `signal` | AbortSignal of this task |
| `meta` | `{ kind: 'beat'\|'enter'\|'undo', chapter, beat, title }` |
| `status` | the `/api/demo/status` payload `{ demo, persona, speed }` |
| `persona` | `{ name: 'Faisal', email: 'faisal@oceanmind.demo' }` (from status) |
| `tempo` | current effective tempo (getter) |
| `check()` | throws if aborted |
| `log(msg, level?)` | HUD + console (`'info' \| 'warn' \| 'error'`) |
| `fast(fn, factor = 3)` | run `fn(ctx)` with tempo × factor (fast-forwarding in `enter`) |

### Finding and waiting

| Signature | Returns / notes |
|---|---|
| `find(target, { within, timeout = 8000, visible = true, enabled = false, index = 0, label })` | `Promise<Element>`; waits (polling 50 ms + MutationObserver); `DemoTimeoutError` on timeout |
| `findAll(target, { within, visible = true })` | `Element[]` now, no waiting |
| `exists(target, opts)` | `boolean` now |
| `waitGone(target, { within, timeout = 15000 })` | waits until nothing visible matches |
| `waitFor(predicate, { timeout = 10000, interval = 50, label, soft = false })` | resolves the first truthy value of `predicate()` (sync or async; throwing counts as "not yet"); `soft: true` resolves `null` instead of throwing |
| `wait(ms)` | sleep *(tempo)* |
| `pause(ms)` | sleep, real ms |
| `waitNet({ quiet = 300, timeout = 20000, grace = 120 })` | no request in flight for `quiet` ms (after `grace` so a just-clicked request has started); resolves `false` on timeout (logged), never throws |
| `waitIdle({ quiet = 300, timeout = 20000 })` | `waitNet` + every `.reveal` in the viewport has finished entering (max 3 s). Use it after anything that loads or navigates |
| `waitStage(name \| name[], { timeout = 15000 })` | waits for `[data-demo="session"][data-stage=…]`; returns the stage |
| `stage()` | current SessionView stage or `null` |
| `sessionId()` | current session id (SessionView marker, else `#/session/:id`) or `null` |

### Acting

All of these first scroll the target into the usable band (below the nav, above
toasts and the Lulu button), wait for the scroll to settle and for its `.reveal`
to finish entering. Only the window scrolls (never overflow:hidden containers like
the flow canvas); inside fixed layers (modals, the Lulu panel) the element's own
scroll container moves instead. Pass `scroll: false` to skip.

| Signature | What the audience sees / what fires |
|---|---|
| `click(target, { within, timeout = 8000, at, pointer = false, spot = true, scroll = true, enabled = true, dwell = 260, hold = 150, settle = 140 })` | spotlight ring + the app's hover look for `dwell` *(tempo)*, then the press look (`:active` mirror) + ripple for `hold` *(tempo)*, then the real click (`el.click()` for HTML, a `MouseEvent` with coordinates for SVG or when `at` is given). `at`: `[fx, fy]`, `{fx, fy}` or `{x, y}` client coords. `pointer: true` also sends pointerdown/mousedown/pointerup/mouseup (FlowBuilder node selection, anything acting on pointer events). Moves focus like a real click (blurs the field you typed in; focuses a clicked field). Returns the element |
| `hover(target, { hold = 380, spot = false, within, timeout, scroll })` | the hover look + React `onMouseEnter`/`onPointerEnter` (containers included, like a real pointer moving from the previous hover). Stays until `unhover()`, the next hover/click, or the end of the task |
| `unhover()` | fires the matching leave events |
| `type(target, text, { cps = 18, clear = false, within, timeout = 8000, scroll, spot = true })` | spotlight, focus, glowing caret; types char by char (native value setter + `input` event, so React `onChange` runs; slight human rhythm, pauses after spaces/punctuation). `cps` *(tempo)*. `clear: true` backspaces the old value first |
| `clear(target, { cps = 60, instant = false })` | visible fast backspacing (or instant) |
| `select(target, value, { hold = 260 })` | spotlight, then sets a `<select>` (fires `input` + `change`) |
| `pressKey(target \| null, key, { code })` | keydown/keypress/keyup on target (or the focused element). E.g. `pressKey(null, 'Escape')` closes a Modal; `pressKey('@tutor-input', 'Enter')`. The director never treats these as presenter keys |
| `slide(target, to \| [to, to, …], { duration = 900, easing = 'inOutCubic', pause = 250 })` | glowing thumb; moves an `<input type=range>` to `to` (or through waypoints) over `duration` *(tempo)* per leg, snapped to the input's `step`, firing `input` on every value change (live redraw) and `change` at the end of each leg. `easing`: `'linear' \| 'outCubic' \| 'inOutCubic' \| 'app' \| 'outBack'` or a function |
| `pointerDrag(target, path, { duration = 900, easing = 'inOutCubic', from, moveOn = 'window', mouse = false, spot = true })` | fingertip dot follows the path. `pointerdown` on the element, then `pointermove`… `pointerup` on `window` (where this app's drag code listens; `moveOn: 'element'` dispatches them on the element, which bubbles to window too). `path`: `{ dx, dy }` from the start, or client points `[{x, y} \| [x, y], …]`. `from`: start point, same forms as click's `at` (default: element center). Waits 70 ms after pointerdown so React can attach its window listeners. Always releases |
| `canvasClick(target, x, y, { units = 'frac', pointer = true, hold = 90 })` | ripple + fingertip at the point; pointer/mouse down-up then a `click` MouseEvent with coordinates. `units: 'frac'` (0..1 of the box), `'px'` (CSS px from its top-left), `'client'` |
| `spotlight(target, { hold = 320, pad = 6 })` | just the accent ring (to point at something without acting) |
| `scrollTo(target \| y \| 'top', { block = 'center' \| 'start' })` | smooth window scroll, waits to settle. `scrollTop()` = `scrollTo('top')` |
| `pointAt(el, fx, fy)` | `{ x, y }` client point inside el (for drag paths) |

The hover/press looks mirror the app's own rules for `.btn` (+ `.btn-orb`),
`.option`, `.suggest-pill`, `.face`, `.report-row`, `.tool-pick`, `.seg button`,
`.fb-pal-item`, `.jrail-stop` dot, `.concept--toggle`, `.reason-chip`, `.nav-link`,
`.nav-bell`, `.tutor-toggle`, `.dg-node`, `.fb-port`, `.icon-btn`, `.acc-head`,
`.lib-head`. Anything else still gets the spotlight and ripple.

### App state and data

| Member | |
|---|---|
| `navigate(path)` | `'/sessions'`, `'#/projects'`, `'/'`: sets the hash and waits for it (the router smooth-scrolls to top on every route change) |
| `api(path, { method, body })` | the app's own `api()`; aborts with the task |
| `getSessionRow(id = sessionId())` | **demo only**: the latest raw `om_learning_sessions` row the server sent, JSON columns parsed, snake_case names: `{ id, user_id, topic_id, status, zone, depth, score, questions: [{ id, text, concept, options, correctIndex, … }], answered: [...], lesson: { title, intro, steps: [{ title, body, block }] }, knowledge_map, summary, goal, … }`. `null` if nothing cached |
| `loadSessionRow(id = sessionId())` | refetches `GET /api/sessions/:id` (which refreshes the cache), then `getSessionRow` |
| `net()` | `{ inflight, lastEndAt }` |
| `refreshUnread()` | re-reads the nav bell now (it also refreshes on every route change, after every non-GET request, and every 5 s in demo) |
| `remember(key, value)` / `recall(key, fallback)` | JSON memo in sessionStorage: survives a refresh, cleared by `r r`. Share ids between beats/chapters (e.g. `remember('dive1', ctx.sessionId())`) |
| `appReady()` | waits for the app to boot (the engine calls it before every task) |

Useful markers from other teams: SessionView root `[data-demo="session"]` with
`data-stage` and `data-session-id`; lesson steps `@lesson-step[data-step-index]`;
blocks are wrapped in `[data-block="<type>"]`; the nav bell has `data-unread="N"`.
See the teams' manifests for every id.

## Examples

```js
// Sign in through the real form
async function signIn(ctx) {
  if (ctx.exists('@nav-signout')) await ctx.click('@nav-signout');
  await ctx.type('@signin-name', ctx.persona.name, { clear: true });
  await ctx.type('@signin-email', ctx.persona.email, { cps: 28, clear: true });
  await ctx.click('@signin-submit');
  await ctx.find('@ask-input', { timeout: 15000 });
  await ctx.waitIdle();
}

// Answer the current quiz question from the answer key (right, wrong or "no idea")
async function answer(ctx, mode = 'right') {
  const q = await ctx.find('@quiz');
  const row = ctx.getSessionRow();
  const key = row.questions.find((x) => String(x.id) === q.dataset.qid).correctIndex;
  if (mode === 'noidea') await ctx.click('@quiz-noidea');
  else {
    const idx = mode === 'right' ? key : (key + 1) % 4;
    await ctx.hover(`@quiz-option[data-idx="${(idx + 2) % 4}"]`, { hold: 300 }); // a moment of "thinking"
    await ctx.click(`@quiz-option[data-idx="${idx}"]`);
  }
  await ctx.waitIdle();
  await ctx.wait(1400); // let the audience read the explanation
}

// A lesson check step (the key is in the lesson itself)
const step = await ctx.find('@lesson-step');
const i = Number(step.dataset.stepIndex);
const { correctIndex } = ctx.getSessionRow().lesson.steps[i].block.question;
await ctx.click(`@check-option[data-idx="${correctIndex}"]`, { within: step });

// Sliders, drags, canvas
const root = await ctx.find('[data-block="neuron"]');
await ctx.slide('input[type=range]', [-2.5, 2.5], { within: root, index: 2, duration: 1400 });
await ctx.pointerDrag('[data-block="loss-surface-3d"] svg', { dx: 420, dy: -40 }, { duration: 1100 });
await ctx.canvasClick('[data-block="nn-playground"] @canvas', 0.85, 0.5);

// Lulu
await ctx.click('@tutor-toggle');
await ctx.type('@tutor-input', 'Can you walk me through routing a support email step by step?');
await ctx.click('@tutor-send');
await ctx.waitNet({ timeout: 45000 });

// A block driver (blockDrivers.js)
export async function driveMemory(ctx, root) {
  await ctx.slide('input[type=range]', [2, 6], { within: root, duration: 1600 });
  await ctx.click('text=Summarise old turns', { within: root });
}

// A chapter enter(): any state → signed in, on Home, at the top
async enter(ctx) {
  await ctx.pressKey(null, 'Escape');   // close a modal if one is open
  if (ctx.exists('@signin-name')) await ctx.fast(() => signIn(ctx));
  await ctx.navigate('/');
  await ctx.find('@ask-input');
  await ctx.scrollTop();
}
```

## Rehearsing

- `h` shows the HUD: status, chapter, running beat with a timer, next beat, queued
  press, last error, network, the last log lines.
- In the browser console: `__omDirector.next()`, `.back()`, `.jump(n)` (0-based),
  `.abort()`, `.setTempo(2)`, `.toggleHud()`, `.getState()`, and
  `await __omDirector.try(async (ctx) => { … })` to run any toolkit code once
  without moving the pointer (returns `{ outcome, error, ms, result }`).
- `r r` resets everything; the server-side demo data resets only if the server
  offers `POST /api/demo/reset` (called and ignored if missing).

## Gotchas

- Present from a **visible, foreground** window. Hidden tabs freeze CSS
  transitions and IntersectionObserver; timers slow down.
- Synthetic events never trigger CSS `:hover`/`:active`; only the classes listed
  above are mirrored. Ask the owning team for an `.om-demo-hover` rule if you need another.
- The presenter's resting mouse hides itself after 2.5 s and the page becomes
  click-through until it moves again, so a parked pointer can't hover things.
- Never click downloads (`⬇`), project delete (`✕`), or "Save to Projects" twice.
- A clicker's "start slideshow" button often sends F5 (reload): the show resumes
  at the start of the current chapter.
- Each `find` waits up to 8 s by default; give longer `timeout`s to things that
  wait on the (replayed) AI.
