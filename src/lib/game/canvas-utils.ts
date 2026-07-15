// Small canvas drawing helpers shared by render.ts, StoryIntro.tsx, and
// DestructionEnding.tsx. Kept dependency-free so it can be imported from both
// client components and the pure-canvas renderer without dragging in engine
// types.

// Cover-scale factor: the scale at which a target rectangle must be drawn so
// that it COVERS a canvas of size (canvasW × canvasH) with no empty bars.
// Returns the uniform scale; the caller multiplies the target's own width and
// height by it to get the final on-screen size.
//
//   const s = coverScale(vw, vh, VIRTUAL_W, VIRTUAL_H);
//   const w = VIRTUAL_W * s;
//   const h = VIRTUAL_H * s;
//
// Used by EternalGame (game canvas), StoryIntro, and DestructionEnding to
// letterbox-free fit a 960×540 virtual stage into any viewport.
export function coverScale(
  canvasW: number,
  canvasH: number,
  targetW: number,
  targetH: number,
): number {
  return Math.max(canvasW / targetW, canvasH / targetH);
}

// Silhouette ridge: draws a filled polygon whose top edge traces the peaks in
// `pts` (interleaved [x, height, x, height, ...]) and whose base sits at
// `baseY`. The polygon overshoots on the left/right/bottom by 10px so it
// cleanly meets the canvas edges regardless of the rightmost x in `pts`.
//
//   ridge(ctx, [0, 70, 150, 110, 300, 70, 960, 90], GROUND_Y, "rgba(40,20,50,0.5)");
//
// Used to draw the layered horizon silhouettes behind every arena and during
// the story intro / ending cinematics.
export function ridge(
  ctx: CanvasRenderingContext2D,
  pts: number[],
  baseY: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-10, baseY + 10);
  for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i], baseY - pts[i + 1]);
  ctx.lineTo(1e5, baseY + 10);
  ctx.closePath();
  ctx.fill();
}
