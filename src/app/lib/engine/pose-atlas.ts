/** All packed poses share the same cell size and body pivot. */
export function drawPose(
  ctx: CanvasRenderingContext2D, atlas: HTMLImageElement, columns: number,
  frame: number, extent: number,
) {
  const cell = atlas.naturalWidth / columns;
  ctx.drawImage(atlas, (frame % columns) * cell, Math.floor(frame / columns) * cell, cell, cell,
    -extent / 2, -extent / 2, extent, extent);
}
