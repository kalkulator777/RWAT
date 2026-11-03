/**
 * One model in the 3D view (docs/proposals/editor.md §3.8): the parts of a
 * {@link LoadedModel} as three.js meshes in the OBJ frame, grouped by object, so that an
 * object moves (`setTransform`), hides (`setVisible`) and lights up (`setLit`) as a whole.
 *
 * - Display "roles": each object in its role's colour (./roleColors.ts), evenly lit;
 *   "textured": as in the game — the texture sampled nearest, cut out where its alpha is
 *   under 0.1, both sides of every face drawn; "lit": the textures in the dark, with the
 *   objects the preview lights glowing at full brightness. A wireframe can be laid on any
 *   of them.
 * - The roles the engine drops (`HIDE`, `skip`, untextured) are see-through ghosts in every
 *   display; they can be hidden as a whole and are never picked.
 * - Picking casts a ray through a BVH of each part (three-mesh-bvh), built when it is first
 *   needed: a model of MVP's size answers every mouse move.
 * - What is hovered is tinted; what is selected is tinted and boxed.
 *
 * A part's texture: the contract's `PartBuffers` has none yet, so the view takes the part's
 * `texture` (pack path) when the model worker gives one, else the texture keyed by the
 * part's material name, else none ({@link textureOf}).
 */

import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  Ray,
  SRGBColorSpace,
  Texture,
} from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { LoadedModel, PartBuffers, Vec3 } from '../core/contracts';
import { boxEdges } from './overlayGeometry';
import { isGhostRole, roleColor } from './roleColors';

/** How the model is painted (core/contracts `ViewApi.setDisplay`). */
export type DisplayMode = 'roles' | 'textured' | 'lit';

export const DISPLAY_MODES: readonly DisplayMode[] = ['roles', 'textured', 'lit'];

/** The view-wide choices that change how every object is drawn. */
export interface ModelLook {
  readonly display: DisplayMode;
  readonly wireframe: boolean;
  /** Draw the dropped roles as ghosts (true) or not at all. */
  readonly ghosts: boolean;
  /** Roles whose objects are not drawn. */
  readonly hiddenRoles: ReadonlySet<string>;
}

export const DEFAULT_LOOK: ModelLook = { display: 'roles', wireframe: false, ghosts: true, hiddenRoles: new Set() };

/** Alpha under which a texel is cut out, as the game's cutout layer. */
export const ALPHA_CUTOUT = 0.1;
/** How see-through a ghost is. */
export const GHOST_OPACITY = 0.18;
/** The colour a part with no texture is drawn in the textured displays. */
const NO_TEXTURE = 0x808080;
/** The tint of the object under the pointer. */
const HOVER_TINT = 0x2a2a2a;
/** The tint of a selected object, and the colour of its box. */
export const SELECTION_COLOR = 0x1d5bbf;
const SELECTION_TINT = new Color(SELECTION_COLOR).multiplyScalar(0.45).getHex();

/** A part as the view may get it: the contract's buffers, perhaps with the pack path of its texture. */
type ViewPart = PartBuffers & { texture?: string | null };

/**
 * The pack path of a part's texture: the part's own `texture` when the model gives one;
 * else its material's name when the model has a texture under that name; else null.
 */
export function textureOf(model: LoadedModel, part: PartBuffers): string | null {
  const own = (part as ViewPart).texture;
  if (own !== undefined) return own;
  return Object.hasOwn(model.textures, part.material) ? part.material : null;
}

/** One object of the model as drawn. */
export interface ObjectNode {
  readonly name: string;
  readonly role: string;
  readonly ghost: boolean;
  /** Holds the object's meshes and its selection box; its matrix is the object's transform. */
  readonly group: Group;
  readonly meshes: readonly Mesh<BufferGeometry, MeshLambertMaterial>[];
  readonly outline: LineSegments;
  /** As the preview set it (`setVisible`). */
  shown: boolean;
  /** As the preview set it (`setLit`). */
  lit: boolean;
}

/** What a ray hit: the object and where, in the OBJ frame, and how far from the ray's start. */
export interface ObjectHit {
  readonly object: string;
  readonly point: Vec3;
  readonly distance: number;
}

function geometryOf(part: PartBuffers): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(part.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(part.normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(part.uvs, 2));
  geometry.computeBoundingBox();
  return geometry;
}

