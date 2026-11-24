import { inject, Injectable } from '@angular/core';
import { AssetLoaderService } from './asset-loader.service';
import { HUTS, ROCKS, sceneryRandom, TREES } from '../constants/scenery';
import { WORLD } from '../constants/terrain-constant';
import { BATTLE, CLEARING, CROSSING, GATE, VILLAGE_STOPS } from '../constants/village';

@Injectable({ providedIn: 'root' })
export class EnvironmentService {
  private readonly assets = inject(AssetLoaderService);
  private map?: HTMLCanvasElement;
  private soil: HTMLImageElement | null = null;
  private ford: HTMLImageElement | null = null;
  private basin: HTMLImageElement | null = null;

  groundCanvas() {
    const soil = this.assets.get('soil');
    const ford = this.assets.get('ford');
    const basin = this.assets.get('basin');
    if (!this.map || this.soil !== soil || this.ford !== ford || this.basin !== basin) {
      this.soil = soil;
      this.ford = ford;
      this.basin = basin;
      this.map = this.paintMap();
    }
    return this.map;
  }

  drawGround(ctx: CanvasRenderingContext2D) {
    ctx.drawImage(this.groundCanvas(), 0, 0);
  }

  private paintMap() {
    const map = document.createElement('canvas');
    map.width = WORLD.WIDTH;
    map.height = WORLD.HEIGHT;
    const ctx = map.getContext('2d')!;
    const random = sceneryRandom(743);

    const ground = ctx.createLinearGradient(0, 0, map.width, map.height);
    ground.addColorStop(0, '#41483b');
    ground.addColorStop(0.5, '#6c6f45');
    ground.addColorStop(1, '#283f39');
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, map.width, map.height);
    this.wash(ctx, 1015, 763, 475, 327, '#b7875c');
    this.wash(ctx, BATTLE.x - 64, BATTLE.y, 330, 195, '#846349');
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(255, 0);
    ctx.bezierCurveTo(325, 200, 470, 450, 188, 660);
    ctx.strokeStyle = '#394438';
    ctx.lineWidth = 100;
    ctx.stroke();
    ctx.strokeStyle = '#587269';
    ctx.lineWidth = 64;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(CROSSING.x - 72, CROSSING.y);
    ctx.quadraticCurveTo(462, 379, BATTLE.x, BATTLE.y);
    ctx.strokeStyle = '#ba8054';
    ctx.lineWidth = 30;
    ctx.stroke();
    this.wash(ctx, CLEARING.x, CLEARING.y, 300, 222, '#797357');
    this.wash(ctx, CLEARING.x + 80, CLEARING.y + 43, 185, 119, '#486d63');
    ctx.strokeStyle = '#c39566ad';
    ctx.lineCap = 'round';
    ctx.lineWidth = 56;
    ctx.beginPath();
    ctx.moveTo(630, 1050);
    ctx.quadraticCurveTo(735, 960, 820, 780);
    ctx.quadraticCurveTo(965, 720, 1110, 580);
    ctx.moveTo(820, 780);
    ctx.quadraticCurveTo(1130, 931, CLEARING.x, CLEARING.y);
    ctx.stroke();

