import { describe, it, expect, vi } from "vitest";
import {
  setObject3DTransform,
  getObject3DTransform,
  bindBlockIdToObject3D,
  bindMountIdToObject3D,
  findBlockIdOnObject3D,
  findMountIdOnObject3D,
  raycastHitFromThreeIntersection,
  ThreeMachineBinder,
  ThreeObject3DLike,
} from "../integrations/three.js";
import { QUAT_IDENTITY, TRANSFORM_IDENTITY, vec3, transform } from "../math.js";

function mockObject3D(userData: Record<string, unknown> = {}, parent?: ThreeObject3DLike): ThreeObject3DLike {
  return {
    position: { x: 0, y: 0, z: 0, set: vi.fn().mockImplementation(function (this: any, x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }) },
    quaternion: { x: 0, y: 0, z: 0, w: 1, set: vi.fn().mockImplementation(function (this: any, x: number, y: number, z: number, w: number) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }) },
    userData,
    parent,
  };
}

describe("setObject3DTransform / getObject3DTransform", () => {
  it("sets and gets transform on object", () => {
    const obj = mockObject3D();
    const t = transform(vec3(1, 2, 3), QUAT_IDENTITY);
    setObject3DTransform(obj, t);
    expect(obj.position.set).toHaveBeenCalledWith(1, 2, 3);
    expect(obj.quaternion.set).toHaveBeenCalledWith(0, 0, 0, 1);
  });

  it("reads transform back", () => {
    const obj = mockObject3D();
    setObject3DTransform(obj, transform(vec3(5, 6, 7), QUAT_IDENTITY));
    const t = getObject3DTransform(obj);
    expect(t.position.x).toBe(5);
    expect(t.position.y).toBe(6);
    expect(t.position.z).toBe(7);
  });
});

describe("bindBlockIdToObject3D / findBlockIdOnObject3D", () => {
  it("binds and finds block id", () => {
    const obj = mockObject3D();
    bindBlockIdToObject3D(obj, "block-1");
    expect(findBlockIdOnObject3D(obj)).toBe("block-1");
  });

  it("traverses parent chain", () => {
    const parent = mockObject3D({ snapBlockId: "parent-block" });
    const child = mockObject3D({}, parent);
    expect(findBlockIdOnObject3D(child)).toBe("parent-block");
  });

  it("returns undefined when not found", () => {
    expect(findBlockIdOnObject3D(mockObject3D())).toBeUndefined();
    expect(findBlockIdOnObject3D(undefined)).toBeUndefined();
  });
});

describe("bindMountIdToObject3D / findMountIdOnObject3D", () => {
  it("binds and finds mount id", () => {
    const obj = mockObject3D();
    bindMountIdToObject3D(obj, "mount-1");
    expect(findMountIdOnObject3D(obj)).toBe("mount-1");
  });

  it("traverses parent chain", () => {
    const parent = mockObject3D({ snapMountId: "parent-mount" });
    const child = mockObject3D({}, parent);
    expect(findMountIdOnObject3D(child)).toBe("parent-mount");
  });

  it("returns undefined when not found", () => {
    expect(findMountIdOnObject3D(mockObject3D())).toBeUndefined();
  });
});

describe("raycastHitFromThreeIntersection", () => {
  it("converts intersection with block id", () => {
    const obj = mockObject3D({ snapBlockId: "b1" });
    const hit = raycastHitFromThreeIntersection({
      point: { x: 1, y: 2, z: 3 },
      face: { normal: { x: 0, y: 1, z: 0 } },
      object: obj,
    });
    expect(hit).not.toBeNull();
    expect(hit!.blockId).toBe("b1");
    expect(hit!.point).toEqual({ x: 1, y: 2, z: 3 });
    expect(hit!.normal).toEqual({ x: 0, y: 1, z: 0 });
  });

  it("returns null when no block id found", () => {
    const obj = mockObject3D();
    const hit = raycastHitFromThreeIntersection({
      point: { x: 0, y: 0, z: 0 },
      object: obj,
    });
    expect(hit).toBeNull();
  });
});

describe("ThreeMachineBinder", () => {
  it("binds, syncs, and unbinds objects", () => {
    const binder = new ThreeMachineBinder();
    const obj = mockObject3D();
    binder.bind("mount-1", obj);

    const provider = {
      getMountWorldTransform: vi.fn().mockReturnValue(transform(vec3(10, 20, 30), QUAT_IDENTITY)),
    };
    binder.sync(provider);
    expect(provider.getMountWorldTransform).toHaveBeenCalledWith("mount-1");
    expect(obj.position.set).toHaveBeenCalledWith(10, 20, 30);

    binder.unbind("mount-1");
    provider.getMountWorldTransform.mockClear();
    binder.sync(provider);
    expect(provider.getMountWorldTransform).not.toHaveBeenCalled();
  });
});
