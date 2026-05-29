---
name: frontend-design-codex
description: Improve or build production-grade frontend interfaces in Codex. Use when styling, redesigning, or polishing React, Next.js, dashboard, landing page, component, or web app UI. Emphasizes distinctive visual direction, implementation inside the existing codebase, accessibility, responsiveness, and browser verification.
license: Adapted for this project from Anthropic's frontend-design skill concept.
---

# Frontend Design For Codex

Use this skill when a frontend needs to look and feel intentionally designed, not merely functional.

## Workflow

1. Read the existing frontend structure, styles, and component patterns before changing UI.
2. Choose one clear aesthetic direction that fits the product and audience.
3. Make scoped code changes in the existing framework rather than creating a disconnected demo.
4. Verify with build, lint, and browser inspection across the main viewport.
5. Fix visible layout, overflow, alignment, contrast, and interaction issues before reporting done.

## Design Direction

For operational SaaS, admin, CRM, recruiting, analytics, and dashboard products:

- Prefer a calm command-center feel: dense, legible, structured, and fast to scan.
- Use restrained color with a few meaningful accents for status, score, and action.
- Favor useful hierarchy over decorative hero sections.
- Avoid oversized marketing composition, nested cards, generic purple gradients, floating blobs, and stock-like decoration.
- Make the first screen the actual working product.

For expressive sites, games, portfolios, campaigns, or editorial pages:

- Commit to a memorable direction such as refined minimal, editorial, industrial, playful, retro-futuristic, art-deco, or luxury.
- Let typography, composition, motion, imagery, and spacing all reinforce that direction.

## UI Quality Checklist

- Typography: clear hierarchy, compact labels in panels, no viewport-based font scaling, no negative letter spacing.
- Layout: stable grid tracks, predictable responsive behavior, no text overlap or clipped controls.
- Components: buttons, inputs, filters, tables, cards, panels, empty states, and loading states should share visual language.
- Data UIs: prioritize scanning, comparison, filtering, and repeated action.
- Interaction: hover/focus/active states should be visible and subtle; animations should clarify state changes.
- Accessibility: maintain readable contrast, keyboard focus, and semantic form controls.
- Responsiveness: verify desktop and narrow layouts; controls should wrap cleanly.
- Validation: run available lint/build checks and inspect the actual UI in a browser when possible.

## Implementation Rules

- Use the project's existing framework, dependencies, icons, and CSS approach.
- Keep edits focused on the requested UI surface.
- Prefer CSS variables and reusable classes already present in the codebase.
- Add assets only when they materially improve the interface and are suitable for deployment.
- Do not describe the UI's features with visible instructional copy unless the workflow requires it.
