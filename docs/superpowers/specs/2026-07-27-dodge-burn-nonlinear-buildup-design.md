# Dodge & Burn: non-linear mask buildup

## Goal
Make the dodge/burn brush mask accumulate non-linearly so that approaching 100% density slows down asymptotically. This removes visible hard edges where the mask saturates and makes full coverage difficult to reach, matching a classic logarithmic/exponential feel.

## Change location
`src/utils/dodgeBurnRenderer.ts`, fragment shader `BRUSH_FRAGMENT`.

## Current behavior
```glsl
float current = texture(u_sourceMask, vec2(v_uv.x, 1.0 - v_uv.y)).r;
float delta = u_flow * alpha * u_mode;
float next = clamp(current + delta, 0.0, 1.0);
```
The mask grows linearly and clamps at 1.0, producing visible saturated blobs and hard boundaries.

## New behavior
```glsl
float current = texture(u_sourceMask, vec2(v_uv.x, 1.0 - v_uv.y)).r;
float decay = exp(-u_flow * alpha);
float next;
if (u_mode > 0.0) {          // add / dodge
    next = 1.0 - (1.0 - current) * decay;
} else {                     // erase / burn-reverse
    next = current * decay;
}
```
Each brush stamp multiplies the remaining distance to the limit by `exp(-flow * alpha)`, so:
- The mask never technically reaches 1.0 (asymptote).
- Edge feathering increases naturally with repeated strokes.
- No `clamp` artifacts.

## Flow scaling
The CPU-side `flowAlpha` is raised from `flow / 200` to `flow / 100` to keep the 0.1–10 slider range usable. At `flow = 2.5` a central stamp (`alpha ≈ 1`) closes roughly 2.5% of the remaining gap to full density.

## Edge cases
- `current = 0` (add): `next = 1 - exp(-flow * alpha)` — identical starting response to the old linear formula for very small values.
- `current = 1` (add): `next = 1` — stays saturated.
- `current = 0` (erase): `next = 0` — stays empty.
- Feathered brush edges (`alpha < 1`) receive proportionally smaller decay, preserving soft falloff.

## Backwards compatibility
Only the live brush accumulation changes. Saved masks remain ordinary grayscale images; existing saved masks load unchanged.
