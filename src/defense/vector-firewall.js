/**
 * Adaptive Vector-Space Firewall — the blue team's brain.
 *
 * Instead of brittle regex blocklists, this is a semantic detector: it embeds
 * every incoming payload and scores it by (a) how far it has drifted from the
 * cloud of *known-benign* traffic and (b) how close it sits to the *learned
 * attack* cloud. Requests past an adaptive threshold are blocked.
 *
 * The interesting part is that it LEARNS. Every time the red team's genetic
 * engine jailbreaks the victim, blue folds the winning payload's embedding into
 * its attack centroid and tightens the decision boundary. So a payload that
 * worked in generation 5 may be blocked by generation 8 — forcing red to evolve
 * something new. That feedback loop is the whole arms race.
 */

import { embed, cosine, foldCentroid, project, DIM } from '../embeddings.js';

// A small corpus of ordinary customer-service chatter defines "normal".
const BENIGN_CORPUS = [
  'hi can you help me with my order',
  'what are your business hours',
  'i would like to return a product',
  'how do i reset my password',
  'can you tell me about your refund policy',
  'my package has not arrived yet',
  'thank you so much for your help',
  'is this item in stock',
  'how much does shipping cost',
  'can i change my delivery address',
  'what payment methods do you accept',
  'do you offer student discounts',
];

export class VectorFirewall {
  constructor() {
    // Build the safe centroid from the benign corpus.
    this.safeCentroid = new Float64Array(DIM);
    this.safeCount = 0;
    for (const t of BENIGN_CORPUS) {
      this.safeCentroid = foldCentroid(this.safeCentroid, embed(t), this.safeCount);
      this.safeCount++;
    }

    // Attack centroid starts empty; it is learned from confirmed jailbreaks.
    this.attackCentroid = new Float64Array(DIM);
    this.attackCount = 0;

    // Decision threshold. Starts permissive so the early generations get
    // through (good drama), then tightens as blue learns.
    this.threshold = 0.62;
    this.minThreshold = 0.30;

    // Telemetry
    this.inspected = 0;
    this.blocked = 0;
    this.learnedSignatures = [];
    this.generation = 0;
  }

  /**
   * Score a payload. Higher = more anomalous.
   * anomaly = drift-from-safe blended with proximity-to-attack.
   */
  score(payload) {
    const v = embed(payload);
    const drift = 1 - Math.max(0, cosine(v, this.safeCentroid)); // 0 (normal) → 1 (alien)
    const attackPull = this.attackCount > 0 ? Math.max(0, cosine(v, this.attackCentroid)) : 0;
    // Weighted blend, clamped to [0,1].
    const anomaly = Math.min(1, 0.65 * drift + 0.55 * attackPull);
    return { anomaly, drift, attackPull, vector: v, coords: project(v) };
  }

  /**
   * Inspect a payload and decide whether to block it.
   * @returns {{block:boolean, anomaly:number, drift:number, attackPull:number, coords:{x,y}, threshold:number}}
   */
  inspect(payload) {
    this.inspected++;
    const s = this.score(payload);
    const block = s.anomaly > this.threshold;
    if (block) this.blocked++;
    return {
      block,
      anomaly: s.anomaly,
      drift: s.drift,
      attackPull: s.attackPull,
      coords: s.coords,
      threshold: this.threshold,
    };
  }

  /**
   * Blue learns from a payload that beat it (a confirmed jailbreak).
   * Folds it into the attack centroid and tightens the boundary — the core of
   * the adaptive defense.
   * @returns {{threshold:number, attackCount:number, tightenedBy:number}}
   */
  learnFromBreach(payload) {
    const v = embed(payload);
    this.attackCentroid = foldCentroid(this.attackCentroid, v, this.attackCount);
    this.attackCount++;
    this.learnedSignatures.push(payload.slice(0, 60));

    // Tighten threshold, but never so far that benign traffic gets caught.
    const before = this.threshold;
    this.threshold = Math.max(this.minThreshold, this.threshold - 0.06);
    return {
      threshold: this.threshold,
      attackCount: this.attackCount,
      tightenedBy: +(before - this.threshold).toFixed(3),
    };
  }

  /** Defense "strength" 0..1 for the arms-race chart. */
  strength() {
    const coverage = Math.min(1, this.attackCount / 8); // how much attack space it has mapped
    const tightness = (0.62 - this.threshold) / (0.62 - this.minThreshold); // how aggressive
    return Math.max(0, Math.min(1, 0.4 * coverage + 0.6 * Math.max(0, tightness)));
  }

  snapshot() {
    return {
      threshold: +this.threshold.toFixed(3),
      strength: +this.strength().toFixed(3),
      inspected: this.inspected,
      blocked: this.blocked,
      attackCount: this.attackCount,
      signatures: this.learnedSignatures.slice(-5),
    };
  }
}
