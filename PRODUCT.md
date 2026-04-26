# Product

## Register

product

## Users

Frontend developers working in AI-assisted coding workflows. The user runs one or more dev servers, has an AI agent pairing session active, and opens the admin to see what the agent sees: which browsers are connected, what's happening in logs, and what state is shared. Context: focused work session, usually one monitor or a side tab, always in a dev environment.

## Product Purpose

web-dev-mcp admin is the human dashboard for the gateway — a partner tool for agent-assisted frontend development. The gateway gives agents access to real browsers running live dev servers. The admin surfaces the same state the agent has: connected browsers, log streams across multiple channels, build health, and REPL access. The shared view is the point — agents and humans see the same ground truth. Success looks like: open the admin, immediately know what's connected and whether anything is broken, drill to any log within two clicks.

## Brand Personality

Sleek, precise, alive. Not a business dashboard. Not a SaaS product. A technical instrument — closer to Chrome DevTools or `htop` than to Datadog or Vercel. The polish is in the density and the correctness, not in decoration.

## Anti-references

- SaaS dashboards: Datadog, Grafana, New Relic — too much chrome, metric cards, gradient accents
- Business ops tools: Linear, Notion — wrong register entirely
- "Developer experience" marketing UI: spacious hero stats, onboarding flows, empty-state illustrations
- Anything with gradient text, glassmorphism, or side-stripe borders

## Design Principles

1. **Shared ground** — the admin shows what agents and humans share: same browsers, same logs, same state. Make that parity legible at a glance; it's the differentiating idea.
2. **Tools look like tools** — no SaaS chrome, no hero metrics, no decorative surfaces. The UI is infrastructure; treat it as such.
3. **Clarity through density** — more information per viewport inch signals competence. Dense is not cluttered; it means every element earns its place.
4. **Live truth** — logs update continuously, connections appear and disappear. Design must feel like a window into real-time reality, not a report of past state.
5. **Sleek ≠ sparse** — precise and polished, not austere. Monospace, tight type, minimal radius — but intentional, not accidentally plain.

## Accessibility & Inclusion

WCAG AA contrast for text and interactive elements. No requirements beyond reasonable contrast — this is a dev tool used by developers in controlled environments. Reduced motion respected (system preference), though the app is currently minimal on animation; live updates are log appends and scroll, not transitions.
