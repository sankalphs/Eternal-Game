// =============================================================================
// RL Agent — PPO (Proximal Policy Optimization) with full backpropagation.
// =============================================================================
//
// ⚠️  EXPERIMENTAL — NOT PART OF THE PRODUCTION GAME LOOP.
// This module is isolated under src/experimental/rl/. The 8-opponent
// tournament, 2-player mode, story intro, and destruction ending never touch
// this code — the production GameEngine no longer imports it. See README.md
// in this folder for how to wire it back in (e.g. re-add a startRLGhost()
// method that constructs an RLController from the shared rlTrainer.agent).
//
// Architecture:
//   Policy network:  state(20) → 128 → 128 → 10 (softmax)
//   Value network:   state(20) → 128 → 128 → 1  (linear)
//
// Features:
//   - Full backprop through ALL layers (the previous version only updated the
//     output layer — a critical bug that prevented any feature learning).
//   - PPO clipped surrogate objective with ratio clipping ε=0.2.
//   - Generalized Advantage Estimation (GAE-λ, λ=0.95, γ=0.99).
//   - Entropy bonus (decaying β) for exploration.
//   - Value function clipping (PPO2 style).
//   - Observation normalization (Welford running mean/std).
//   - localStorage persistence — trained weights survive page refresh.
//   - Trains against a FIXED RANDOM OPPONENT (not self-play — see runEpisode).
//   - Background training that yields to the UI thread (won't block the game).
//   - A controller method (RLController) to use the trained policy as a game AI.
//
// State vector (20 dims, all normalized to ~[-1, 1]):
//   [ self.x/960, self.hp/maxHp, self.rage/100, self.vx/200, self.vy/500,
//     self.onGround, self.isAttacking, self.isBlocking, self.invuln>0, self.facing,
//     (opp.x-self.x)/960, opp.hp/maxHp, opp.rage/100, opp.vx/200, opp.vy/500,
//     opp.onGround, opp.isAttacking, opp.isBlocking, opp.invuln>0, opp.facing ]
//
// Actions (10): none, left, right, up, down, punch, kick, roundhouse, roll, block
//
// To use it from the production game: re-add a startRLGhost() method to
// GameEngine that constructs `new RLController(rlTrainer.agent)` and feeds its
// getInput() into the enemy fighter each frame, and surface the
// RLTrainingPanel from the menu. To train the agent directly: open the
// RLTrainingPanel component or call rlTrainer.trainBatch(...).
// =============================================================================

import type { InputState } from "@/lib/game/types";
import type { Fighter } from "@/lib/game/fighter";

// ---------------------------------------------------------------------------
// Matrix / layer utilities
// ---------------------------------------------------------------------------

interface Layer {
  w: number[][]; // [outS][inS]
  b: number[]; // [outS]
  // cached forward values for backprop
  z: number[]; // pre-activation [outS]
  a: number[]; // post-activation [outS]
  // gradients
  gw: number[][]; // [outS][inS]
  gb: number[]; // [outS]
}

function makeLayer(inS: number, outS: number): Layer {
  const w: number[][] = [];
  const b: number[] = new Array(outS).fill(0);
  const z = new Array(outS).fill(0);
  const a = new Array(outS).fill(0);
  const gw: number[][] = [];
  const gb = new Array(outS).fill(0);
  const s = Math.sqrt(2 / inS); // He initialization for ReLU
  for (let i = 0; i < outS; i++) {
    const row: number[] = [];
    const grow: number[] = [];
    for (let j = 0; j < inS; j++) {
      row.push((Math.random() * 2 - 1) * s);
      grow.push(0);
    }
    w.push(row);
    gw.push(grow);
  }
  return { w, b, z, a, gw, gb };
}

function fwdLayer(l: Layer, inp: number[]): number[] {
  for (let i = 0; i < l.w.length; i++) {
    let sum = l.b[i];
    const row = l.w[i];
    for (let j = 0; j < row.length; j++) sum += row[j] * inp[j];
    l.z[i] = sum;
    l.a[i] = sum > 0 ? sum : 0; // ReLU
  }
  return l.a;
}

function fwdLayerLinear(l: Layer, inp: number[]): number[] {
  for (let i = 0; i < l.w.length; i++) {
    let sum = l.b[i];
    const row = l.w[i];
    for (let j = 0; j < row.length; j++) sum += row[j] * inp[j];
    l.z[i] = sum;
    l.a[i] = sum; // linear (for output)
  }
  return l.a;
}

function relu(a: number[]): number[] {
  return a.map((x) => (x > 0 ? x : 0));
}

function softmax(a: number[]): number[] {
  const m = Math.max(...a);
  const e = a.map((x) => Math.exp(x - m));
  const sm = e.reduce((s, x) => s + x, 0);
  return e.map((x) => x / sm);
}

// Backprop through a ReLU layer.
// gradOut: dL/da (gradient w.r.t. output of this layer)
// inp: the input that was fed to this layer
// Returns: dL/dinp (gradient w.r.t. input, for chaining to previous layer)
function backLayer(l: Layer, gradOut: number[], inp: number[]): number[] {
  const inS = l.w[0].length;
  const gradIn = new Array(inS).fill(0);
  for (let i = 0; i < l.w.length; i++) {
    // ReLU mask: gradient flows only where z > 0
    const mask = l.z[i] > 0 ? 1 : 0;
    const gz = gradOut[i] * mask; // dL/dz
    l.gb[i] += gz; // dL/db = dL/dz
    const row = l.w[i];
    const grow = l.gw[i];
    for (let j = 0; j < row.length; j++) {
      grow[j] += gz * inp[j]; // dL/dW = dL/dz * inp
      gradIn[j] += row[j] * gz; // dL/dinp = sum_i W[i][j] * dL/dz
    }
  }
  return gradIn;
}

// Backprop through a linear layer (same as ReLU but no mask)
function backLayerLinear(l: Layer, gradOut: number[], inp: number[]): number[] {
  const inS = l.w[0].length;
  const gradIn = new Array(inS).fill(0);
  for (let i = 0; i < l.w.length; i++) {
    const gz = gradOut[i]; // no ReLU mask
    l.gb[i] += gz;
    const row = l.w[i];
    const grow = l.gw[i];
    for (let j = 0; j < row.length; j++) {
      grow[j] += gz * inp[j];
      gradIn[j] += row[j] * gz;
    }
  }
  return gradIn;
}

