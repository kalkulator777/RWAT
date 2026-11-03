/**
 * One model in the 3D view (docs/proposals/editor.md §3.8): the parts of a
 * {@link LoadedModel} as three.js meshes in the OBJ frame, grouped by object, so that an
 * object moves (`setTransform`), hides (`setVisible`) and lights up (`setLit`) as a whole.
 *
 * - Display "roles": each part in its role's colour (./roleColors.ts), evenly lit;
 *   "textured": as in the game — the part's texture sampled nearest, cut out where its
 *   alpha is under 0.1, both sides of every face drawn; "lit": the textures in the dark,
 *   with the objects the preview lights glowing at full brightness. A wireframe can be laid
 *   on any of them.
 * - The parts the engine does not draw (`PartBuffers.drawn` false: `HIDE`, `skip`, no
 *   texture) are see-through ghosts in every display; they can be hidden as a whole and are
 *   never picked. Parts of the roles the bar hides are not drawn either.
 * - A texture's picture is the model's own, or one put in its place (`setTexture`: a
 *   livery's), until the next model.
 * - Picking casts a ray through a BVH of each part (three-mesh-bvh), built when it is first
 *   needed: a model of MVP's size answers every mouse move.
 * - What is hovered is tinted; what is selected is tinted and boxed.
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
import type { DisplayMode, LoadedModel, PartBuffers, Vec3 } from '../core/contracts';
import { boxEdges } from './overlayGeometry';
import { roleColor } from './roleColors';

export type { DisplayMode } from '../core/contracts';

export const DISPLAY_MODES: readonly DisplayMode[] = ['roles', 'textured', 'lit'];

/** The view-wide choices that change how every object is drawn. */
export interface ModelLook {
  readonly display: DisplayMode;
  readonly wireframe: boolean;
  /** Draw the parts the engine drops as ghosts (true) or not at all. */
  readonly ghosts: boolean;
  /** Roles whose parts are not drawn. */
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

/** A mesh of one part, with what of the part its look depends on. */
export interface PartMesh {
  readonly mesh: Mesh<BufferGeometry, MeshLambertMaterial>;
  /** The part's role: its colour in the "roles" display, and whether the bar hides it. */
  readonly role: string;
  /** The engine does not draw it: a ghost. */
  readonly ghost: boolean;
  /** Its texture's pack path, null for none. */
  readonly texture: string | null;
}

/** One object of the model as drawn. */
export interface ObjectNode {
  readonly name: string;
  /** The object's role (`ObjectInfo.role`): what the status line and the objects tab name. */
  readonly role: string;
  /** Every part of it is a ghost: the engine draws nothing of it. */
  readonly ghost: boolean;
  /** Holds the object's meshes and its selection box; its matrix is the object's transform. */
  readonly group: Group;
  readonly parts: readonly PartMesh[];
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
  // decoded upside down already (createImageBitmap with imageOrientation 'flipY'), so the
  // OBJ's V samples it as the file is drawn; an ImageBitmap ignores three's flipY anyway
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
  /** Each texture's three.js texture, by pack path; null when it has no picture. */
  private readonly textures = new Map<string, Texture | null>();
  private readonly bvhs = new WeakMap<BufferGeometry, MeshBVH>();
  private look: ModelLook = DEFAULT_LOOK;
  private hovered: string | null = null;
  private selected: ReadonlySet<string> = new Set();

  /**
   * @param pictures the picture each texture is drawn with at first, by pack path: the
   *   model's own (the default), or what the view was told to draw it with since
   */
  constructor(
    readonly model: LoadedModel,
    pictures: (path: string) => ImageBitmap | null = (path) => model.textures[path] ?? null,
  ) {
    this.root.name = `model:${model.id}`;
    const infos = new Map(model.objects.map((info) => [info.name, info]));
    const groups = new Map<string, { group: Group; parts: PartMesh[]; bbox: [Vec3, Vec3] | undefined }>();
    for (const part of model.parts) {
      let entry = groups.get(part.object);
      if (entry === undefined) {
        const group = new Group();
        group.name = part.object;
        group.matrixAutoUpdate = false;
        entry = { group, parts: [], bbox: infos.get(part.object)?.bbox };
        groups.set(part.object, entry);
        this.root.add(group);
      }
      const mesh = new Mesh(geometryOf(part), new MeshLambertMaterial({ side: DoubleSide }));
      mesh.name = `${part.object}/${part.material}`;
      mesh.matrixAutoUpdate = false;
      entry.group.add(mesh);
      entry.parts.push({ mesh, role: part.role, ghost: !part.drawn, texture: part.texture });
      if (part.texture !== null && !this.textures.has(part.texture)) this.textures.set(part.texture, this.textureFrom(pictures(part.texture)));
    }
    for (const [name, { group, parts, bbox }] of groups) {
      const outline = outlineOf(bbox ?? this.partsBox(parts));
      group.add(outline);
      const role = infos.get(name)?.role ?? parts[0]?.role ?? 'body';
      const ghost = parts.every((part) => part.ghost);
      this.nodes.set(name, { name, role, ghost, group, parts, meshes: parts.map((part) => part.mesh), outline, shown: true, lit: false });
    }
    this.applyLook();
  }

