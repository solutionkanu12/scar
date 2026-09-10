# Scar UI/UX Source of Truth

## Product truth

Scar is shared safety memory for autonomous agents. It sits between an agent's proposed action and execution. Sibyl Memory persists incidents and retrieves relevant organizational history. Memory is evidence. Deterministic policy code returns ALLOW, REVIEW, or BLOCK. The LLM may interpret and explain, but it never authorizes a consequential action.

The product proof is one causal sequence:

`incident -> persisted Scar -> fresh session -> recalled evidence -> changed decision`

Unknown authorization never appears safe. If memory cannot be verified, protected execution stops. Authorization and execution outcomes are always shown separately.

## Aesthetic direction

**Bright Safety Ledger** combines an operational incident ledger with Oddie's rounded, playful confidence. The environment is cream-first, spacious, bright, calm, and precise. Bold Fredoka headlines create character. Nunito keeps operational text easy to scan. Yellow marks the primary action and the strongest proof point. Dark charcoal anchors the product without turning it into a dark security console.

No hackathon, demo, judge, or simulation language appears in the product.

## Brand mark

Use a standalone inherited-memory mark made from three connected rounded traces. It represents an incident passing protection forward. It is not a letter, shield, brain, sparkle, chain link, or mascot. It must remain legible at 16px and work beside the Scar wordmark.

Agent identities use simple rounded character portraits with distinct silhouettes and functional tool symbols. They remain calm and professional, not cartoon mascots.

## Color tokens

| Token | Value | Use |
|---|---:|---|
| Canvas | `#F7F8EE` | Main page background |
| Surface | `#FBFCF4` | Primary panels and controls |
| Raised surface | `#F1F4D7` | Focused memory and decision surfaces |
| Inset surface | `#E7EDF2` | Muted rows and disabled surfaces |
| Primary text | `#0B1400` | Headings and primary content |
| Secondary text | `#3C4550` | Supporting copy |
| Muted text | `#5E6975` | Metadata and timestamps |
| Inverse text | `#FBFCF4` | Text on charcoal |
| Accent | `#D7DC1F` | Primary CTA and focal evidence |
| Accent hover | `#D0D815` | Primary hover |
| Accent quiet | `rgba(215, 220, 31, 0.14)` | Selected and supporting states |
| Memory | `#9AA015` | Sibyl retrieval and inherited evidence |
| Warning | `#E0A300` | REVIEW and caution |
| Error | `#FF6B5A` | BLOCK and negative actions |
| Error deep | `#D64A3A` | Critical labels and validation |
| Boundary | `#D3D8BE` | Structural dividers |
| Separator | `#E7EDF2` | Ledger rows |
| Focus | `rgba(215, 220, 31, 0.35)` | Focus ring |
| Charcoal surface | `#0C0D0B` | Small high-contrast anchors only |

The canvas, surface, text, yellow, olive, gold, and red roles come from the supplied Oddie design system. Large areas remain pale and calm. Pure black is not used as an extended surface.

## Typography

- Display and headings: Fredoka, weights 600 to 700.
- Body, navigation, labels, and controls: Nunito, weights 600 to 900.
- Evidence IDs and hashes: system monospace only where the data requires it.
- Display: 63px/64px desktop, 48px tablet, 36px mobile.
- Page title: 34px/39px desktop, 30px tablet, 27px mobile.
- Section title: 23px/29px.
- Body: 17px/28px.
- Compact body and controls: 15px/22px.
- Label: 14px/18px. Do not go below 12px.
- No artificial letter spacing for normal copy. Small uppercase metadata may use at most 0.04em.

Copy is concise, calm, specific, and written for technical operators. No buzzwords, hype, filler, exclamation marks, em dashes, or en dashes.

## Geometry and spacing

- Base unit: 4px. Primary rhythm uses 8px steps with 4px half-steps.
- Spacing: 4, 8, 12, 16, 20, 24, 28, 36, 48, 56, 80.
- Page maximum: 1440px.
- Desktop gutters: 48 to 80px. Tablet: 32 to 40px. Mobile: 16px.
- Primary controls: pill radius `999px`.
- Inputs: 12px radius.
- Compact evidence and status: 9px radius.
- Focus panels: 24 to 30px radius.
- Ledger rows remain flat and are separated by whitespace or a pale divider.
- Use the full Oddie multi-layer olive shadow only for the action inspector, decision result, modal, and rare raised surfaces. Never apply it to every row.

## Components

- App shell with desktop sidebar and compact mobile top bar.
- Brand mark and wordmark.
- Agent character, name, role, and status.
- Activity ledger row.
- Action status and decision badge.
- Current action summary.
- Memory search progress.
- Memory evidence block with source incident.
- Policy result row.
- Decision panel.
- Evidence and transaction row with copy control.
- Incident timeline.
- Incident creation dialog.
- Review approval dialog.
- Empty, loading, unavailable, invalid, unauthorized, and failure states.
- Toast feedback.

