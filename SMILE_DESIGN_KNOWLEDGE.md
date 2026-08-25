# Smile Design — Domain & Product Knowledge Transfer

> **Purpose of this document.** This is a distilled, self-contained brief for an AI coding
> agent (and human developers) starting a **new, web-based 2D smile-design application from
> scratch**. It encodes everything learned from building a mature desktop smile-design product
> — the clinical domain, the workflow, the data model, the algorithms, and the hard-won
> lessons — **without any dependency on the previous codebase, its backend, or its company.**
>
> There is no shared code, no shared server, no shared file format. Treat this as a
> specification and a body of experience, not as a porting guide.

---

## 0. Read this first: the ten things that actually matter

If you read nothing else, internalize these. Each is expanded later.

1. **A smile design is a photo with teeth drawn on it.** Everything else is machinery to
   make those teeth land in the right place at the right size.
2. **The tooth numbering system is the backbone of the whole data model.** Get it right on
   day one; retrofitting it is agony. (§2)
3. **The workflow is strictly linear and each step invalidates everything after it.** Editing
   an earlier step must cascade a reset forward. This is the single most common source of
   "impossible" bugs. (§4, §11.1)
4. **Teeth must be imported as a *contiguous run* including a central incisor**, even teeth
   the user didn't select. The fitting math needs neighbors and an anchor. Non-selected
   fill-ins are "auxiliary" teeth: present in the math, hidden from the user. (§6.3)
5. **Facial landmarks drive the design.** Interpupillary line, facial midline, nasal wings,
   and lip/smile curve define the coordinate frame the teeth are placed into. (§5)
6. **Five global fine-tune parameters** (ratio, scale, curve-of-spee, occlusal gap, inner
   gap) reposition the *entire* arch at once. They are the primary design control, far more
   used than per-tooth editing. (§6.4)
7. **Every long operation needs a progress + promise abstraction**, and every user gesture
   that can fire rapidly (sliders, dropdown hovers) needs debouncing and serialization.
   (§9.2, §11.2)
8. **Undo/redo must be batched.** One user action = one undo entry, even when it triggers
   twenty internal operations. (§9.3)
9. **The deliverable is the before/after report.** It is what the clinician shows the
   patient and what sells the treatment. It is not an afterthought. (§8)
10. **Ship the 2D path only.** 3D scans, veneer geometry, and printable mockups are a
    different product. Deliberately out of scope. (§12)

---

## 1. What a smile design application is

### 1.1 The clinical problem

A patient wants to improve the appearance of their front teeth — via veneers, crowns,
composite bonding, or orthodontics. Before any irreversible work happens, the clinician must:

- **Plan** what the new teeth should look like (shape, size, proportion, alignment).
- **Communicate** that plan to the patient so they can consent to it enthusiastically.
- **Communicate** it to the dental lab that will fabricate the restorations.

**Digital Smile Design (DSD)** is the established clinical methodology for this. It is a real,
named discipline in dentistry with published protocols — not something we invented. The core
insight of DSD is that *aesthetic dentistry is governed by facial proportions, not by the
teeth in isolation.* A technically perfect tooth that ignores the patient's facial midline
looks wrong to everyone who sees it.

### 1.2 What the software does

Given photographs of a patient, the software lets a clinician overlay a set of idealized
template teeth onto the patient's smile, align them to the patient's facial reference lines,
adjust their proportions, and produce a **before/after visualization**.

That's it. That is the whole product. Everything else is refinement.

### 1.3 Who uses it

- **Primary user: the clinician** (dentist, prosthodontist, or a trained treatment
  coordinator). They are *not* CAD professionals. They are time-poor, often doing this
  chairside with a patient waiting, and they will abandon a tool that requires more than a
  few minutes per case.
- **Secondary audience: the patient**, who sees only the final report. The report is a
  *sales and consent instrument*.
- **Tertiary audience: the dental lab**, in the full product. **Out of scope for the MVP.**

**Design implication that cannot be overstated:** optimize aggressively for *speed to a
plausible result*. A one-click automatic result the user then nudges beats a blank canvas
with perfect tools, every single time. The previous product's most-used feature by an
enormous margin was the five fine-tune sliders — not any of the precise per-tooth editing.

### 1.4 Vocabulary you need

