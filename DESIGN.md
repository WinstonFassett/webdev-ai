# DESIGN.md — admin-svelte

Live dev-server observability dashboard. Terminal-adjacent, ultra-dense, monospace-first. Dark mode is the primary experience; light mode is a mirror.

> Note: promoted from `apps/admin-svelte/DRAFT_DESIGN.md` after a Google Stitch visual overhaul. Token names and component patterns are accurate; specific hex values and some layout details may be slightly stale — verify against `apps/admin-svelte/src/app.css` for ground truth.

## 1. Atmosphere

- **Density:** Maximum. Compact rows (py-0.5 to py-2.5), tiny type (10–13px), no decorative chrome
- **Personality:** Tool. Feels like a `top` pane or Chrome DevTools — not a product dashboard
- **Color strategy:** Near-monochrome. Blue accent for UI chrome. Semantic colors reserved for severity/state
- **Motion:** `transition-colors` only. No enter animations, no layout morphs
- **Typography:** Monospace everywhere (body default). System sans explicitly never used

## 2. Color Tokens

Tokens are defined in [apps/admin-svelte/src/app.css](apps/admin-svelte/src/app.css) as CSS custom properties and mapped into Tailwind via `@theme inline`. Components must reference semantic class names (`bg-muted`, `text-foreground`), never raw hex.

### Surfaces

| Token                   | Light     | Dark      | Role                            |
|-------------------------|-----------|-----------|---------------------------------|
| `bg-background`         | `#ffffff` | `#0a0a0a` | Page background                 |
| `text-foreground`       | `#0a0a0a` | `#e5e5e5` | Primary text                    |
| `bg-card`               | `#ffffff` | `#141414` | Raised surfaces (cards, panels) |
| `bg-muted`              | `#f5f5f5` | `#1a1a1a` | Hover fills, selected states    |
| `text-muted-foreground` | `#737373` | `#a3a3a3` | Secondary text, chrome          |
| `border-border`         | `#e5e5e5` | `#2a2a2a` | All borders                     |

### UI chrome — blue family (never collides with severity)

| Token       | Value     | Role                                 |
|-------------|-----------|--------------------------------------|
| `bg-accent` | `#3b82f6` | Links, selected tab underline, focus |
| `text-info` | `#3b82f6` | Info-level log entries               |

### Severity (reserved for state/levels only)

| Token            | Value     | Role                                 |
|------------------|-----------|--------------------------------------|
| `bg-destructive` | `#ef4444` | Errors, disconnected, delete actions |
| `bg-warning`     | `#f59e0b` | Warnings, idle servers               |
| `bg-success`     | `#22c55e` | Connected, live endpoints            |

**Rule:** Severity colors are not interchangeable with chrome. An error is `text-destructive`, never `text-warning`. Idle is `bg-warning`, never `bg-accent`.

Opacity modifiers (`/30`, `/40`, `/50`, `/60`) are used heavily for hover surfaces and tertiary text. Standard ladder: `/50` for third-rail text, `/30` for hover bg on cards.

## 3. Typography

**Body font-family is monospace** — `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`. Base size 13px. This is not a sans-serif app. Do not add `font-sans`.

| Element              | Classes                                                        |
|----------------------|----------------------------------------------------------------|
| Base body            | 13px (root), monospace                                         |
| Heading (view title) | `text-base font-medium text-foreground` (16px)                 |
| Section heading      | `text-sm font-medium text-foreground` (14px)                   |
| Section label        | `text-[10px] uppercase tracking-wide text-muted-foreground/60` |
| Body rows            | `text-xs` (12px) or `text-[11px]`                              |
| Sidebar tree         | `text-xs` (12px) with `text-[11px]` nested                     |
| Badges               | `text-[10px]`                                                  |
| Log entries          | `text-[11px] leading-[18px]`                                   |
| Footer / status bar  | `text-[10px]`                                                  |
| IDs, paths, ports    | `font-mono` (redundant but signals intent)                     |

The app is already mono; use `font-mono` utility only to signal intent for IDs/paths even though it's visually identical.

## 4. Layout Skeleton

Single fixed chrome, no scrolling page shell. Defined in [apps/admin-svelte/src/App.svelte](apps/admin-svelte/src/App.svelte).

```
┌─ header (h-8) ─────────────────────────── breadcrumbs · theme toggle ─┐
│                                                                        │
├─ sidebar (w-48) ─┬─ main (flex-1) ───────────────────────────────────┤
│  SidebarTree      │  ViewTabs (h-8) — Overview | Logs                 │
│                   │  ─────────────────────────────────────────────────│
│                   │  route content (overflow-y-auto)                  │
│                   │                                                    │
│                   │  ReplPanel (toggleable, absolute bottom)          │
├───────────────────┴────────────────────────────────────────────────────┤
│ footer (h-6) — connection · counts                                    │
└────────────────────────────────────────────────────────────────────────┘
```

Sidebar is fixed 192px (`w-48`), no resize. Main content scrolls internally. The whole page is `h-screen flex flex-col overflow-hidden` — never the window.

## 5. Spacing

Standard Tailwind scale only. No custom tokens.

| Context             | Classes                                     |
|---------------------|---------------------------------------------|
| Sidebar/tree rows   | `px-2 py-1`, nested `py-0.5`               |
| Card interiors      | `p-4` (default), `p-6` for view-scope       |
| Row groupings       | `space-y-0.5` (tree), `space-y-6` (sections)|
| Inline gaps         | `gap-1`, `gap-1.5`, `gap-2`, `gap-3`        |
| View content        | `p-6`                                       |
| Header/footer       | `px-3`                                      |

