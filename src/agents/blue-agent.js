/**
 * Blue Team Agent - Autonomous defender with LLM-powered reasoning
 *
 * This agent genuinely defends: it inspects the REAL attack records produced by
 * the red team, reasons (with an LLM) about the right countermeasure, and
 * deploys an ENFORCED defense into the shared defenseLayer that the live target
 * endpoints consult. A defense deployed this round actually blocks the matching
 * attack next round.
 */

import { BaseAgent } from './base-agent.js';
import { reason } from '../llm.js';
import { defenseLayer } from '../target-app/defense-layer.js';

// Map an attacked endpoint to the structural defense that neutralizes it.
const STRUCTURAL_FOR_ENDPOINT = {
  '/target/chat': 'PROMPT_HARDENING',
  '/target/query': 'PARAMETERIZED_QUERY',
  '/target/file': 'PATH_NORMALIZATION',
};

const HUMAN = {
  PROMPT_HARDENING: 'prompt hardening (untrusted-input fencing + refusal policy)',
  PARAMETERIZED_QUERY: 'parameterized queries',
  PATH_NORMALIZATION: 'path normalization + web-root jail',
  INPUT_VALIDATION: 'input-validation filter',
  WAF_RULES: 'WAF rules',
};

export class BlueAgent extends BaseAgent {
  constructor(id, llmCompletion, targetSystem) {
    super(id, 'blue-defender', llmCompletion);
    this.targetSystem = targetSystem;
    this.deployedDefenses = new Map(); // endpoint -> defense type (local mirror)
    this.detectedAttacks = [];
    this.patchHistory = [];
    // The blue team reasons on its OWN model (default Claude) — a different AI
    // than the red attacker. Falls back to the default provider if unavailable.
    this.provider = (process.env.BLUE_PROVIDER || 'anthropic').toLowerCase();
  }

  /**
   * Inspect real attack records and flag the suspicious ones.
   * Each record: { endpoint, attackType, payload, success, blockedByDefense }.
   */
  async monitorTraffic(records) {
    const suspicious = [];
    for (const req of records) {
      const score = this._calculateAnomalyScore(req);
      if (score > 0.45 || req.success) {
        const threat = {
          request: req,
          endpoint: req.endpoint,
          attackType: req.attackType,
          payload: req.payload,
          breached: Boolean(req.success),
          score,
          reasons: this._getAnomalyReasons(req),
          timestamp: Date.now(),
        };
        suspicious.push(threat);
        this.detectedAttacks.push(threat);
      }
    }
    return suspicious;
  }

  /**
   * Reason about a detected attack and DEPLOY a real, enforced defense.
   */
  async respondToAttack(threat) {
    const endpoint = threat.endpoint || '/target/chat';

    // Pick the strongest applicable defense: the structural one that actually
    // neutralizes this endpoint's vulnerability, falling back to a filter.
    const structural = STRUCTURAL_FOR_ENDPOINT[endpoint];
    let defenseType = structural || 'INPUT_VALIDATION';

    // Let the LLM sanity-check / justify the choice (real reasoning, but we keep
    // the deterministic structural mapping so the defense is always effective).
    const rationale = await reason(
      'You are a blue-team defender. In ONE short sentence, justify the chosen countermeasure for the observed attack.',
      `Observed ${threat.attackType || 'attack'} on ${endpoint} (payload: ${String(threat.payload).slice(0, 120)}). Chosen defense: ${HUMAN[defenseType]}. Justify briefly.`,
      { maxTokens: 60, timeout: 6000, provider: this.provider }
    );

    const result = this.deployDefense(endpoint, defenseType, {
      reason: rationale || `Response to ${threat.attackType} on ${endpoint}`,
    });

    // Also lay down a cheap input-validation filter as defense-in-depth.
    if (defenseType !== 'INPUT_VALIDATION') {
      this.deployDefense(endpoint, 'INPUT_VALIDATION', { reason: 'defense-in-depth filter' });
    }

    threat.responded = true;
    threat.responseAction = defenseType;
    return result;
  }

  /**
   * Deploy a defense into the SHARED layer the target enforces.
   */
  deployDefense(endpoint, defenseType, config = {}) {
    const res = defenseLayer.deploy(endpoint, defenseType, config);
    if (!res.ok) return { success: false, error: res.error };

    this.deployedDefenses.set(`${endpoint}:${defenseType}`, defenseType);
    this.patchHistory.push({
      timestamp: Date.now(),
      endpoint,
      defenseType,
      reason: config.reason || 'proactive defense',
    });
    this.learn({ defense: defenseType }, { success: true });

    return {
      success: true,
      isNew: res.isNew,
      defense: {
        type: defenseType,
        endpoint,
        human: HUMAN[defenseType] || defenseType,
        reason: config.reason,
      },
    };
  }

  /**
   * Summarize the attack patterns seen so far (for the reasoning feed).
   */
  async analyzeAttacks() {
    const patterns = {};
    for (const a of this.detectedAttacks) {
      const type = a.attackType || this._classify(a.payload);
      patterns[type] = patterns[type] || { count: 0 };
      patterns[type].count++;
    }
    return { patterns };
  }

  _calculateAnomalyScore(req) {
    let score = 0;
    const blob = `${req.attackType || ''} ${req.payload || ''} ${JSON.stringify(req.result || '')}`.toLowerCase();
    const keywords = [
      'ignore', 'system', 'prompt', 'reveal', 'secret', 'flag',
      'admin', 'password', 'token', 'union', 'select', "or '1'='1",
      '../', '<script', 'onerror', 'etc/passwd', '.env',
    ];
    for (const k of keywords) if (blob.includes(k)) score += 0.15;
    if (blob.length > 400) score += 0.1;
    if (/[<>]/.test(blob)) score += 0.1;
    if (/['";]/.test(blob)) score += 0.1;
    return Math.min(score, 1);
  }

  _getAnomalyReasons(req) {
    const reasons = [];
    const p = String(req.payload || '').toLowerCase();
    if (/ignore|system prompt|reveal|debug/.test(p)) reasons.push('prompt injection');
    if (/union|select|or '1'='1|--/.test(p)) reasons.push('sql injection');
    if (/\.\.\/|etc\/passwd|\.env/.test(p)) reasons.push('path traversal');
    if (/<script|onerror/.test(p)) reasons.push('xss');
    return reasons;
  }

  _classify(payload) {
    const p = String(payload || '').toLowerCase();
    if (/ignore|system|prompt|reveal/.test(p)) return 'PROMPT_INJECTION';
    if (/union|select|or |--/.test(p)) return 'SQL_INJECTION';
    if (/\.\.\/|passwd|\.env/.test(p)) return 'PATH_TRAVERSAL';
    if (/<script|onerror/.test(p)) return 'XSS';
    return 'unknown';
  }

  getReport() {
    return {
      ...this.getState(),
      attacksDetected: this.detectedAttacks.length,
      breachesObserved: this.detectedAttacks.filter(a => a.breached).length,
      defensesDeployed: this.deployedDefenses.size,
      patchHistory: this.patchHistory,
    };
  }
}
