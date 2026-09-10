# Scar Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the approved Scar Work prototype into the production frontend without changing its locked visual design or product flow.

**Architecture:** Preserve the existing Next.js/Vinext app and CSS visual system. Refactor the monolithic client prototype into small frontend modules with explicit demo-state contracts, route-safe legal/product surfaces, and testable interaction logic. All data remains local/mock for this phase; no Sibyl, Base, Virtuals, contract, or backend implementation is allowed in Phase 1.

**Tech Stack:** Next.js 16, Vinext, React 19, TypeScript 5.9, Tailwind/CSS, Lucide, existing shadcn/base-ui components.

**Spec:** `design.md`

## Global Constraints

- `design.md` is locked. No visual redesign without explicit user approval.
- Preserve the bright calm palette, Fredoka/Nunito typography, restrained motion, and approved copy style.
- No gradients, glow, glass, generic AI imagery, cyberpunk/Web3 treatment, or horizontal overflow.
- Preserve the complete ALLOW -> unsafe incident -> persistence visual state -> fresh session -> recall -> BLOCK prototype flow.
- During Phase 1, persistence and integrations remain intentionally simulated. Do not fake them as real.
- Do not add backend APIs, smart contracts, Sibyl SDK code, Base execution, or Virtuals code in this plan.
- Mobile must be intentionally usable at 320px and above.
- Authorization and execution states remain visually separate.
- Local control docs remain current according to `AGENTS.md`.

---

### Task 1: Establish the frontend verification harness

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `test/setup.ts`
- Create: `test/frontend/smoke.test.tsx`

**Interfaces:**
- Consumes: existing `app/page.tsx` default export.
- Produces: `npm test` command and a browser-like component test environment for later frontend tasks.

- [x] Add Vitest, jsdom, Testing Library React, Testing Library DOM, and user-event as dev dependencies.
- [x] Add `test` and `test:watch` scripts to `package.json`.
- [x] Configure Vitest to resolve `@/*` using the repository tsconfig and load `test/setup.ts`.
- [x] Write a failing smoke test that renders Scar and asserts the landing page exposes the Scar brand, primary opening CTA, Privacy, and Terms affordances.
- [x] Run the test and confirm the intended failure is caused by missing test setup or exposed behavior, not syntax/configuration mistakes.
- [x] Complete the minimal setup needed for the smoke test to pass without editing approved product copy.
- [x] Run the smoke test again and confirm PASS.

### Task 2: Extract stable frontend domain state

**Files:**
- Create: `features/scar/types.ts`
- Create: `features/scar/demo-data.ts`
- Create: `features/scar/demo-flow.ts`
- Create: `test/frontend/demo-flow.test.ts`
- Modify: `app/page.tsx`

**Interfaces:**
- Produces: `View`, `Surface`, `FlowStep`, demo activity/agent records, and pure transition helpers used by the UI.

- [x] Write failing tests for the legal demo transitions: initial -> checking-first -> allowed -> executing -> confirmed -> scar-saved -> fresh -> checking-recall -> blocked.
- [x] Write failing tests proving invalid transitions are rejected rather than silently jumping state.
- [x] Extract the state types and static records from `app/page.tsx`.
- [x] Implement pure transition helpers with the minimum behavior required by the tests.
- [x] Update `app/page.tsx` to consume the extracted contracts with no visual or copy changes.
- [x] Run tests and confirm PASS.

### Task 3: Componentize the approved console without visual drift

**Files:**
- Create: `features/scar/components/brand.tsx`
- Create: `features/scar/components/status-badge.tsx`
- Create: `features/scar/components/agent-face.tsx`
- Create: `features/scar/components/app-shell.tsx`
- Create: `features/scar/views/activity-view.tsx`
- Create: `features/scar/views/action-view.tsx`
- Create: `features/scar/views/agents-view.tsx`
- Create: `features/scar/views/scars-view.tsx`
- Create: `features/scar/views/scar-detail-view.tsx`
- Modify: `app/page.tsx`
- Test: `test/frontend/console-flow.test.tsx`

**Interfaces:**
- Consumes: `features/scar/types.ts`, `demo-data.ts`, and `demo-flow.ts`.
- Produces: focused view components with typed props and no integration side effects.

- [x] Write a failing user-flow test covering Activity -> action inspection -> ALLOW -> execution confirmed -> report unsafe outcome -> Scar saved -> fresh session -> recalled evidence -> BLOCK.
- [x] Extract reusable visual primitives first, preserving current classes exactly.
- [x] Extract each console view while preserving existing DOM semantics and CSS classes where possible.
- [x] Keep timers/demo orchestration in one small controller layer, not distributed across view components.
- [x] Run the full flow test and confirm PASS.
- [x] Compare the rendered UI against the original prototype at desktop and mobile widths before deleting duplicated markup.

### Task 4: Productionize public and legal surfaces

**Files:**
- Create: `features/scar/views/landing-page.tsx`
- Create: `features/scar/views/legal-page.tsx`
- Create or modify route files only if routing can be introduced without changing the approved UX.
- Modify: `app/page.tsx`
- Test: `test/frontend/public-surfaces.test.tsx`

**Interfaces:**
- Produces: stable Landing, Privacy, Terms, and console-entry surfaces.

- [x] Write failing tests for opening Privacy, Terms, returning Home, opening the operator console, and footer social/email affordances.
- [x] Extract landing and legal surfaces from `app/page.tsx` with exact approved content and styling.
- [x] Prefer real URL-addressable legal routes if the current Vinext routing setup supports them without deployment regressions; otherwise preserve the existing state surface for this phase and record the decision in `decision.md`.
- [x] Confirm browser back/forward behavior is not broken by whichever routing choice is used.
- [x] Run tests and confirm PASS.

### Task 5: Complete responsive and accessibility QA

**Files:**
- Modify only frontend files needed to fix verified defects.
- Create: `test/frontend/accessibility-contract.test.tsx`

**Interfaces:**
- Produces: keyboard-usable, touch-usable, overflow-safe frontend at 320px and above.

- [x] Add tests for nav menu accessibility state, dialog labels, copy controls, button labels, and non-color-only decision text.
- [x] Verify focus-visible treatment is present for interactive controls.
- [x] Verify mobile menu opens/closes and navigation changes do not strand focus.
- [x] Inspect 320, 375, 768, 1024, and 1440px widths for horizontal overflow and clipped hashes/labels.
- [x] Fix only observed defects while preserving the locked visual system.
- [x] Respect `prefers-reduced-motion` for motion that can translate or animate content.
- [x] Run tests and confirm PASS.

### Task 6: Frontend acceptance gate

**Files:**
- Modify: `status.md`
- Modify: `handoff.md`
- Modify: `security.md` only if a frontend trust-boundary/security issue was found.
- Append: `decision.md` only for material implementation choices.

**Interfaces:**
- Produces: verified Phase 1 frontend ready for backend wiring.

- [x] Run `npm test`.
- [x] Run `npm run lint`.
- [x] Run the project's TypeScript/build check through `npm run build`.
- [x] Manually complete the full demo flow once on desktop and once on mobile.
- [x] Confirm Privacy, Terms, GitHub/X/email footer affordances work as designed.
- [x] Confirm there is no horizontal overflow at 320px or above.
- [x] Confirm no Sibyl/Base/Virtuals/backend code was introduced during Phase 1.
- [x] Update `status.md` with exact verification results.
- [x] Update `handoff.md` with the next concrete task: backend contract design only after frontend acceptance is green.