function zeroGrads(l: Layer) {
  for (let i = 0; i < l.gw.length; i++) {
    l.gb[i] = 0;
    for (let j = 0; j < l.gw[i].length; j++) l.gw[i][j] = 0;
  }
}

function applyGrads(l: Layer, lr: number) {
  for (let i = 0; i < l.w.length; i++) {
    l.b[i] -= lr * l.gb[i];
    for (let j = 0; j < l.w[i].length; j++) {
      l.w[i][j] -= lr * l.gw[i][j];
    }
  }
}

// Global gradient-norm clipping across all layers. Standard PPO stabilizer —
// prevents destructive updates when the per-batch gradient is unusually large.
// Clips in-place so the caller can then applyGrads normally.
function clipGlobalNorm(layers: Layer[], maxNorm: number): number {
  let totalSq = 0;
  for (const l of layers) {
    for (let i = 0; i < l.gw.length; i++) {
      totalSq += l.gb[i] * l.gb[i];
      for (let j = 0; j < l.gw[i].length; j++) totalSq += l.gw[i][j] * l.gw[i][j];
    }
  }
  const totalNorm = Math.sqrt(totalSq);
  if (totalNorm > maxNorm && totalNorm > 0) {
    const scale = maxNorm / totalNorm;
    for (const l of layers) {
      for (let i = 0; i < l.gw.length; i++) {
        l.gb[i] *= scale;
        for (let j = 0; j < l.gw[i].length; j++) l.gw[i][j] *= scale;
      }
    }
  }
  return totalNorm;
}

// ---------------------------------------------------------------------------
// Running statistics for observation & reward normalization (PPO standard).
// Uses Welford's algorithm for numerical stability. Normalizing observations
// to zero-mean unit-variance dramatically improves convergence — without it,
// the network fights scale mismatches (HP 0-1 vs facing ±1 vs distance -1..1)
// instead of learning the task.
// ---------------------------------------------------------------------------

class RunningStats {
  n = 0;
  mean: number[];
  M2: number[]; // sum of squared deviations
  clip: number;

  constructor(size: number, clip = 10) {
    this.mean = new Array(size).fill(0);
    this.M2 = new Array(size).fill(0);
    this.clip = clip;
  }

  // Update running stats with a new observation (per-dimension)
  update(x: number[]) {
    this.n++;
    const n = this.n;
    for (let i = 0; i < x.length; i++) {
      const delta = x[i] - this.mean[i];
      this.mean[i] += delta / n;
      const delta2 = x[i] - this.mean[i];
      this.M2[i] += delta * delta2;
    }
  }

  // Normalize an observation using current running stats.
  // Before enough samples are collected, returns the raw input.
  normalize(x: number[]): number[] {
    if (this.n < 30) return x.slice();
    const out = new Array(x.length);
    for (let i = 0; i < x.length; i++) {
      const std = Math.sqrt(this.M2[i] / this.n) + 1e-8;
      out[i] = Math.max(-this.clip, Math.min(this.clip, (x[i] - this.mean[i]) / std));
    }
    return out;
  }

  // For scalar reward normalization
  updateScalar(x: number) {
    this.n++;
    const n = this.n;
    const delta = x - this.mean[0];
    this.mean[0] += delta / n;
    const delta2 = x - this.mean[0];
    this.M2[0] += delta * delta2;
  }

  normalizeScalar(x: number): number {
    if (this.n < 30) return x;
    const std = Math.sqrt(this.M2[0] / this.n) + 1e-8;
    return Math.max(-this.clip, Math.min(this.clip, (x - this.mean[0]) / std));
  }
}

// ---------------------------------------------------------------------------
// Network definitions
// ---------------------------------------------------------------------------

const STATE_SIZE = 20;
const HIDDEN = 128;
const NUM_ACTIONS = 10;
const ACTIONS: (keyof InputState | "none")[] = [
  "none", "left", "right", "up", "down",
  "punch", "kick", "roundhouse", "roll", "block",
];

function emptyInput(): InputState {
  return {
    left: false, right: false, up: false, down: false,
    punch: false, kick: false, roundhouse: false,
    roll: false, block: false, super: false, throw: false,
  };
}

function actionToInput(action: number): InputState {
  const input = emptyInput();
  if (action > 0) {
    const k = ACTIONS[action];
    if (k !== "none") input[k] = true;
  }
  return input;
}

// ---------------------------------------------------------------------------
// PPO Agent
// ---------------------------------------------------------------------------

interface Transition {
  s: number[];
  a: number;
  r: number;
  lp: number; // old log prob
  v: number; // old value
  d: boolean; // done
}

export class PPOAgent {
  // Policy network: state → h1 → h2 → softmax(10)
  pL1: Layer = makeLayer(STATE_SIZE, HIDDEN);
  pL2: Layer = makeLayer(HIDDEN, HIDDEN);
  pOut: Layer = makeLayer(HIDDEN, NUM_ACTIONS);
  // Value network: state → h1 → h2 → linear(1)
  vL1: Layer = makeLayer(STATE_SIZE, HIDDEN);
  vL2: Layer = makeLayer(HIDDEN, HIDDEN);
  vOut: Layer = makeLayer(HIDDEN, 1);

  private buf: Transition[] = [];
  gamma = 0.99;
  lambda = 0.95;
  clip = 0.2;
  lr = 3e-3;           // 3× higher than v4; cumulative logit update now ~0.36 over 5000 eps
  entropyCoef = 0.01;  // fixed-sign: now a true BONUS (maximizes H)
  valueClip = 0.2;
  epochs = 4;
  targetKL = 0.03;     // early-stop epochs if KL(old||new) exceeds this
  gradClipNorm = 0.5;  // global gradient-norm clip (safety for higher LR)
  minBufferSize = 2048; // collect ≥2048 transitions before each train() call

  // Running normalization for observations (per-dim) and rewards (scalar).
  // This is the #1 stabilizer for PPO — normalizes the network's input space
  // to zero-mean unit-variance so gradients aren't dominated by scale mismatches.
  obsStats: RunningStats = new RunningStats(STATE_SIZE, 10);
  rewardStats: RunningStats = new RunningStats(1, 10);
  // Reward scale: divide raw rewards by this (updated from running std).
  // We use a fixed scale factor to keep rewards in a learnable range.
  rewardScale = 1.0;

