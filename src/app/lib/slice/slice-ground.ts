import { DUNGEON, DUNGEON_ENTRANCE, MOUNDS, PLAIN } from './slice-map';

/**
 * Peint le sol de la tranche verticale sur la carte 2400×1600 (appelé par
 * EnvironmentService avant les arbres) : herbe sèche de la plaine, piste
 * vers la digue, boue craquelée des chambres asséchées.
 */
export function paintSliceGround(ctx: CanvasRenderingContext2D, random: () => number) {
  ctx.save();
  // Savane sèche : grand lavis ocre-vert.
  const savanna = ctx.createLinearGradient(PLAIN.x, PLAIN.y, PLAIN.x + PLAIN.w, PLAIN.y + PLAIN.h);
  savanna.addColorStop(0, '#8a8450');
  savanna.addColorStop(0.5, '#a39257');
  savanna.addColorStop(1, '#7d7a49');
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = savanna;
  ctx.fillRect(PLAIN.x - 30, PLAIN.y - 30, PLAIN.w + 60, PLAIN.h + 60);
  ctx.globalAlpha = 1;

  // Piste du village vers l'entrée des chambres.
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#b98457b0';
  ctx.lineWidth = 34;
  ctx.beginPath();
  ctx.moveTo(1150, 1100);
  ctx.quadraticCurveTo(1350, 1330, 1700, 1300);
  ctx.quadraticCurveTo(2000, 1280, DUNGEON_ENTRANCE.x, DUNGEON_ENTRANCE.y + 10);
  ctx.stroke();

  // Touffes d'herbe sèche.
  for (let i = 0; i < 2600; i++) {
    const x = PLAIN.x + random() * PLAIN.w;
    const y = PLAIN.y + random() * PLAIN.h;
    ctx.strokeStyle = random() < 0.5 ? '#d9c27a55' : '#4f4a2a44';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 2 + random() * 4, y - 4 - random() * 6);
    ctx.stroke();
  }

  // Ombres au pied des termitières.
  for (const mound of MOUNDS) {
    ctx.fillStyle = '#3b2a1c66';
    ctx.beginPath();
    ctx.ellipse(mound.x + mound.r * 0.6, mound.y + mound.r * 0.4, mound.r * 1.6, mound.r * 0.9, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Boue craquelée des chambres : fond sombre et fissures.
  ctx.fillStyle = '#4a3a2c';
  ctx.fillRect(DUNGEON.x, DUNGEON.y, DUNGEON.w, DUNGEON.h);
  ctx.strokeStyle = '#2c2118aa';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 520; i++) {
    let x = DUNGEON.x + random() * DUNGEON.w;
    let y = DUNGEON.y + random() * DUNGEON.h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      x += -9 + random() * 18;
      y += -9 + random() * 18;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Flaques restantes (l'eau qui s'en va).
  for (let i = 0; i < 26; i++) {
    const x = DUNGEON.x + 20 + random() * (DUNGEON.w - 40);
    const y = DUNGEON.y + 20 + random() * (DUNGEON.h - 40);
    ctx.fillStyle = '#3f6660aa';
    ctx.beginPath();
    ctx.ellipse(x, y, 6 + random() * 14, 3 + random() * 7, random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