function outlineOf(bbox: readonly [Vec3, Vec3]): LineSegments {
  const pad = 0.02;
  const min: Vec3 = [bbox[0][0] - pad, bbox[0][1] - pad, bbox[0][2] - pad];
  const max: Vec3 = [bbox[1][0] + pad, bbox[1][1] + pad, bbox[1][2] + pad];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(boxEdges(min, max).flat(2)), 3));
  const outline = new LineSegments(geometry, new LineBasicMaterial({ color: SELECTION_COLOR, depthTest: false, transparent: true }));
  outline.renderOrder = 10;
  outline.visible = false;
  return outline;
}

/** A three.js texture of a decoded image, sampled as the game samples it. */
function textureFrom(image: ImageBitmap): Texture {
  const texture = new Texture(image);
  // decoded upright already (createImageBitmap with imageOrientation 'flipY'): an ImageBitmap ignores flipY
  texture.flipY = false;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export class ModelScene {
  /** Everything of the model; its own matrix stays the identity, so world is the OBJ frame. */
  readonly root = new Group();
  private readonly nodes = new Map<string, ObjectNode>();
  private readonly textures = new Map<string, Texture>();
  private readonly partTextures = new Map<Mesh, Texture | null>();
  private readonly bvhs = new WeakMap<BufferGeometry, MeshBVH>();
  private look: ModelLook = DEFAULT_LOOK;
  private hovered: string | null = null;
  private selected: ReadonlySet<string> = new Set();

  constructor(readonly model: LoadedModel) {
    this.root.name = `model:${model.id}`;
    const infos = new Map(model.objects.map((info) => [info.name, info]));
    for (const part of model.parts) {
      let node = this.nodes.get(part.object);
      if (node === undefined) {
        const info = infos.get(part.object);
        const role = info?.role ?? 'body';
        const group = new Group();
        group.name = part.object;
        group.matrixAutoUpdate = false;
        const outline = outlineOf(info?.bbox ?? this.partBox(part));
        group.add(outline);
        node = { name: part.object, role, ghost: isGhostRole(role), group, meshes: [], outline, shown: true, lit: false };
        this.nodes.set(part.object, node);
        this.root.add(group);
      }
      const mesh = new Mesh(geometryOf(part), new MeshLambertMaterial({ side: DoubleSide }));
      mesh.name = `${part.object}/${part.material}`;
      mesh.matrixAutoUpdate = false;
      (node.meshes as Mesh<BufferGeometry, MeshLambertMaterial>[]).push(mesh);
      node.group.add(mesh);
      this.partTextures.set(mesh, this.textureFor(textureOf(model, part)));
    }
    this.applyLook();
  }

  private partBox(part: PartBuffers): [Vec3, Vec3] {
    const box = new Box3().setFromBufferAttribute(new BufferAttribute(part.positions, 3));
    return [box.min.toArray(), box.max.toArray()];
  }

  private textureFor(path: string | null): Texture | null {
    if (path === null) return null;
    const known = this.textures.get(path);
    if (known !== undefined) return known;
    const image = this.model.textures[path];
    if (image === null || image === undefined) return null;
    const texture = textureFrom(image);
    this.textures.set(path, texture);
    return texture;
  }

  /** The objects in the order of their first part. */
  objectNames(): string[] {
    return [...this.nodes.keys()];
  }

  /** One object as drawn, or undefined if the model has no such object. */
  node(name: string): ObjectNode | undefined {
    return this.nodes.get(name);
  }

  /** Changes how every object is drawn. */
  setLook(look: ModelLook): void {
    this.look = look;
    this.applyLook();
  }

  /** The object's transform in the OBJ frame, column-major; null is the rest pose. */
  setTransform(name: string, matrix: ArrayLike<number> | null): void {
    const node = this.nodes.get(name);
    if (node === undefined) return;
    if (matrix === null) node.group.matrix.identity();
    else node.group.matrix.fromArray(Array.from(matrix));
    node.group.matrixWorldNeedsUpdate = true;
  }

  setVisible(name: string, visible: boolean): void {
    const node = this.nodes.get(name);
    if (node === undefined) return;
    node.shown = visible;
    this.applyNode(node);
  }

  setLit(name: string, lit: boolean): void {
    const node = this.nodes.get(name);
    if (node === undefined) return;
    node.lit = lit;
    this.applyNode(node);
  }

  /** The object under the pointer (tinted) and the selected objects (tinted and boxed). */
  setHighlight(hovered: string | null, selected: ReadonlySet<string>): void {
    const before = new Set([this.hovered, hovered, ...this.selected, ...selected]);
    this.hovered = hovered;
    this.selected = selected;
    for (const name of before) {
      const node = name === null ? undefined : this.nodes.get(name);
      if (node !== undefined) this.applyNode(node);
    }
  }

  /** True if the object is drawn now: shown by the preview, its role not hidden, not a hidden ghost. */
  isDrawn(name: string): boolean {
    const node = this.nodes.get(name);
    return node !== undefined && this.drawn(node);
  }

  private drawn(node: ObjectNode): boolean {
    return node.shown && !this.look.hiddenRoles.has(node.role) && (!node.ghost || this.look.ghosts);
  }

  private applyLook(): void {
    for (const node of this.nodes.values()) this.applyNode(node, true);
  }

  private applyNode(node: ObjectNode, rebuild = false): void {
    node.group.visible = this.drawn(node);
    const selected = this.selected.has(node.name);
    node.outline.visible = selected;
    const { display, wireframe } = this.look;
    const textured = display !== 'roles' && !node.ghost;
    const glowing = display === 'lit' && node.lit && !node.ghost;
    const tint = selected ? SELECTION_TINT : this.hovered === node.name ? HOVER_TINT : 0x000000;
    for (const mesh of node.meshes) {
      const material = mesh.material;
      const map = textured ? (this.partTextures.get(mesh) ?? null) : null;
      if (rebuild || material.map !== map) {
        material.map = map;
        material.color.set(textured ? (map === null ? NO_TEXTURE : 0xffffff) : roleColor(node.role));
        material.transparent = node.ghost;
        material.opacity = node.ghost ? GHOST_OPACITY : 1;
        material.depthWrite = !node.ghost;
        material.alphaTest = map === null ? 0 : ALPHA_CUTOUT;
        material.wireframe = wireframe;
        material.needsUpdate = true;
      }
      // a lit object shines its own texture (or colour) at full brightness; the rest take the highlight's tint
      const emissiveMap = glowing ? map : null;
      if (material.emissiveMap !== emissiveMap) {
        material.emissiveMap = emissiveMap;
        material.needsUpdate = true;
      }
      if (glowing && map === null) material.emissive.copy(material.color);
      else material.emissive.set(glowing ? 0xffffff : tint);
    }
  }

  /**
   * The nearest object the ray hits among those drawn, ghosts aside, with the point in
   * the OBJ frame; null if it hits none.
   */
  pick(ray: Ray): ObjectHit | null {
    this.root.updateMatrixWorld();
    let best: ObjectHit | null = null;
    const local = new Ray();
    const inverse = new Matrix4();
    for (const node of this.nodes.values()) {
      if (node.ghost || !this.drawn(node)) continue;
      for (const mesh of node.meshes) {
        const geometry = mesh.geometry;
        const bvh = this.bvhOf(geometry);
        local.copy(ray).applyMatrix4(inverse.copy(mesh.matrixWorld).invert());
        const hit = bvh.raycastFirst(local, DoubleSide);
        if (hit === null) continue;
        const point = hit.point.clone().applyMatrix4(mesh.matrixWorld);
        const distance = point.distanceTo(ray.origin);
        if (best === null || distance < best.distance) best = { object: node.name, point: point.toArray(), distance };
      }
    }
    return best;
  }

  /** The part's BVH, built the first time a ray needs it. */
  private bvhOf(geometry: BufferGeometry): MeshBVH {
    let bvh = this.bvhs.get(geometry);
    if (bvh === undefined) {
      bvh = new MeshBVH(geometry);
      this.bvhs.set(geometry, bvh);
    }
    return bvh;
  }

  /**
   * The box around the objects drawn now, as they stand (transforms applied), in the OBJ
   * frame: of the named ones when names are given, else of the whole model. Empty when
   * none of them is drawn.
   */
  bounds(names?: Iterable<string>): Box3 {
    this.root.updateMatrixWorld();
    const box = new Box3();
    const wanted = names === undefined ? this.nodes.keys() : names;
    for (const name of wanted) {
      const node = this.nodes.get(name);
      if (node === undefined || !this.drawn(node)) continue;
      for (const mesh of node.meshes) {
        const part = mesh.geometry.boundingBox;
        if (part !== null) box.union(part.clone().applyMatrix4(mesh.matrixWorld));
      }
    }
    return box;
  }

  /** Frees the GPU's copies: geometries, materials, textures. */
  dispose(): void {
    for (const node of this.nodes.values()) {
      for (const mesh of node.meshes) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      node.outline.geometry.dispose();
      (node.outline.material as LineBasicMaterial).dispose();
    }
    for (const texture of this.textures.values()) texture.dispose();
    this.root.clear();
  }
}