| Term | Meaning |
|---|---|
| **Smile photo** | Frontal photo, natural smile, lips apart, teeth visible. The main design surface. |
| **Retracted photo** | Frontal photo with cheek retractors pulling the lips away, exposing the full arches. Used for accurate tooth-shape reference. |
| **Arch** | The curved row of teeth in one jaw. Upper arch (maxillary) / lower arch (mandibular). |
| **Incisor** | The flat front cutting teeth. **Central incisors** are the two middle ones — the aesthetic centerpiece of any smile design. |
| **Canine** | The pointed "eye tooth", third from the midline. Marks the corner of the smile. |
| **Midline** | The vertical line splitting the face (facial midline) or the arch (dental midline). Mismatch between them is a classic aesthetic complaint. |
| **Incisal edge** | The biting edge of a front tooth. The curve traced by all incisal edges is the **smile line**. |
| **Gingival margin / zenith** | The gum line at the top of a tooth, and its highest point. |
| **Curve of Spee** | The gentle front-to-back curve of the biting surfaces of the arch. In a 2D frontal view it reads as a subtle arc of the incisal edges. |
| **Golden proportion** | The classical aesthetic rule that successive visible front teeth appear in a ~1.618 width ratio. Widely taught, loosely applied. |
| **Width/length ratio** | For a central incisor, an aesthetically pleasing width:length is roughly **0.75–0.85**. This is the single most useful numeric guideline in the whole domain. |
| **Mockup** | A physical or visual preview of the planned result. In 2D, it's the composited after-image. |
| **Veneer** | A thin shell bonded to the front of a tooth. The most common restoration this planning drives. |

---

## 2. Tooth numbering — get this right first

There are two competing numbering systems, and users expect to switch between them freely.
Store one canonically, display either.

### 2.1 Universal Numbering System (US convention) — **use this as your internal canonical ID**

Teeth are numbered **1–32** in a single continuous sweep:

- **1–16**: upper arch, starting at the patient's **upper right** third molar (1), sweeping
  across the midline, ending at the **upper left** third molar (16).
- **17–32**: lower arch, starting at the **lower left** third molar (17), sweeping across,
  ending at the **lower right** third molar (32).

Key landmarks to memorize:

| Universal # | Tooth |
|---|---|
| 8 | Upper right central incisor |
| 9 | Upper left central incisor |
| 7 / 10 | Upper lateral incisors |
| 6 / 11 | Upper canines |
| 24 / 25 | Lower central incisors |

**The aesthetic zone — the teeth that actually matter for smile design — is roughly
universal 4–13 (upper) and 20–29 (lower).** In practice most cases only design upper 5–12.

### 2.2 FDI / ISO Two-Digit System (international convention) — **for display**

Two digits: `quadrant` + `position from midline`.

