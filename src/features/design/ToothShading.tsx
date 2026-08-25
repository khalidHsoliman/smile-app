/**
 * Tooth shading (spec 7.1, 7.2).
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
 * Deliberately no WebGL. Spec 7.2 reserves photorealistic compositing for a
 * later polish pass and warns it must not shape the MVP; gradients get most of
 * the credibility for none of the architectural cost.
 *
 * The gradients are defined in the tooth's own local space
 * (`objectBoundingBox`), so one definition serves every tooth regardless of its
 * size or placement.
 */

interface ToothShadingProps {
  /** Prefix for the gradient ids, so multiple layers cannot collide. */
  idPrefix: string;
  /** True for the upper arch, whose gum is at the top of the local box. */
  upper: boolean;
}

export function ToothShading({ idPrefix, upper }: ToothShadingProps) {
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
        <stop offset="0%" stopColor="#e8d9bd" />
        <stop offset="28%" stopColor="#f4ece0" />
        <stop offset="72%" stopColor="#faf7f1" />
        <stop offset="93%" stopColor="#f2f2f0" />
        {/* The very edge loses its dentine backing and reads translucent. */}
        <stop offset="100%" stopColor="#e4e8ea" />
      </linearGradient>

      {/*
        Labial highlight: an off-centre vertical band, brightest just above the
        middle, fading out well before the edges so it never reads as a stripe.
      */}
      <linearGradient
        id={`${idPrefix}-highlight`}
        x1="0%"
        y1="0%"
        x2="100%"
        y2="0%"
      >
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="34%" stopColor="#ffffff" stopOpacity="0.42" />
        <stop offset="52%" stopColor="#ffffff" stopOpacity="0.16" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>

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