    if (this.soil) {
      const pattern = ctx.createPattern(this.soil, 'repeat');
      if (pattern) {
        ctx.save();
        ctx.globalAlpha = 0.48;
        ctx.globalCompositeOperation = 'soft-light';
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, map.width, map.height);
        ctx.restore();
      }
    }

    if (this.ford) this.blendRegion(ctx, this.ford, 216, 63, 945, 577);

    for (let i = 0; i < 2200; i++) {
      const x = random() * map.width;
      const y = random() * map.height;
      if (Math.abs(x - GATE.x) < 110 || (x > 270 && x < 455 && y < 485)) continue;
      ctx.strokeStyle = random() < 0.5 ? '#aaa47337' : '#253c373f';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 2, y - 5 - random() * 5);
      ctx.lineTo(x + 4 + random() * 6, y - 6 - random() * 7);
      ctx.stroke();
    }

    for (let i = 0; i < 18500; i++) {
      const x = random() * map.width;
      const y = random() * map.height;
      ctx.fillStyle = random() < 0.5 ? '#f4cf8225' : '#26190a26';
      ctx.fillRect(x, y, 1 + random() * 6, 1 + random() * 3);
    }

    for (const { x, y, radius: r, seed } of TREES) {
      const branchRandom = sceneryRandom(seed);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(0.56);
      this.oval(ctx, r * 0.7, 6, r * 1.75, r * 0.77, '#1d292e58');
      ctx.restore();
      for (let branch = 0; branch < 8; branch++) {
        const a = branchRandom() * Math.PI * 2;
        const spread = branchRandom() * r * 0.62;
        const bx = x + Math.cos(a) * spread;
        const by = y + Math.sin(a) * spread;
        const crown = r * (0.38 + branchRandom() * 0.4);
        this.oval(ctx, bx + 4, by + 6, crown, crown * 0.87, '#263731');
        this.oval(ctx, bx, by, crown * 0.91, crown * 0.77, ['#415646', '#6f7750', '#52654c'][branch % 3]);
        this.oval(ctx, bx - crown * 0.23, by - crown * 0.28, crown * 0.55, crown * 0.34, '#a3a46a57');
      }
    }

    const scatteredDebris = this.ford ? [] : [[469, 290], [530, 411], [680, 258], [746, 391]];
    for (const [x, y] of scatteredDebris) {
      this.oval(ctx, x, y, 22, 12, '#4a3628');
      this.oval(ctx, x - 5, y - 4, 14, 7, '#67513d');
      this.oval(ctx, x - 10, y - 8, 5, 3, '#e49454');
    }

    for (const [x, y, color] of [[329, 323, '#ab693b'], [314, 360, '#dfbc82'], [349, 376, '#354e50']] as const) {
      this.oval(ctx, x, y + 7, 13, 7, '#3e3a2c');
      this.oval(ctx, x, y, 12, 8, color);
      this.oval(ctx, x + 2, y - 5, 6, 6, '#4d3225');
    }

    if (this.basin) this.blendRegion(ctx, this.basin, 1097, 524, 810, 550);

    for (const [x, y, r] of HUTS) {
      this.oval(ctx, x + r * 0.43, y + r * 0.42, r * 1.25, r * 0.86, '#30212289');
      this.oval(ctx, x, y + 8, r + 3, r + 3, '#524032');
      this.oval(ctx, x, y, r, r, '#806149');
      for (let facet = 0; facet < 12; facet++) {
        const start = facet * Math.PI / 6;
        ctx.fillStyle = ['#8c6950', '#987355', '#b38e63', '#c09c6c',
          '#d1af79', '#caa16a', '#bd9564', '#a58157', '#99724e', '#8c6448', '#775940', '#7f5d46'][facet];
        ctx.beginPath();
        ctx.moveTo(x - 8, y - 8);
        ctx.arc(x, y, r, start, start + Math.PI / 6 + 0.01);
        ctx.closePath();
        ctx.fill();
      }
      for (let straw = 0; straw < 150; straw++) {
        const a = random() * Math.PI * 2;
        const offset = 0.28 + random() * 0.65;
        ctx.strokeStyle = straw % 2 ? '#f9db9865' : '#54392545';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * r * offset, y + Math.sin(a) * r * offset);
        const end = Math.min(1, offset + 0.13);
        ctx.lineTo(x + Math.cos(a) * r * end, y + Math.sin(a) * r * end);
        ctx.stroke();
      }
      this.oval(ctx, x, y, 7, 7, '#7e5332');
    }

    if (!this.basin) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#594736';
      ctx.lineWidth = 40;
      ctx.beginPath();
      ctx.moveTo(GATE.x + 12, GATE.y - 145);
      ctx.quadraticCurveTo(GATE.x + 85, GATE.y, GATE.x + 7, GATE.y + 150);
      ctx.stroke();
      ctx.strokeStyle = '#63867d';
      ctx.lineWidth = 14;
      ctx.stroke();
      const bridgeX = GATE.x - 18;
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#8d5737' : '#ac774c';
        ctx.fillRect(bridgeX + i * 9, GATE.y - 21, 8, 42);
      }

      for (const [x, y] of ROCKS) {
        this.oval(ctx, x + 9, y + 7, 25, 19, '#50372775');
        this.oval(ctx, x, y, 21, 17, '#794b35');
        this.oval(ctx, x - 3, y - 4, 14, 12, '#a76542');
        this.oval(ctx, x - 5, y - 8, 7, 6, '#c88957');
        this.oval(ctx, x + 5, y + 2, 3, 4, '#553329');
      }

    }

    for (const stop of VILLAGE_STOPS) {
      this.oval(ctx, stop.x, stop.y, 60, 48, '#d3945d');
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 9) {
        this.oval(ctx, stop.x + Math.cos(a) * 59, stop.y + Math.sin(a) * 47, 4, 3, '#efbb7a');
      }
      this.oval(ctx, stop.x, stop.y + 5, 17, 9, '#744832');
      this.oval(ctx, stop.x, stop.y + 1, 15, 10, '#365e56');
      this.oval(ctx, stop.x, stop.y - 5, 8, 8, '#553322');
    }
    this.wash(ctx, BATTLE.x - 145, BATTLE.y - 95, 370, 114, '#b8c2b42e');
    this.wash(ctx, GATE.x + 186, GATE.y + 27, 330, 113, '#cfdbc233');
    this.wash(ctx, VILLAGE_STOPS[0].x, VILLAGE_STOPS[0].y, 210, 135, '#ffc78120');
    return map;
  }

  private blendRegion(
    ctx: CanvasRenderingContext2D, image: HTMLImageElement,
    x: number, y: number, width: number, height: number,
  ) {
    const stamp = document.createElement('canvas');
    stamp.width = width;
    stamp.height = height;
    const ink = stamp.getContext('2d');
    if (!ink) return;
    ink.drawImage(image, 0, 0, stamp.width, stamp.height);
    ink.globalCompositeOperation = 'destination-in';
    const fade = (length: number, horizontal: boolean) => {
      const mask = ink.createLinearGradient(0, 0, horizontal ? length : 0, horizontal ? 0 : length);
      mask.addColorStop(0, 'transparent');
      mask.addColorStop(0.13, 'black');
      mask.addColorStop(0.85, 'black');
      mask.addColorStop(1, 'transparent');
      ink.fillStyle = mask;
      ink.fillRect(0, 0, stamp.width, stamp.height);
    };
    fade(stamp.width, true);
    fade(stamp.height, false);
    ctx.drawImage(stamp, x, y);
  }

  private wash(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    const gradient = ctx.createRadialGradient(0, 0, 0.17, 0, 0, 1);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, '#00000000');
    this.oval(ctx, 0, 0, 1, 1, gradient);
    ctx.restore();
  }

  private oval(
    ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number,
    fill: string | CanvasGradient,
  ) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
