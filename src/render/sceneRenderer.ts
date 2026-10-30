import * as THREE from 'three';
import type { Game } from '../game';
import type { LevelDef } from '../levels';
import { RAY_LENGTH } from '../rays';
import type { FlowerShape, Ribbon, RibbonPoint } from '../treeTypes';
import { at, clamp, lerp, Rng, smoothstep } from '../util';
import { hex, mix, paletteFor, type Palette, type Rgb } from './colors';
import { RibbonMesh } from './ribbonMesh';
import { cloudTexture, flowerTexture, glowTexture, moonTexture, sunTexture } from './textures';

THREE.ColorManagement.enabled = false;

const VIEW_HEIGHT = 46;
const MIN_ZOOM = 0.55;
const MAX_FLOWERS = 900;
const MAX_RAYS = 1400;
const MAX_DROPS = 700;
const MAX_BIRDS = 8;
/** Thickness of every drawn line, in CSS pixels. The whole scene uses one pen. */
const STROKE_PX = 1.35;

/** Palette slots used by the static line work, so it can be recoloured cheaply. */
const SLOT = { ink: 0, paper: 1, faint: 2 } as const;

export interface ViewState {
  seedGhost: { x: number; valid: boolean } | undefined;
  branchRing: { x: number; y: number } | undefined;
  hoverX: number;
  hoverY: number;
}

interface Drop {
  x: number;
  y: number;
  speed: number;
}

function clipQuad(material: THREE.ShaderMaterial, renderOrder: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  return mesh;
}

function lineMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function spriteMaterial(map: THREE.Texture, additive: boolean): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

export class SceneRenderer {
  readonly canvas: HTMLCanvasElement;
  palette: Palette;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  private readonly game: Game;
  private readonly level: LevelDef;
  private width = 1;
  private height = 1;
  private zoom = 1;
  private centerX = 0;
  private centerY = 6;
  private userZoomed = false;

  private readonly skyMaterial: THREE.ShaderMaterial;
  private readonly groundMaterial: THREE.ShaderMaterial;
  private readonly skyGroup = new THREE.Group();
  private readonly sun: THREE.Mesh;
  private readonly moon: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly clouds: THREE.Mesh[] = [];
  private readonly waterPockets: THREE.Mesh[] = [];

  private readonly staticMesh: RibbonMesh;
  private readonly undergroundMesh: RibbonMesh;
  private readonly treeMesh: RibbonMesh;
  private readonly debrisMesh: RibbonMesh;
  private readonly selectionMesh: RibbonMesh;
  private readonly gizmoMesh: RibbonMesh;
  private readonly birdMesh: RibbonMesh;
  private readonly flowerMesh: THREE.InstancedMesh;
  private readonly glowMesh: THREE.InstancedMesh;
  private readonly rayGeometry: THREE.BufferGeometry;
  private readonly rayPositions: Float32Array;
  private readonly rayColors: Float32Array;
  private readonly rayMesh: THREE.Mesh;
  private readonly rainGeometry: THREE.BufferGeometry;
  private readonly rainPositions: Float32Array;
  private readonly rainLines: THREE.LineSegments;
  private readonly drops: Drop[] = [];

  private readonly rng = new Rng(4242);
  private readonly matrix = new THREE.Matrix4();
  private readonly tempColor = new THREE.Color();
  private readonly tempPosition = new THREE.Vector3();
  private readonly tempScale = new THREE.Vector3();
  private readonly tempQuaternion = new THREE.Quaternion();
  private readonly tempAxis = new THREE.Vector3(0, 0, 1);
  private readonly disposables: { dispose(): void }[] = [];
  private staticInk: Rgb = [0, 0, 0];