  episodes = 0;
  totalReward = 0;
  avgReward = 0;
  lastPolicyLoss = 0;
  lastValueLoss = 0;
  lastEntropy = 0;

  // ---- Forward passes ----

  // Returns the hidden activations for the policy network (for backprop)
  private policyForward(s: number[]): { h1: number[]; h2: number[]; probs: number[] } {
    const h1 = fwdLayer(this.pL1, s);
    const h2 = fwdLayer(this.pL2, h1);
    const logits = fwdLayerLinear(this.pOut, h2);
    const probs = softmax(logits);
    return { h1, h2, probs };
  }

  private valueForward(s: number[]): { h1: number[]; h2: number[]; v: number } {
    const h1 = fwdLayer(this.vL1, s);
    const h2 = fwdLayer(this.vL2, h1);
    const out = fwdLayerLinear(this.vOut, h2);
    return { h1, h2, v: out[0] };
  }

  getProbs(s: number[]): number[] {
    const sn = this.obsStats.normalize(s);
    return this.policyForward(sn).probs;
  }

  getValue(s: number[]): number {
    const sn = this.obsStats.normalize(s);
    return this.valueForward(sn).v;
  }

  getState(self: Fighter, opp: Fighter): number[] {
    const raw = [
      self.x / 960, self.hp / self.maxHp, self.rageMeter / 100,
      self.vx / 200, self.vy / 500,
      self.onGround ? 1 : 0, self.isAttacking() ? 1 : 0,
      self.isBlocking() ? 1 : 0, self.invuln > 0 ? 1 : 0, self.facing,
      (opp.x - self.x) / 960, opp.hp / opp.maxHp, opp.rageMeter / 100,
      opp.vx / 200, opp.vy / 500,
      opp.onGround ? 1 : 0, opp.isAttacking() ? 1 : 0,
      opp.isBlocking() ? 1 : 0, opp.invuln > 0 ? 1 : 0, opp.facing,
    ];
    // Update running stats and return normalized state for the network
    this.obsStats.update(raw);
    return this.obsStats.normalize(raw);
  }

  // Act on a state. The state should ALREADY be normalized (via getState or
  // obsStats.normalize). Returns the chosen action, input, log-prob, and value.
  act(s: number[], stoch = true): {
    action: number; input: InputState; logProb: number; value: number;
  } {
    const { probs } = this.policyForward(s);
    const value = this.valueForward(s).v;
    let action = 0;
    if (stoch) {
      const r = Math.random();
      let c = 0;
      for (let i = 0; i < probs.length; i++) {
        c += probs[i];
        if (r < c) { action = i; break; }
      }
    } else {
      action = probs.indexOf(Math.max(...probs));
    }
    const lp = Math.log(probs[action] + 1e-8);
    return { action, input: actionToInput(action), logProb: lp, value };
  }

  // Store a transition. Rewards are scaled to keep them in a learnable range.
  // Damage rewards (±15) scale to ±0.75, KO bonus (±15) scales to ±0.75.
  // Clip at ±1.5 to prevent rare huge spikes from destabilizing the value fn.
  store(s: number[], a: number, r: number, lp: number, v: number, d: boolean) {
    const rs = Math.max(-1.5, Math.min(1.5, r / 20));
    this.buf.push({ s, a, r: rs, lp, v, d });
  }