All interactive targets are at least 44px. Focus-visible states use a 3px accent ring. Status always combines color with a label and icon.

## Motion

- Press: 120ms.
- Hover and color: 160ms ease.
- Evidence reveal: 220ms strong ease-out.
- Dialog or sheet: 240ms strong ease-out.
- Route-level content change: 220ms ease-in-out.
- Memory checking uses a restrained linear trace, then reveals evidence before the decision.
- Do not use hover enlargement, spring motion, glow, or decorative animation.
- Reduced motion removes translation and preserves immediate opacity and color feedback.

## Responsive rules

- Desktop: 196px navigation plus flexible content. Action inspection uses two columns, with current action on the left and evidence plus decision on the right.
- Tablet: compact top navigation. Two columns remain only when each can retain a readable measure.
- Mobile: one purposeful sequence, not a stack of desktop cards. Decision appears directly after the current action, followed by the memory that explains it. Secondary metadata uses disclosure. Hashes truncate with a copy control. Primary actions remain reachable.
- No horizontal scrolling at 320px or above.

## Product flow

1. Activity opens with active agents and protected actions.
2. The operator opens the Treasury Agent action to Supplier Alpha.
3. Scar visibly checks organizational memory and static policy.
4. No relevant Scar is found. Authorization returns ALLOW.
5. The Base transaction moves from pending to confirmed.
6. The operator selects `Report unsafe outcome`.
7. A focused incident form captures what happened, severity, evidence, and the learned safeguard.
8. Scar saves the incident to Sibyl and confirms that protection now applies to Treasury and Procurement.
9. A fresh Procurement Agent session starts with no inherited browser state.
10. Procurement proposes a related action to Supplier Alpha.
11. Scar retrieves the Treasury incident, shows its provenance, evaluates policy, and returns BLOCK.
12. The operator can open the original incident without losing the current action context.

## Screen inventory

### Public landing page

Answers: Why does Scar exist and what changes after an incident? The first viewport pairs one direct claim with a compact live product proof. The page contains five purposeful sections only: promise, product proof, mechanism, fresh-session decision change, and security boundary. Navigation remains sticky and scrolls smoothly to the relevant section.

Use one real archival photograph as a memory metaphor. Remaining visuals must be product-native interface compositions built from actual Scar concepts and data. Do not use AI-generated imagery, generic robots, brains, glowing networks, stock handshake scenes, or decorative technology photography.

The landing page uses the same canvas, typography, agent identities, status colors, buttons, corners, and motion grammar as the console. It must feel like the public face of the same product rather than a separate marketing template.

### Privacy and Terms

Privacy and Terms are dedicated readable surfaces reached from the footer. Use a narrow text measure, clear sections, and the same navigation and footer. Legal copy remains plain, calm, and specific.

### Activity

Answers: What is Scar protecting now? Shows active agents, current status, recent action ledger, and when organizational memory affected a decision.

### Action inspection

Answers: Why can or cannot this action proceed? Keeps the current action, memory evidence, policy, authorization, and execution state in one causal view.

### Scar detail

Answers: What happened, what was learned, and who inherits the safeguard? Shows incident facts, outcome, safeguard, affected agents, and verifiable evidence.

### Agent detail

Answers: What can this agent do and what safety memory does it inherit? Remains lightweight.

### Incident creation

Answers: What unsafe outcome should become organizational memory? Opens from a completed action as a normal operator control, not a demo shortcut.

## Required states

Loading app, no agents, no activity, checking memory, no relevant memory, one related Scar, multiple Scars, ALLOW, REVIEW, BLOCK, execution pending, execution succeeded, execution failed, incident draft, incident saved, fresh session, Sibyl unavailable, invalid action, unauthorized agent, empty Scar history, Base pending, and Base confirmed.

Sibyl unavailable always stops protected execution. REVIEW requires explicit human confirmation. BLOCK never offers a casual bypass.

## Forbidden patterns

No gradients, glass, glow, neon-on-dark treatment, generic AI chat, dashboard metric grids, bento grids, oversized marketing hero, decorative stars, emoji icons, excessive cards, nested cards, extended black surfaces, or generic Web3 wallet styling.

## Prototype acceptance criteria

- A first-time viewer understands the action, memory check, and decision within 10 seconds.
- The first allowed action can become a critical Scar through a normal operator workflow.
- The fresh session is understandable without narration.
- The original Treasury incident is visibly connected to the later Procurement BLOCK decision.
- Authorization and execution never blur together.
- Every primary interaction works with keyboard and touch.
- Desktop, tablet, and mobile remain readable without clipping or horizontal scroll.
- The landing page reaches the product mechanism within the first viewport and never relies on hype or generic feature-card grids.
- Footer links expose Privacy, Terms, GitHub, X, and email destinations without inventing unavailable company information.
