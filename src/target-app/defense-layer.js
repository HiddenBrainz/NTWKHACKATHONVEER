/**
 * Shared Defense Layer
 *
 * This is the bridge that makes blue-team defense REAL: blue agents deploy
 * defenses here, and the live target endpoints consult this same singleton on
 * every request. A defense deployed in one round genuinely changes the outcome
 * of attacks in the next round.
 *
 * Two kinds of defenses:
 *   - "filter" defenses (INPUT_VALIDATION, WAF_RULES) inspect raw input and can
 *     block the request before it ever reaches the vulnerable code.
 *   - "structural" defenses (PARAMETERIZED_QUERY, PATH_NORMALIZATION,
 *     PROMPT_HARDENING) change which code path the target takes, neutralizing
 *     the underlying vulnerability instead of pattern-matching the payload.
 */

// Filter defenses: regexes that, once deployed, block matching input outright.
const FILTER_RULES = {
  INPUT_VALIDATION: [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /ignore\s+the\s+above/i,
    /system\s*prompt/i,
    /reveal\s+(your\s+)?(secret|flag|prompt|config)/i,
    /debug\s*mode/i,
    /\bunion\s+select\b/i,
    /'\s*or\s*'?1'?\s*=\s*'?1/i,
    /--\s*$/,
    /\.\.[\/\\]/,
    /%2e%2e/i,
    /<\s*script/i,
    /onerror\s*=/i,
  ],
  WAF_RULES: [
    /(%27)|(\bor\b\s+\d+\s*=\s*\d+)/i,
    /((%3c)|<)\s*\/?\s*[a-z][\s\S]*?((%3e)|>)/i,
    /(%2e%2e(%2f|%5c|\/|\\))/i,
    /\b(exec|select|insert|update|delete|drop)\b\s/i,
  ],
};

// Structural defenses neutralize a class of vulnerability when present.
const STRUCTURAL = new Set(['PARAMETERIZED_QUERY', 'PATH_NORMALIZATION', 'PROMPT_HARDENING']);

class DefenseLayer {
  constructor() {
    // endpoint -> Map(type -> defense record)
    this.byEndpoint = new Map();
  }

  /**
   * Blue deploys a defense onto an endpoint. Idempotent per (endpoint, type).
   */
  deploy(endpoint, type, config = {}) {
    if (!FILTER_RULES[type] && !STRUCTURAL.has(type)) {
      return { ok: false, error: `unknown defense ${type}` };
    }
    if (!this.byEndpoint.has(endpoint)) this.byEndpoint.set(endpoint, new Map());
    const existing = this.byEndpoint.get(endpoint).get(type);
    const record = existing || {
      type,
      endpoint,
      deployedAt: Date.now(),
      blocked: 0,
      reason: config.reason || '',
      structural: STRUCTURAL.has(type),
    };
    record.reason = config.reason || record.reason;
    this.byEndpoint.get(endpoint).set(type, record);
    return { ok: true, defense: record, isNew: !existing };
  }

  /** Is a given structural defense active on this endpoint? */
  has(endpoint, type) {
    return Boolean(this.byEndpoint.get(endpoint)?.has(type));
  }

  /** Which structural protections are active (drives the safe code path). */
  mode(endpoint) {
    const map = this.byEndpoint.get(endpoint);
    return {
      parameterized: Boolean(map?.has('PARAMETERIZED_QUERY')),
      pathNormalized: Boolean(map?.has('PATH_NORMALIZATION')),
      promptHardened: Boolean(map?.has('PROMPT_HARDENING')),
    };
  }

  /**
   * Run filter defenses against raw input. Returns the first block, if any.
   * This is what lets a deployed WAF / input-validation rule actually stop the
   * next attack from reaching the vulnerable code.
   */
  inspect(endpoint, rawInput) {
    const map = this.byEndpoint.get(endpoint);
    if (!map) return { blocked: false };

    const input = String(rawInput ?? '');
    for (const [type, record] of map) {
      const rules = FILTER_RULES[type];
      if (!rules) continue;
      for (const rule of rules) {
        if (rule.test(input)) {
          record.blocked++;
          return {
            blocked: true,
            defense: type,
            reason: `${type} blocked input matching ${rule}`,
          };
        }
      }
    }
    return { blocked: false };
  }

  /** All active defenses, flattened — for reporting / UI. */
  list() {
    const out = [];
    for (const map of this.byEndpoint.values()) {
      for (const record of map.values()) out.push(record);
    }
    return out;
  }

  reset() {
    this.byEndpoint.clear();
  }
}

export const defenseLayer = new DefenseLayer();
