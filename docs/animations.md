# Animations

Every animation is purely visual and can be removed without touching the app's behavior. Most of them live in **one file**: [`client/src/animations.scss`](../client/src/animations.scss), which is loaded by the first line of [`client/src/styles.scss`](../client/src/styles.scss) (`@use 'animations';`).

## How to turn them off

| Goal | What to do |
|---|---|
| Everything, without deleting anything | Add `data-motion="off"` to the `<html>` tag in `client/src/index.html`. |
| Everything, for good | Delete `client/src/animations.scss` and the `@use 'animations';` line at the top of `client/src/styles.scss`, then remove the pieces under *Not in the stylesheet* and *Things that exist only for the animations* below. |
| One of them | Delete its section in `animations.scss` (the sections are numbered like the table below). |
| People who ask for less motion | Already handled: the `prefers-reduced-motion` rule at the end of `styles.scss` switches all animations off for them. |

## What exists

| # | Animation | Where it is | Notes |
|---|---|---|---|
| 1 | Modals fade and scale in and out | `animations.scss` section 1 (`.modal-backdrop`, `.modal-panel`) | The Modal component (`shared/modal.ts`) keeps the dialog on screen for 170 ms after closing so it can fade. Without the stylesheet it simply closes 170 ms late; set that delay to 0 in the component if you remove the animation. |
| 2 | Page changes fade up | section 2 (`main.page > *`) | |
| 3 | New table rows fade up, staggered | section 3 (`table.list tbody tr`) | Only rows that are created animate, not every refresh. |
| 4 | Button hover lift, press, and a spinner while working | section 4 (`.btn`, `.btn.busy`) | The spinner shows on buttons that have `[class.busy]="busy()"` in their templates; harmless if the CSS is gone. |
| 5 | Pulsing ring on LIVE badges | section 5 (`.badge.live`, `.pill.live`) | |
| 6 | Pulsing Share screen button while streaming; live chip fades in | section 6 (`.btn.share.pulsing`, `.livechip`) | The `pulsing` class is set in `pages/dashboard/shell.ts`. |
| 7 | Rooms "More" menu drops down | section 7 (`.more[open] .menu`) | |
| 8 | Viewer page: stats rise, unmute button bounces in | section 8 | |
| 9 | Toasts slide in and out | section 9 (`.toast-stack`) | See *Things that exist only for the animations*. |
| 10 | Shimmering loading placeholders | section 10 (`.skeleton`, `.is-loading`) | Used by the Rooms, Users and Presets pages (see below). |

## Not in the stylesheet

These are tied to a component and carry an `ANIM:` comment, so `grep -rn "ANIM:" client/src` finds them:

- **Hamburger menu slide and icon turn** (`ANIM:menu-slide`, `ANIM:menu-icon`) in `client/src/app/pages/dashboard/shell.ts` and `client/src/app/shared/topbar.ts`. To remove: delete the closed-state `visibility`/`opacity`/`transform`/`transition` lines and the matching lines of the `.menu.open` block, and make `.menu` use `display: none` when closed and `display: flex` when open again.

## Things that exist only for the animations

- **Toasts** (`client/src/app/core/toast.ts`, `client/src/app/shared/toast-host.ts`, the `<app-toast-host />` tag in `client/src/app/app.ts`). They show "Copied to the clipboard" and "Saved.". The function `toast()` is called from `copyText()` in `core/util.ts` and after saving on the Bandwidth page. To remove: delete the two files, the tag and its import in `app.ts`, and the `toast(...)` calls.
- **Loading placeholders**: in the Rooms, Users and Presets pages the table card has `[class.is-loading]="!loaded()"` and is preceded by a block of `.skeleton` bars shown while `!loaded()`. To remove: delete that `@if (!loaded())` block and the `[class.is-loading]` attribute. The `loaded` signals are harmless.
- **Busy spinners**: remove `[class.busy]="busy()"` from the buttons if you want (it does nothing without the CSS).
