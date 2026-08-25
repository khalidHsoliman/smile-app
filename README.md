# Smile Design Web

A browser-based **2D digital smile design (DSD)** tool. A clinician uploads two patient
photographs, marks facial reference lines, overlays idealized template teeth, tunes them with
five global parameters, and exports a before/after report as PDF.

## Privacy: no backend, by design

This application is **fully client-side and static-hostable. Patient photographs never leave
the browser.** There is no server, no upload endpoint, and no cloud storage. Photos are held
in memory and in the browser's own IndexedDB, on the clinician's machine.

This is a deliberate compliance decision, not a temporary shortcut. Patient photographs are
identifiable health data; **the moment a server or cloud storage is introduced, HIPAA/GDPR
obligations attach to them.** Adding a backend is therefore a considered, well-resourced
decision to be taken explicitly -- not something to slip in for convenience.

## Scope

**2D only.** No intraoral scans, no meshes, no 3D workflow, and no mode flag anticipating one.
See `CLAUDE.md` for the full constraint list and `SMILE_DESIGN_KNOWLEDGE.md` for the domain
specification.

## Stack

Vite - TypeScript (strict) - React - Zustand - SVG rendering - `@mediapipe/tasks-vision` for
face landmarks - IndexedDB (`idb`) for persistence - Vitest.

## Getting started

```sh
npm install
npm run dev        # development server
npm test           # domain + state unit tests
npm run typecheck  # strict TypeScript, no emit
npm run build      # production build
```

## Layout

```
src/
  domain/     pure, dependency-free, fully unit-tested -- numbering, arch runs,
              face frame, fitting maths. No React, no DOM, no store imports.
  state/      zustand store, workflow steps, cascade invalidation
  features/   one folder per workflow step
  render/     SVG layers, view transform, hit-testing
  export/     snapshot capture, PDF/PNG generation
  vision/     MediaPipe wrapper and landmark -> reference derivation
```

`src/domain/` is the only genuinely subtle code in the project and is kept isolated so it can
be tested without a browser.

## Status

Skeleton and domain core. Implemented: workflow store with cascade invalidation, step
navigation, tooth numbering (Universal/FDI, mirroring), and arch-run resolution -- all under
test. Next: photo upload, tooth chart, MediaPipe landmarks, then **arch fitting plus the five
sliders**, which is the go/no-go milestone for the product.