  private partsBox(parts: readonly PartMesh[]): [Vec3, Vec3] {
    const box = new Box3();
    for (const { mesh } of parts) if (mesh.geometry.boundingBox !== null) box.union(mesh.geometry.boundingBox);
    return [box.min.toArray(), box.max.toArray()];
  }

  private textureFrom(image: ImageBitmap | null): Texture | null {
    return image === null ? null : textureFrom(image);
  }

  /** The objects in the order of their first part. */
  objectNames(): string[] {
    return [...this.nodes.keys()];
  }

  /** One object as drawn, or undefined if the model has no such object. */
  node(name: string): ObjectNode | undefined {
    return this.nodes.get(name);
  }

  /** The three.js texture a texture's parts sample now; null for none (they are drawn grey), undefined if no part uses it. */
  texture(path: string): Texture | null | undefined {
    return this.textures.get(path);
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

  /** Draws the parts of texture `path` with another picture (null: none); a texture no part uses is ignored. */
  setTexture(path: string, image: ImageBitmap | null): void {
    const old = this.textures.get(path);
    if (old === undefined) return;
    if (old !== null && old.image === image) return;
    old?.dispose();
    this.textures.set(path, this.textureFrom(image));
    for (const node of this.nodes.values()) if (node.parts.some((part) => part.texture === path)) this.applyNode(node);
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

  /** True if something of the object is drawn now: shown by the preview, a part of it not of a hidden role nor a hidden ghost. */
  isDrawn(name: string): boolean {
    const node = this.nodes.get(name);
    return node !== undefined && node.shown && node.parts.some((part) => this.partShown(part));
  }

  private partShown(part: PartMesh): boolean {
    return !this.look.hiddenRoles.has(part.role) && (!part.ghost || this.look.ghosts);
  }

  private applyLook(): void {
    for (const node of this.nodes.values()) this.applyNode(node, true);
  }

  private applyNode(node: ObjectNode, rebuild = false): void {
    node.group.visible = node.shown;
    const selected = this.selected.has(node.name);
    node.outline.visible = selected && this.isDrawn(node.name);
    const { display, wireframe } = this.look;
    const tint = selected ? SELECTION_TINT : this.hovered === node.name ? HOVER_TINT : 0x000000;
    for (const part of node.parts) {
      const { mesh, ghost } = part;
      mesh.visible = this.partShown(part);
      const material = mesh.material;
      const textured = display !== 'roles' && !ghost;
      const glowing = display === 'lit' && node.lit && !ghost;
      const map = textured && part.texture !== null ? (this.textures.get(part.texture) ?? null) : null;
      if (rebuild || material.map !== map) {
        material.map = map;
        material.color.set(textured ? (map === null ? NO_TEXTURE : 0xffffff) : roleColor(part.role));
        material.transparent = ghost;
        material.opacity = ghost ? GHOST_OPACITY : 1;
        material.depthWrite = !ghost;
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
   * The nearest object the ray hits among the parts drawn, ghosts aside, with the point in
   * the OBJ frame; null if it hits none.
   */
  pick(ray: Ray): ObjectHit | null {
    this.root.updateMatrixWorld();
    let best: ObjectHit | null = null;
    const local = new Ray();
    const inverse = new Matrix4();
    for (const node of this.nodes.values()) {
      if (!node.shown) continue;
      for (const part of node.parts) {
        if (part.ghost || !this.partShown(part)) continue;
        const { mesh } = part;
        const bvh = this.bvhOf(mesh.geometry);
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
   * The box around the parts drawn now, as they stand (transforms applied), in the OBJ
   * frame: of the named objects when names are given, else of the whole model. Empty when
   * nothing of them is drawn.
   */
  bounds(names?: Iterable<string>): Box3 {
    this.root.updateMatrixWorld();
    const box = new Box3();
    const wanted = names === undefined ? this.nodes.keys() : names;
    for (const name of wanted) {
      const node = this.nodes.get(name);
      if (node === undefined || !node.shown) continue;
      for (const part of node.parts) {
        if (!this.partShown(part)) continue;
        const bounds = part.mesh.geometry.boundingBox;
        if (bounds !== null) box.union(bounds.clone().applyMatrix4(part.mesh.matrixWorld));
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
    for (const texture of this.textures.values()) texture?.dispose();
    this.textures.clear();
    this.root.clear();
  }
}
