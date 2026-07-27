# Dodge & Burn: non-linear mask buildup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the linear dodge/burn mask accumulation with an exponential asymptotic curve and adjust flow scaling so the 0.1–10 slider stays usable.

**Architecture:** Only the brush fragment shader in `src/utils/dodgeBurnRenderer.ts` changes. CPU-side flow scaling is raised so the new exponential decay produces a responsive yet asymptotic buildup.

**Tech Stack:** TypeScript, WebGL2 (GLSL ES 3.0), Vite.

---

### Task 1: Update brush shader accumulation

**Files:**
- Modify: `src/utils/dodgeBurnRenderer.ts:62-76`

- [ ] **Step 1: Read the current shader block**

  Read lines 50–78 of `src/utils/dodgeBurnRenderer.ts` to confirm the current `BRUSH_FRAGMENT` accumulation logic:
  ```glsl
  float current = texture(u_sourceMask, vec2(v_uv.x, 1.0 - v_uv.y)).r;
  float delta = u_flow * alpha * u_mode;
  float next = clamp(current + delta, 0.0, 1.0);
  ```

- [ ] **Step 2: Replace with exponential asymptotic accumulation**

  Edit `BRUSH_FRAGMENT` so the brush stamp multiplies the remaining distance to the limit:
  ```glsl
  float current = texture(u_sourceMask, vec2(v_uv.x, 1.0 - v_uv.y)).r;
  float decay = exp(-u_flow * alpha);
  float next;
  if (u_mode > 0.0) {
      next = 1.0 - (1.0 - current) * decay;
  } else {
      next = current * decay;
  }
  outColor = vec4(next, 0.0, 0.0, 1.0);
  ```

- [ ] **Step 3: Raise flow scaling**

  In `paintBrush`, change:
  ```ts
  const flowAlpha = Math.max(0, Math.min(1, flow / 200));
  ```
  to:
  ```ts
  const flowAlpha = Math.max(0, Math.min(1, flow / 100));
  ```

### Task 2: Verify build and formatting

**Files:**
- Verify: `src/utils/dodgeBurnRenderer.ts`

- [ ] **Step 1: Build the frontend**

  Run:
  ```bash
  npm run build
  ```
  Expected: Vite build completes with no errors.

- [ ] **Step 2: Check formatting**

  Run:
  ```bash
  npx prettier --check src/utils/dodgeBurnRenderer.ts
  ```
  Expected: `All matched files use Prettier code style!`

- [ ] **Step 3: (Optional) commit if requested**

  Do **not** commit unless the user explicitly asks. If asked:
  ```bash
  git add src/utils/dodgeBurnRenderer.ts
  git commit -m "dodge-burn: use exponential asymptotic mask buildup"
  ```
