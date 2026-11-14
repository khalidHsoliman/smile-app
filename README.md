# Smile Design Web

A browser-based **2D digital smile design (DSD)** tool. A clinician uploads a smile photograph
and optionally a retracted one, picks the teeth to design, checks the facial reference lines the
app detects, overlays idealized template teeth, tunes them with six sliders and per-tooth
adjustments, and exports a before/after report as PNG images or, through the browser's print
dialog, as PDF.

## Privacy: no backend, by design

This application is **fully client-side and static-hostable.** There is no server, no upload
endpoint, and no cloud storage. While a case is being worked on, its photographs are held in
memory and in the browser's own IndexedDB, on the clinician's machine. The face detector's
runtime and model are served from the app's own origin, not a CDN, so analysing a photograph
makes no third-party request; when deployed, `public/_headers` sets a Content-Security-Policy
that allows requests to the app's own origin only.

Patient data leaves the browser only when the clinician saves or prints it:

- **Save case** writes a `.smilecase` file holding the patient's photographs, their name, the
  clinic name and the whole design (see [Case files](#case-files)). The file is not encrypted.
- **The report** PNG images contain the photographs; the PDF contains the photographs, the
  patient and clinic names, the date and the teeth treated.

Once downloaded, these files are the clinician's to keep safe, like any other patient record:
wherever they are stored, copied, synced or sent, that is the clinician's responsibility, not
the app's.

Keeping everything else in the browser is a deliberate compliance decision, not a temporary
shortcut. Patient photographs are identifiable health data; **the moment a server or cloud
storage is introduced, HIPAA/GDPR obligations attach to them.** Adding a backend is therefore a
considered, well-resourced decision to be taken explicitly -- not something to slip in for
convenience.

## Scope

**2D only.** No intraoral scans, no meshes, no 3D workflow, and no mode flag anticipating one.

## Stack

Vite - TypeScript (strict) - React - Zustand - SVG rendering - `@mediapipe/tasks-vision` for
face landmarks - IndexedDB (`idb`) for the autosave - Node's built-in test runner (`node:test`).

## Getting started

```sh
npm install
npm run dev        # development server
npm test           # unit tests (see Tests)
npm run typecheck  # strict TypeScript, no emit, including the tests
npm run build      # typecheck, then production build
npm run preview    # serve the production build
```

**Face model.** Face detection loads MediaPipe's Face Landmarker model from
`public/models/face_landmarker.task`, served as `/models/face_landmarker.task`. The WASM runtime
needs no setup: the build copies it out of `node_modules` into `/wasm`.

**Demo photographs.** The Upload step shows a **Load the demo case** button when
`public/demo/smile.(jpg|jpeg|png)` and `public/demo/retracted.(jpg|jpeg|png)` are present, and
hides it otherwise. See `src/features/demo/README.md` about the photographs.

## Tests

```sh
npm test
```

The tests run on **plain Node 22.18 or newer, with nothing to install**: Node runs the
TypeScript directly, and `npm test` only runs this command, which works without npm too:

```sh
node --import ./test/ts-resolve.mjs --test "test/**/*.test.ts"
```

`test/ts-resolve.mjs` lets Node follow the sources' `./file.js` imports to `file.ts`; on an
older Node it stops with a message saying which version is needed. Node does not check types
when it runs the tests -- `npm run typecheck` does, and it covers `test/`.

The tests live in `test/`, mirroring `src/`, and cover code that imports no npm package:
arch-run resolution, writing and reading case files (including broken, foreign and newer files),
building the saved case from the app state, download file names, and the question asked before
opening a case. The store, the React components and the face detection import npm packages and
are not tested.

## Workflow

Five steps, shown in the header. Each unlocks the next, and changing an earlier step resets
everything after it.

1. **Upload.** A frontal smile photograph (required) and a photograph with cheek retractors
   (optional); JPEG, PNG or WebP. Either can be rotated in quarter turns. The teeth to design
   are picked on a dental chart labelled in FDI numbering.
2. **Matching.** Aligns the retracted photograph onto the smile photograph so the design can be
   shown on both. **Auto-align** fits the two on face landmarks, then refines the fit on the
   teeth themselves; points can also be matched by hand and the overlay dragged. A trustworthy
   automatic alignment accepts itself; otherwise the clinician accepts it or skips matching.
   Skipped automatically when there is no retracted photograph.
3. **Facial Analysis.** Detects the pupils, nasal wings, facial midline, lip line and mouth
   opening on the smile photograph. The pupils, nasal wings, midline and lip line have handles
   that can be dragged to correct them; the mouth opening comes from detection only.
   **Re-detect** runs detection again.
4. **Design.** Template teeth (**Natural** or **Hollywood**) fitted to the face, tuned with six
   sliders -- Scale, Ratio, Tooth proportion, Smile curve, Occlusal gap and Arch width; Scale,
   Occlusal gap and Smile curve start from values suggested by the mouth opening. Teeth can be
   adjusted one at a time, optionally mirrored to the matching tooth, and the whole design
   nudged. The tooth shade is sampled from the photograph or chosen by hand. Teeth opacity,
   clipping to the mouth and blending into the photograph change how the design is shown. Undo
   and redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z) cover the template, the sliders and the per-tooth
   adjustments.
5. **Report.** Patient and clinic name, and before/after pairs: a close-up of the mouth, the
   smile photograph and, when there is one, the retracted photograph -- with the design on it
   when the photographs were aligned. Each image downloads as a PNG, named after the patient
   (`jane-doe-smile-after.png`); **Export PDF** opens the browser's print dialog.

## Saving work

**Autosave.** The open case is saved in the browser's IndexedDB a moment after every change and
restored when the app is opened again. There is one autosaved case: **New case** asks, then
discards it and starts empty.

### Case files

To keep a case after **New case**, or to move it to another computer or browser, save it to a
file.

**Save case** (header) downloads the open case as one file named after the patient and the day,
`jane-doe-2025-11-14.smilecase`, or just `2025-11-14.smilecase` without a name. Letters from any
language are kept (`josé-müller-…`, `محمد-علي-…`); spaces and punctuation become hyphens, and
characters a file name cannot hold, control characters, direction overrides and emoji are
dropped. Long names are shortened to fit. The report PNGs use the same rules for the name,
without the date, and `patient` when there is no name.

**What the file holds** is exactly what the autosave holds: both photographs as the app holds
them (the uploaded file, or a PNG once it has been rotated), the patient and clinic names, the
selected teeth, the facial reference points, the photo alignment, and the design -- template,
sliders, per-tooth adjustments, shade and display settings. Not included: undo history, zoom and
the current step; the face frame and tooth positions are recomputed from what is saved. The file
is JSON with the photographs embedded as base64, and starts with a format marker, a format
version and the time it was saved.

**Open case** (header) opens a file picker. The chosen file is read and checked in full before
anything changes:

- A file that is not a case file, is damaged or cut short, or was saved by a newer version of
  the app is refused with a message saying which, and the open case stays as it was.
- A good file leads to a question naming the patient and when the case was saved. Confirming
  replaces the open case, which then becomes the autosaved case; it opens on the Upload step,
  with the later steps unlocked as far as its saved work allows.

The file records its format version. This version of the app writes version 1, the only one so
far, and refuses files with a newer version, asking for the app to be updated.

## Layout

```
src/
  domain/     pure, no npm packages, no React, no DOM, no store imports -- numbering, arch
              runs, face frame, fitting, photo alignment, tooth edits, undo history
  state/      zustand store and cascade invalidation, workflow steps, autosave (IndexedDB),
              case files
  features/   one folder per workflow step, plus the tooth chart, zoom and pan, the demo case,
              the step navigation and the Save case / Open case buttons. Drawing the photos,
              reference handles and teeth as SVG happens here, in the step that shows them.
  export/     report images (SVG to PNG) and download file names
  vision/     MediaPipe wrapper, landmark indices and their checks, photo alignment on the
              teeth, shade sampling
test/         unit tests, mirroring src/, and the hook that lets plain Node run them
```
