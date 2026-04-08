import { RaycastHit } from "../snap.js";
import { Transform, Vec3, Quat, transform } from "../math.js";

export interface ThreeVector3Like {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): this;
}

export interface ThreeQuaternionLike {
  x: number;
  y: number;
  z: number;
  w: number;
  set(x: number, y: number, z: number, w: number): this;
}

export interface ThreeObject3DLike {
  position: ThreeVector3Like;
  quaternion: ThreeQuaternionLike;
  userData: Record<string, unknown>;
  parent?: ThreeObject3DLike;
}

export interface ThreeIntersectionLike {
  point: Vec3;
  face?: { normal: Vec3 };
  object: ThreeObject3DLike;
}

export interface PartTransformProvider {
  getMountWorldTransform(mountId: string): Transform;
}

const BLOCK_ID_KEYS = ["snapBlockId", "blockId"] as const;
const MOUNT_ID_KEYS = ["snapMountId", "mountId"] as const;

export function setObject3DTransform(object: ThreeObject3DLike, worldTransform: Transform): void {
  object.position.set(worldTransform.position.x, worldTransform.position.y, worldTransform.position.z);
  object.quaternion.set(
    worldTransform.rotation.x,
    worldTransform.rotation.y,
    worldTransform.rotation.z,
    worldTransform.rotation.w,
  );
}

export function getObject3DTransform(object: ThreeObject3DLike): Transform {
  return transform(
    { x: object.position.x, y: object.position.y, z: object.position.z },
    { x: object.quaternion.x, y: object.quaternion.y, z: object.quaternion.z, w: object.quaternion.w },
  );
}

export function bindBlockIdToObject3D(object: ThreeObject3DLike, blockId: string): void {
  object.userData.snapBlockId = blockId;
}

export function bindMountIdToObject3D(object: ThreeObject3DLike, mountId: string): void {
  object.userData.snapMountId = mountId;
}

export function findBlockIdOnObject3D(object: ThreeObject3DLike | undefined): string | undefined {
  let current = object;
  while (current) {
    for (const key of BLOCK_ID_KEYS) {
      const value = current.userData[key];
      if (typeof value === "string") {
        return value;
      }
    }
    current = current.parent;
  }
  return undefined;
}

export function findMountIdOnObject3D(object: ThreeObject3DLike | undefined): string | undefined {
  let current = object;
  while (current) {
    for (const key of MOUNT_ID_KEYS) {
      const value = current.userData[key];
      if (typeof value === "string") {
        return value;
      }
    }
    current = current.parent;
  }
  return undefined;
}

export function raycastHitFromThreeIntersection(intersection: ThreeIntersectionLike): RaycastHit | null {
  const blockId = findBlockIdOnObject3D(intersection.object);
  if (!blockId) {
    return null;
  }
  return {
    blockId,
    point: { ...intersection.point },
    normal: intersection.face ? { ...intersection.face.normal } : undefined,
  };
}

export class ThreeMachineBinder {
  private readonly objectsByMountId = new Map<string, ThreeObject3DLike>();

  bind(mountId: string, object: ThreeObject3DLike): void {
    bindMountIdToObject3D(object, mountId);
    this.objectsByMountId.set(mountId, object);
  }

  unbind(mountId: string): void {
    this.objectsByMountId.delete(mountId);
  }

  sync(provider: PartTransformProvider): void {
    for (const [mountId, object] of this.objectsByMountId) {
      setObject3DTransform(object, provider.getMountWorldTransform(mountId));
    }
  }
}
