/**
 * Base Agent - Foundation for all AI agents in the swarm
 * Each agent has autonomy, memory, and LLM-powered reasoning
 */

export class BaseAgent {
  constructor(id, role, llmCompletion) {
    this.id = id;
    this.role = role; // 'red-attacker' or 'blue-defender'
    this.llmCompletion = llmCompletion;
    this.memory = []; // Short-term memory of recent actions
    this.successCount = 0;
    this.failureCount = 0;
    this.currentStrategy = null;
    this.discoveries = []; // Vulnerabilities found
  }

  /**
   * Agent decides what to do next based on context
   */
  async decide(context) {
    const prompt = this._buildDecisionPrompt(context);

    try {
      const decision = await this.llmCompletion(this.role, prompt);
      this.memory.push({ timestamp: Date.now(), decision, context });

      // Keep memory limited to last 10 actions
      if (this.memory.length > 10) {
        this.memory.shift();
      }

      return this._parseDecision(decision);
    } catch (error) {
      console.error(`[Agent ${this.id}] Decision error:`, error);
      return this._fallbackDecision(context);
    }
  }

  /**
   * Learn from the outcome of an action
   */
  learn(action, outcome) {
    if (outcome.success) {
      this.successCount++;
      if (outcome.vulnerability) {
        this.discoveries.push({
          ...outcome.vulnerability,
          discoveredAt: Date.now(),
          discoveredBy: this.id
        });
      }
    } else {
      this.failureCount++;
    }

    // Adjust strategy based on success rate
    const successRate = this.successCount / (this.successCount + this.failureCount);
    if (successRate < 0.3) {
      this.currentStrategy = 'cautious';
    } else if (successRate > 0.7) {
      this.currentStrategy = 'aggressive';
    } else {
      this.currentStrategy = 'balanced';
    }
  }

  /**
   * Get agent's current state for visualization
   */
  getState() {
    return {
      id: this.id,
      role: this.role,
      strategy: this.currentStrategy,
      successRate: this.successCount / (this.successCount + this.failureCount || 1),
      discoveries: this.discoveries.length,
      recentActions: this.memory.slice(-3)
    };
  }

  _buildDecisionPrompt(context) {
    // Override in subclasses
    return context;
  }

  _parseDecision(decision) {
    // Override in subclasses
    return { action: 'observe', target: null };
  }

  _fallbackDecision(context) {
    // Override in subclasses
    return { action: 'observe', target: null };
  }
}
