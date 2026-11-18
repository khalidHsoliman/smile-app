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
arch-run resolution, writing and reading case files (including broken, foreign, version 1 and 2
and newer files) and tooth template files, building the saved case from the app state and what an
autosaved design opens with, download file names, the measurements
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
4. **Design.** Template teeth (**Natural**, **Hollywood**, or a clinic's own -- see
   [Tooth templates](#tooth-templates)) fitted to the face, tuned with six
   sliders -- Scale, Ratio, Tooth proportion, Smile curve, Occlusal gap and Arch width; Scale,
   Occlusal gap and Smile curve start from values suggested by the mouth opening, Ratio and Tooth
   proportion from the template chosen, and **Reset** returns to the defaults and the template's
   starting values. Teeth can be
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

## Tooth templates

Two templates are built in: **Natural** and **Hollywood**. A clinic can use its own as well: export
a template to a file, edit it, and import it.

- **Export selected** (under the templates in the Design step) downloads the selected template. A
  built-in one is written as a copy, named `Natural (copy)` in `natural-copy-template.json`, because
  a built-in name is not accepted on import. An imported one keeps its name, so exporting it and
  importing the file again gives back the same template. A template file holds no patient data.
- **Import template…** reads a file, checks it in full, adds the template to the list with an
  **Imported** label, and selects it. A file that cannot be used is refused whole, with the reason
  under the buttons -- for example `teeth.12.outline is 0.759 wide, more than 10% off the tooth's
  width of 0.66` -- and nothing changes. The message stays until **OK** or the next import or
  export, so it can be read while the file is fixed.
- **Imported templates belong to the open case**, not to the app. **New case** and **Open case**
  replace them. The one the design uses is saved whole with the case, in the autosave and in the
  case file, so the case opens with it on any computer; other imported templates the design does
  not use are not saved.
- **A template is its content.** Importing the same file again adds nothing. Any change -- a number,
  a shape, the name -- makes it a different template, so editing a file afterwards never changes a
  case designed with the earlier version. A different template under a name already in the case is
  refused, as is a built-in name, whatever its capitals (`natural` too).

### How the sliders act on a template

**Ratio** and **Tooth proportion** work differently for the built-in templates and imported ones.
Choosing a template, and **Reset**, put both sliders at that template's starting values; the other
four sliders are about the face, not the teeth, and stay where they are. One **Undo** takes back a
template and its sliders together. Clicking the template already selected changes nothing.
**Tooth proportion** always reads as the upper lateral's width as a share of the central's, and the
canine narrows and widens with it.

**Natural and Hollywood** start at the published targets, 0.80 and 0.70, and the slider values *are*
the proportions drawn:

- **Ratio** is the central's width:length. Every tooth in an arch is lengthened or shortened by the
  one factor that gives the central that ratio, so each keeps its length relative to the central.
- **Tooth proportion** sets the lateral's width to that share of the central's, and the canine's to
  that share of the lateral's: 0.70 gives 0.70 and 0.49. The templates' own lateral and canine
  widths are not used.
- Premolars and molars keep the template's widths, but are never drawn wider than the tooth in front.

So Hollywood's squarer centrals (0.88) are drawn at 0.80 until Ratio is moved. This is how the two
templates have always drawn, and saved cases open exactly as they were designed.

**An imported template starts at its own proportions**, where every tooth is drawn exactly as the
file has it: Ratio at the width:length of 11, and Tooth proportion at the width of 12 as a share of
11's. Natural's shapes, imported, therefore start at 0.80 and **0.66**, and look different from the
built-in Natural: laterals 0.66 and canines 0.58 wide, as the file says, rather than 0.70 and 0.49.
From there:

- **Ratio** works as for the built-in templates, from the template's own lengths. Both arches
  follow 11, so lower teeth keep their lengths relative to the upper ones.
- **Tooth proportion** scales the template's own lateral and canine widths: the laterals by the
  slider's change from its starting value, the canines by that change squared, as the proportion
  compounds from tooth to tooth. Each tooth's own width is scaled, so the lower teeth keep the
  widths the file gives them against the lower centrals, however narrow those are.
- A tooth is never drawn wider than the one in front, unless the file draws it wider. Raised far
  enough, a canine grows faster than its lateral and stops at the lateral's width.

The measurements panel reads the teeth as drawn, so it shows the template's own proportions until
the sliders move.

### The template file

JSON, in this shape, with all 32 teeth keyed by their **FDI number** (11-18, 21-28, 31-38, 41-48):

```json
{
  "format": "smile-design-template",
  "version": 1,
  "name": "Natural (copy)",
  "description": "Softly rounded with a visible smile arc. The default for most cases.",
  "teeth": {
    "11": {
      "width": 1,
      "length": 1.25,
      "incisalOffset": 0,
      "outline": "M 0.49 0 C 0.4975 0.0249 0.5 0.2025 0.5 0.45 C ... Q 0 -0.07 0.49 0 Z"
    },
    "12": { ... },
    ...
    "48": { ... }
  }
}
```

**Units.** Everything is measured in **upper central incisor widths**: 11 and 21 are exactly 1 wide,
and every other number is relative to that. The app scales the whole set to the face; a template
holds proportions, not millimetres.

**Each tooth is drawn in its own frame**: the origin is the middle of the biting edge, x runs
toward the patient's left and y toward the gum. Lower teeth are drawn the same way, with y toward
their gum; the app turns them over. Left and right teeth are separate entries and are not mirrored
for you -- the built-in templates mirror their shapes, so an exported file shows how.

- `width`, `length`: the tooth's width and its length from biting edge to gum. The app spaces the
  teeth by `width` and reports sizes from both.
- `incisalOffset`: how far this tooth's biting edge sits above the central's; positive means
  shorter. It makes the gull-wing line of the smile -- Natural's laterals sit at 0.09.
- `outline`: the tooth's shape as an SVG path.

**What is checked** -- a file that fails any of these is refused:

| What | Rule |
|---|---|
| File | JSON, at most 1 MB, with the marker `"format": "smile-design-template"` and `"version": 1` (a newer version asks for the app to be updated) |
| `name` | 1-60 characters, no line breaks, tabs, other control characters or direction overrides; not a built-in name |
| `description` | Up to 200 characters, same characters as the name; may be empty |
| `teeth` | All 32 FDI numbers, and nothing else |
| `width` | 0.2 to 2; **exactly 1 for 11 and 21** |
| `length` | 0.3 to 3 |
| `incisalOffset` | -1 to 1 |
| 11 | Its width:length between 0.55 and 0.95, the Ratio slider's range, since Ratio starts there |
| 12 | Its width between 0.55 and 0.85 of 11's, the Tooth proportion slider's range, since Tooth proportion starts there |
| `outline` | One closed shape: starts with `M`, ends with `Z`, and uses only the absolute commands `M`, `L`, `C`, `Q` and `Z` -- no lowercase (relative) commands, `H`, `V`, `S`, `T` or `A`. At most 100 points and 10,000 characters; every coordinate within -10 to 10 |
| The drawn outline | Within 10% of the numbers: its width against `width`, its height against `length`, its centre within 10% of `width` of x = 0, and its lowest point within 10% of `length` of the biting edge, y = 0 |

Names and descriptions have spaces trimmed from their ends. Spaces and commas in an outline, and
repeated numbers after a command, are accepted as SVG allows, and the outline is stored written out
in full, as the built-in ones are. Fields the app does not know are ignored. Only 11 and 12 set where
the sliders start; the left side may differ from the right and is drawn as the file has it.

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
settings. A built-in template (Natural, Hollywood) is saved by name; an imported one is saved
whole, so the case opens on any computer. Not included: undo history, zoom and the current step; the face frame and tooth
positions are recomputed from what is saved. The file is JSON with the photographs embedded as
base64, and starts with a format marker, a format version and the time it was saved.

**Open case** (header) opens a file picker. The chosen file is read and checked in full before
anything changes:

- A file that is not a case file, is damaged or cut short, or was saved by a newer version of
  the app is refused with a message saying which, and the open case stays as it was. A pupil
  distance that is not a number from 40 to 80 mm is damage like any other, and so is a design
  whose template is neither built in nor carried whole and unaltered in the file.
- A good file leads to a question naming the patient and when the case was saved. Confirming
  replaces the open case, which then becomes the autosaved case; it opens on the Upload step,
  with the later steps unlocked as far as its saved work allows.

The file records its format version. This version of the app writes version 3, which added
imported templates (version 2 added the pupil distance), and refuses files with a newer version,
asking for the app to be updated. Version 1 and 2 files still open -- version 1 with no pupil
distance entered; saved again, they become version 3.

The autosave is not refused like a file: if an autosaved design's imported template cannot be
found, the case opens with Natural, its per-tooth adjustments cleared and the sliders kept, and a
notice says so.

## Layout

```
src/
  domain/     pure, no npm packages, no React, no DOM, no store imports -- numbering, arch
              runs, face frame, fitting, photo alignment, tooth edits, undo history,
              measurements
  state/      zustand store and cascade invalidation, workflow steps, autosave (IndexedDB),
              case files, tooth template files
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
