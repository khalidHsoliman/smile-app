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
  patient and clinic names, the date, the teeth treated and the measurements; the measurements
  CSV file contains the patient and clinic names, the date, the teeth treated, the pupil
  distance and the measurements.

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
arch-run resolution, writing and reading case files (including broken, foreign, version 1 and
newer files), building the saved case from the app state, download file names, the measurements
CSV file, the question asked before opening a case, and the [measurements](#measurements) -- how
each is worked out and worded, including the sides on a mirrored photograph and the cases that
show "-". The store, the React components and the face detection import npm packages and are not
tested.

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
   adjustments. A **Measurements** panel under the sliders shows head tilt, the midline and lip
   line cants, the dental midline offset and the upper front teeth's proportions, following the
   design as it changes; with the patient's **Pupil distance** entered above it, the front teeth's
   sizes and the offset show in mm too (see [Measurements](#measurements)).
5. **Report.** Patient and clinic name, the [measurements](#measurements) under the header, and
   before/after pairs: a close-up of the mouth, the smile photograph and, when there is one, the
   retracted photograph -- with the design on it when the photographs were aligned. Each image
   downloads as a PNG, named after the patient (`jane-doe-smile-after.png`), and the
   measurements as a CSV file for the lab (`jane-doe-measurements.csv`, see
   [The measurements file](#the-measurements-file)); **Export PDF** opens the browser's print
   dialog; the measurements are kept together on one page.

## Measurements

The numbers a clinician reads off a design, shown in the Design step and in the report. They
are worked out from the facial references and the design as it stands, per-tooth adjustments
and nudges included, and are recomputed rather than saved. Sizes in mm also need the patient's
pupil distance (see [Sizes in mm](#sizes-in-mm)), which is saved with the case.

- **Head tilt** -- the line between the pupils, against the image horizontal.
- **Midline cant** -- the facial midline, against the line at 90° to the pupil line.
- **Lip line cant** -- the line between the two ends of the lip line (the mouth corners),
  against the pupil line.
- **Dental midline offset** -- how far the designed dental midline sits from the facial
  midline. The dental midline is the point halfway between the inner edges of 11 and 21 at their
  biting edge; the distance is measured along the pupil line, to the facial midline at the same
  height. It is a **percentage of a central's width** -- the average width of 11 and 21 -- so
  "9%" means the dental midline is off by 9% of a central incisor. Needs both 11 and 21. With a
  pupil distance, the mm follow: "9% (0.8 mm), toward patient's left".
- **Central width : length**, **Lateral / central**, **Canine / central** -- the upper teeth,
  each side on its own (11-13 and 21-23): the central's width against its length, and the
  lateral's and canine's width as a percentage of the central's on the same side.
- **Upper teeth, mm** -- the central's, lateral's and canine's width × length in mm, each side
  on its own, as seen from the front: the same widths the percentages compare, so a lateral or
  canine turning away round the arch shows narrower than the tooth really is. Needs a pupil
  distance.

Each tooth is measured with its own width and length as designed, ignoring its rotation. Only
teeth the clinician selected count: teeth added to complete the arch, and the lower arch, do
not.

Angles show to 0.1°, sizes in mm to 0.1 mm, everything else as whole percents. The direction
is named by the patient's side -- "2.1°, patient's left side lower", "2.1°, lower end toward
patient's left", "9%, toward patient's left" -- and a result that rounds to zero, "0.0°", "0%"
or "0% (0.0 mm)", names no side. The side follows the **Left pupil** and **Right pupil**
handles, not the image's left and right, so it stays the same on a mirrored photograph as long
as each pupil handle is on the eye it names.

A number that cannot be worked out -- a tooth that is not in the design, for example, or two
handles on top of each other -- shows "-": with a short reason in the Design step, on its own in
the report. Its row is always shown, with one exception: without a pupil distance, the report
leaves out the sizes in mm altogether, where the Design step shows them as "- (enter the pupil
distance)".

### Sizes in mm

A photograph has no scale of its own, so sizes in mm come from one distance the clinician
knows: the patient's **pupil distance**, entered in the Design step above the measurements.
Measure it as for glasses, looking into the distance. The app divides it by the distance
between the **Left pupil** and **Right pupil** handles to get mm per pixel, so the handles need
to sit on the pupils' centres.

- Any distance from 40 to 80 mm is taken, with a decimal point or comma: `62`, `62.5`, `62,5`
  and `62 mm` all read. Anything else is not used -- the sizes show "-" -- and the field says why
  once it is left. Emptying it removes the distance.
- The distance belongs to the patient: it is saved with the case (in the autosave and in case
  files), survives a photo being replaced, is not part of undo, and is cleared by **New case**.
- The report names it under the measurements -- "Sizes in mm from a pupil distance of 62.0 mm."
  -- so a printout says what its mm rest on.

The mm are an estimate, not a measurement of the mouth. The front teeth sit 1-2 cm in front of
the eyes, closer to the camera, so they read a few percent large -- roughly 0.1-0.3 mm on a
central incisor, more the closer the camera -- and the app does not correct for it. A head
turned to one side, a pupil handle off-centre or a pupil distance measured up close (the eyes
turn in) add error too.

### The measurements file

The **CSV** button under the measurements in the report downloads them for the lab, named like
the report images: `jane-doe-measurements.csv`, or `patient-measurements.csv` without a name.
It opens in Excel, LibreOffice, Numbers and most lab software.

- **Everything the report shows**, one value per row, in five columns -- Measurement, Tooth,
  Value, Unit, Note: the patient and clinic names, the date, the teeth treated, the pupil
  distance, the three angles, the dental midline offset (a % row and an mm row), the three
  ratios per side, and the width and length in mm of 11-13 and 21-23, each tooth by its FDI
  number.
- **A fixed layout.** Every file has the same rows in the same order, so a spreadsheet or an
  import set up once works on every case. A value that cannot be worked out is left empty, with
  the reason in the Note column (`23 not in the design`); without a pupil distance the mm rows
  are still there, empty, noted `no pupil distance entered`. Directions are in the Note column,
  worded as in the report.
- **Numbers as the report shows them**: 0.1° and 0.1 mm, whole percents -- rounded by the same
  code, so the file and the printout agree.
- **A fixed format**, whatever the computer's language: UTF-8 with a byte order mark (so Excel
  shows accents, other scripts, ° and × correctly), `.` for decimals, `,` between columns, CRLF
  line ends, quotes only where a value needs them. Excel set to a language that writes decimal
  commas (German, French, Italian and others) may open it all in one column or misread the
  decimals; importing it through **Data > From Text/CSV**, and telling it the file uses commas
  between columns and points for decimals, reads it correctly.
- **Safe to open.** A name that a spreadsheet would run as a formula -- one starting with `=`,
  `+`, `-` or `@` -- is written with a leading apostrophe, so it opens as text; line breaks and
  hidden direction marks in names are removed.

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
patient's pupil distance when one was entered, the selected teeth, the facial reference points,
the photo alignment, and the design -- template, sliders, per-tooth adjustments, shade and display
settings. Not included: undo history, zoom and the current step; the face frame and tooth
positions are recomputed from what is saved. The file is JSON with the photographs embedded as
base64, and starts with a format marker, a format version and the time it was saved.

**Open case** (header) opens a file picker. The chosen file is read and checked in full before
anything changes:

- A file that is not a case file, is damaged or cut short, or was saved by a newer version of
  the app is refused with a message saying which, and the open case stays as it was. A pupil
  distance that is not a number from 40 to 80 mm is damage like any other.
- A good file leads to a question naming the patient and when the case was saved. Confirming
  replaces the open case, which then becomes the autosaved case; it opens on the Upload step,
  with the later steps unlocked as far as its saved work allows.

The file records its format version. This version of the app writes version 2, which added the
pupil distance, and refuses files with a newer version, asking for the app to be updated. Version
1 files still open, with no pupil distance entered; saved again, they become version 2.

## Layout

```
src/
  domain/     pure, no npm packages, no React, no DOM, no store imports -- numbering, arch
              runs, face frame, fitting, photo alignment, tooth edits, undo history,
              measurements
  state/      zustand store and cascade invalidation, workflow steps, autosave (IndexedDB),
              case files
  features/   one folder per workflow step, plus the tooth chart, zoom and pan, the demo case,
              the step navigation, the Save case / Open case buttons, and the measurements
              panel the Design step and the report share, with the pupil distance input.
              Drawing the photos, reference handles and teeth as SVG happens here, in the
              step that shows them.
  export/     report images (SVG to PNG), the measurements CSV file and download file names
  vision/     MediaPipe wrapper, landmark indices and their checks, photo alignment on the
              teeth, shade sampling
test/         unit tests, mirroring src/, and the hook that lets plain Node run them
```
