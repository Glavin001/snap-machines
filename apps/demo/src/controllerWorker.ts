type ConfigMessage = {
  type: "configure";
  source: string;
  globals: {
    commands: Record<string, string>;
    actuators: Record<string, string>;
    config: unknown;
  };
};

type StepMessage = {
  type: "step";
  frame: unknown;
};

type WorkerMessage = ConfigMessage | StepMessage;

interface ControllerModule {
  init?: (frame: unknown) => unknown;
  step: (frame: unknown, state: unknown) => { state?: unknown; outputs?: Record<string, number> };
}

const helperApi = {
  clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
  },
  deadzone(value: number, threshold = 0.1) {
    return Math.abs(value) < threshold ? 0 : value;
  },
  lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
  },
  rateLimit(current: number, target: number, maxDelta: number) {
    if (target > current) {
      return Math.min(target, current + maxDelta);
    }
    return Math.max(target, current - maxDelta);
  },
  pd(error: number, velocity: number, kp: number, kd: number) {
    return kp * error - kd * velocity;
  },
  pid(error: number, state: { integral?: number; previousError?: number } | undefined, dt: number, kp: number, ki: number, kd: number) {
    const integral = (state?.integral ?? 0) + error * dt;
    const derivative = dt > 0 ? (error - (state?.previousError ?? error)) / dt : 0;
    return {
      output: kp * error + ki * integral + kd * derivative,
      state: { integral, previousError: error },
    };
  },
};

let controllerModule: ControllerModule | null = null;
let controllerState: unknown;
let didInit = false;
let controllerGlobals: ConfigMessage["globals"] = {
  commands: {},
  actuators: {},
  config: {},
};

function compileController(source: string, globals: ConfigMessage["globals"]): ControllerModule {
  const factory = new Function(
    "helpers",
    "commands",
    "actuators",
    "config",
    `"use strict";\n${source}\nreturn { init: typeof init === "function" ? init : undefined, step: typeof step === "function" ? step : undefined };`,
  ) as (
    helpers: typeof helperApi,
    commands: ConfigMessage["globals"]["commands"],
    actuators: ConfigMessage["globals"]["actuators"],
    config: ConfigMessage["globals"]["config"],
  ) => { init?: ControllerModule["init"]; step?: ControllerModule["step"] };
  const result = factory(helperApi, globals.commands, globals.actuators, globals.config);
  if (typeof result.step !== "function") {
    throw new Error("Controller script must define a step(frame, state) function.");
  }
  return { init: result.init, step: result.step };
}

function postError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  self.postMessage({ type: "error", message });
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  try {
    if (event.data.type === "configure") {
      controllerGlobals = event.data.globals;
      controllerModule = compileController(event.data.source, controllerGlobals);
      controllerState = undefined;
      didInit = false;
      self.postMessage({ type: "configured" });
      return;
    }

    if (!controllerModule) {
      throw new Error("Controller worker received a step message before configure.");
    }

    if (!didInit && controllerModule.init) {
      controllerState = controllerModule.init(event.data.frame);
      didInit = true;
    } else if (!didInit) {
      didInit = true;
    }

    const result = controllerModule.step(event.data.frame, controllerState) ?? {};
    controllerState = result.state ?? controllerState;
    self.postMessage({
      type: "result",
      outputs: result.outputs ?? {},
    });
  } catch (error) {
    postError(error);
  }
};