## 6. Borders, Radius, Shadows

- **Radius:** `rounded` (4px, tree rows), `rounded-lg` (8px, cards), `rounded-full` (status dots, badges)
- **Borders:** `border border-border` is the default for any card, panel, row group. `border-b border-border` for horizontal dividers.
- **Shadows:** Almost none. `shadow-lg` only on floating dropdowns. The monochrome palette relies on border contrast, not elevation.

## 7. Interaction Affordances

Every clickable thing must visually declare itself.

### Cursor
Every `<button>` and clickable card uses `cursor-pointer` explicitly. The browser default for `<button>` is not pointer — relying on defaults produces a tool that feels dead.

### Hover feedback

| Surface                  | Hover class                                                                 |
|--------------------------|-----------------------------------------------------------------------------|
| Tree row / chrome button | `hover:bg-muted`                                                            |
| Card-on-card / secondary | `hover:bg-muted/30`                                                         |
| Inline link / text-only  | `hover:text-foreground` or `hover:underline` (for `text-accent` links)      |
| Chevron / icon button    | `hover:text-foreground`                                                     |

`transition-colors` is always added for consistency.

### Focus
Native browser focus ring is kept. Do not add `outline-none` without a replacement.

### Compound interactive rows
When a row has two distinct affordances (toggle vs. select), use separate `<button>` children inside a hover-tracking parent — not one button with conditional onclick logic:

```svelte
<div class="flex items-stretch rounded hover:bg-muted">
  <button onclick={toggle}>▸</button>
  <button onclick={select}>…body…</button>
</div>
```

### Selection state
Selected rows/tabs use `bg-muted` plus `text-foreground font-medium`. Selection is never indicated by color alone — always a surface change.

### Tab underline
Active tab: `border-b-2 border-accent` with `-mb-px`. Inactive: `border-transparent`.

## 8. State Dots & Badges

**StatusDot** — `w-2 h-2 rounded-full` in `bg-success` (live) or `bg-warning` (idle). Always paired with `title` for tooltip.

**ServerTypeBadge** — Brand-colored (Vite purple `#646CFF`, Storybook pink `#FF4785`, etc.). One of the few places hard-coded hex is allowed — these are brand colors, not theme tokens. Shape: `text-[10px] px-1.5 py-0.5 rounded`. Brand colors live inline in the component; do not promote to CSS variables.

## 9. Routing & URL State

Hash-based routing: `#/view[/id[/type[/browserId]]][/logs]`. See [apps/admin-svelte/src/lib/data/router.ts](apps/admin-svelte/src/lib/data/router.ts).

Tab is part of the URL. Nav handlers always spread existing `route` and override only the changing fields:

```ts
navigate({ ...route, view: 'project', projectId, type: undefined, browserId: undefined })
```

Never `navigatePath('#/project/xxx')` — that silently drops current tab. Use `navigate()` with a route object.

## 10. View Composition Pattern

Every view follows the same skeleton:

```svelte
<ViewTabs {route} />
{#if route.tab === 'logs'}
  <LogStream filter={...} historyServerIds={...} />
{:else}
  <div class="p-6 space-y-6 overflow-y-auto flex-1">
    <!-- view header -->
    <!-- <LogSummary> -->
    <!-- domain content -->
  </div>
{/if}
```

`LogSummary` sits near the top of every Overview — logs are always visible as counts and recent entries, not hidden behind the tab.

## 11. Keyboard

| Key           | Action                  |
|---------------|-------------------------|
| `Cmd+K` / `/` | Open command palette    |
| `Ctrl+\``     | Toggle REPL panel       |
| `Esc`         | Close palette / REPL    |

## 12. Do's and Don'ts

### Always
- Use semantic Tailwind classes (`bg-muted`, `text-muted-foreground`, `border-border`)
- Add `cursor-pointer` and a hover style to every clickable element
- Preserve `route.tab` via `navigate({ ...route, … })`
- Split compound interactions into sibling buttons under a hover parent
- Prefer smaller type (`text-xs`, `text-[11px]`)

### Never
- Introduce `font-sans`
- Use severity colors for UI chrome
- Use `bg-accent` to indicate a status
- Rely on color alone for selection
- Build nav with `navigatePath('#/...')`
- Remove the focus ring without a replacement
- Add shadows beyond `shadow-lg` on floating menus

## 13. Agent Quick Reference

```
Surfaces:     bg-background, bg-card, bg-muted, bg-accent
Text:         text-foreground, text-muted-foreground, text-muted-foreground/50
Borders:      border-border (default), border-b border-border (divider)
Chrome:       bg-accent (#3b82f6), text-info
Severity:     text-destructive, bg-warning, bg-success
Hover:        hover:bg-muted (rows), hover:bg-muted/30 (cards)
Clickable:    cursor-pointer + hover:* + transition-colors
Radius:       rounded (rows), rounded-lg (cards), rounded-full (dots)
Type:         text-xs default; text-[11px] dense; text-[10px] labels
Family:       monospace body — do not override
Nav:          navigate({ ...route, … }) — never navigatePath for inter-view jumps
Ground truth: apps/admin-svelte/src/app.css
```
