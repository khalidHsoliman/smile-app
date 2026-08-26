/**
 * A synthetic patient, drawn rather than photographed.
 *
 * Demo imagery for a dental tool is a legal problem before it is a technical
 * one: a photograph's licence comes from the photographer, but an identifiable
 * face also carries the depicted person's rights, and in a clinical context
 * their health data. A CC0 photo is copyright-clean and still not safe to ship
 * in a demo that implies the person was a patient. Drawing the face removes the
 * question entirely -- there is nobody depicted.
 *
 * The two views are generated from one description of the same face, so the
 * geometry between them is genuinely consistent: the retracted view is the same
 * head at a slightly different distance and pitch, which is what the alignment
 * step exists to solve. A demo that skipped that would demonstrate nothing.
 */

export interface FaceOptions {
  width: number;
  height: number;
  /** Retracted view: lips pulled back, whole arch exposed, retractor visible. */
  retracted: boolean;
  /**
   * Vertical shift of the whole head, in pixels. The retracted view is given a
   * small one because a patient tilts their chin when retractors go in -- the
   * pitch difference the teeth-matching stage corrects for.
   */
  pitchShift: number;
  /** Scale about the centre. The retracted shot is usually taken closer. */
  zoom: number;
}

const SKIN = '#e6b895';
const SKIN_SHADE = '#d3a184';
const LIP = '#b9736b';
const LIP_DARK = '#9d5a55';
const CAVITY = '#2a1210';
const GUM = '#b8676a';
const ENAMEL = '#e8dfc8';
const ENAMEL_ALT = '#ded4ba';
const HAIR = '#3b2b22';

/**
 * Draw one view of the synthetic patient.
 *
 * Proportions follow the same references the application measures -- pupils on
 * a level line, alae at roughly a third of the interpupillary width, mouth on
 * the midline -- so the detected face frame lands where a real one would and
 * the fitted arch is a fair demonstration rather than a flattering one.
 */
export function drawFace(canvas: HTMLCanvasElement, options: FaceOptions): void {
  const { width: W, height: H, retracted, pitchShift, zoom } = options;
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#f2f0ee';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H / 2 + pitchShift);
  ctx.scale(zoom, zoom);
  ctx.translate(-W / 2, -H / 2);

  const cx = W / 2;
  const faceTop = H * 0.16;
  const faceBottom = H * 0.86;
  const faceH = faceBottom - faceTop;
  const faceW = faceH * 0.72;

  drawHairAndHead(ctx, cx, faceTop, faceBottom, faceW, faceH);

  // Feature positions, in the proportions the app's references assume.
  const eyeY = faceTop + faceH * 0.42;
  const eyeGap = faceW * 0.24;
  const noseY = faceTop + faceH * 0.63;
  const mouthY = faceTop + faceH * 0.78;

  drawBrow(ctx, cx - eyeGap, eyeY - faceH * 0.075, faceW * 0.17);
  drawBrow(ctx, cx + eyeGap, eyeY - faceH * 0.075, faceW * 0.17);
  drawEye(ctx, cx - eyeGap, eyeY, faceW * 0.115);
  drawEye(ctx, cx + eyeGap, eyeY, faceW * 0.115);
  drawNose(ctx, cx, noseY, faceW * 0.15, faceH * 0.12);

  if (retracted) drawRetractedMouth(ctx, cx, mouthY, faceW);
  else drawSmilingMouth(ctx, cx, mouthY, faceW);

  ctx.restore();
}

function drawHairAndHead(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  bottom: number,
  w: number,
  h: number,
): void {
  // Hair behind the head, so the hairline reads correctly.
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.ellipse(cx, top + h * 0.28, w * 0.56, h * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ears.
  ctx.fillStyle = SKIN_SHADE;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * w * 0.5, top + h * 0.46, w * 0.06, h * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // The face: a tapered oval, lit slightly from above so the render has the
  // tonal range a photograph would.
  const gradient = ctx.createLinearGradient(cx, top, cx, bottom);
  gradient.addColorStop(0, SKIN);
  gradient.addColorStop(0.75, SKIN);
  gradient.addColorStop(1, SKIN_SHADE);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.5, top + h * 0.36);
  ctx.bezierCurveTo(cx - w * 0.52, top - h * 0.04, cx + w * 0.52, top - h * 0.04, cx + w * 0.5, top + h * 0.36);
  ctx.bezierCurveTo(cx + w * 0.48, top + h * 0.78, cx + w * 0.22, bottom, cx, bottom);
  ctx.bezierCurveTo(cx - w * 0.22, bottom, cx - w * 0.48, top + h * 0.78, cx - w * 0.5, top + h * 0.36);
  ctx.fill();

  // Fringe, over the forehead.
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.5, top + h * 0.2);
  ctx.bezierCurveTo(cx - w * 0.5, top - h * 0.06, cx + w * 0.5, top - h * 0.06, cx + w * 0.5, top + h * 0.2);
  ctx.bezierCurveTo(cx + w * 0.24, top + h * 0.1, cx - w * 0.24, top + h * 0.1, cx - w * 0.5, top + h * 0.2);
  ctx.fill();
}