  constructor(container: HTMLElement, game: Game) {
    this.game = game;
    this.level = game.level;
    this.palette = paletteFor(game.env.sunHeight, game.env.cloudCover, game.env.isDay);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'game-canvas';
    container.appendChild(this.canvas);
    this.scene.add(this.camera);

    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader:
        `uniform vec3 top;
         uniform vec3 bottom;
         varying vec2 vUv;
         float grain(vec2 p) {
           return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
         }
         void main() {
           vec3 color = mix(bottom, top, pow(vUv.y, 0.85));
           color += (grain(gl_FragCoord.xy) - 0.5) * 0.018;
           gl_FragColor = vec4(color, 1.0);
         }`,
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(clipQuad(this.skyMaterial, -20));

    this.groundMaterial = new THREE.ShaderMaterial({
      uniforms: {
        surface: { value: new THREE.Color() },
        middle: { value: new THREE.Color() },
        bottom: { value: new THREE.Color() },
      },
      vertexShader:
        'attribute float depth; varying float vDepth; void main() { vDepth = depth; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        `uniform vec3 surface;
         uniform vec3 middle;
         uniform vec3 bottom;
         varying float vDepth;
         float grain(vec2 p) {
           return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
         }
         void main() {
           vec3 near = mix(surface, middle, smoothstep(0.04, 0.34, vDepth));
           vec3 color = mix(near, bottom, smoothstep(0.34, 1.0, vDepth));
           color += (grain(gl_FragCoord.xy) - 0.5) * 0.025;
           gl_FragColor = vec4(color, 1.0);
         }`,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const built = this.buildSkyBodies();
    this.sun = built.sun;
    this.moon = built.moon;
    this.stars = built.stars;
    this.buildGround();

    this.staticMesh = new RibbonMesh(90000, 2);
    this.undergroundMesh = new RibbonMesh(60000, 4);
    this.selectionMesh = new RibbonMesh(12000, 6);
    this.treeMesh = new RibbonMesh(90000, 8);
    this.debrisMesh = new RibbonMesh(40000, 10);
    this.birdMesh = new RibbonMesh(3000, 12);
    this.gizmoMesh = new RibbonMesh(6000, 24);
    for (const mesh of [
      this.staticMesh,
      this.undergroundMesh,
      this.selectionMesh,
      this.treeMesh,
      this.debrisMesh,
      this.birdMesh,
      this.gizmoMesh,
    ]) {
      this.scene.add(mesh.mesh);
      this.disposables.push(mesh);
    }
    this.buildStatic();

    const flowerTex = flowerTexture();
    const glowTex = glowTexture();
    this.disposables.push(flowerTex, glowTex);
    this.flowerMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), spriteMaterial(flowerTex, false), MAX_FLOWERS);
    this.flowerMesh.renderOrder = 11;
    this.flowerMesh.frustumCulled = false;
    this.flowerMesh.count = 0;
    this.glowMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), spriteMaterial(glowTex, true), MAX_FLOWERS);
    this.glowMesh.renderOrder = 16;
    this.glowMesh.frustumCulled = false;
    this.glowMesh.count = 0;
    this.scene.add(this.flowerMesh, this.glowMesh);
    for (const pocket of this.level.pockets) {
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        spriteMaterial(glowTex, false),
      );
      water.position.set(pocket.x, pocket.y, 0);
      water.scale.set(pocket.rx * 3.2, pocket.ry * 3.2, 1);
      water.renderOrder = -8;
      water.frustumCulled = false;
      this.waterPockets.push(water);
      this.scene.add(water);
    }

    this.rayPositions = new Float32Array(MAX_RAYS * 4 * 3);
    this.rayColors = new Float32Array(MAX_RAYS * 4 * 4);
    const rayIndices = new Uint32Array(MAX_RAYS * 6);
    for (let i = 0; i < MAX_RAYS; i += 1) {
      const v = i * 4;
      rayIndices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    }
    this.rayGeometry = new THREE.BufferGeometry();
    this.rayGeometry.setAttribute('position', new THREE.BufferAttribute(this.rayPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.rayGeometry.setAttribute('color', new THREE.BufferAttribute(this.rayColors, 4).setUsage(THREE.DynamicDrawUsage));
    this.rayGeometry.setIndex(new THREE.BufferAttribute(rayIndices, 1));
    this.rayMesh = new THREE.Mesh(this.rayGeometry, lineMaterial());
    this.rayMesh.renderOrder = 15;
    this.rayMesh.frustumCulled = false;
    this.scene.add(this.rayMesh);

    this.rainPositions = new Float32Array(MAX_DROPS * 2 * 3);
    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainLines = new THREE.LineSegments(
      this.rainGeometry,
      new THREE.LineBasicMaterial({ transparent: true, opacity: 0.4, depthTest: false, depthWrite: false }),
    );
    this.rainLines.renderOrder = 18;
    this.rainLines.frustumCulled = false;
    this.scene.add(this.rainLines);
    for (let i = 0; i < MAX_DROPS; i += 1) {
      this.drops.push({ x: this.rng.range(-50, 50), y: this.rng.range(-5, 40), speed: this.rng.range(24, 32) });
    }

    this.resize(container.clientWidth, container.clientHeight);
  }

  private buildSkyBodies(): { sun: THREE.Mesh; moon: THREE.Mesh; stars: THREE.Points } {
    this.scene.add(this.skyGroup);
    const sunTex = sunTexture();
    const moonTex = moonTexture();
    this.disposables.push(sunTex, moonTex);
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), spriteMaterial(sunTex, false));
    sun.renderOrder = -16;
    const moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), spriteMaterial(moonTex, false));
    moon.renderOrder = -16;
    this.skyGroup.add(sun, moon);

    const starCount = 150;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      starPositions[i * 3] = this.rng.range(-1, 1);
      starPositions[i * 3 + 1] = this.rng.range(-0.05, 1);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, transparent: true, depthTest: false, depthWrite: false }),
    );
    stars.frustumCulled = false;
    stars.renderOrder = -18;
    this.skyGroup.add(stars);

    const cloudTextures = [cloudTexture(0), cloudTexture(1)];
    this.disposables.push(...cloudTextures);
    for (const cloud of this.game.scenery.clouds) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), spriteMaterial(at(cloudTextures, cloud.variant % 2), false));
      mesh.renderOrder = -14;
      mesh.scale.set(cloud.width, cloud.width, 1);
      mesh.frustumCulled = false;
      this.clouds.push(mesh);
      this.scene.add(mesh);
    }
    return { sun, moon, stars };
  }

  private buildGround(): void {
    const { level } = this;
    const margin = 90;
    const xs: number[] = [];
    for (let x = -level.halfWidth - margin; x <= level.halfWidth + margin + 0.001; x += 0.5) {
      xs.push(x);
    }
    const depths = [0, 1.5, 4, 8, level.depth, level.depth + 20];
    const cols = xs.length;
    const rows = depths.length;
    const positions = new Float32Array(cols * rows * 3);
    const depthAttr = new Float32Array(cols * rows);
    const indices: number[] = [];
    const maxDepth = at(depths, rows - 1);
    xs.forEach((x, i) => {
      const surface = level.surface(x);
      depths.forEach((depth, j) => {
        const v = (i * rows + j) * 3;
        positions[v] = x;
        positions[v + 1] = surface - depth;
        positions[v + 2] = 0;
        depthAttr[i * rows + j] = Math.pow(depth / maxDepth, 0.55);
      });
    });
    for (let i = 0; i < cols - 1; i += 1) {
      for (let j = 0; j < rows - 1; j += 1) {
        const a = i * rows + j;
        const b = (i + 1) * rows + j;
        const c = i * rows + j + 1;
        const d = (i + 1) * rows + j + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('depth', new THREE.BufferAttribute(depthAttr, 1));
    geometry.setIndex(indices);
    const mesh = new THREE.Mesh(geometry, this.groundMaterial);
    mesh.renderOrder = -10;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.disposables.push(geometry);
  }

  /** Rocks, soil flecks, ground spirals, grass and buildings. Recoloured, never rebuilt. */
  private buildStatic(): void {
    const { level } = this;
    const mesh = this.staticMesh;
    const rng = new Rng(level.seed);
    const stroke = 0.055;
    mesh.begin();

    mesh.useSlot(SLOT.faint);
    for (let i = 0; i < 72; i += 1) {
      const x = rng.range(-level.halfWidth, level.halfWidth);
      const depth = rng.range(1, level.depth - 0.5);
      const y = level.surface(x) - depth;
      if (level.rocks.some((r) => Math.hypot(x - r.x, y - r.y) < r.r + 0.4)) {
        continue;
      }
      const r = rng.range(0.05, 0.12);
      mesh.addPolygon(
        [0, 1, 2, 3, 4].map((k) => ({ x: x + Math.cos(k * 1.26 + i) * r, y: y + Math.sin(k * 1.26 + i) * r * 0.8 })),
        hex('#ffffff'),
        0.28,
      );
    }
    // Spirals in the soil, the flourish the sand drawing fills its ground with.
    for (let i = 0; i < 9; i += 1) {
      const x = rng.range(-level.halfWidth + 2, level.halfWidth - 2);
      const depth = rng.range(1.6, level.depth - 2);
      const y = level.surface(x) - depth;
      if (level.rocks.some((r) => Math.hypot(x - r.x, y - r.y) < r.r + 1.2)) {
        continue;
      }
      mesh.addRibbon(
        spiral(
          x,
          y,
          rng.range(0.5, 1.1),
          rng.chance(0.5) ? 1 : -1,
          rng.range(0, 6),
          1.5,
        ),
        stroke * 0.25,
        () => hex('#ffffff'),
        0.18,
      );
    }
    // Sparse contour lines turn the cut soil into a quiet topographic drawing.
    for (const depth of [2.8, 5.8, 9.2, 13.4]) {
      const contour: RibbonPoint[] = [];
      for (let x = -level.halfWidth; x <= level.halfWidth; x += 0.7) {
        contour.push({
          x,
          y:
            level.surface(x) -
            depth +
            Math.sin(x * 0.12 + depth * 0.7) * 0.16,
          r: stroke * 0.18,
          heat: 0,
          glow: 0,
        });
      }
      mesh.addRibbon(
        contour,
        0,
        () => hex('#ffffff'),
        0.16,
        false,
      );
    }

    mesh.useSlot(SLOT.paper);
    const rockOutlines: { x: number; y: number }[][] = level.rocks.map((rock) => {
      const pts: { x: number; y: number }[] = [];
      const sides = 11;
      for (let i = 0; i < sides; i += 1) {
        const a = (i / sides) * Math.PI * 2;
        const wobble = 1 + 0.1 * Math.sin(i * 2.7 + rock.x);
        pts.push({ x: rock.x + Math.cos(a) * rock.r * wobble, y: rock.y + Math.sin(a) * rock.r * wobble * 0.86 });
      }
      return pts;
    });
    for (const pts of rockOutlines) {
      mesh.addPolygon(pts, hex('#ffffff'));
    }
    mesh.useSlot(SLOT.ink);
    rockOutlines.forEach((pts, i) => {
      mesh.addLoop(pts, stroke, hex('#ffffff'), true);
      const rock = at(level.rocks, i);
      mesh.addRibbon(
        [0.3, 0.55, 0.8].map((t) => ({
          x: rock.x + Math.cos(2.6 + t * 1.5) * rock.r * 0.55,
          y: rock.y + Math.sin(2.6 + t * 1.5) * rock.r * 0.5,
          r: stroke * 0.3,
          heat: 0,
          glow: 0,
        })),
        0,
        () => hex('#ffffff'),
        0.5,
      );
    });

    // A single line for the ground, with sparse tufts instead of a band of grass.
    const surfaceLine: RibbonPoint[] = [];
    for (let x = -level.halfWidth - 90; x <= level.halfWidth + 90; x += 0.5) {
      surfaceLine.push({ x, y: level.surface(x), r: stroke * 0.62, heat: 0, glow: 0 });
    }
    mesh.addRibbon(surfaceLine, 0, () => hex('#ffffff'), 1, false);
    for (let x = -level.halfWidth - 20; x < level.halfWidth + 20; x += rng.range(0.7, 2.4)) {
      const y = level.surface(x);
      const count = 1 + Math.floor(rng.range(0, 2.99));
      for (let k = 0; k < count; k += 1) {
        const bx = x + k * 0.16;
        const h = rng.range(0.3, 0.75);
        const lean = rng.range(-0.3, 0.3);
        mesh.addRibbon(
          [
            { x: bx, y, r: stroke * 0.42, heat: 0, glow: 0 },
            { x: bx + lean * 0.4, y: y + h * 0.6, r: stroke * 0.3, heat: 0, glow: 0 },
            { x: bx + lean, y: y + h, r: stroke * 0.12, heat: 0, glow: 0 },
          ],
          0,
          () => hex('#ffffff'),
          0.75,
        );
      }
    }

    for (const part of level.obstacles) {
      mesh.useSlot(SLOT.paper);
      mesh.addPolygon(part.points, hex('#ffffff'));
      mesh.useSlot(SLOT.ink);
      mesh.addLoop(part.points, stroke, hex('#ffffff'), part.points.length > 6);
    }
    mesh.end();
  }

  private recolorStatic(): void {
    const { ink, soil, faint } = this.palette;
    if (Math.abs(ink[0] - this.staticInk[0]) + Math.abs(ink[1] - this.staticInk[1]) + Math.abs(ink[2] - this.staticInk[2]) < 0.004) {
      return;
    }
    this.staticInk = ink;
    this.staticMesh.recolor([ink, mix(soil, ink, 0.2), mix(faint, soil, 0.55)]);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    if (!this.userZoomed) {
      this.zoom = clamp((VIEW_HEIGHT * this.aspect) / (this.level.halfWidth * 2), MIN_ZOOM, 1.6);
    }
    this.updateCamera();
  }

  private get aspect(): number {
    return this.width / this.height;
  }

  private updateCamera(): void {
    const viewH = VIEW_HEIGHT / this.zoom;
    const viewW = viewH * this.aspect;
    const { level } = this;
    const maxX = Math.max(0, level.halfWidth - viewW / 2);
    this.centerX = clamp(this.centerX, -maxX, maxX);
    const minY = -level.depth - 1 + viewH / 2;
    const maxY = 90 - viewH / 2;
    this.centerY = clamp(this.centerY, Math.min(minY, maxY), Math.max(minY, maxY));
    this.camera.left = this.centerX - viewW / 2;
    this.camera.right = this.centerX + viewW / 2;
    this.camera.top = this.centerY + viewH / 2;
    this.camera.bottom = this.centerY - viewH / 2;
    this.camera.updateProjectionMatrix();
  }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    const before = this.screenToWorld(clientX, clientY);
    this.userZoomed = true;
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, 3.5);
    this.updateCamera();
    const after = this.screenToWorld(clientX, clientY);
    this.centerX += before.x - after.x;
    this.centerY += before.y - after.y;
    this.updateCamera();
  }

  panByPixels(dx: number, dy: number): void {
    const perPixel = VIEW_HEIGHT / this.zoom / this.height;
    this.centerX -= dx * perPixel;
    this.centerY += dy * perPixel;
    this.updateCamera();
  }

  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: lerp(this.camera.left, this.camera.right, (clientX - rect.left) / rect.width),
      y: lerp(this.camera.top, this.camera.bottom, (clientY - rect.top) / rect.height),
    };
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((x - this.camera.left) / (this.camera.right - this.camera.left)) * rect.width,
      y: rect.top + ((this.camera.top - y) / (this.camera.top - this.camera.bottom)) * rect.height,
    };
  }

  /** World units covered by one CSS pixel. */
  get worldPerPixel(): number {
    return VIEW_HEIGHT / this.zoom / this.height;
  }

  render(time: number, view: ViewState): void {
    const { env } = this.game;
    const elevation = env.isDay ? env.sunHeight : -Math.sin(env.bodyAngle);
    this.palette = paletteFor(elevation, env.cloudCover, env.isDay);
    this.recolorStatic();

    this.updateSky(time);
    this.updateClouds();
    this.updateBirds();
    this.updateRays();
    this.updateRain(1 / 60);
    this.updateTree();
    this.updateGizmos(view, time);
    this.renderer.render(this.scene, this.camera);
  }

  private get strokeWidth(): number {
    return Math.max(0.012, this.worldPerPixel * STROKE_PX);
  }

  /** Draws a limb as one dark, calligraphic silhouette. */
  private drawLimb(mesh: RibbonMesh, ribbon: Ribbon, alpha: number): void {
    const { ink } = this.palette;
    const warn = hex('#c4533a');
    mesh.addRibbon(
      ribbon.points,
      0,
      (p) => mix(ink, warn, smoothstep(0.65, 1, p.heat)),
      alpha,
    );
  }

  private updateTree(): void {
    const { game } = this;
    const { tree } = game;
    const order: Record<string, number> = { tendril: 0, root: 1, twig: 2, branch: 3, trunk: 4 };

    this.undergroundMesh.begin();
    this.treeMesh.begin();
    this.selectionMesh.begin();
    const flowerShapes: FlowerShape[] = [];
    const waterGlows: { x: number; y: number; glow: number }[] = [];

    if (tree) {
      const ribbons = tree.buildRibbons().sort((a, b) => (order[a.kind] ?? 0) - (order[b.kind] ?? 0));
      for (const ribbon of ribbons) {
        const underground = ribbon.kind === 'root' || ribbon.kind === 'tendril';
        this.drawLimb(underground ? this.undergroundMesh : this.treeMesh, ribbon, 1);
        const tip = at(ribbon.points, ribbon.points.length - 1);
        if (underground && tip.glow > 0.02) {
          waterGlows.push({ x: tip.x, y: tip.y, glow: tip.glow });
        }
      }
      flowerShapes.push(...tree.collectFlowers());
      const limb = game.selectedLimb;
      if (limb) {
        for (const ribbon of tree.buildRibbons(new Set(limb.segIds))) {
          this.selectionMesh.addRibbon(ribbon.points, this.strokeWidth * 2.5, () => this.palette.sun, 0.3);
        }
      }
    }
    this.undergroundMesh.end();
    this.treeMesh.end();
    this.selectionMesh.end();

    this.debrisMesh.begin();
    for (const piece of game.debris) {
      const ribbons = piece.ribbons().sort((a, b) => (order[a.kind] ?? 0) - (order[b.kind] ?? 0));
      for (const ribbon of ribbons) {
        this.drawLimb(this.debrisMesh, ribbon, piece.alpha);
      }
      for (const shape of piece.flowers()) {
        flowerShapes.push({
          ...shape,
          opacity: shape.opacity * piece.alpha,
        });
      }
    }
    this.debrisMesh.end();

    this.updateFlowers(flowerShapes, waterGlows);
  }

  private updateSky(time: number): void {
    const { env } = this.game;
    const p = this.palette;
    (this.skyMaterial.uniforms['top']?.value as THREE.Color).setRGB(p.skyTop[0], p.skyTop[1], p.skyTop[2]);
    (this.skyMaterial.uniforms['bottom']?.value as THREE.Color).setRGB(p.skyLow[0], p.skyLow[1], p.skyLow[2]);
    (this.groundMaterial.uniforms['surface']?.value as THREE.Color).setRGB(
      p.soilSurface[0],
      p.soilSurface[1],
      p.soilSurface[2],
    );
    (this.groundMaterial.uniforms['middle']?.value as THREE.Color).setRGB(
      p.soil[0],
      p.soil[1],
      p.soil[2],
    );
    (this.groundMaterial.uniforms['bottom']?.value as THREE.Color).setRGB(p.soilDeep[0], p.soilDeep[1], p.soilDeep[2]);
    (this.rainLines.material as THREE.LineBasicMaterial).color.setRGB(
      p.faint[0],
      p.faint[1],
      p.faint[2],
    );
    for (const water of this.waterPockets) {
      const material = water.material as THREE.MeshBasicMaterial;
      material.color.setRGB(p.water[0], p.water[1], p.water[2]);
      material.opacity = 0.34;
    }

    const viewH = VIEW_HEIGHT;
    const viewW = viewH * this.aspect;
    this.skyGroup.position.set(this.centerX, this.centerY, 0);
    this.skyGroup.scale.setScalar(1 / this.zoom);
    const a = env.bodyAngle;
    const frac = lerp(0.08, 0.92, (1 - Math.cos(a)) / 2);
    const bx = (frac - 0.5) * viewW;
    const by = (-0.18 + Math.sin(a) * 0.9) * (viewH / 2);
    const body = env.isDay ? this.sun : this.moon;
    this.sun.visible = env.isDay;
    this.moon.visible = !env.isDay;
    body.position.set(bx, by, 0);
    body.scale.setScalar(env.isDay ? 11 : 7);
    const bodyMaterial = body.material as THREE.MeshBasicMaterial;
    bodyMaterial.color.setRGB(p.sun[0], p.sun[1], p.sun[2]);
    bodyMaterial.opacity = env.isDay ? clamp(1 - env.cloudCover * 0.55, 0.25, 1) : 0.95;
    this.sun.rotation.z = time * 0.01;

    const starPositions = this.stars.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (starPositions.getZ(0) !== 1) {
      for (let i = 0; i < starPositions.count; i += 1) {
        starPositions.setXYZ(i, starPositions.getX(i) * (viewW / 2), starPositions.getY(i) * (viewH / 2), 1);
      }
      starPositions.needsUpdate = true;
    }
    const starMaterial = this.stars.material as THREE.PointsMaterial;
    starMaterial.color.setRGB(p.ink[0], p.ink[1], p.ink[2]);
    starMaterial.opacity = clamp((env.isDay ? 0 : 1) - env.cloudCover * 0.7, 0, 1) * 0.85;
    this.stars.visible = starMaterial.opacity > 0.02;
  }

  private updateClouds(): void {
    const { env, scenery } = this.game;
    const p = this.palette;
    scenery.clouds.forEach((cloud, i) => {
      const mesh = at(this.clouds, i);
      mesh.position.set(cloud.x, cloud.y, 0);
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.color.setRGB(p.paper[0], p.paper[1], p.paper[2]);
      material.opacity = clamp(0.08 + env.cloudCover * 0.3, 0, 0.36);
    });
  }

  private updateBirds(): void {
    this.birdMesh.begin();
    const half = this.strokeWidth * 0.45;
    for (const bird of this.game.scenery.birds.slice(0, MAX_BIRDS)) {
      const flap = Math.sin(bird.phase) * 0.5;
      const dir = Math.sign(bird.vx);
      const s = bird.size;
      this.birdMesh.addRibbon(
        [
          { x: bird.x - 1.0 * s * dir, y: bird.y + flap * s, r: half, heat: 0, glow: 0 },
          { x: bird.x - 0.42 * s * dir, y: bird.y + flap * 0.3 * s + 0.1 * s, r: half, heat: 0, glow: 0 },
          { x: bird.x, y: bird.y, r: half, heat: 0, glow: 0 },
          { x: bird.x + 0.42 * s * dir, y: bird.y + flap * 0.3 * s + 0.1 * s, r: half, heat: 0, glow: 0 },
          { x: bird.x + 1.0 * s * dir, y: bird.y + flap * s, r: half, heat: 0, glow: 0 },
        ],
        0,
        () => this.palette.ink,
        0.8,
      );
    }
    this.birdMesh.end();
  }

  private updateRays(): void {
    const { rays } = this.game.rays;
    const { env } = this.game;
    const view = this.camera;
    const p = this.palette;
    let n = 0;
    const alpha = 0.6 * clamp(env.sunStrength * 1.6, 0, 1);
    const halfWidth = Math.max(0.02, this.worldPerPixel * 0.9);
    for (const ray of rays) {
      if (n >= MAX_RAYS) {
        break;
      }
      if (ray.x < view.left - 2 || ray.x > view.right + 2 || ray.y < view.bottom - 2 || ray.y > view.top + 2) {
        continue;
      }
      const speed = Math.hypot(ray.vx, ray.vy);
      const dx = ray.vx / speed;
      const dy = ray.vy / speed;
      const tx = ray.x - dx * RAY_LENGTH;
      const ty = ray.y - dy * RAY_LENGTH;
      const nx = -dy * halfWidth;
      const ny = dx * halfWidth;
      this.rayPositions.set([ray.x + nx, ray.y + ny, 0, ray.x - nx, ray.y - ny, 0, tx + nx, ty + ny, 0, tx - nx, ty - ny, 0], n * 12);
      this.rayColors.set([p.sun[0], p.sun[1], p.sun[2], alpha, p.sun[0], p.sun[1], p.sun[2], alpha, p.sun[0], p.sun[1], p.sun[2], 0, p.sun[0], p.sun[1], p.sun[2], 0], n * 16);
      n += 1;
    }
    this.rayGeometry.setDrawRange(0, n * 6);
    (this.rayGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.rayGeometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateRain(dt: number): void {
    const { env, world } = this.game;
    const active = Math.floor(env.rain * MAX_DROPS);
    const view = this.camera;
    const slant = clamp(env.wind * 2.4, -14, 14);
    for (let i = 0; i < MAX_DROPS; i += 1) {
      const drop = at(this.drops, i);
      if (i >= active) {
        this.rainPositions.fill(0, i * 6, i * 6 + 6);
        continue;
      }
      drop.y -= drop.speed * dt;
      drop.x += slant * dt;
      if (drop.y < world.surfaceY(drop.x) || drop.x < view.left - 3 || drop.x > view.right + 3 || drop.y < view.bottom) {
        drop.x = this.rng.range(view.left - 2, view.right + 2);
        drop.y = view.top + this.rng.range(0, 14);
      }
      const p = i * 6;
      this.rainPositions[p] = drop.x;
      this.rainPositions[p + 1] = drop.y;
      this.rainPositions[p + 2] = 0;
      this.rainPositions[p + 3] = drop.x - slant * 0.028;
      this.rainPositions[p + 4] = drop.y + 0.8;
      this.rainPositions[p + 5] = 0;
    }
    (this.rainGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.rainLines.visible = active > 0;
  }

  private updateFlowers(
    shapes: FlowerShape[],
    waterGlows: { x: number; y: number; glow: number }[],
  ): void {
    const p = this.palette;
    const healthy = mix(p.bloom, hex('#f2e5cf'), 0.55);
    const wilted = hex('#92683b');
    const dead = hex('#241b16');
    let n = 0;
    let g = 0;
    for (const f of shapes) {
      if (n >= MAX_FLOWERS) {
        break;
      }
      const size = (0.45 + 1.05 * f.scale) * f.opacity;
      this.tempQuaternion.setFromAxisAngle(this.tempAxis, f.x * 0.9 + f.y * 0.4);
      this.tempPosition.set(f.x, f.y, 0);
      this.tempScale.set(size, size, 1);
      this.matrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
      this.flowerMesh.setMatrixAt(n, this.matrix);
      const conditionColor =
        f.health >= 0.55
          ? mix(wilted, healthy, (f.health - 0.55) / 0.45)
          : mix(dead, wilted, f.health / 0.55);
      const c = mix(conditionColor, p.sun, f.glow * 0.7);
      this.tempColor.setRGB(c[0], c[1], c[2]);
      this.flowerMesh.setColorAt(n, this.tempColor);
      n += 1;
      if (f.glow > 0.02) {
        g = this.addGlow(g, f.x, f.y, 2.6 * f.scale * (0.5 + 0.5 * f.glow), p.sun, f.glow * 0.55);
      }
    }
    for (const w of waterGlows) {
      g = this.addGlow(g, w.x, w.y, 1.5 * (0.5 + 0.5 * w.glow), p.water, w.glow * 0.75);
    }
    this.flowerMesh.count = n;
    this.glowMesh.count = g;
    this.flowerMesh.instanceMatrix.needsUpdate = true;
    this.glowMesh.instanceMatrix.needsUpdate = true;
    if (this.flowerMesh.instanceColor) {
      this.flowerMesh.instanceColor.needsUpdate = true;
    }
    if (this.glowMesh.instanceColor) {
      this.glowMesh.instanceColor.needsUpdate = true;
    }
  }

  private addGlow(index: number, x: number, y: number, size: number, color: Rgb, strength: number): number {
    if (index >= MAX_FLOWERS) {
      return index;
    }
    this.tempPosition.set(x, y, 0);
    this.tempScale.set(size, size, 1);
    this.tempQuaternion.identity();
    this.matrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
    this.glowMesh.setMatrixAt(index, this.matrix);
    this.tempColor.setRGB(color[0] * strength, color[1] * strength, color[2] * strength);
    this.glowMesh.setColorAt(index, this.tempColor);
    return index + 1;
  }

  private circle(cx: number, cy: number, r: number): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  private updateGizmos(view: ViewState, time: number): void {
    const { game } = this;
    const stroke = this.strokeWidth;
    const p = this.palette;
    this.gizmoMesh.begin();

    if (view.seedGhost) {
      const x = view.seedGhost.x;
      const y = this.level.surface(x);
      const color = view.seedGhost.valid ? p.sun : p.bloom;
      const r = 0.7 + Math.sin(time * 3) * 0.06;
      this.gizmoMesh.addLoop(this.circle(x, y + 0.7, r), stroke, color, true);
      this.gizmoMesh.addRibbon(
        [
          { x, y: y + 0.7 + r, r: stroke / 2, heat: 0, glow: 0 },
          { x, y: y + 2.8, r: stroke / 2, heat: 0, glow: 0 },
        ],
        0,
        () => color,
        0.85,
        false,
      );
    }
    if (view.branchRing) {
      this.gizmoMesh.addLoop(this.circle(view.branchRing.x, view.branchRing.y, 0.55), stroke, p.sun, true);
    }

    const limb = game.selectedLimb;
    if (limb && game.tree && limb.kind !== 'twig' && limb.kind !== 'tendril' && !limb.closed) {
      const tip = game.tree.tipSegment(limb);
      const dx = Math.cos(limb.steer);
      const dy = Math.sin(limb.steer);
      const sx = tip.x1;
      const sy = tip.y1;
      const length = 2.6;
      const ex = sx + dx * length;
      const ey = sy + dy * length;
      const color = limb.blocked ? p.bloom : p.sun;
      this.gizmoMesh.addRibbon(
        [
          { x: sx + dx * 0.4, y: sy + dy * 0.4, r: stroke / 2, heat: 0, glow: 0 },
          { x: ex, y: ey, r: stroke / 2, heat: 0, glow: 0 },
        ],
        0,
        () => color,
        0.9,
        false,
      );
      const head = 0.42;
      this.gizmoMesh.addPolygon(
        [
          { x: ex + dx * head, y: ey + dy * head },
          { x: ex - dy * head * 0.5, y: ey + dx * head * 0.5 },
          { x: ex + dy * head * 0.5, y: ey - dx * head * 0.5 },
        ],
        color,
        0.95,
      );
    }
    this.gizmoMesh.end();
  }

  dispose(): void {
    for (const item of this.disposables) {
      item.dispose();
    }
    this.renderer.dispose();
    this.canvas.remove();
  }
}

/** A logarithmic spiral drawn as a ribbon, used for the flourishes in the soil. */
function spiral(cx: number, cy: number, radius: number, direction: number, phase: number, turns: number): RibbonPoint[] {
  const points: RibbonPoint[] = [];
  const steps = Math.ceil(turns * 10);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = phase + direction * t * turns * Math.PI * 2;
    const r = radius * (1 - t * 0.92);
    points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, r: 0.02, heat: 0, glow: 0 });
  }
  return points;
}
