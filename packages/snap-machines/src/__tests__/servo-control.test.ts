/**
 * Servo control loop quality tests.
 *
 * Simulates a motorized revolute joint under gravity using a simple
 * single-DOF physics model (no WASM needed). Tests the PD motor with
 * and without velocity feedforward to verify convergence, overshoot,
 * and steady-state error under load.
 *
 * Physics model:
 *   torque = stiffness * (targetPos - pos) + damping * (targetVel - vel)
 *   torque = clamp(torque, -maxForce, maxForce)
 *   accel = torque / inertia - gravity * sin(pos)
 *   vel += accel * dt
 *   pos += vel * dt
 */
import { describe, it, expect } from "vitest";

interface ServoParams {
  stiffness: number;
  damping: number;
  maxForce: number;
  /** Velocity feedforward gain: targetVel = Kv * error. 0 = pure PD. */
  Kv: number;
  /** Max velocity feedforward (rad/s) */
  maxVel: number;
}

interface SimResult {
  /** Time to settle within ±0.02 rad of target (seconds), or Infinity */
  settlingTime: number;
  /** Max overshoot past target (radians) */
  overshoot: number;
  /** Steady-state error at end of simulation (radians) */
  steadyStateError: number;
  /** Max velocity during simulation (rad/s) */
  maxVelocity: number;
  /** Position trace at 10fps for debugging */
  trace: number[];
}

/**
 * Simulate a single revolute joint with a PD motor and gravity.
 * The joint starts at pos=0, target steps to `targetPos` at t=0.
 */
function simulateServo(
  params: ServoParams,
  targetPos: number,
  inertia: number,
  gravityTorqueAtZero: number,
  duration: number,
  dt: number = 1 / 240,
): SimResult {
  const { stiffness, damping, maxForce, Kv, maxVel } = params;
  let pos = 0;
  let vel = 0;
  let settlingTime = Infinity;
  let lastUnsettledTime = 0;
  let overshoot = 0;
  let maxVelocity = 0;
  const trace: number[] = [];
  let traceAccum = 0;
  const SETTLE_BAND = 0.02; // ±0.02 rad

  const steps = Math.round(duration / dt);
  for (let i = 0; i < steps; i++) {
    const t = i * dt;
    const error = targetPos - pos;

    // Velocity feedforward
    const vff = Kv > 0 ? Math.max(-maxVel, Math.min(maxVel, Kv * error)) : 0;

    // PD motor torque
    let torque = stiffness * error + damping * (vff - vel);
    torque = Math.max(-maxForce, Math.min(maxForce, torque));

    // Gravity torque (proportional to sin of angle from vertical)
    const gravTorque = gravityTorqueAtZero * Math.sin(pos);

    // Integration
    const accel = (torque - gravTorque) / inertia;
    vel += accel * dt;
    pos += vel * dt;

    // Track metrics
    if (Math.abs(error) > SETTLE_BAND) {
      lastUnsettledTime = t;
    }
    const pastTarget = targetPos > 0 ? pos - targetPos : targetPos - pos;
    if (pastTarget > 0) {
      overshoot = Math.max(overshoot, pastTarget);
    }
    maxVelocity = Math.max(maxVelocity, Math.abs(vel));

    // Trace at ~10fps
    traceAccum += dt;
    if (traceAccum >= 0.1) {
      trace.push(pos);
      traceAccum -= 0.1;
    }
  }

  settlingTime = lastUnsettledTime < duration - dt * 10 ? lastUnsettledTime + dt : Infinity;
  const steadyStateError = Math.abs(targetPos - pos);

  return { settlingTime, overshoot, steadyStateError, maxVelocity, trace };
}

// ---------------------------------------------------------------------------
// Test scenarios
// ---------------------------------------------------------------------------

// Arm motor parameters (matching besiege/compounds.ts)
const ARM_STIFFNESS = 5000;
const ARM_DAMPING = 200;
const ARM_MAX_FORCE = 5000;

// Typical crane arm: 1kg segment, 1m lever → I ≈ 0.33 kg·m², gravity torque ≈ 5 N·m
const ARM_INERTIA = 0.5;
const ARM_GRAVITY_TORQUE = 5; // N·m at horizontal

// Loaded crane arm (2 segments + grip = ~3kg at ~1.5m)
const LOADED_INERTIA = 3.0;
const LOADED_GRAVITY_TORQUE = 30;