function drawBrow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.ellipse(x, y, w, w * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Sclera, iris and pupil: the iris centre is what the detector keys on. */
function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = '#fbfaf8';
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.52, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#5b4632';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#150f0a';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(x - r * 0.15, y - r * 0.16, r * 0.09, 0, Math.PI * 2);
  ctx.fill();

  // Lid line, which gives the eye its corners.
  ctx.strokeStyle = 'rgba(60,40,30,0.75)';
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.52, 0, Math.PI, Math.PI * 2);
  ctx.stroke();
}

/** The alae are the width reference the whole design is scaled against. */
function drawNose(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = SKIN_SHADE;
  ctx.beginPath();
  ctx.ellipse(cx, y, w, h * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(90,58,44,0.55)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * w * 0.5, y + h * 0.2, w * 0.16, h * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * A relaxed smile: the upper lip covers most of the crowns, so only a band of
 * tooth shows. That is the ordinary case, and the one the alignment finds
 * hardest -- a demo that used a wide grin would hide the interesting behaviour.
 */
function drawSmilingMouth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  faceW: number,
): void {
  const w = faceW * 0.42;
  const incisalY = y + faceW * 0.028;

  ctx.fillStyle = LIP;
  ctx.beginPath();
  ctx.ellipse(cx, y, w, faceW * 0.115, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = CAVITY;
  ctx.beginPath();
  ctx.ellipse(cx, y - faceW * 0.005, w * 0.86, faceW * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();

  drawUpperTeeth(ctx, cx, incisalY, w * 0.78, faceW * 0.055);

  // Lower lip, covering everything below the incisal edge.
  ctx.fillStyle = LIP_DARK;
  ctx.beginPath();
  ctx.ellipse(cx, incisalY + faceW * 0.052, w * 0.94, faceW * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** The retracted view: whole arch exposed, lower arch in contact, retractor. */
function drawRetractedMouth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  faceW: number,
): void {
  const w = faceW * 0.5;
  const incisalY = y + faceW * 0.028;

  // The retractor: a translucent ring holding the lips clear.
  ctx.strokeStyle = 'rgba(232,240,244,0.85)';
  ctx.lineWidth = faceW * 0.055;
  ctx.beginPath();
  ctx.ellipse(cx, y + faceW * 0.02, w * 1.16, faceW * 0.21, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = LIP;
  ctx.beginPath();
  ctx.ellipse(cx, y + faceW * 0.01, w * 1.06, faceW * 0.185, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = GUM;
  ctx.beginPath();
  ctx.ellipse(cx, y + faceW * 0.01, w * 0.94, faceW * 0.155, 0, 0, Math.PI * 2);
  ctx.fill();

  // Full upper crowns, down to the same incisal edge as the smile view.
  drawUpperTeeth(ctx, cx, incisalY, w * 0.78, faceW * 0.115);

  // The bite line, then the lower arch in contact.
  ctx.fillStyle = 'rgba(28,12,10,0.8)';
  ctx.fillRect(cx - w * 0.78, incisalY + 1, w * 1.56, Math.max(2, faceW * 0.006));

  const lowerTop = incisalY + faceW * 0.009;
  const count = 8;
  const tw = (w * 1.5) / count;
  for (let i = 0; i < count; i++) {
    const x = cx - (w * 1.5) / 2 + i * tw;
    ctx.fillStyle = i % 2 ? ENAMEL_ALT : ENAMEL;
    roundRect(ctx, x + 1, lowerTop, tw - 2, faceW * 0.085, tw * 0.18);
    ctx.fill();
  }
}

/**
 * The upper anterior teeth, drawn from the incisal edge upward.
 *
 * Anchored at the incisal edge in both views on purpose: that shared boundary
 * is exactly what the alignment stage locks onto, so the demo exercises the
 * real behaviour rather than a version of it that happens to line up.
 */
function drawUpperTeeth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  incisalY: number,
  halfWidth: number,
  crownHeight: number,
): void {
  const widths = [0.62, 0.74, 1, 1, 0.74, 0.62];
  const total = widths.reduce((s, v) => s + v, 0);
  const unit = (halfWidth * 2) / total;

  let x = cx - halfWidth;
  widths.forEach((relative, i) => {
    const w = relative * unit;
    // Laterals sit slightly shorter: the gull-wing arc.
    const shorten = relative === 0.74 ? crownHeight * 0.12 : 0;
    ctx.fillStyle = i % 2 ? ENAMEL_ALT : ENAMEL;
    roundRect(ctx, x + 1, incisalY - crownHeight + shorten, w - 2, crownHeight - shorten, w * 0.2);
    ctx.fill();

    // Interdental shadow: the feature the horizontal match keys on.
    ctx.fillStyle = 'rgba(60,40,28,0.3)';
    ctx.fillRect(x + w - 2, incisalY - crownHeight + shorten, 2, crownHeight - shorten);
    x += w;
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
