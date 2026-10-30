import * as THREE from 'three';
import { invariant } from '../util';

function canvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  invariant(ctx !== null, 'Canvas 2D context is unavailable.');
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A restrained five-petal silhouette, tinted by the renderer. */
export function flowerTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, size) => {
    const c = size / 2;
    ctx.translate(c, c);
    ctx.fillStyle = '#ffffff';
    const petals = 5;
    for (let i = 0; i < petals; i += 1) {
      ctx.save();
      ctx.rotate((i / petals) * Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.04);
      ctx.bezierCurveTo(
        -size * 0.17,
        -size * 0.18,
        -size * 0.1,
        -size * 0.38,
        0,
        -size * 0.39,
      );
      ctx.bezierCurveTo(
        size * 0.1,
        -size * 0.38,
        size * 0.17,
        -size * 0.18,
        0,
        -size * 0.04,
      );
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.07, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function glowTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, size) => {
    const c = size / 2;
    const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.3, 'rgba(255,255,255,0.4)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
}

/** Soft atmospheric cloud cover. It must never read as an icon. */
export function cloudTexture(variant: number): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    const wisps: [number, number, number, number][] =
      variant % 2 === 0
        ? [
            [0.28, 0.54, 0.28, 0.12],
            [0.48, 0.48, 0.34, 0.16],
            [0.7, 0.55, 0.25, 0.11],
          ]
        : [
            [0.26, 0.56, 0.24, 0.1],
            [0.48, 0.5, 0.3, 0.14],
            [0.68, 0.52, 0.29, 0.13],
          ];
    for (const [x, y, rx, ry] of wisps) {
      const radius = rx * size;
      const gradient = ctx.createRadialGradient(
        x * size,
        y * size,
        0,
        x * size,
        y * size,
        radius,
      );
      gradient.addColorStop(0, 'rgba(255,255,255,0.38)');
      gradient.addColorStop(0.55, 'rgba(255,255,255,0.18)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save();
      ctx.translate(x * size, y * size);
      ctx.scale(1, ry / rx);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  });
}

export function moonTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, size) => {
    const c = size / 2;
    const glow = ctx.createRadialGradient(c, c, 0, c, c, size * 0.48);
    glow.addColorStop(0, 'rgba(255,255,255,0.95)');
    glow.addColorStop(0.48, 'rgba(255,255,255,0.9)');
    glow.addColorStop(0.65, 'rgba(255,255,255,0.18)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  });
}

export function sunTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, size) => {
    const c = size / 2;
    const glow = ctx.createRadialGradient(c, c, 0, c, c, size * 0.5);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.3, 'rgba(255,255,255,0.95)');
    glow.addColorStop(0.48, 'rgba(255,255,255,0.28)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  });
}