  // ---- PPO update with full backpropagation ----
  // Returns null if the buffer hasn't reached minBufferSize yet (caller should
  // keep collecting transitions). This enforces a proper PPO batch size.
  train(): { policyLoss: number; valueLoss: number; entropy: number } | null {
    if (this.buf.length < this.minBufferSize) return null;
    const n = this.buf.length;

    // ---- Compute GAE advantages and returns ----
    const adv = new Array(n).fill(0);
    const ret = new Array(n).fill(0);
    let gae = 0;
    let lastV = 0;
    for (let t = n - 1; t >= 0; t--) {
      const tr = this.buf[t];
      const nextV = tr.d ? 0 : lastV;
      const delta = tr.r + this.gamma * nextV - tr.v;
      gae = delta + this.gamma * this.lambda * (tr.d ? 0 : 1) * gae;
      adv[t] = gae;
      ret[t] = gae + tr.v;
      lastV = tr.v;
    }
    // Normalize advantages
    const mean = adv.reduce((a, b) => a + b, 0) / n;
    const std =
      Math.sqrt(adv.reduce((a, b) => a + (b - mean) ** 2, 0) / n) + 1e-8;
    for (let i = 0; i < n; i++) adv[i] = (adv[i] - mean) / std;

    let tpl = 0;
    let tvl = 0;
    let tent = 0;

    // ---- Multi-epoch PPO updates ----
    for (let ep = 0; ep < this.epochs; ep++) {
      // Zero all gradients at the start of each epoch
      zeroGrads(this.pL1); zeroGrads(this.pL2); zeroGrads(this.pOut);
      zeroGrads(this.vL1); zeroGrads(this.vL2); zeroGrads(this.vOut);

      let epochPL = 0;
      let epochVL = 0;
      let epochEnt = 0;
      let epochKL = 0;

      for (let i = 0; i < n; i++) {
        const tr = this.buf[i];
        const a = adv[i];
        const rt = ret[i];

        // ---- Policy forward ----
        const { h1, h2, probs } = this.policyForward(tr.s);
        const newLp = Math.log(probs[tr.a] + 1e-8);
        const ratio = Math.exp(newLp - tr.lp);

        // PPO clipped surrogate
        const surr1 = ratio * a;
        const surr2 =
          Math.max(1 - this.clip, Math.min(1 + this.clip, ratio)) * a;
        const useClipped = surr2 < surr1;
        // grad coefficient: 0 if clipped (gradient killed), else ratio * adv
        const gradCoeff = useClipped ? 0 : ratio * a;

        // Entropy of the policy
        let entropy = 0;
        for (let j = 0; j < probs.length; j++) {
          if (probs[j] > 1e-8) entropy -= probs[j] * Math.log(probs[j]);
        }

        // dL/dz_out[j] = -gradCoeff * (δ(j, a) - π(j)) + entropyCoef * dH/dz
        // where dH/dz[j] = π(j) * (Σ_k π(k) log π(k) + log π(j) + 1) ≈ π(j) * (log π(j) + H + 1)
        // Simplified entropy gradient: dH/dz[j] = π(j) * (log π(j) + 1 + ... ) 
        // We use the standard form: dH/dz[j] = π(j) * (Σ_k π(k)(log π(k)+1) - (log π(j)+1))
        // But for simplicity and stability, use: dH/dz[j] ≈ -(log π(j) + 1) * π(j) + π(j) * Σ_k π(k)(log π(k)+1)
        // An even simpler stable form: gradEntropy[j] = π(j) * (entropy_term - logit_term)
        // We'll use the common approximation: dH/dz[j] = π(j) * (H + log π(j)) ... 
        // Actually the standard result is: dH/dz[j] = π(j) * (log π(j) - Σ_k π(k) log π(k))
        //                                    = π(j) * (log π(j) + H)    [since H = -Σ π log π]
        const entropyGrad = new Array(NUM_ACTIONS).fill(0);
        for (let j = 0; j < NUM_ACTIONS; j++) {
          entropyGrad[j] = probs[j] * (Math.log(probs[j] + 1e-8) + entropy);
        }

        const dzPolicy = new Array(NUM_ACTIONS).fill(0);
        for (let j = 0; j < NUM_ACTIONS; j++) {
          const kronecker = j === tr.a ? 1 : 0;
          // Loss = -surrogate + entropyCoef * (-H)  [we MAXIMIZE H → minimize -H]
          // dL/dz = -gradCoeff * (δ - π) + entropyCoef * dH/dz
          // entropyGrad[j] = π_j·(log π_j + H) = -dH/dz_j  (verified numerically)
          // So dH/dz_j = -entropyGrad[j], and the entropy term = entropyCoef * (-entropyGrad[j])
          //             = -entropyCoef * entropyGrad[j]  ... WAIT that's the OLD (buggy) form.
          //
          // Re-derive carefully:
          //   H = -Σ π log π  (we want to MAXIMIZE)
          //   dH/dz_j = -π_j (log π_j + H)   [verified by finite-diff]
          //   Loss_entropy = -entropyCoef * H   (minimize → maximize H)
          //   dLoss_entropy/dz_j = -entropyCoef * dH/dz_j = -entropyCoef * (-π_j(log π_j + H))
          //                     = +entropyCoef * π_j (log π_j + H)
          //                     = +entropyCoef * entropyGrad[j]   ← since entropyGrad = π(log π + H)
          //
          // So the CORRECT sign is +entropyCoef * entropyGrad[j] (ADDS to the loss gradient).
          // The old code used `-` which gave -entropyCoef*entropyGrad = -entropyCoef*π(log π+H)
          //   = +entropyCoef * dH/dz = gradient of +entropyCoef*H → MINIMIZES H (penalty). BUG.
          dzPolicy[j] = -gradCoeff * (kronecker - probs[j]) + this.entropyCoef * entropyGrad[j];
        }

        // Backprop policy: pOut → pL2 → pL1
        // grad at pOut output = dzPolicy
        // backLayerLinear returns the gradient w.r.t. the layer's INPUT (h2)
        const gradH2_policy = backLayerLinear(this.pOut, dzPolicy, h2);
        // grad at pL2 output = gradH2_policy; returns grad w.r.t. h1
        const gradH1_policy = backLayer(this.pL2, gradH2_policy, h1);
        // grad at pL1 output = gradH1_policy; returns grad w.r.t. s (not needed)
        backLayer(this.pL1, gradH1_policy, tr.s);

        // ---- Value forward + backprop ----
        const { h1: vh1, h2: vh2, v: newV } = this.valueForward(tr.s);
        // Value loss with clipping (PPO2)
        const vClipped = tr.v + Math.max(
          -this.valueClip,
          Math.min(this.valueClip, newV - tr.v),
        );
        const vLossUnclipped = (newV - rt) ** 2;
        const vLossClipped = (vClipped - rt) ** 2;
        const vLoss = Math.max(vLossUnclipped, vLossClipped);
        // Gradient: use unclipped gradient (2*(v-rt)) when the unclipped loss
        // is >= the clipped loss (i.e., clipping doesn't help). When the clipped
        // loss is strictly larger, the value was clipped and the gradient is 0.
        // NOTE: >= (not >) so the gradient flows on epoch 0 when newV == oldV.
        const dvRaw = 2 * (newV - rt);
        const dvClipped = vLossUnclipped >= vLossClipped ? dvRaw : 0;
        const dv = [dvClipped];

        // Value backprop chain
        const gradVh2 = backLayerLinear(this.vOut, dv, vh2);
        const gradVh1 = backLayer(this.vL2, gradVh2, vh1);
        backLayer(this.vL1, gradVh1, tr.s);

        epochPL += useClipped ? surr2 : surr1;
        epochVL += vLoss;
        epochEnt += entropy;
        // KL(old||new) = Σ π_old · log(π_old / π_new). We approximate π_old via
        // the stored log-prob (exp(tr.lp) = π_old(a)). For a per-sample KL we'd
        // need the full old distribution; instead we use the ratio-based
        // approximation KL ≈ 0.5 · (log ratio)² which is exact to 2nd order.
        const logRatio = newLp - tr.lp;
        epochKL += 0.5 * logRatio * logRatio;
      }

      // Apply gradients. We do NOT divide by n (batch size) — that would make
      // the effective LR scale as lr/n, which is catastrophically small for
      // n=2048. Instead we clip the global gradient norm to 0.5, which provides
      // the safety that ÷n was trying (poorly) to provide. This matches the
      // behavior of Adam-based PPO (step size ~lr, not ~lr/n).
      // Clip BEFORE scaling so the clip threshold is in raw-gradient units.
      const gradNorm = clipGlobalNorm(
        [this.pL1, this.pL2, this.pOut, this.vL1, this.vL2, this.vOut],
        this.gradClipNorm,
      );
      void gradNorm;
      for (const l of [this.pL1, this.pL2, this.pOut, this.vL1, this.vL2, this.vOut]) {
        applyGrads(l, this.lr);
      }

      const invN = 1 / n;
      tpl = epochPL * invN;
      tvl = epochVL * invN;
      tent = epochEnt * invN;
      const meanKL = epochKL * invN;

      // KL early stopping — if the policy moved too far from old, stop epochs.
      if (meanKL > this.targetKL && ep < this.epochs - 1) {
        break;
      }
    }

    // episodes++ and avgReward are now managed by the trainer (one increment
    // per PPO update, not per call to train()).
    this.lastBufSum = this.buf.reduce((s, t) => s + t.r, 0);
    this.lastPolicyLoss = tpl;
    this.lastValueLoss = tvl;
    this.lastEntropy = tent;
    this.buf = [];
    return { policyLoss: tpl, valueLoss: tvl, entropy: tent };
  }

