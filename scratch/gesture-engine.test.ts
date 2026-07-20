import assert from 'node:assert';
import {
  AxisLock,
  StepAccumulator,
  quantizeMouseWheel,
  detectWheelDevice,
  MOVE_AXIS_LOCK,
  SCROLL_AXIS_LOCK,
} from '../src/utils/gestureEngine';

{
  const acc = new StepAccumulator(6);
  assert.strictEqual(acc.push(2), 0);
  assert.strictEqual(acc.push(2), 0);
  assert.strictEqual(acc.push(2), 1);
  assert.strictEqual(acc.push(-7), -1);
  assert.strictEqual(acc.push(-5), -1);
  acc.reset();
  assert.strictEqual(acc.push(6), 1);
}

assert.strictEqual(quantizeMouseWheel(120), 1);
assert.strictEqual(quantizeMouseWheel(-53), -1);
assert.strictEqual(quantizeMouseWheel(0), 0);

{
  const lock = new AxisLock(MOVE_AXIS_LOCK);
  let locked = 'none';
  for (let i = 0; i < 5; i++) locked = lock.push(6, 0.2);
  assert.strictEqual(locked, 'horizontal');
}

{
  const lock = new AxisLock(MOVE_AXIS_LOCK);
  let locked = 'none';
  for (let i = 0; i < 5; i++) locked = lock.push(5, 5);
  assert.strictEqual(locked, 'both');
}

{
  const lock = new AxisLock(SCROLL_AXIS_LOCK, true);
  for (let i = 0; i < 5; i++) lock.push(0, 10);
  assert.strictEqual(lock.locked, 'vertical');
  lock.push(0, 0);
  assert.strictEqual(lock.locked, 'none');
}

assert.strictEqual(detectWheelDevice({ deltaY: 120, deltaMode: 0 } as WheelEvent), 'mouse');
assert.strictEqual(detectWheelDevice({ deltaY: 3, deltaMode: 1 } as WheelEvent), 'mouse');
assert.strictEqual(detectWheelDevice({ deltaY: 4.5, deltaMode: 0 } as WheelEvent), 'trackpad');
assert.strictEqual(detectWheelDevice({ deltaY: 12, deltaMode: 0 } as WheelEvent), 'trackpad');

console.log('gestureEngine tests: ALL PASS');
