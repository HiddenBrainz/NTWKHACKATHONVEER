/**
 * Swarm Controller - Replaces the old scripted orchestrator
 * Integrates autonomous agent swarms with the existing event system
 */

import { SwarmOrchestrator } from './agents/swarm-orchestrator.js';
import { completion } from './llm.js';

// Target endpoints that agents can attack
const TARGET_ENDPOINTS = [
  { name: 'chat', endpoint: '/target/chat', type: 'llm' },
  { name: 'query', endpoint: '/target/query', type: 'database' },
  { name: 'file', endpoint: '/target/file', type: 'file' }
];

class SwarmController {
  constructor() {
    this.swarm = null;
    this.clients = []; // SSE clients
    this.isActive = false;
  }

  /**
   * Register an SSE client
   */
  addClient(res) {
    this.clients.push(res);
    // Send current state immediately
    this.sendEvent(res, { type: 'idle' });
  }

  /**
   * Remove an SSE client
   */
  removeClient(res) {
    this.clients = this.clients.filter(c => c !== res);
  }

  /**
   * Broadcast event to all connected clients
   */
  broadcastEvent(event) {
    const data = JSON.stringify(event);
    this.clients.forEach(client => {
      try {
        client.write(`data: ${data}\n\n`);
      } catch (error) {
        console.error('[SwarmController] Error broadcasting:', error);
      }
    });
  }

  /**
   * Send event to a single client
   */
  sendEvent(client, event) {
    const data = JSON.stringify(event);
    try {
      client.write(`data: ${data}\n\n`);
    } catch (error) {
      console.error('[SwarmController] Error sending:', error);
    }
  }

  /**
   * Start the autonomous agent swarm battle
   */
  async startSwarm(config = {}) {
    if (this.isActive) {
      console.log('[SwarmController] Swarm already active');
      return;
    }

    this.isActive = true;

    console.log('[SwarmController] Initializing agent swarm...');

    // Create swarm with event broadcaster
    this.swarm = new SwarmOrchestrator(
      TARGET_ENDPOINTS,
      (event) => this.broadcastEvent(event)
    );

    // Initialize agents
    await this.swarm.initialize({
      redCount: config.redCount || 3,
      blueCount: config.blueCount || 3
    });

    // Delay for UI to update
    await this._sleep(1000);

    // Broadcast start
    this.broadcastEvent({
      type: 'attack_started',
      message: 'Agent swarm battle initiated'
    });

    // Start the battle
    await this.swarm.start();

    // When done, broadcast final stats
    const stats = this.swarm.getStats();

    if (stats.vulnerabilitiesFound > 0) {
      this.broadcastEvent({
        type: 'breach_confirmed',
        stats,
        message: `Battle complete: ${stats.vulnerabilitiesFound} vulnerabilities discovered`
      });
    }

    this.isActive = false;
  }

  /**
   * Judge an interactive attack submitted by the user ("play as attacker").
   * A blue-team LLM evaluates the payload and the verdict is broadcast to all
   * connected clients. Falls back gracefully when no LLM is configured.
   */
  async judgeAttack(payload) {
    let verdict;
    try {
      const context = `A red-team attacker submitted this payload: "${payload}". ` +
        `As a blue-team defender, evaluate in one short line whether it would breach ` +
        `our system and how you would block it.`;
      verdict = await completion('blue-defender', context);
    } catch (err) {
      console.error('[SwarmController] judgeAttack error:', err);
      verdict = 'attack evaluated — monitoring perimeter';
    }

    this.broadcastEvent({ type: 'defense', text: `blue-judge · ${verdict}` });
    return { success: true, verdict };
  }

  /**
   * Stop the swarm
   */
  stop() {
    if (this.swarm) {
      this.swarm.stop();
    }
    this.isActive = false;
  }

  /**
   * Reset to idle state
   */
  reset() {
    this.stop();
    this.swarm = null;

    this.broadcastEvent({ type: 'reset' });
    console.log('[SwarmController] Reset to idle');
  }

  /**
   * Get current state
   */
  getState() {
    if (!this.swarm) {
      return { active: false };
    }

    return {
      active: this.isActive,
      stats: this.swarm.getStats()
    };
  }

  /**
   * Get detailed report
   */
  getReport() {
    if (!this.swarm) {
      return null;
    }

    return this.swarm.getDetailedReport();
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const swarmController = new SwarmController();
