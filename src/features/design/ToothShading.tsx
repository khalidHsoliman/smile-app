/**
 * Tooth shading.
 *
 * Real enamel is not flat white. Three things carry most of the realism, and
 * all three are reachable in plain SVG:
 *
 *  - the **cervical third** (nearest the gum) is warmer and more saturated,
 *    because dentine shows through thinner enamel there;
 *  - the **incisal edge** is translucent and slightly blue-grey, since there is
 *    no dentine behind it;
 *  - a soft **highlight** runs down the labial surface.
 *
 * Deliberately no WebGL. Photorealistic compositing is left for a later
 * polish pass and must not shape the MVP; gradients get most of
 * the credibility for none of the architectural cost.
 *
 * And deliberately no `feSpecularLighting`, which is the obvious way to do this
 * and the wrong one. Its whole appeal is that it derives a highlight from the
 * shape's own silhouette -- but every browser computes the surface normals from
 * the *device* pixel grid, and `kernelUnitLength`, the attribute that exists to
 * fix exactly that, is ignored by Chromium and Firefox alike. So the same tooth
 * would come out glossy on screen at viewport scale and nearly matte in a
 * report rendered at the photograph's native resolution. An export that does
 * not match what the clinician approved is the worst bug this application can
 * have, so the gloss is built from geometry instead: gradients in the tooth's
 * own bounding box, which follow the silhouette because the outline clips them,
 * and which rasterize identically at any scale.
 *
 * The gradients are defined in the tooth's own local space
 * (`objectBoundingBox`), so one definition serves every tooth regardless of its
 * size or placement.
 */

import type { ToothPalette } from '../../vision/sampleToothColor.js';

interface ToothShadingProps {
  /** Prefix for the gradient ids, so multiple layers cannot collide. */
  idPrefix: string;
  /** True for the upper arch, whose gum is at the top of the local box. */
  upper: boolean;
  /** Enamel tones, sampled from the patient's photo where possible. */
  palette: ToothPalette;
}

export function ToothShading({ idPrefix, upper, palette }: ToothShadingProps) {
  // Tooth outlines are authored with +y toward the gum, and the upper arch is
  // flipped vertically at placement -- so in the *rendered* box the gum ends up
  // at the top for uppers and the bottom for lowers.
  const gumStop = upper ? '0%' : '100%';
  const incisalStop = upper ? '100%' : '0%';

  return (
    <defs>
      {/*
        Body: warm at the gum, neutral through the middle, cooler and paler at
        the biting edge.
      */}
      <linearGradient
        id={`${idPrefix}-body`}
        x1="0%"
        y1={gumStop}
        x2="0%"
        y2={incisalStop}
      >
        <stop offset="0%" stopColor={palette.cervical} />
        <stop offset="28%" stopColor={palette.base} />
        {/*
          Translucent, and it matters that it is.

          Real enamel is translucent through the middle third, and letting 45%
          of the photograph through here is what makes the design sit *in* the
          mouth rather than on it. It was briefly made opaque -- correctly, in
          the sense that a body layer usually should be, and wrongly, because
          the thing then showing through was a dark backdrop rather than the
          photograph and every crown picked up a dull band. The backdrop is gone
          and the translucency is back; it is the more valuable of the two.
        */}
        <stop offset="72%" stopColor={palette.highlight} stopOpacity="0.55" />
        <stop offset="93%" stopColor={palette.base} />
        {/* The very edge loses its dentine backing and reads translucent. */}
        <stop offset="100%" stopColor={palette.incisal} />
      </linearGradient>

      {/*
        Labial sheen: the broad, soft reflection off the middle of the crown.

        Radial rather than the vertical band this replaced. A band is the same
        width at the gum as at the biting edge, which is what made the old teeth
        read as flat cut-outs -- a stripe painted on a shape rather than light
        falling across one. A radial pool has a centre and falls off in every
        direction, so it reads as a curved surface; the outline clips it, so it
        takes the tooth's own shape for free.

        Centred a little toward the biting edge, where the labial surface
        actually bulges (`bulgeHeight` in the outline generator puts the widest
        point in the incisal third).
      */}
      <radialGradient
        id={`${idPrefix}-highlight`}
        cx="45%"
        cy={upper ? '56%' : '44%'}
        r="54%"
      >
        <stop offset="0%" stopColor={palette.highlight} stopOpacity="0.4" />
        <stop offset="42%" stopColor={palette.highlight} stopOpacity="0.2" />
        <stop offset="100%" stopColor={palette.highlight} stopOpacity="0" />
      </radialGradient>

      {/*
        The glint: the small, hard catchlight enamel gets from a flash.

        This is the single detail that most says "wet". The sheen above says the
        surface is curved; only a tight, near-white spot says it is *glossy*
        rather than matte. Kept small and placed above the sheen's centre, which
        is where it sits on a photograph lit from above -- and white rather than
        the palette's highlight tone, because a specular reflection is the
        colour of the light, not of the thing reflecting it.
      */}
      <radialGradient
        id={`${idPrefix}-glint`}
        cx="42%"
        cy={upper ? '36%' : '64%'}
        r="21%"
      >
        {/*
          Kept short of a blown white spot. A catchlight is the brightest thing
          on a tooth and still only a suggestion -- at full strength it stopped
          reading as a reflection and started reading as a hole punched in the
          enamel.
        */}
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
        <stop offset="50%" stopColor="#ffffff" stopOpacity="0.17" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </radialGradient>

      {/*
        Proximal shading: the mesial and distal edges curve away from the
        viewer, so they fall off into shadow. This is what separates adjacent
        teeth without drawing a hard outline between them.
      */}
      <linearGradient
        id={`${idPrefix}-proximal`}
        x1="0%"
        y1="0%"
        x2="100%"
        y2="0%"
      >
        <stop offset="0%" stopColor="#8a7c66" stopOpacity="0.36" />
        <stop offset="16%" stopColor="#8a7c66" stopOpacity="0" />
        <stop offset="84%" stopColor="#8a7c66" stopOpacity="0" />
        <stop offset="100%" stopColor="#8a7c66" stopOpacity="0.36" />
      </linearGradient>
    </defs>
  );
}
