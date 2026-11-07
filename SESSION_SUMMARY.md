# Session-first companion UX

## Overview
This phase shifted the app from a developer-oriented VRM demo into a product-style learning experience centered on a live 3D companion session. The goal was to preserve the working VRM, animation, and voice foundations while restructuring the app into a calmer flow: home → companion selection → pre-call lobby → active session → summary.

The work stayed within the requested boundaries: no auth, no database, no cloud AI backend, no payments, no WebRTC/webcam setup, and no external service integration. The result is a polished local-only UX shell designed to support a future AI tutor layer without redesigning the experience again.

## History
1. The app started as a technical VRM/voice demo and needed to become a more productized experience.
2. The flow was restructured around the idea of a companion-led study session rather than a raw developer panel.
3. Existing 3D, voice, and animation systems were kept intact and reused instead of being replaced.
4. UI and state architecture were refactored to support a complete session lifecycle.
5. Product polish and performance guardrails were added to make the experience feel calm and useable.
6. The project reached a stable checkpoint where the app behaves like a local companion session app, even though it still lacks a real AI conversation engine.

## Work done
- Replaced the developer dashboard shell with a session-oriented app experience.
- Added home, companion selection, pre-call lobby, session, and summary screens.
- Introduced a lightweight state-driven flow in the app layer.
- Kept the existing VRM avatar and voice systems active within the new product flow.
- Added a debug/developer panel that remains accessible without cluttering the standard UX.
- Improved avatar presentation and screen hierarchy for a calmer, more premium feel.
- Added adaptive local quality and performance protections in the render pipeline.
- Verified the project still builds and runs successfully after the UX refactor.

## Technical details
- The app remains a Vite + React + TypeScript SPA with a 3D avatar stage.
- Session state is handled in the UI/app layer without introducing routing or backend infrastructure.
- Companion selection is currently local metadata rather than account-based data.
- The call-style session experience is visual and state-based; it does not imply actual remote video conferencing or WebRTC.
- Voice controls are still tied to the existing local session manager and avatar bridge.
- Performance hardening includes quality-tier detection, adaptive DPR, and delta-time clamping.
- The design follows a glassmorphism-inspired, minimal, accessibility-aware system with reduced-motion support.

## Important files
- [src/App.tsx](./src/App.tsx) — top-level screen flow and session orchestration.
- [src/components/UI.tsx](./src/components/UI.tsx) — product UI shell for home, companions, pre-call, session, and summary states.
- [src/components/UI.css](./src/components/UI.css) — styling for layout, panels, session screens, and responsive behavior.
- [src/services/SceneManager.ts](./src/services/SceneManager.ts) — render loop and quality/performance logic.
- [src/services/performance/QualitySystem.ts](./src/services/performance/QualitySystem.ts) — hardware-aware quality detection and DPR mapping.
- [src/components/ui/LearningCards.tsx](./src/components/ui/LearningCards.tsx) — reusable session learning card primitives.
- [src/components/AvatarCanvas.tsx](./src/components/AvatarCanvas.tsx) — VRM stage and loading overlays.
- [src/index.css](./src/index.css) — shared design tokens and accessibility defaults.

## Next steps
- Keep the current session-first architecture as the base for future AI tutor integration.
- Add a real conversation controller and tutor logic behind the existing flow.
- Connect avatar emotion or response states to learning context as the product matures.
- Continue to keep the app local-only unless a later phase intentionally introduces backend services.

## Checkpoint title
Session-first companion UX
