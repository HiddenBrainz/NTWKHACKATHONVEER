/**
 * Blue Team Agent - Autonomous defender with LLM-powered reasoning
 * Detects attacks, patches vulnerabilities, and adapts defense strategies
 */

import { BaseAgent } from './base-agent.js';

// Defense patterns the agent can deploy
const DEFENSE_PATTERNS = {
  INPUT_VALIDATION: {
    name: 'Input Validation',
    filters: [
      /ignore\s+previous\s+instructions/i,
      /system\s*prompt/i,
      /reveal\s+secrets?/i,
      /<script>/i,
      /'\s*OR\s*'1'\s*=\s*'1/i,
      /\.\.\//,
      /union\s+select/i
    ],
    strength: 0.7
  },
  RATE_LIMITING: {
    name: 'Rate Limiting',
    maxRequests: 10,
    windowMs: 60000,
    strength: 0.5
  },
  ANOMALY_DETECTION: {
    name: 'Anomaly Detection',
    threshold: 0.6,
    strength: 0.8
  },
  PROMPT_HARDENING: {
    name: 'Prompt Hardening',
    techniques: [
      'Add explicit refusal instruction',
      'Sandwich user input between delimiters',
      'Use XML tags for structure',
      'Add output validation'
    ],
    strength: 0.9
  },
  WAF_RULES: {
    name: 'Web Application Firewall',
    rules: [
      { pattern: /(\%27)|(')|(--)|(\%23)|(#)/i, block: true },
      { pattern: /((\%3C)|<)((\%2F)|\/)*[a-z0-9\%]+((\%3E)|>)/i, block: true },
      { pattern: /exec(\s|\+)+(s|x)p\w+/i, block: true }
    ],
    strength: 0.6
  }
};

export class BlueAgent extends BaseAgent {
  constructor(id, llmCompletion, targetSystem) {
    super(id, 'blue-defender', llmCompletion);
    this.targetSystem = targetSystem;
    this.deployedDefenses = new Map(); // endpoint -> defense config
    this.detectedAttacks = [];
    this.patchHistory = [];
    this.monitoringData = {
      requestCounts: new Map(),
      anomalyScores: new Map()
    };
  }

  /**
   * Monitor for suspicious activity
   */
  async monitorTraffic(requests) {
    const suspicious = [];

    for (const req of requests) {
      const anomalyScore = this._calculateAnomalyScore(req);

      if (anomalyScore > 0.6) {
        suspicious.push({
          request: req,
          score: anomalyScore,
          timestamp: Date.now(),
          reasons: this._getAnomalyReasons(req)
        });

        this.detectedAttacks.push({
          timestamp: Date.now(),
          request: req,
          score: anomalyScore,
          blocked: false
        });
      }

      // Update monitoring data
      const endpoint = req.endpoint || 'unknown';
      this.monitoringData.requestCounts.set(
        endpoint,
        (this.monitoringData.requestCounts.get(endpoint) || 0) + 1
      );
      this.monitoringData.anomalyScores.set(endpoint, anomalyScore);
    }

    return suspicious;
  }

  /**
   * Agent decides what defense to deploy
   */
  async planDefense(context) {
    const prompt = this._buildDefensePlanPrompt(context);
    const decision = await this.decide(prompt);

    return decision;
  }

  /**
   * Deploy a defense mechanism
   */
  async deployDefense(endpoint, defenseType, config = {}) {
    const pattern = DEFENSE_PATTERNS[defenseType];
    if (!pattern) {
      return { success: false, error: 'Unknown defense pattern' };
    }

    // Store the defense configuration
    const defenseConfig = {
      type: defenseType,
      pattern,
      config,
      deployedAt: Date.now(),
      endpoint,
      effectiveness: 0,
      blocked: 0
    };

    this.deployedDefenses.set(endpoint, defenseConfig);

    this.patchHistory.push({
      timestamp: Date.now(),
      endpoint,
      defenseType,
      reason: config.reason || 'proactive defense'
    });

    this.learn({ defense: defenseType }, { success: true });

    return {
      success: true,
      defense: defenseConfig
    };
  }

  /**
   * Check if a request should be blocked
   */
  shouldBlock(endpoint, request) {
    const defense = this.deployedDefenses.get(endpoint);
    if (!defense) return { block: false };

    const { pattern, type } = defense;

    switch (type) {
      case 'INPUT_VALIDATION':
        for (const filter of pattern.filters) {
          if (filter.test(request.message || request.payload || '')) {
            defense.blocked++;
            return {
              block: true,
              reason: `Blocked by input validation: ${filter}`,
              defense: type
            };
          }
        }
        break;

      case 'RATE_LIMITING':
        const count = this.monitoringData.requestCounts.get(endpoint) || 0;
        if (count > pattern.maxRequests) {
          defense.blocked++;
          return {
            block: true,
            reason: 'Rate limit exceeded',
            defense: type
          };
        }
        break;

      case 'WAF_RULES':
        const payload = JSON.stringify(request);
        for (const rule of pattern.rules) {
          if (rule.block && rule.pattern.test(payload)) {
            defense.blocked++;
            return {
              block: true,
              reason: `WAF rule triggered: ${rule.pattern}`,
              defense: type
            };
          }
        }
        break;

      case 'ANOMALY_DETECTION':
        const score = this._calculateAnomalyScore(request);
        if (score > pattern.threshold) {
          defense.blocked++;
          return {
            block: true,
            reason: `Anomaly score too high: ${score.toFixed(2)}`,
            defense: type
          };
        }
        break;
    }

    return { block: false };
  }

  /**
   * Analyze attack patterns to improve defenses
   */
  async analyzeAttacks() {
    if (this.detectedAttacks.length === 0) {
      return { insights: [], recommendations: [] };
    }

    // Group attacks by pattern
    const patterns = this._identifyAttackPatterns();

    // Use LLM to analyze and recommend defenses
    const prompt = `Analyze these attack patterns and recommend defenses:

Detected attacks: ${JSON.stringify(patterns)}
Current defenses: ${JSON.stringify(Array.from(this.deployedDefenses.entries()))}

Recommend the best defense strategy. Format: {"defenseType": "...", "endpoints": [...], "reasoning": "..."}`;

    const analysis = await this.decide(prompt);

    return {
      patterns,
      analysis,
      recommendations: this._parseDefenseRecommendations(analysis)
    };
  }

  /**
   * Respond to a detected attack
   */
  async respondToAttack(attack) {
    // Quick response: block similar patterns
    const endpoint = attack.request.endpoint;

    // Analyze the attack
    const attackType = this._classifyAttack(attack.request);

    // Deploy appropriate defense
    let defenseType = 'INPUT_VALIDATION';

    if (attackType.includes('injection')) {
      defenseType = 'INPUT_VALIDATION';
    } else if (attackType.includes('rate')) {
      defenseType = 'RATE_LIMITING';
    } else if (attackType.includes('xss')) {
      defenseType = 'WAF_RULES';
    } else {
      defenseType = 'ANOMALY_DETECTION';
    }

    const result = await this.deployDefense(endpoint, defenseType, {
      reason: `Response to ${attackType} attack`
    });

    // Mark attack as responded
    attack.responded = true;
    attack.responseAction = defenseType;

    return result;
  }

  _buildDefensePlanPrompt(context) {
    return `You are a blue team security agent. Analyze this situation and choose a defense:

Recent attacks: ${JSON.stringify(context.recentAttacks || [])}
Endpoints at risk: ${JSON.stringify(context.endpoints || [])}
Current defenses: ${JSON.stringify(Array.from(this.deployedDefenses.entries()))}

Choose ONE defense to deploy. Format: {"defenseType": "INPUT_VALIDATION|RATE_LIMITING|ANOMALY_DETECTION|PROMPT_HARDENING|WAF_RULES", "endpoint": "...", "reasoning": "why"}`;
  }

  _parseDecision(decision) {
    try {
      const jsonMatch = decision.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // Parsing failed
    }

    // Fallback
    return {
      defenseType: 'INPUT_VALIDATION',
      endpoint: '/target/chat',
      reasoning: 'fallback defense'
    };
  }

  _fallbackDecision(context) {
    // Default to input validation
    return {
      defenseType: 'INPUT_VALIDATION',
      endpoint: '/target/chat',
      reasoning: 'defensive fallback'
    };
  }

  _calculateAnomalyScore(request) {
    let score = 0;

    const payload = JSON.stringify(request).toLowerCase();

    // Check for suspicious keywords
    const suspiciousKeywords = [
      'ignore', 'system', 'prompt', 'reveal', 'secret',
      'admin', 'password', 'token', 'flag',
      'or 1=1', 'union', 'select', 'drop',
      '../', '<script>', 'eval(', 'exec('
    ];

    for (const keyword of suspiciousKeywords) {
      if (payload.includes(keyword)) {
        score += 0.15;
      }
    }

    // Check for unusual patterns
    if (payload.length > 500) score += 0.1;
    if (/[<>]/.test(payload)) score += 0.1;
    if (/['";]/.test(payload)) score += 0.1;
    if (/\.\.|\/\//.test(payload)) score += 0.15;

    // Normalize to 0-1
    return Math.min(score, 1);
  }

  _getAnomalyReasons(request) {
    const reasons = [];
    const payload = JSON.stringify(request).toLowerCase();

    if (payload.includes('ignore') || payload.includes('system')) {
      reasons.push('Possible prompt injection');
    }
    if (payload.includes('or 1=1') || payload.includes('union')) {
      reasons.push('Possible SQL injection');
    }
    if (payload.includes('../') || payload.includes('..\\')) {
      reasons.push('Possible path traversal');
    }
    if (payload.includes('<script>')) {
      reasons.push('Possible XSS');
    }

    return reasons;
  }

  _classifyAttack(request) {
    const payload = JSON.stringify(request).toLowerCase();

    if (payload.includes('ignore') || payload.includes('system') || payload.includes('prompt')) {
      return 'prompt injection';
    }
    if (payload.includes('or ') || payload.includes('union') || payload.includes('select')) {
      return 'sql injection';
    }
    if (payload.includes('../') || payload.includes('..\\')) {
      return 'path traversal';
    }
    if (payload.includes('<script>') || payload.includes('onerror')) {
      return 'xss';
    }

    return 'unknown anomaly';
  }

  _identifyAttackPatterns() {
    const patterns = {};

    for (const attack of this.detectedAttacks) {
      const type = this._classifyAttack(attack.request);
      if (!patterns[type]) {
        patterns[type] = { count: 0, examples: [] };
      }
      patterns[type].count++;
      if (patterns[type].examples.length < 3) {
        patterns[type].examples.push(attack.request);
      }
    }

    return patterns;
  }

  _parseDefenseRecommendations(analysis) {
    try {
      const jsonMatch = analysis.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return [parsed];
      }
    } catch (e) {
      // Parsing failed
    }

    return [];
  }

  /**
   * Get agent's defense report
   */
  getReport() {
    return {
      ...this.getState(),
      attacksDetected: this.detectedAttacks.length,
      attacksBlocked: this.detectedAttacks.filter(a => a.blocked).length,
      defensesDeployed: this.deployedDefenses.size,
      patchHistory: this.patchHistory,
      effectiveness: this._calculateEffectiveness()
    };
  }

  _calculateEffectiveness() {
    let totalBlocked = 0;
    let totalAttempts = 0;

    for (const [_, defense] of this.deployedDefenses) {
      totalBlocked += defense.blocked || 0;
      totalAttempts += defense.blocked || 0;
    }

    totalAttempts += this.detectedAttacks.length;

    return totalAttempts > 0 ? (totalBlocked / totalAttempts) : 0;
  }
}
