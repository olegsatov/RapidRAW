export type AxisLockConfig = {
  windowSize: number;
  axisThreshold: number;
  diagRatio: number;
  bothFactor: number;
};

export class AxisLock {
  public locked: 'none' | 'horizontal' | 'vertical' | 'both' = 'none';
  private samples: Array<{ x: number; y: number }> = [];
  private config: AxisLockConfig;
  private idleReset: boolean;

  constructor(config: AxisLockConfig, idleReset: boolean = false) {
    this.config = config;
    this.idleReset = idleReset;
  }

  push(dx: number, dy: number): 'none' | 'horizontal' | 'vertical' | 'both' {
    if (this.idleReset && dx === 0 && dy === 0) {
      this.samples = [];
      this.locked = 'none';
      return 'none';
    }

    this.samples.push({ x: dx, y: dy });
    if (this.samples.length > this.config.windowSize) {
      this.samples.shift();
    }

    let sumX = 0;
    let sumY = 0;
    for (const s of this.samples) {
      sumX += Math.abs(s.x);
      sumY += Math.abs(s.y);
    }

    const major = Math.max(sumX, sumY);
    const minor = Math.min(sumX, sumY);

    if (major <= this.config.axisThreshold) {
      this.locked = 'none';
      return 'none';
    }

    if (minor === 0 || minor / major < this.config.diagRatio) {
      this.locked = sumX > sumY ? 'horizontal' : 'vertical';
      return this.locked;
    }

    const bothThreshold = this.config.axisThreshold * this.config.bothFactor;
    if (major > bothThreshold && minor > bothThreshold) {
      this.locked = 'both';
      return this.locked;
    }

    this.locked = 'none';
    return 'none';
  }
}

export class StepAccumulator {
  public step: number;
  private total: number = 0;

  constructor(step: number) {
    this.step = step;
  }

  push(delta: number): number {
    this.total += delta;
    const magnitude = Math.abs(this.total);
    const wholeSteps = Math.floor(magnitude / this.step);
    if (wholeSteps === 0) {
      return 0;
    }
    const direction = this.total >= 0 ? 1 : -1;
    this.total -= direction * wholeSteps * this.step;
    return direction * wholeSteps;
  }

  reset(): void {
    this.total = 0;
  }
}

export function quantizeMouseWheel(delta: number): number {
  if (delta > 0) return 1;
  if (delta < 0) return -1;
  return 0;
}

export function detectWheelDevice(e: WheelEvent): 'mouse' | 'trackpad' {
  if (e.deltaMode === 1 || e.deltaMode === 2) {
    return 'mouse';
  }
  if (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 100) {
    return 'mouse';
  }
  return 'trackpad';
}

export const MOVE_AXIS_LOCK: AxisLockConfig = {
  windowSize: 5,
  axisThreshold: 1,
  diagRatio: 0.5,
  bothFactor: 1.5,
};

export const SCROLL_AXIS_LOCK: AxisLockConfig = {
  windowSize: 5,
  axisThreshold: 8,
  diagRatio: 0.5,
  bothFactor: 1,
};

export const TRACKPAD_SCROLL_AXIS_LOCK: AxisLockConfig = {
  windowSize: 3,
  axisThreshold: 0.5,
  diagRatio: 0.5,
  bothFactor: 1.5,
};

export const MOUSE_MOVE_STEP = { stepX: 6, stepY: 6 };
export const MOUSE_SCROLL_STEP = 3;
export const TRACKPAD_SCROLL_STEP = 6.25; // trackpad deltas are much finer than mouse notches

// Accumulates sub-pixel movement and returns fractional parameter units.
// pxPerUnit = how many pixels the cursor must travel to change the parameter by 1.
export class ContinuousAccumulator {
  private remainder = 0;
  private prevDelta = 0;
  private readonly smooth = 0.8; // light EMA: 80% current, 20% previous

  constructor(private pxPerUnit: number) {}

  push(deltaPx: number): number {
    const smoothed = deltaPx * this.smooth + this.prevDelta * (1 - this.smooth);
    this.prevDelta = smoothed;
    const units = smoothed / this.pxPerUnit + this.remainder;
    const applied = Math.round(units * 100) / 100;
    this.remainder = units - applied;
    return applied;
  }

  reset(): void {
    this.remainder = 0;
    this.prevDelta = 0;
  }
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
