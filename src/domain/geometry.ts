/**
 * 2D vector and affine-matrix primitives.
 *
 * Small on purpose. Every coordinate space in the application -- image pixels,
 * viewport pixels, normalized face units -- is related to the others by an
 * affine transform, so one shared implementation keeps the conversions honest
 * (spec 11.3).
 */

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * An affine transform, row-major:
 *
 *   | a  c  e |
 *   | b  d  f |
 *   | 0  0  1 |
 *
 * Field names match the SVG/DOM matrix convention so a matrix can be handed
 * straight to `matrix(a b c d e f)` without reordering.
 */
export interface Matrix2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });

export const IDENTITY: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export const add = (p: Vec2, q: Vec2): Vec2 => vec(p.x + q.x, p.y + q.y);
export const sub = (p: Vec2, q: Vec2): Vec2 => vec(p.x - q.x, p.y - q.y);
export const scaleVec = (p: Vec2, k: number): Vec2 => vec(p.x * k, p.y * k);
export const dot = (p: Vec2, q: Vec2): number => p.x * q.x + p.y * q.y;
export const length = (p: Vec2): number => Math.hypot(p.x, p.y);
export const distance = (p: Vec2, q: Vec2): number => length(sub(p, q));
export const midpoint = (p: Vec2, q: Vec2): Vec2 =>
  vec((p.x + q.x) / 2, (p.y + q.y) / 2);

/** Unit vector in the direction of `p`. Returns (0,0) for a zero vector. */
export function normalize(p: Vec2): Vec2 {
  const len = length(p);
  return len === 0 ? vec(0, 0) : vec(p.x / len, p.y / len);
}

/** `p` rotated a quarter turn clockwise in screen space (y down). */
export const perpendicular = (p: Vec2): Vec2 => vec(-p.y, p.x);

/** Signed angle of `p` from the positive x-axis, radians. */
export const angleOf = (p: Vec2): number => Math.atan2(p.y, p.x);

/** Apply a transform to a point. */
export const applyMatrix = (m: Matrix2D, p: Vec2): Vec2 =>
  vec(m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f);

/**
 * Apply a transform to a direction, ignoring translation. Use this for axes
 * and offsets; using `applyMatrix` on a direction is a classic silent bug.
 */
export const applyMatrixToVector = (m: Matrix2D, p: Vec2): Vec2 =>
  vec(m.a * p.x + m.c * p.y, m.b * p.x + m.d * p.y);

/** `first` then `second` -- i.e. the matrix product `second * first`. */
export function compose(first: Matrix2D, second: Matrix2D): Matrix2D {
  return {
    a: second.a * first.a + second.c * first.b,
    b: second.b * first.a + second.d * first.b,
    c: second.a * first.c + second.c * first.d,
    d: second.b * first.c + second.d * first.d,
    e: second.a * first.e + second.c * first.f + second.e,
    f: second.b * first.e + second.d * first.f + second.f,
  };
}

export const translation = (tx: number, ty: number): Matrix2D => ({
  ...IDENTITY,
  e: tx,
  f: ty,
});

export const scaling = (sx: number, sy: number = sx): Matrix2D => ({
  ...IDENTITY,
  a: sx,
  d: sy,
});

export function rotation(radians: number): Matrix2D {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export const determinant = (m: Matrix2D): number => m.a * m.d - m.b * m.c;

/** Inverse transform. Throws on a singular (non-invertible) matrix. */
export function invert(m: Matrix2D): Matrix2D {
  const det = determinant(m);
  if (det === 0) throw new Error('Matrix is not invertible');
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** Serialize for an SVG `transform` attribute. */
export const toSvgMatrix = (m: Matrix2D): string =>
  `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The transform that fits a `content`-sized box into `viewport`, centred,
 * preserving aspect ratio. `padding` is a fraction of the viewport to leave
 * as margin (spec 7.3 -- fit-to-view is called on entry to every step).
 */
export function fitToView(
  content: { width: number; height: number },
  viewport: { width: number; height: number },
  padding = 0.05,
): Matrix2D {
  if (content.width <= 0 || content.height <= 0) return IDENTITY;

  const usableW = viewport.width * (1 - padding * 2);
  const usableH = viewport.height * (1 - padding * 2);
  const scale = Math.min(usableW / content.width, usableH / content.height);

  return compose(
    scaling(scale),
    translation(
      (viewport.width - content.width * scale) / 2,
      (viewport.height - content.height * scale) / 2,
    ),
  );
}
