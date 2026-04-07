/**
 * First-person character controller using Rapier's KinematicCharacterController.
 *
 * Creates a capsule collider for the player and handles:
 * - WASD movement relative to camera yaw
 * - Mouse look via Pointer Lock API
 * - Gravity + ground detection for jumping
 * - Camera positioned at eye height inside the capsule
 */
import { useRef, useEffect, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

export interface PlayerControllerProps {
  world: RAPIER.World;
  RAPIER: typeof RAPIER;
  /** Spawn position for the player */
  spawnPosition?: [number, number, number];
}

const CAPSULE_RADIUS = 0.3;
const CAPSULE_HALF_HEIGHT = 0.5;
const EYE_HEIGHT = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.1; // ~0.9 above body center
const MOVE_SPEED = 5;
const JUMP_VELOCITY = 5;
const GRAVITY = -9.81;
const MOUSE_SENSITIVITY = 0.002;
const GROUND_OFFSET = 0.08; // character controller skin width
const MAX_PITCH = Math.PI / 2 - 0.05;
const PUSH_FORCE = 8; // impulse strength when pushing dynamic bodies (e.g. doors)

export function PlayerController({ world, RAPIER: R, spawnPosition = [0, 2, 6] }: PlayerControllerProps) {
  const { camera, gl } = useThree();

  const bodyRef = useRef<RAPIER.RigidBody | null>(null);
  const colliderRef = useRef<RAPIER.Collider | null>(null);
  const controllerRef = useRef<RAPIER.KinematicCharacterController | null>(null);

  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const verticalVelocity = useRef(0);
  const keysRef = useRef(new Set<string>());
  const lockedRef = useRef(false);

  // Create physics body and character controller
  useEffect(() => {
    const bodyDesc = R.RigidBodyDesc.kinematicPositionBased().setTranslation(
      spawnPosition[0],
      spawnPosition[1],
      spawnPosition[2],
    );
    const body = world.createRigidBody(bodyDesc);

    const colliderDesc = R.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS);
    const collider = world.createCollider(colliderDesc, body);

    const controller = world.createCharacterController(GROUND_OFFSET);
    controller.enableAutostep(0.3, 0.2, true);
    controller.enableSnapToGround(0.3);
    controller.setSlideEnabled(true);

    bodyRef.current = body;
    colliderRef.current = collider;
    controllerRef.current = controller;

    // Initialize camera direction to look toward house center
    yawRef.current = Math.PI; // face -Z
    pitchRef.current = 0;

    return () => {
      world.removeCharacterController(controller);
      world.removeCollider(collider, false);
      world.removeRigidBody(body);
      bodyRef.current = null;
      colliderRef.current = null;
      controllerRef.current = null;
    };
  }, [world, R]);

  // Keyboard handlers
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      keysRef.current.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Pointer lock for mouse look
  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!lockedRef.current) return;
    yawRef.current -= e.movementX * MOUSE_SENSITIVITY;
    pitchRef.current -= e.movementY * MOUSE_SENSITIVITY;
    pitchRef.current = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitchRef.current));
  }, []);

  useEffect(() => {
    const canvas = gl.domElement;

    const onLockChange = () => {
      lockedRef.current = document.pointerLockElement === canvas;
    };
    const onClick = () => {
      if (!lockedRef.current) {
        canvas.requestPointerLock();
      }
    };

    canvas.addEventListener("click", onClick);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousemove", onMouseMove);

    return () => {
      canvas.removeEventListener("click", onClick);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMouseMove);
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock();
      }
    };
  }, [gl, onMouseMove]);

  // Movement + camera update each frame
  useFrame((_state, delta) => {
    const body = bodyRef.current;
    const collider = colliderRef.current;
    const controller = controllerRef.current;
    if (!body || !collider || !controller) return;

    const dt = Math.min(delta, 1 / 30);
    const keys = keysRef.current;

    // Compute movement direction relative to yaw
    let moveX = 0;
    let moveZ = 0;
    if (keys.has("w") || keys.has("arrowup")) moveZ -= 1;
    if (keys.has("s") || keys.has("arrowdown")) moveZ += 1;
    if (keys.has("a") || keys.has("arrowleft")) moveX -= 1;
    if (keys.has("d") || keys.has("arrowright")) moveX += 1;

    const yaw = yawRef.current;
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);

    // Transform movement from player-local to world space (Y-up, yaw rotation)
    const worldMoveX = moveX * cosYaw - moveZ * sinYaw;
    const worldMoveZ = moveX * sinYaw + moveZ * cosYaw;

    // Normalize diagonal movement
    const len = Math.sqrt(worldMoveX * worldMoveX + worldMoveZ * worldMoveZ);
    const nx = len > 0 ? (worldMoveX / len) * MOVE_SPEED : 0;
    const nz = len > 0 ? (worldMoveZ / len) * MOVE_SPEED : 0;

    // Gravity + jump
    const grounded = controller.computedGrounded();
    if (grounded) {
      verticalVelocity.current = 0;
      if (keys.has(" ")) {
        verticalVelocity.current = JUMP_VELOCITY;
      }
    } else {
      verticalVelocity.current += GRAVITY * dt;
    }

    const desiredMovement = new R.Vector3(
      nx * dt,
      verticalVelocity.current * dt,
      nz * dt,
    );

    controller.computeColliderMovement(collider, desiredMovement);

    // Push dynamic bodies the player collides with (e.g. the door)
    for (let i = 0; i < controller.numComputedCollisions(); i++) {
      const collision = controller.computedCollision(i);
      if (!collision) continue;
      const hitCollider = collision.collider;
      if (!hitCollider) continue;
      const hitBody = hitCollider.parent();
      if (!hitBody || !hitBody.isDynamic()) continue;

      // Apply impulse in the player's movement direction
      const impulse = new R.Vector3(
        nx * dt * PUSH_FORCE,
        0,
        nz * dt * PUSH_FORCE,
      );
      hitBody.applyImpulse(impulse, true);
    }

    const corrected = controller.computedMovement();

    const pos = body.translation();
    body.setNextKinematicTranslation(
      new R.Vector3(
        pos.x + corrected.x,
        pos.y + corrected.y,
        pos.z + corrected.z,
      ),
    );

    // Update camera to eye position
    const bodyPos = body.translation();
    camera.position.set(bodyPos.x, bodyPos.y + EYE_HEIGHT, bodyPos.z);

    // Apply yaw + pitch to camera
    const euler = new THREE.Euler(pitchRef.current, yawRef.current, 0, "YXZ");
    camera.quaternion.setFromEuler(euler);
  });

  // Render a visible capsule mesh for the player body (only visible in 3rd person / debug)
  // In first person we don't render it since the camera is inside
  return null;
}