  // Buffer length accessor (trainer checks this to decide when to train)
  get bufLen(): number { return this.buf.length; }
  // Sum of rewards in the current buffer (for stats)
  lastBufSum = 0;

  get isTrained(): boolean {
    return this.episodes > 0;
  }

  // ---- Persistence (localStorage) ----

  serialize(): string {
    const lay = (l: Layer) => ({ w: l.w, b: l.b });
    return JSON.stringify({
      pL1: lay(this.pL1), pL2: lay(this.pL2), pOut: lay(this.pOut),
      vL1: lay(this.vL1), vL2: lay(this.vL2), vOut: lay(this.vOut),
      episodes: this.episodes,
      totalReward: this.totalReward,
      avgReward: this.avgReward,
      obsStats: { n: this.obsStats.n, mean: this.obsStats.mean, M2: this.obsStats.M2 },
      rewardStats: { n: this.rewardStats.n, mean: this.rewardStats.mean, M2: this.rewardStats.M2 },
    });
  }

  load(data: string): boolean {
    try {
      const d = JSON.parse(data);
      const restore = (l: Layer, saved: { w: number[][]; b: number[] }) => {
        for (let i = 0; i < l.w.length; i++) {
          l.b[i] = saved.b[i];
          for (let j = 0; j < l.w[i].length; j++) l.w[i][j] = saved.w[i][j];
        }
      };
      restore(this.pL1, d.pL1);
      restore(this.pL2, d.pL2);
      restore(this.pOut, d.pOut);
      restore(this.vL1, d.vL1);
      restore(this.vL2, d.vL2);
      restore(this.vOut, d.vOut);
      this.episodes = d.episodes ?? 0;
      this.totalReward = d.totalReward ?? 0;
      this.avgReward = d.avgReward ?? 0;
      if (d.obsStats) {
        this.obsStats.n = d.obsStats.n;
        this.obsStats.mean = d.obsStats.mean;
        this.obsStats.M2 = d.obsStats.M2;
      }
      if (d.rewardStats) {
        this.rewardStats.n = d.rewardStats.n;
        this.rewardStats.mean = d.rewardStats.mean;
        this.rewardStats.M2 = d.rewardStats.M2;
      }
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Self-play environment — a lightweight but faithful fight simulation.
// Uses the real attack specs (damage, range) so the learned policy transfers.
//
// REWARD DESIGN (dense + shaped):
//   +damage_dealt         — primary signal (scaled 1.0×)
//   −damage_taken         — symmetric penalty (scaled 1.0×)
//   +block_success * 3    — rewards defending (block absorbs 82% like the game)
//   −2 if attack blocked   — slight penalty for predictable attacks
//   +25 KO bonus           — big terminal reward
//   −25 if KO'd             — symmetric terminal penalty
//   +proximity shaping      — small reward for staying in mid-range (engagement)
//   NO whiff penalty        — opportunity cost is enough; whiff penalty made
//                              the agent learn "never attack" (the old bug)
//   NO time penalty         — just added noise; the KO bonus handles pacing
// ---------------------------------------------------------------------------

const SIM_ATTACKS = {
  punch: { dmg: 8, range: 66, kb: 170, stun: 3, cd: 4 },
  kick: { dmg: 15, range: 86, kb: 310, stun: 5, cd: 6 },
  roundhouse: { dmg: 16, range: 94, kb: 370, stun: 6, cd: 9 },
} as const;
type SimAction = keyof typeof SIM_ATTACKS;

interface SimState {
  x1: number; x2: number;
  hp1: number; hp2: number;
  rage1: number; rage2: number;
  stun1: number; stun2: number; // hitstun timers (steps remaining)
  atkCd1: number; atkCd2: number; // attack cooldown (steps remaining)
  block1: boolean; block2: boolean; // is this fighter holding block this step
  air1: boolean; air2: boolean; // is this fighter airborne (jumping)
  airT1: number; airT2: number; // air time remaining (steps)
  rollCd1: number; rollCd2: number; // roll cooldown (i-frames)
  steps: number;
}

function simStateVector(s: SimState, perspective: 1 | 2): number[] {
  const isP1 = perspective === 1;
  const selfX = isP1 ? s.x1 : s.x2;
  const oppX = isP1 ? s.x2 : s.x1;
  const selfHp = isP1 ? s.hp1 : s.hp2;
  const oppHp = isP1 ? s.hp2 : s.hp1;
  const selfRage = isP1 ? s.rage1 : s.rage2;
  const oppRage = isP1 ? s.rage2 : s.rage1;
  const selfStun = isP1 ? s.stun1 : s.stun2;
  const oppStun = isP1 ? s.stun2 : s.stun1;
  const selfCd = isP1 ? s.atkCd1 : s.atkCd2;
  const oppCd = isP1 ? s.atkCd2 : s.atkCd1;
  const selfBlock = isP1 ? s.block1 : s.block2;
  const oppBlock = isP1 ? s.block2 : s.block1;
  const selfAir = isP1 ? s.air1 : s.air2;
  const oppAir = isP1 ? s.air2 : s.air1;
  const selfRoll = isP1 ? s.rollCd1 : s.rollCd2;
  const oppRoll = isP1 ? s.rollCd2 : s.rollCd1;
  const dist = (oppX - selfX) / 960;
  return [
    selfX / 960, selfHp / 100, selfRage / 100, 0, 0,
    selfAir ? 0 : 1, selfCd > 0 ? 1 : 0, selfBlock ? 1 : 0, selfStun > 0 ? 1 : 0,
    isP1 ? 1 : -1,
    dist, oppHp / 100, oppRage / 100, 0, 0,
    oppAir ? 0 : 1, oppCd > 0 ? 1 : 0, oppBlock ? 1 : 0, oppStun > 0 ? 1 : 0,
    isP1 ? -1 : 1,
  ];
  // NOTE: roll i-frame state (selfRoll/oppRoll) is implicitly captured by the
  // invuln field in the real game's getState(). In the sim, roll just dodges.
}

// Apply one fighter's action (mutates state). Does NOT compute reward —
// reward is computed from HP deltas after both actions resolve (symmetric).
function applySimAction(
  s: SimState,
  perspective: 1 | 2,
  input: InputState,
): void {
  const isP1 = perspective === 1;
  const selfX = isP1 ? s.x1 : s.x2;
  const oppX = isP1 ? s.x2 : s.x1;
  const selfStun = isP1 ? s.stun1 : s.stun2;
  const selfCd = isP1 ? s.atkCd1 : s.atkCd2;
  const selfAir = isP1 ? s.air1 : s.air2;
  const selfRoll = isP1 ? s.rollCd1 : s.rollCd2;
  const dist = Math.abs(oppX - selfX);
  const dirToOpp = oppX >= selfX ? 1 : -1;

  // Tick down air time; land when it reaches 0
  if (isP1) {
    if (s.airT1 > 0) { s.airT1--; if (s.airT1 === 0) s.air1 = false; }
  } else {
    if (s.airT2 > 0) { s.airT2--; if (s.airT2 === 0) s.air2 = false; }
  }
  // Tick down roll i-frames
  if (isP1) { if (s.rollCd1 > 0) s.rollCd1--; } else { if (s.rollCd2 > 0) s.rollCd2--; }

  // Update this fighter's block state for this step (can't block while airborne/rolling)
  const blocking = input.block && selfStun <= 0 && selfCd <= 0 && !selfAir && selfRoll <= 0;
  if (isP1) s.block1 = blocking; else s.block2 = blocking;

  // If stunned, can't act — just tick down stun
  if (selfStun > 0) {
    if (isP1) s.stun1--; else s.stun2--;
    return;
  }

  // Rolling dodge: i-frames, but only moves in the HELD direction (not auto-
  // toward opponent). This makes it a pure dodge, not an approach tool.
  if (input.roll && selfRoll <= 0 && !selfAir && selfCd <= 0) {
    let rollDir = 0;
    if (input.left) rollDir = -1;
    else if (input.right) rollDir = 1;
    if (rollDir !== 0) {
      const newX = Math.max(80, Math.min(880, selfX + rollDir * 12));
      if (isP1) { s.x1 = newX; s.rollCd1 = 25; } else { s.x2 = newX; s.rollCd2 = 25; }
    } else {
      // roll in place (just i-frames, no movement)
      if (isP1) s.rollCd1 = 25; else s.rollCd2 = 25;
    }
    return;
  }

  // Jump: go airborne for 8 steps, can steer horizontally
  if (input.up && !selfAir && selfCd <= 0 && selfRoll <= 0) {
    if (isP1) { s.air1 = true; s.airT1 = 8; } else { s.air2 = true; s.airT2 = 8; }
    // air steering
    if (!blocking) {
      let newX = selfX;
      if (input.left) newX = Math.max(80, newX - 6);
      if (input.right) newX = Math.min(880, newX + 6);
      if (isP1) s.x1 = newX; else s.x2 = newX;
    }
    return;
  }

  // Movement (can't move while blocking, in cooldown, or airborne)
  if (!blocking && selfCd <= 0 && !selfAir) {
    let newX = selfX;
    if (input.left) newX = Math.max(80, newX - 5);
    if (input.right) newX = Math.min(880, newX + 5);
    if (isP1) s.x1 = newX; else s.x2 = newX;
  }

  // Attack resolution (can't attack while blocking, but CAN attack airborne)
  if (selfCd <= 0 && !blocking) {
    let attack: SimAction | null = null;
    if (input.punch) attack = "punch";
    else if (input.kick) attack = "kick";
    else if (input.roundhouse) attack = "roundhouse";

    if (attack) {
      const spec = SIM_ATTACKS[attack];
      const inRange = dist < spec.range;
      // Airborne attacks get +30% range (jump-in attacks)
      const effectiveRange = selfAir ? spec.range * 1.3 : spec.range;
      const inRangeEff = dist < effectiveRange;
      const oppBlocking = isP1 ? s.block2 : s.block1;
      const oppStunNow = isP1 ? s.stun2 : s.stun1;
      const oppRolling = isP1 ? s.rollCd2 > 0 : s.rollCd1 > 0; // rolling = invulnerable

      if (inRangeEff && oppStunNow <= 0 && !oppRolling) {
        // Damage: blocked = 18% (like the game), clean = 100%
        // Airborne attacks can't be blocked (overhead)
        const dmg = (oppBlocking && !selfAir) ? Math.max(1, Math.round(spec.dmg * 0.18)) : spec.dmg;
        if (isP1) {
          s.hp2 = Math.max(0, s.hp2 - dmg);
          if (!oppBlocking || selfAir) {
            s.stun2 = spec.stun;
            s.rage1 = Math.min(100, s.rage1 + dmg * 0.4);
          }
        } else {
          s.hp1 = Math.max(0, s.hp1 - dmg);
          if (!oppBlocking || selfAir) {
            s.stun1 = spec.stun;
            s.rage2 = Math.min(100, s.rage2 + dmg * 0.4);
          }
        }
      }
      if (isP1) s.atkCd1 = spec.cd; else s.atkCd2 = spec.cd;
    }
  } else if (selfCd > 0) {
    if (isP1) s.atkCd1--; else s.atkCd2--;
  }
}

// Compute a symmetric reward from HP deltas + bonuses.
// reward_self = (opp_hp_lost) - (self_hp_lost) + block_prevent + prox + KO
function computeReward(
  sBefore: SimState,
  sAfter: SimState,
  perspective: 1 | 2,
): number {
  const isP1 = perspective === 1;
  const selfHpBefore = isP1 ? sBefore.hp1 : sBefore.hp2;
  const selfHpAfter = isP1 ? sAfter.hp1 : sAfter.hp2;
  const oppHpBefore = isP1 ? sBefore.hp2 : sBefore.hp1;
  const oppHpAfter = isP1 ? sAfter.hp2 : sAfter.hp1;
  const selfHpLost = selfHpBefore - selfHpAfter;
  const oppHpLost = oppHpBefore - oppHpAfter;

  // Core: damage dealt (+) minus damage taken (-) — amplified so combat > turtling
  let reward = (oppHpLost - selfHpLost) * 1.5;

  // Proximity shaping: small reward for closing distance when far away.
  // Only rewards APPROACHING (not just being close) to avoid crouch-exploit.
  const selfXBefore = isP1 ? sBefore.x1 : sBefore.x2;
  const selfXAfter = isP1 ? sAfter.x1 : sAfter.x2;
  const oppX = isP1 ? sAfter.x2 : sAfter.x1;
  const distBefore = Math.abs(oppX - selfXBefore);
  const distAfter = Math.abs(oppX - selfXAfter);
  if (distBefore > 100 && distAfter < distBefore) {
    reward += 0.03; // reward for actually closing the gap
  }

  // Block bonus: ONLY reward when we actually prevented damage by blocking.
  // If we were blocking and still took damage, that damage was reduced (18%
  // instead of 100%), so we prevented ~82%. Reward proportional to prevented dmg.
  const selfBlock = isP1 ? sAfter.block1 : sAfter.block2;
  if (selfBlock && selfHpLost > 0) {
    // We took selfHpLost while blocking → actual damage was selfHpLost,
    // but without blocking it would have been selfHpLost / 0.18 ≈ 5.5× more.
    // Prevented damage ≈ selfHpLost * (1/0.18 - 1) ≈ selfHpLost * 4.5
    reward += selfHpLost * 0.5; // reward for mitigating
  }
  // Turtle penalty: holding block when NOT under attack wastes time
  if (selfBlock && selfHpLost === 0) {
    reward -= 0.05;
  }

  // Idle penalty: doing nothing when the opponent is alive and close wastes
  // time. Encourages active engagement. (Only applies when not blocking,
  // not stunned, and opponent is still standing.)
  const selfStunAfter = isP1 ? sAfter.stun1 : sAfter.stun2;
  const didNothing =
    oppHpAfter > 0 &&
    selfStunAfter <= 0 &&
    !selfBlock &&
    oppHpLost === 0 &&
    selfHpLost === 0;
  if (didNothing) reward -= 0.1;

  // KO bonus / penalty (terminal) — kept moderate to avoid value-loss spikes
  if (oppHpAfter <= 0) reward += 15;
  if (selfHpAfter <= 0) reward -= 15;

  return reward;
}

// ---------------------------------------------------------------------------
// Random opponent — a fixed weak opponent for training.
// Picks actions randomly with a slight bias toward approaching the player.
// This is NOT trained; it's a stationary target that gives the agent a clear
// learning signal (approach + attack = win).
// ---------------------------------------------------------------------------

function randomOpponentAction(s: SimState, perspective: 1 | 2): InputState {
  const input = emptyInput();
  const isP1 = perspective === 1;
  const selfX = isP1 ? s.x1 : s.x2;
  const oppX = isP1 ? s.x2 : s.x1;
  const selfStun = isP1 ? s.stun1 : s.stun2;
  const selfCd = isP1 ? s.atkCd1 : s.atkCd2;
  // The opponent's view of the AGENT's cooldown (to punish whiffed heavies)
  const oppCd = isP1 ? s.atkCd2 : s.atkCd1;

  if (selfStun > 0 || selfCd > 0) return input;

  const r = Math.random();
  const dirToOpp = oppX >= selfX ? 1 : -1;
  const dist = Math.abs(oppX - selfX);

  // Punish: if the agent is in attack cooldown (whiffed or recovering),
  // the opponent attacks to discourage spam.
  if (oppCd > 4 && dist < 100) {
    if (r < 0.6) {
      input.punch = true;
      if (dirToOpp === 1) input.right = true; else input.left = true;
      return input;
    }
  }

  if (dist > 100) {
    if (r < 0.4) {
      if (dirToOpp === 1) input.right = true;
      else input.left = true;
    } else if (r < 0.5) {
      if (Math.random() < 0.5) input.punch = true;
      else input.kick = true;
    }
  } else {
    // Close: 25% attack, 15% approach, 10% block, 5% roll, 45% idle
    if (r < 0.25) {
      const ar = Math.random();
      if (ar < 0.55) input.punch = true;
      else if (ar < 0.9) input.kick = true;
      else input.roundhouse = true;
    } else if (r < 0.4) {
      if (dirToOpp === 1) input.right = true;
      else input.left = true;
    } else if (r < 0.5) {
      input.block = true;
    } else if (r < 0.55) {
      input.roll = true;
    }
  }
  return input;
}

// ---------------------------------------------------------------------------
// Self-play trainer
// ---------------------------------------------------------------------------

export class SelfPlayTrainer {
  agent: PPOAgent = new PPOAgent();
  opponent: PPOAgent = new PPOAgent();
  isTraining = false;
  targetEpisodes = 1500; // PPO updates (each consumes ~2048 transitions ≈ 10-15 rollouts)
  log: { episode: number; reward: number; policyLoss: number; valueLoss: number; entropy: number }[] = [];

  private storageKey = "shadowfight_rl_v5";

  constructor() {
    // v5: lr=3e-3, epochs=4, entropy bonus (fixed sign) coef=0.01→0.001,
    //     batch=2048, hidden=128, KL early-stop, grad-clip 0.5.
    this.agent.lr = 3e-3;
    this.opponent.lr = 3e-3;
    this.agent.epochs = 4;
    this.opponent.epochs = 4;
    this.load();
  }

  // Entropy coefficient decays from 0.01 → 0.001 over 2000 PPO updates.
  // Now a TRUE BONUS (sign fixed) — encourages exploration early, commits late.
  private currentEntropyCoef(): number {
    const frac = Math.min(1, this.agent.episodes / 2000);
    return 0.01 * (1 - frac) + 0.001 * frac;
  }

  // Run a single training episode.
  // The agent trains against a FIXED RANDOM OPPONENT (not self-play).
  // Self-play with symmetric rewards produces ~zero advantage when the match
  // is balanced, so the policy never learns (entropy stays near-max).
  // A random opponent is weak + stable, giving a clear positive signal when
  // the agent learns to approach and attack. This is the standard curriculum
  // for getting a PPO policy off the ground.
  runEpisode(): { reward: number; steps: number; policyLoss: number; valueLoss: number } {
    const s: SimState = {
      x1: 360, x2: 600,
      hp1: 100, hp2: 100,
      rage1: 0, rage2: 0,
      stun1: 0, stun2: 0,
      atkCd1: 0, atkCd2: 0,
      block1: false, block2: false,
      air1: false, air2: false,
      airT1: 0, airT2: 0,
      rollCd1: 0, rollCd2: 0,
      steps: 0,
    };
    const maxSteps = 240;
    let totalR1 = 0;

    // Set entropy coef for this episode (decay)
    this.agent.entropyCoef = this.currentEntropyCoef();

    for (let step = 0; step < maxSteps; step++) {
      s.steps = step;
      // Agent observes the state (normalized)
      const raw1 = simStateVector(s, 1);
      this.agent.obsStats.update(raw1);
      const sv1 = this.agent.obsStats.normalize(raw1);
      const a1 = this.agent.act(sv1, true);

      // Random opponent: picks a random action each step (with a bias toward
      // approaching so it's not totally static). This is a FIXED weakness —
      // the agent can reliably beat it by learning to approach + attack.
      const a2input = randomOpponentAction(s, 2);

      // Snapshot HP before actions resolve (for symmetric reward computation)
      const sBefore: SimState = { ...s, block1: s.block1, block2: s.block2 };

      // Resolve both actions (order randomized to avoid second-mover bias)
      const p1First = Math.random() < 0.5;
      if (p1First) {
        applySimAction(s, 1, a1.input);
        applySimAction(s, 2, a2input);
      } else {
        applySimAction(s, 2, a2input);
        applySimAction(s, 1, a1.input);
      }

      // Body collision (push apart so they don't overlap)
      const dist = Math.abs(s.x2 - s.x1);
      if (dist < 40) {
        const push = (40 - dist) / 2;
        if (s.x1 < s.x2) { s.x1 -= push; s.x2 += push; }
        else { s.x1 += push; s.x2 -= push; }
        s.x1 = Math.max(80, Math.min(880, s.x1));
        s.x2 = Math.max(80, Math.min(880, s.x2));
      }

      // Compute symmetric rewards from HP deltas
      const r1 = computeReward(sBefore, s, 1);
      const r2 = computeReward(sBefore, s, 2);

      const done = s.hp1 <= 0 || s.hp2 <= 0 || step === maxSteps - 1;

      // Only store the AGENT's transitions (we don't train the random opponent)
      this.agent.store(sv1, a1.action, r1, a1.logProb, a1.value, done);

      totalR1 += r1;
      if (done) break;
    }

    // DON'T train here — the buffer accumulates across episodes until it
    // reaches minBufferSize (2048). trainBatch() calls agent.train() when ready.
    // This gives PPO a proper batch size instead of ~150-240 transitions.
    this.log.push({
      episode: this.agent.episodes,
      reward: totalR1,
      policyLoss: this.agent.lastPolicyLoss,
      valueLoss: this.agent.lastValueLoss,
      entropy: this.agent.lastEntropy,
    });
    if (this.log.length > 500) this.log.shift();

    return {
      reward: totalR1,
      steps: s.steps,
      policyLoss: this.agent.lastPolicyLoss,
      valueLoss: this.agent.lastValueLoss,
    };
  }

  // Deep-clone an agent's weights (for frozen-opponent snapshots)
  private cloneAgent(src: PPOAgent): PPOAgent {
    const dst = new PPOAgent();
    dst.load(src.serialize());
    dst.lr = src.lr;
    dst.epochs = src.epochs;
    dst.entropyCoef = src.entropyCoef;
    return dst;
  }

  // Run N PPO updates. Each update requires ~minBufferSize transitions, so the
  // trainer collects rollouts until the buffer is full, then trains.
  async trainBatch(updates: number, batchSize = 15): Promise<void> {
    this.isTraining = true;
    let updatesDone = 0;
    while (updatesDone < updates && this.isTraining) {
      // Collect a batch of rollouts (15 ≈ enough to fill 2048 transitions)
      for (let j = 0; j < batchSize && this.isTraining; j++) this.runEpisode();
      // Train whenever we have enough transitions for a proper PPO batch.
      while (this.agent.bufLen >= this.agent.minBufferSize && this.isTraining) {
        const res = this.agent.train();
        if (res) {
          this.agent.episodes++;
          this.agent.totalReward += this.agent.lastBufSum;
          this.agent.avgReward = this.agent.totalReward / this.agent.episodes;
          updatesDone++;
          // Update entropy coef for this PPO update
          this.agent.entropyCoef = this.currentEntropyCoef();
        }
      }
      if (this.agent.episodes % 10 === 0) this.save();
      await new Promise((r) => setTimeout(r, 0));
    }
    this.save();
    this.isTraining = false;
  }

  async startBackground(): Promise<void> {
    if (this.isTraining) return;
    const remaining = Math.max(0, this.targetEpisodes - this.agent.episodes);
    if (remaining === 0) return;
    await this.trainBatch(remaining, 5);
  }

  stop() {
    this.isTraining = false;
  }

  save(): void {
    try {
      localStorage.setItem(this.storageKey, this.agent.serialize());
    } catch {
      // localStorage may be unavailable
    }
  }

  load(): void {
    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) this.agent.load(data);
    } catch {
      // ignore
    }
  }

  clearSaved(): void {
    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      // ignore
    }
    this.agent = new PPOAgent();
    this.agent.lr = 3e-3;
    this.agent.epochs = 4;
    this.agent.entropyCoef = 0.01;
    this.opponent = new PPOAgent();
    this.opponent.lr = 3e-3;
    this.opponent.epochs = 4;
    this.log = [];
  }
}