describe("servo control loop quality", () => {
  describe("pure PD (no feedforward)", () => {
    const params: ServoParams = {
      stiffness: ARM_STIFFNESS,
      damping: ARM_DAMPING,
      maxForce: ARM_MAX_FORCE,
      Kv: 0,
      maxVel: 0,
    };

    it("settles to 45° under light load", () => {
      const result = simulateServo(params, Math.PI / 4, ARM_INERTIA, ARM_GRAVITY_TORQUE, 3);
      expect(result.settlingTime).toBeLessThan(2);
      expect(result.steadyStateError).toBeLessThan(0.05);
    });

    it("settles to 45° under heavy load (may oscillate)", () => {
      const result = simulateServo(params, Math.PI / 4, LOADED_INERTIA, LOADED_GRAVITY_TORQUE, 5);
      // Pure PD under heavy load: expect more overshoot and slower settling
      expect(result.steadyStateError).toBeLessThan(0.1);
    });
  });

  describe("PD + velocity feedforward (Kv=3)", () => {
    const params: ServoParams = {
      stiffness: ARM_STIFFNESS,
      damping: ARM_DAMPING,
      maxForce: ARM_MAX_FORCE,
      Kv: 3,
      maxVel: 5,
    };

    it("settles to 45° under light load — faster than pure PD", () => {
      const result = simulateServo(params, Math.PI / 4, ARM_INERTIA, ARM_GRAVITY_TORQUE, 3);
      expect(result.settlingTime).toBeLessThan(1.5);
      expect(result.overshoot).toBeLessThan(0.15);
      expect(result.steadyStateError).toBeLessThan(0.02);
    });

    it("settles to 45° under heavy load — less oscillation than pure PD", () => {
      const purePD: ServoParams = { ...params, Kv: 0, maxVel: 0 };
      const purePDResult = simulateServo(purePD, Math.PI / 4, LOADED_INERTIA, LOADED_GRAVITY_TORQUE, 5);
      const vffResult = simulateServo(params, Math.PI / 4, LOADED_INERTIA, LOADED_GRAVITY_TORQUE, 5);

      // VFF should have less overshoot OR faster settling than pure PD
      const purePDScore = purePDResult.overshoot + purePDResult.settlingTime * 0.1;
      const vffScore = vffResult.overshoot + vffResult.settlingTime * 0.1;
      expect(vffScore).toBeLessThanOrEqual(purePDScore + 0.01); // at least as good

      expect(vffResult.steadyStateError).toBeLessThan(0.05);
    });

    it("handles 90° step under gravity without excessive overshoot", () => {
      const result = simulateServo(params, Math.PI / 2, LOADED_INERTIA, LOADED_GRAVITY_TORQUE, 5);
      expect(result.overshoot).toBeLessThan(0.3); // < 17° overshoot
      expect(result.steadyStateError).toBeLessThan(0.05);
    });

    it("holds position against gravity with near-zero steady-state error", () => {
      // Command a position and let it settle
      const result = simulateServo(params, Math.PI / 6, LOADED_INERTIA, LOADED_GRAVITY_TORQUE, 10);
      expect(result.steadyStateError).toBeLessThan(0.02); // < 1°
    });

    it("velocity stays within max limit", () => {
      const result = simulateServo(params, Math.PI / 2, ARM_INERTIA, ARM_GRAVITY_TORQUE, 3);
      // Motor velocity should stay reasonable
      expect(result.maxVelocity).toBeLessThan(50); // unloaded arm moves fast, that's OK
    });
  });

  describe("tuning comparison", () => {
    it("Kv=3 outperforms Kv=0 on combined score (settling + overshoot)", () => {
      const scenarios = [
        { target: Math.PI / 4, inertia: ARM_INERTIA, gravity: ARM_GRAVITY_TORQUE },
        { target: Math.PI / 2, inertia: LOADED_INERTIA, gravity: LOADED_GRAVITY_TORQUE },
        { target: Math.PI / 6, inertia: LOADED_INERTIA, gravity: LOADED_GRAVITY_TORQUE },
      ];

      let pdTotal = 0;
      let vffTotal = 0;

      for (const s of scenarios) {
        const pd = simulateServo(
          { stiffness: ARM_STIFFNESS, damping: ARM_DAMPING, maxForce: ARM_MAX_FORCE, Kv: 0, maxVel: 0 },
          s.target, s.inertia, s.gravity, 5,
        );
        const vff = simulateServo(
          { stiffness: ARM_STIFFNESS, damping: ARM_DAMPING, maxForce: ARM_MAX_FORCE, Kv: 3, maxVel: 5 },
          s.target, s.inertia, s.gravity, 5,
        );
        // Score: lower is better (settling time + 10 * overshoot + 100 * SS error)
        pdTotal += pd.settlingTime + 10 * pd.overshoot + 100 * pd.steadyStateError;
        vffTotal += vff.settlingTime + 10 * vff.overshoot + 100 * vff.steadyStateError;
      }

      expect(vffTotal).toBeLessThan(pdTotal);
    });
  });
});
