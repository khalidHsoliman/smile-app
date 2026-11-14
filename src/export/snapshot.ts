/**
 * Snapshot capture.
 *
 * Renders the design to a raster image **at the photo's native resolution**,
 * not the viewport's. The difference in print is dramatic -- a 300px-wide
 * viewport capture blown up to a PDF page looks like a screenshot, which
 * undermines the whole deliverable.
 *
 * The approach: serialize an SVG containing the photo and the tooth layer, load
 * it as an image, draw it to an off-screen canvas at full size, and read a
 * blob back out.
 */

export interface SnapshotOptions {
  /** Serialized SVG markup. Must be self-contained -- no external references. */
  svg: string;
  /** Output size in pixels. Use the photo's own dimensions. */
  width: number;
  height: number;
  /**
   * Crop applied after rendering, in the same coordinate space as the SVG's
   * viewBox. Used for the close-up pair.
   */
  crop?: { x: number; y: number; width: number; height: number };
  /** JPEG quality, 0-1. PNG is used when omitted. */
  quality?: number;
}

export class SnapshotError extends Error {}

/**
 * Render an SVG string to a PNG (or JPEG) blob.
 *
 * Everything must be same-origin or inlined: a canvas that has drawn a
 * cross-origin image is tainted and `toBlob` throws. Photos come from object
 * URLs, which are same-origin, so this holds -- but the failure is silent until
 * export, hence the explicit error.
 */
export async function renderSnapshot(options: SnapshotOptions): Promise<Blob> {
  const { svg, width, height, crop, quality } = options;

  const image = await decodeSvg(svg);

  const target = crop ?? { x: 0, y: 0, width, height };
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(target.width);
  canvas.height = Math.round(target.height);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new SnapshotError('Could not create a drawing context');

  // White behind the image: a JPEG has no alpha, and a transparent PNG dropped
  // into a PDF renders black on some viewers.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.drawImage(
    image,
    target.x,
    target.y,
    target.width,
    target.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return toBlob(canvas, quality);
}

/**
 * Decode SVG markup into an image element.
 *
 * The blob carries an explicit XML declaration and namespace: without them
 * some browsers refuse to decode the SVG at all, and the failure surfaces as a
 * bare `onerror` with no detail.
 */
function decodeSvg(svg: string): Promise<HTMLImageElement> {
  const withHeader = svg.includes('xmlns=')
    ? svg
    : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');

  const blob = new Blob([withHeader], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new SnapshotError('Could not render the design to an image'));
    };
    image.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const type = quality === undefined ? 'image/png' : 'image/jpeg';
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new SnapshotError('Could not encode the snapshot'));
      },
      type,
      quality,
    );
  });
}

/**
 * Inline a photo as a data URI.
 *
 * A serialized SVG that references an object URL will not load inside an
 * `Image` -- the blob URL resolves in the document, not in the detached SVG
 * document -- so the photo has to be embedded. This is the single most common
 * cause of a blank snapshot.
 */
export async function inlinePhoto(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new SnapshotError('Could not read the photo');

  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new SnapshotError('Could not encode the photo'));
    reader.readAsDataURL(blob);
  });
}

/** Trigger a download of a blob under `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