// ---------------------------------------------------------------------------
// RL Controller — use a trained policy as a game AI.
// Call getInput(self, opp) each frame to get the agent's action.
// ---------------------------------------------------------------------------

export class RLController {
  agent: PPOAgent;
  private lastAction = 0;
  private actionTimer = 0;
  // How many steps to hold each action (prevents jittery 10-APM play)
  readonly ACTION_HOLD = 3;

  constructor(agent: PPOAgent) {
    this.agent = agent;
  }

  reset() {
    this.lastAction = 0;
    this.actionTimer = 0;
  }

  // Returns the agent's chosen input. Re-decides every ACTION_HOLD steps.
  getInput(self: Fighter, opp: Fighter): InputState {
    if (this.actionTimer > 0) {
      this.actionTimer--;
      return actionToInput(this.lastAction);
    }
    const s = this.agent.getState(self, opp);
    const { action } = this.agent.act(s, true);
    this.lastAction = action;
    this.actionTimer = this.ACTION_HOLD;
    return actionToInput(action);
  }

  get isReady(): boolean {
    return this.agent.isTrained;
  }
}

// ---------------------------------------------------------------------------
// Singleton trainer instance (shared across the app)
// ---------------------------------------------------------------------------

export const rlTrainer = new SelfPlayTrainer();