- Quadrants (patient's perspective): **1** = upper right, **2** = upper left, **3** = lower
  left, **4** = lower right.
- Position: **1** = central incisor … **8** = third molar.

So the upper right central incisor is **11** ("one-one", never "eleven"), the upper left
central is **21**, lower left central is **31**, lower right central is **41**.

### 2.3 The conversion table

Index this array with `universal - 1` to get FDI. This exact ordering is battle-tested; copy
it verbatim.

```ts
const UNIVERSAL_TO_FDI = [
  18, 17, 16, 15, 14, 13, 12, 11,   // universal 1–8   → upper right
  21, 22, 23, 24, 25, 26, 27, 28,   // universal 9–16  → upper left
  38, 37, 36, 35, 34, 33, 32, 31,   // universal 17–24 → lower left
  41, 42, 43, 44, 45, 46, 47, 48,   // universal 25–32 → lower right
] as const;

export const toFDI = (universal: number): number => UNIVERSAL_TO_FDI[universal - 1];
```

### 2.4 Mirroring (contralateral pairs)

Users constantly want "make the left one match the right one." The mirror partner is found by
subtraction:

```ts
// Upper arch (1–16): partner = 17 - n   →  8 ↔ 9,  7 ↔ 10,  6 ↔ 11
// Lower arch (17–32): partner = 49 - n  →  24 ↔ 25, 23 ↔ 26
const mirrorOf = (n: number): number => (n <= 16 ? 17 - n : 49 - n);
```

Mirroring a tooth means reflecting its geometry across the **dental midline** and applying the
result to the partner. Two distinct features both need this:

- **Mirror a tooth's shape** onto its partner (an explicit, destructive action — confirm it).
- **Mirror mode during transforms**: while dragging tooth 8 to the right, tooth 9 moves left
  by the same amount, preserving symmetry. Extremely popular; make it a toggle.

**Warn the user** that mirror-mode changes multi-selection behavior: if both partners are
selected and mirror mode is on, they fight each other. The previous product shipped a
one-time explanatory dialog for exactly this, because users were confused every time.

### 2.5 Upper/lower split rule

```ts
const isUpper = (universal: number): boolean => universal <= 16;
```

This single predicate appears everywhere: grouping, template loading, arch fitting, layer
visibility. Centralize it.

---

## 3. Inputs

### 3.1 The two photographs

| | **Smile photo** | **Retracted photo** |
|---|---|---|
| **Content** | Natural smile, frontal, relaxed lips | Cheek retractors in place, full arches exposed |
| **Role** | The *design surface* — the final visualization is composited onto this | The *anatomical reference* — true tooth shape/position without lip occlusion |
| **Required?** | Yes | Yes (strongly recommended; the MVP can degrade gracefully without it) |

Both must be **frontal**, reasonably sharp, and with the head roughly upright. Real-world
uploads are frequently rotated by EXIF orientation or shot in portrait on a phone — **provide
a rotate control on the upload tile.** The previous product added this after the fact because
a meaningful fraction of uploads arrived sideways.

### 3.2 What we deliberately do NOT take

**No 3D intraoral scan.** The previous product supported both a 2D (photo-only) and 3D
(photo + scan) workflow, and the mode was latched once at upload time. Roughly *half* of
the total complexity of that application came from maintaining two parallel implementations
of every step behind a `is3DWorkflow` branch.

**The new application is 2D-only. There is no mode flag. Do not add one "just in case."**
If a 3D product is ever needed it should be a separate application with a shared design
core, not a branch inside every component.

### 3.3 Tooth selection

Before designing, the user picks **which teeth are being treated** on an interactive dental
chart. This selection (the "teeth of interest") drives which templates load.

Two behaviors the previous product's chart had that users depended on:

- **Range fill**: clicking two teeth in an arch auto-selects everything between them. Users
  select by clicking the corners of the treatment zone, not by clicking eight individual
  teeth.
- **Per-arch independence**: upper and lower ranges are tracked separately.

Typical selections in practice: upper 6–11 (canine to canine), or upper 5–12, or upper
4–13. Lower-arch treatment is much rarer in aesthetic cases.

---

## 4. The workflow

Five linear steps. Each unlocks the next. This structure was validated over the lifetime of
the previous product and should be preserved.

```
  ┌──────────┐   ┌──────────┐   ┌──────────────────┐   ┌────────┐   ┌────────┐
  │  Upload  │ → │ Matching │ → │ Facial Analysis  │ → │ Design │ → │ Report │
  └──────────┘   └──────────┘   └──────────────────┘   └────────┘   └────────┘
   photos +       align the      mark the facial        place &       before /
   tooth chart    two photos     reference lines        tune teeth    after + export
```

### 4.1 The cascade-invalidation rule — the most important architectural constraint

**Returning to an earlier step and changing its inputs must invalidate and reset every
later step, and re-lock their navigation buttons.**

Concretely:
- Changing a photo → resets matching, analysis, design, report.
- Changing the tooth selection → resets analysis, design, report.
- Re-running the photo matching → resets analysis, design, report.

If you do not enforce this rigorously you get the previous product's worst class of bug:
teeth positioned against a facial frame that no longer exists, producing designs that are
subtly, inexplicably wrong. Model it explicitly:

```ts
const STEPS = ['upload', 'matching', 'analysis', 'design', 'report'] as const;
type Step = typeof STEPS[number];

/** Reset every step strictly after `from`, and re-lock navigation to them. */
function invalidateAfter(from: Step) {
  const start = STEPS.indexOf(from) + 1;
  for (const step of STEPS.slice(start)) {
    resetStep(step);
    setStepUnlocked(step, false);
  }
}
```

Call it from a **single** place — a store action — never ad-hoc from components.

### 4.2 Each step needs an explicit lifecycle

Steps are not just views. Each owns tool activation, visibility rules, and camera state. Give
every step three hooks and call them on navigation:

```ts
interface StepLifecycle {
  enter(): void;   // activate tools, set layer visibility, fit the view
  exit(): void;    // commit or cancel in-flight edits, deactivate tools
  reset(): void;   // discard this step's results (called by invalidateAfter)
}
```

**A subtle trap worth stating explicitly:** `exit()` must *commit* any uncommitted in-flight
tool edit, not silently discard it. In the previous product, navigating away from facial
analysis while a landmark drag was pending left the teeth aligned to stale references. The
fix was to force-commit on exit. It's ugly but correct — users do not expect navigation to
throw away their work.

---

## 5. Step: Facial Analysis (the conceptual heart)

This is where the aesthetic logic lives. Everything downstream is a consequence of it.

### 5.1 The reference lines

The user marks (or corrects auto-detected) facial landmarks on the **smile photo**:

| Reference | Definition | What it controls |
|---|---|---|
| **Interpupillary line** | The line through both pupils | **Roll / horizon.** Teeth are levelled against this, not against the image edge. Patients' heads are always slightly tilted. |
| **Facial midline** | Vertical line through glabella → nose tip → philtrum → chin | **Horizontal placement.** The dental midline should coincide with (or be deliberately offset from) it. |
| **Nasal wings (alae)** | The outer edges of the nostrils | **Width scale reference.** The inter-alar width correlates with the ideal inter-canine width. A classic DSD proportion. |
| **Lip line / smile curve** | The curve of the lower border of the upper lip when smiling | **Vertical placement and the incisal curve.** The incisal edges should run roughly parallel to the lower lip — the "smile arc." |

### 5.2 The derived coordinate frame

Convert the raw landmarks into a normalized **face frame** and do all design math in it. This
makes the design invariant to photo resolution, crop, zoom, and head tilt — which is exactly
the property you want.

```ts
interface FaceFrame {
  origin: Vec2;      // midline ∩ lip line — the anchor point of the design
  xAxis: Vec2;       // unit vector along the interpupillary line (defines "level")
  yAxis: Vec2;       // unit vector perpendicular to xAxis, pointing down
  scale: number;     // px per normalized unit, derived from inter-alar or interpupillary width
  roll: number;      // rotation of xAxis relative to image horizontal, radians
}

const toFace  = (p: Vec2, f: FaceFrame): Vec2 => { /* world px → normalized face units */ };
const toWorld = (p: Vec2, f: FaceFrame): Vec2 => { /* normalized face units → world px */ };
```

**Rule: teeth are authored and manipulated in face-frame coordinates and only converted to
pixels at render time.** Following this consistently eliminates an entire family of bugs where
the design drifts when the photo is re-fit to the viewport.

### 5.3 Auto-detection, then correction

Auto-detect landmarks, then let the user drag them. Never make them place all of it manually,
and never trust the detector completely.

- **MediaPipe Face Landmarker** (`@mediapipe/tasks-vision`) runs in-browser via WASM, is free,
  needs no server, and yields 478 dense 3D face landmarks. Use it.
- Useful indices from the canonical MediaPipe 468-point topology: iris centers **468**
  (left) and **473** (right) when iris refinement is enabled; nose tip **1**; alae **48**
  and **278**; upper-lip vermilion border around **0**, **13**, **14**, **17**.
  **Verify these against the current model output rather than trusting them blindly** —
  index maps have shifted between MediaPipe versions.
- Derive the four references from those landmarks, then render them as **draggable handles**.
  Every clinician adjusts the midline at least slightly; it is a matter of professional
  judgment, not just detection accuracy.

### 5.4 The live-update contract

**Any change to the facial references must immediately re-fit the teeth.** In the previous
product this was an event (`facialAnalysisUpdated`) that triggered a re-run of the arch
fitting. Users drag the midline and watch the whole arch slide — that immediate feedback is
what makes the tool feel intelligent. Debounce the recompute, not the visual feedback.

---

## 6. Step: Design (placing and tuning the teeth)

### 6.1 Templates

A **template** is a complete set of idealized tooth shapes with a consistent aesthetic
character. The previous product shipped two — a natural/generic set and a more stylized
"Hollywood" set — and users compared them constantly.

**Ship at least two, ideally three or four**, with recognizable names describing the
aesthetic (e.g. *Natural*, *Hollywood*, *Youthful*, *Masculine*). Template choice is a
conversation the clinician has with the patient; it is a selling feature.

**For a 2D web app, author each tooth as an SVG path**, not a 3D mesh. A tooth outline in a
frontal view is a closed path with 8–20 control points. Store them normalized:

```ts
interface ToothTemplate {
  universal: number;      // 1–32
  outline: string;        // SVG path in a normalized unit box, origin at the incisal midpoint
  width: number;          // normalized, relative to the central incisor = 1.0
  length: number;         // normalized
  gingivalZenith: Vec2;   // gum-line high point, in the tooth's local frame
  incisalEdge: Vec2[];    // the biting edge polyline — used for smile-arc fitting
}

interface Template {
  id: string;
  name: string;           // "Natural", "Hollywood"
  teeth: Record<number, ToothTemplate>;  // keyed by universal number
}
```

**Template preview before commit.** The previous product previewed the template under the
cursor in the dropdown before the user confirmed, and this was well-liked. It is also a rich
source of race conditions — see §11.2.

### 6.2 Reference proportions to bake into the templates

These are the standard aesthetic guidelines. Encode them in the template geometry so a
freshly imported template already looks credible.

- **Central incisor width : length ≈ 0.75–0.85.** The single most important ratio.
- **Apparent widths from the frontal view**, relative to the central at 1.0:
  central **1.0**, lateral **≈ 0.62–0.7**, canine **≈ 0.55–0.62**. (This approximates the
  golden proportion; real teeth vary and strict 1.618 often looks artificial.)
- **Incisal edge positions**: centrals sit lowest; laterals ~0.5–1.0 mm shorter; canine tips
  return to roughly the central's level. This produces the characteristic gull-wing smile arc.
- **Gingival zeniths**: central and canine zeniths roughly level; the lateral's sits
  ~0.5–1 mm lower (more incisal). A flat gum line reads as artificial.
- **Smile arc**: incisal edge curve should run parallel to the lower lip's curve. A flat or
  reverse arc is the most common aesthetic failure in amateur designs.

### 6.3 Arch fitting — the core algorithm

This is the piece that makes the product work. Given the face frame, the template, and the
selected teeth, place every tooth.

**Critical rule inherited from the previous product, and non-obvious:** the fitting requires a
**contiguous run of teeth that includes a central incisor.** You cannot fit a sparse selection
— teeth are positioned relative to their neighbors along the arch, and the central incisor is
the anchor from which the run is laid out.

Therefore:

1. Take the user's selected teeth, split by arch, sort ascending.
2. For each arch, **fill in every tooth between the minimum and maximum selected**.
3. **If the upper run contains neither 8 nor 9, add 8. If the lower run contains neither 24
   nor 25, add 24.**
4. Teeth added by steps 2–3 that the user did not select are **auxiliary**: they participate
   fully in the layout math but are **rendered hidden** and excluded from user selection.

```ts
function resolveArchRun(selected: number[], arch: 'upper' | 'lower'): {
  run: number[];        // contiguous, anchored
  auxiliary: number[];  // in `run` but not user-selected — hide these
} {
  const range = arch === 'upper' ? [1, 16] : [17, 32];
  const anchors = arch === 'upper' ? [8, 9] : [24, 25];
  const fallbackAnchor = anchors[0];

  const picked = selected.filter(t => t >= range[0] && t <= range[1]).sort((a, b) => a - b);
  if (picked.length === 0) return { run: [], auxiliary: [] };

  let lo = picked[0], hi = picked[picked.length - 1];
  if (!picked.some(t => anchors.includes(t))) {
    lo = Math.min(lo, fallbackAnchor);
    hi = Math.max(hi, fallbackAnchor);
  }

  const run: number[] = [];
  for (let t = lo; t <= hi; t++) run.push(t);
  return { run, auxiliary: run.filter(t => !picked.includes(t)) };
}
```

**Layout procedure**, all in face-frame coordinates:

1. Establish the **dental midline** — the facial midline, plus any user-applied offset.
2. Place the **central incisors** straddling the midline, their incisal edges on the smile
   curve, sized by the `scale` parameter against the face frame.
3. **Walk outward** from each central, placing each successive tooth adjacent to its
   neighbor's distal edge, with the inter-tooth spacing controlled by the `gapX` parameter.
4. Set each tooth's **vertical position** by projecting onto the smile curve, adjusted by the
   curve-of-spee parameter and by the per-tooth incisal offsets from the template.
5. Apply the **ratio** parameter to each tooth's width:length.
6. Apply the global **roll** from the interpupillary line, so the whole arch levels to the
   face rather than to the image.

### 6.4 The five fine-tune parameters — your most important UI

The previous product exposed exactly these five global sliders, and they were the dominant
interaction. Reproduce them.

| Parameter | Range | Step | Meaning |
|---|---|---|---|
| **Ratio** | 0.10 – 1.00 | 0.01 | Width-to-length ratio of the teeth. Lower = longer/narrower, higher = shorter/wider. |
| **Scale** | 0.10 – 4.00 | 0.10 | Overall size of the whole arch relative to the face. |
| **Curve of Spee** | –5.0 – +5.0 | 0.10 | Curvature of the incisal edge line. Negative flattens/reverses, positive deepens the arc. |
| **Occlusal Gap** | –100 – +100 | 1 | Vertical offset of the arch — how far the teeth sit up or down relative to the lip line. |
| **Inner Gap** | –5.0 – +5.0 | 0.10 | Horizontal spacing between adjacent teeth. Negative overlaps, positive separates. |

These ranges and step sizes come directly from the shipped product and are known to feel
right. Adopt them as-is and tune later against real cases.

Two implementation notes:
- **Debounce recomputation to ~100 ms** while dragging. The previous product did precisely
  this and it was necessary for smooth dragging.
- **Sliders are a single undo unit per drag**, not per pixel. (§9.3)

### 6.5 Per-tooth editing

After the global fit, the user refines individual teeth. Minimum viable set:

- **Select** — click a tooth; support multi-select via shift-click and a rubber-band box.
- **Transform** — move, rotate, and scale the selection, with **mirror mode** as a toggle.
- **Reshape** — drag the control points of the tooth's SVG outline. This is the 2D analogue
  of the previous product's 3D sculpting, and it is far simpler. Keep the handle count low.
- **Mirror shape onto partner** — an explicit, confirmed, destructive action. (§2.4)

**Optional but valuable:** a measurements overlay showing each tooth's width, length, and
width/length ratio in millimetres. This requires a **mm-per-pixel calibration**, which you can
derive from an assumed average inter-alar or interpupillary distance — state the assumption in
the UI, because it is an estimate, not a measurement.

---

## 7. Rendering

### 7.1 What is actually on screen

A stack of layers, composited in order:

```
  ┌─────────────────────────────────────┐
  │  Facial reference overlay           │  ← lines + draggable handles (analysis step)
  ├─────────────────────────────────────┤
  │  Template teeth                     │  ← the design; per-tooth fill/stroke/opacity
  ├─────────────────────────────────────┤
  │  Lip mask (optional)                │  ← hides teeth outside the lip aperture
  ├─────────────────────────────────────┤
  │  Patient photo (smile or retracted) │  ← base layer
  └─────────────────────────────────────┘
```

Give the user a **layer panel** with per-layer visibility and opacity. The previous product's
equivalent panel was used constantly — especially toggling teeth opacity to compare against
the original. Make **teeth opacity** a first-class, always-visible control, not a buried one.

### 7.2 Technology recommendation

**Use SVG or Canvas 2D, not three.js.** three.js is listed as a candidate technology, but for
a genuinely 2D application it is the wrong tool: you would be setting up an orthographic
camera and a scene graph to do what SVG does natively, and you would lose crisp vector
rendering, hit-testing, and CSS styling for free.

Concretely:
- **SVG (recommended)** — teeth are paths, handles are circles, hit-testing and pointer events
  are free, everything is inspectable in devtools, and export to PDF/print is trivially crisp.
  Performance is entirely adequate for ~20 tooth paths plus a photo.
- **Canvas 2D** — only if you add pixel-level effects (blending teeth into the photo,
  per-pixel lip masking). You then implement hit-testing yourself.
- A pragmatic hybrid: photo in an `<img>` or canvas, design and handles in an SVG overlay,
  both inside one transformed container.

**Reserve WebGL/three.js for one specific thing:** realistic compositing of the teeth into
the photo (shading, translucency, blending with lighting). That is a *polish* feature. Do not
let it dictate the architecture of the MVP.

### 7.3 View transform

One pan/zoom transform shared by the photo and all overlays. Keep it as a single matrix in the
store; never let layers transform independently. Provide **fit-to-view**, and call it on entry
to each step (the previous product did this and it mattered — steps have different natural
framings).

---

## 8. Step: Report — the deliverable

The report is what the clinician shows the patient. Treat it as a product surface, not an
export utility.

### 8.1 Content

The previous product's report layout, which worked well:

- **Header**: clinic branding placeholder, patient name, date.
- **Before & After — full photo**: the original smile photo beside the composited design, at
  matched size and framing.
- **Close-ups**: the same pair, cropped tightly to the mouth. **This crop is the most
  persuasive image in the entire report** — it is what the patient leans in to look at.
- Optionally: the retracted before/after pair, and a summary of which teeth are being treated.

### 8.2 The lip box

To generate the close-up crop you need the **lip bounding box** — a rectangle around the mouth
aperture, in image coordinates. Derive it from the MediaPipe lip landmarks with padding, and
store it alongside the photo. The previous product stored exactly this per-image and used it
to drive the report crop. Let the user nudge it.

### 8.3 Snapshot generation

Generate four images at report time:

| Snapshot | Content |
|---|---|
| Smile — before | Smile photo, no teeth overlay |
| Smile — after | Smile photo with the designed teeth composited |
| Retracted — before | Retracted photo, no overlay |
| Retracted — after | Retracted photo with the design |

Render each off-screen at full photo resolution — **not** at viewport resolution. The previous
product captured these through the render pipeline at native size, and the quality difference
in print is dramatic.

In the browser: render the SVG into an off-screen canvas at native resolution
(`new Image()` on a serialized SVG blob, drawn onto a canvas), then `toBlob()`. Watch for
canvas tainting — keep everything same-origin or use object URLs.

### 8.4 Export

- **PDF** via `jspdf` or the browser print pipeline with a dedicated print stylesheet.
- **PNG** of each snapshot pair for messaging apps — clinicians send these to patients
  constantly.
- A **teeth-shade colour selector** applied before capture is worth having; the previous
  product let the user set the teeth colour for the report specifically, and shade discussion
  is part of the patient conversation.

---

## 9. Cross-cutting architecture

### 9.1 State shape

A single normalized store (Zustand or Redux Toolkit). Sketch:

```ts
interface AppState {
  step: Step;
  unlockedSteps: Set<Step>;

  photos: {
    smile:     { url: string; width: number; height: number; rotation: number; lipBox?: Rect } | null;
    retracted: { url: string; width: number; height: number; rotation: number; lipBox?: Rect } | null;
    alignment: Matrix2D | null;   // retracted → smile, from the matching step
  };

  selectedTeeth: number[];        // universal numbering, the user's picks

  face: {
    landmarks: FaceLandmarks | null;   // raw detector output
    refs: FacialReferences | null;     // user-editable: interpupillary, midline, alae, lipCurve
    frame: FaceFrame | null;           // derived; recomputed from refs
  };

  design: {
    templateId: string;
    params: FineTuneParams;                 // the five sliders
    teeth: Record<number, ToothInstance>;   // per-tooth transform + outline overrides
    auxiliary: number[];                    // hidden fill-in teeth
    selection: number[];
  };

  view: { transform: Matrix2D; layers: Record<LayerId, { visible: boolean; opacity: number }> };
}
```

**Keep derived values derived.** `frame` from `refs`; tooth placements from
`frame + template + params + per-tooth overrides`. Recompute on change; do not store
duplicated truth. The previous product's most persistent bugs came from state that was stored
in two places and drifted.

### 9.2 Async operations and progress

Even without a server, several operations take real time: landmark detection (WASM model
load + inference), photo decode of large images, snapshot rendering. Every one of these needs
a progress representation.

The previous product wrapped a `Progress` object into a promise, with a title, percentage,
indeterminate flag, and success/failure/cancel signals — plus a distinction between **modal**
progress (blocking, for things the user must wait for) and **background** progress (in a
status bar, for things they can work through). That distinction is worth reproducing.

Also inherited: **disable the drop zones while an upload is processing.** Users absolutely
will drop a second photo mid-processing.

### 9.3 Undo/redo

Non-negotiable, and it must be **batched**.

- **One user action = one undo entry.** Importing a template creates ~10 tooth objects,
  applies materials to each, and runs a fit — that is *one* undo step. Wrap it in an
  explicit `startUndoBatch()` / `endUndoBatch()`.
- **A slider drag is one entry**, committed on release — not one per value change.
- **Clear the history at step boundaries.** The previous product did this deliberately: undoing
  across a step transition produces incoherent states. Clear on entering a step and after a
  template import.

Implementation: a command stack over the design slice, or an immer-patch-based approach
(`produceWithPatches`) with patches grouped per batch.

### 9.4 Guard rails users need

Learned from shipped support burden:

- **Warn before destructive resets.** "Re-matching will discard your design" with a
  *"don't show again"* checkbox. Users re-enter earlier steps constantly and are shocked when
  work vanishes.
- **Confirm before mirroring**, because it replaces a tooth.
- **Explain mirror mode once**, on first enable.
- **Prompt on close** if there is unsaved work.

The "don't show again" preference is not optional politeness — without it, power users are
interrupted dozens of times per session and start clicking through dialogs blindly.

---

## 10. Recommended stack

Given a fully client-side, no-backend MVP:

| Concern | Choice | Why |
|---|---|---|
| Build | **Vite** | Fast, first-class WASM and worker support. |
| Language | **TypeScript, strict** | The tooth-numbering and geometry code is exactly where types pay for themselves. |
| UI | **React** (or Svelte) | Component ecosystem; the workflow is a straightforward state machine. |
| State | **Zustand** | Minimal ceremony; easy to slice; works well with derived selectors. |
| Rendering | **SVG overlay + `<img>`/canvas base** | §7.2. |
| Face landmarks | **`@mediapipe/tasks-vision`** (Face Landmarker, WASM) | Runs in-browser, no server, no per-call cost. |
| Geometry | **gl-matrix** or hand-rolled 2×3 matrices | Small surface; hand-rolled is fine and dependency-free. |
| PDF | **jsPDF**, or print CSS | §8.4. |
| Persistence | **IndexedDB** (via `idb`) | Photos are large; localStorage cannot hold them. |
| Tests | **Vitest** | Unit-test the numbering, arch resolution, and fitting math — see §13. |

**No backend for the MVP.** Static hosting only. This is a genuine advantage: no PHI leaves
the clinician's browser, which sidesteps a mountain of medical-data compliance work for a
prototype. **Say this explicitly in your README** — and note that the moment you add a server
or any cloud storage, HIPAA/GDPR obligations attach to patient photos, which are identifiable
health data. That is a deliberate, later, well-resourced decision.

### 10.1 Suggested layout

```
src/
  domain/            # pure, dependency-free, fully unit-tested
    teeth.ts         # numbering, FDI conversion, mirroring, arch predicates
    archRun.ts       # contiguity + anchor resolution (§6.3)
    faceFrame.ts     # landmarks → FaceFrame, coordinate transforms
    fitting.ts       # the arch layout algorithm
    templates/       # tooth outline data + loader
  state/             # zustand store, slices, undo middleware
  features/
    upload/  matching/  analysis/  design/  report/
  render/            # SVG layers, view transform, hit-testing
  export/            # snapshot capture, PDF/PNG generation
  vision/            # MediaPipe wrapper, worker, landmark → reference derivation
```

**Keep `domain/` free of React, DOM, and store imports.** It should be testable in isolation,
and it is the part of this application worth protecting.

---

## 11. Traps, in order of how much pain they caused

### 11.1 Stale downstream state
Already covered (§4.1) but repeated because it dominated the previous product's bug list.
Enforce cascade invalidation through one code path and test it.

### 11.2 Rapid-fire async operations
Template preview on dropdown hover was the previous product's worst race: hovering quickly
started an import, then a delete of a still-importing object, orphaning it. The fix was an
explicit **serialization queue** — every preview/delete/confirm operation chained onto a
single promise so no two could interleave:

```ts
let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T,>(op: () => Promise<T>): Promise<T> => {
  const next = queue.then(op, op);
  queue = next.catch(() => {});   // never let a rejection poison the chain
  return next;
};
```

Apply the same pattern anywhere a user gesture can outrun an async operation.

### 11.3 Coordinate space confusion
Photo pixels, viewport pixels, face-frame units, and normalized tooth-local units are four
distinct spaces. Name them in your types (`Vec2Image`, `Vec2Face`, …) or at minimum in every
variable name. The previous product suffered repeated drift bugs from implicit conversions.

### 11.4 Photo orientation
EXIF rotation and portrait phone photos. Normalize orientation at load and offer a manual
rotate. Do not assume the browser handles it — behavior varies by how you load the image.

### 11.5 Missing anchor teeth
Covered in §6.3. If the fitting produces nonsense, this is the first thing to check.

### 11.6 Sculpting/reshaping while a fit is pending
If a global parameter change re-fits while the user is dragging an outline point, their edit
is lost. Either block global re-fits during a per-tooth edit, or apply per-tooth overrides
*after* the fit as a separate transform layer. **The second is the right design** — treat
per-tooth edits as deltas on top of the computed fit, never as replacements for it.

### 11.7 Report resolution
Capture at native photo resolution, not viewport size (§8.3).

---

## 12. Scope discipline for the MVP

### In scope
Upload two photos · select teeth · auto + manual facial references · template selection ·
automatic arch fit · five fine-tune sliders · per-tooth transform and reshape · mirror ·
layer visibility/opacity · before/after report · PDF/PNG export · undo/redo · local persistence.

### Explicitly out of scope
- **Anything 3D**: intraoral scans, meshes, veneer geometry, printable mockups, STL export.
  This is where the previous product's complexity lived, and it is a separate product.
- **Multi-user, accounts, cloud storage, PACS/PMS integration.** Each brings compliance
  obligations disproportionate to a prototype (§10).
- **AI-generated smile synthesis** (generative before/after images). Interesting, and a
  credible later differentiator, but it is a different technology with different validation
  and regulatory questions. Not the MVP.
- **Orthodontic simulation, occlusion analysis, treatment sequencing.**

### Definition of done for the MVP
> A clinician uploads two photos, picks the teeth to treat, confirms the auto-detected facial
> lines, chooses a template, adjusts five sliders for under a minute, and exports a
> before/after PDF. **Total time under five minutes.**

Hold every proposed feature against that sentence.

---

## 13. Test the domain layer

The pure logic is small, high-risk, and trivially testable. Cover at minimum:

- `toFDI` across all 32 teeth, against the table in §2.3.
- `mirrorOf` for both arches, including the 16/17 boundary.
- `resolveArchRun`:
  - sparse selection → contiguous run;
  - selection excluding centrals → anchor injected (8 upper, 24 lower);
  - upper-only, lower-only, and both-arch selections;
  - empty selection → empty run, no crash.
- `FaceFrame` round-trip: `toWorld(toFace(p)) ≈ p` for a rolled, scaled, offset frame.
- Fitting invariants:
  - teeth are ordered left-to-right along the arch and do not overlap at `gapX = 0`;
  - `scale` change is uniform about the frame origin;
  - `roll` is applied to the arch as a rigid body.

These tests are cheap and they protect the only part of the codebase that is genuinely subtle.

---

## 14. Suggested build order

1. **Skeleton + store + step navigation** with the cascade-invalidation rule wired from the
   very beginning. Retrofitting it is expensive.
2. **`domain/teeth.ts` + `domain/archRun.ts` with tests.** Small, fast, de-risks the data model.
3. **Photo upload**, EXIF-normalized, with rotate, into IndexedDB, plus the pan/zoom view.
4. **Tooth chart** with range-fill selection.
5. **MediaPipe integration** — landmarks → the four references → draggable handles → `FaceFrame`.
6. **One template**, hand-authored as SVG outlines. Ugly is fine; correct is not optional.
7. **Arch fitting** + the five sliders. **This is the moment the product becomes real** — get
   here as fast as you can and evaluate it on real photos before building anything else.
8. **Per-tooth transform and selection.**
9. **Report + export.**
10. **Undo/redo**, then a second template, then outline reshaping, then polish.

Step 7 is the go/no-go milestone. If the fit does not look credible on a dozen real
photographs, nothing downstream matters — iterate there before proceeding.

---

## 15. Photo matching (deferred, but here is what it is)

The previous product had a **Matching** step between upload and analysis that aligned the
retracted photo to the smile photo, so tooth positions observed in the retracted view could
inform the design on the smile view. It ran an automatic alignment, then offered manual
correction by placing corresponding point pairs in side-by-side views, then a fine-tuning
overlay with the top image semi-transparent.

**For the MVP this can be deferred.** The design happens on the smile photo, and the
retracted photo is primarily a visual reference for the clinician's own judgment plus a second
before/after pair in the report. If you do implement it, the shape that worked was:

1. **Preview** — show the automatic alignment; accept or reject.
2. **Manual** — two side-by-side views; the user clicks corresponding landmarks in each.
3. **Fine-tune** — the images overlaid, top one at ~60% opacity, draggable for final nudging.

The underlying math is a **similarity transform** (translation, rotation, uniform scale) fitted
by least squares from ≥2 point pairs — a small, well-understood algorithm. Do not reach for a
homography; the photos are frontal and a similarity transform is both sufficient and far more
stable.

---

## 16. Bird's-eye summary

```
   PHOTOS ───────► FACIAL REFERENCES ───────► FACE FRAME
                                                 │
   TOOTH SELECTION ───► CONTIGUOUS ARCH RUN ─────┤
                        (+ anchor, + auxiliary)  │
                                                 ▼
   TEMPLATE ─────────────────────────────► ARCH FITTING ◄──── FIVE FINE-TUNE PARAMS
                                                 │
                                                 ▼
                                       PER-TOOTH OVERRIDES
                                        (transform, reshape, mirror)
                                                 │
                                                 ▼
                              COMPOSITE ONTO PHOTO ──► BEFORE/AFTER REPORT ──► PDF / PNG
```

Everything in this document is machinery serving that single flow. When a design decision is
unclear, ask which box it belongs to and whether it makes that box faster or more credible for
a clinician with a patient in the chair.
