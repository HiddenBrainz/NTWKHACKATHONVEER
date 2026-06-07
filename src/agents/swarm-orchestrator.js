/**
 * Swarm Orchestrator - Coordinates multiple AI agents in adversarial testing
 * Manages red team vs blue team dynamics, tracks discoveries, broadcasts events
 */

import { RedAgent } from './red-agent.js';
import { BlueAgent } from './blue-agent.js';
import { completion } from '../llm.js';
import { defenseLayer } from '../target-app/defense-layer.js';

// Each attack vector has a natural target endpoint
const ENDPOINT_BY_ATTACK = {
  PROMPT_INJECTION: 'chat',
  XSS: 'chat',
  SQL_INJECTION: 'query',
  PATH_TRAVERSAL: 'file'
};

// Map a target endpoint to the node it represents on the attack-surface map
const NODE_BY_ENDPOINT = {
  '/target/chat': 'System prompt',
  '/target/query': 'User DB',
  '/target/file': 'Secrets'
};

// Distinct attack focus per red agent so the swarm probes every surface
const RED_FOCUSES = ['PROMPT_INJECTION', 'SQL_INJECTION', 'PATH_TRAVERSAL', 'XSS'];

export class SwarmOrchestrator {
  constructor(targetEndpoints, eventBroadcaster) {
    this.targetEndpoints = targetEndpoints;
    this.broadcastEvent = eventBroadcaster;

    // Agent swarms
    this.redTeam = [];
    this.blueTeam = [];

    // Battle state
    this.isRunning = false;
    this.currentRound = 0;
    this.discoveries = [];
    this.defenses = [];
    this.exploitChains = [];

    // Statistics
    this.stats = {
      attacksAttempted: 0,
      attacksSuccessful: 0,
      defensesDeployed: 0,
      vulnerabilitiesFound: 0,
      startTime: null,
      endTime: null
    };
  }

  /**
   * Initialize the agent swarms
   */
  async initialize(config = {}) {
    const {
      redCount = 3,
      blueCount = 3
    } = config;

    console.log(`[Swarm] Initializing ${redCount} red agents, ${blueCount} blue agents`);

    // Start every battle from a clean slate — no defenses carried over
    defenseLayer.reset();

    // Create red team agents, each assigned a distinct attack focus
    for (let i = 0; i < redCount; i++) {
      const focus = RED_FOCUSES[i % RED_FOCUSES.length];
      const agent = new RedAgent(`red-${i + 1}`, completion, this.targetEndpoints, focus);
      this.redTeam.push(agent);

      this.broadcastEvent({
        type: 'agent_spawned',
        agent: {
          id: agent.id,
          role: 'red',
          index: i
        }
      });
    }

    // Create blue team agents
    for (let i = 0; i < blueCount; i++) {
      const agent = new BlueAgent(`blue-${i + 1}`, completion, this.targetEndpoints);
      this.blueTeam.push(agent);

      this.broadcastEvent({
        type: 'agent_spawned',
        agent: {
          id: agent.id,
          role: 'blue',
          index: i
        }
      });
    }

    console.log('[Swarm] Swarm initialized');
  }

  /**
   * Start the adversarial battle
   */
  async start() {
    if (this.isRunning) {
      console.log('[Swarm] Already running');
      return;
    }

    this.isRunning = true;
    this.stats.startTime = Date.now();
    this.currentRound = 0;

    this.broadcastEvent({
      type: 'swarm_started',
      teams: {
        red: this.redTeam.length,
        blue: this.blueTeam.length
      }
    });

    // Run autonomous battle
    await this._runBattle();
  }

  /**
   * Stop the swarm
   */
  stop() {
    this.isRunning = false;
    this.stats.endTime = Date.now();

    this.broadcastEvent({
      type: 'swarm_stopped',
      stats: this.getStats()
    });
  }

  /**
   * Main battle loop
   */
  async _runBattle() {
    const MAX_ROUNDS = 4;

    while (this.isRunning && this.currentRound < MAX_ROUNDS) {
      this.currentRound++;

      this.broadcastEvent({
        type: 'round_started',
        round: this.currentRound
      });

      console.log(`[Swarm] === Round ${this.currentRound} ===`);

      // Phase 1: Red team reconnaissance
      await this._redReconnaissancePhase();

      // Small delay for visualization
      await this._sleep(800);

      // Phase 2: Red team attacks
      const discoveredBefore = this.discoveries.length;
      const attacks = await this._redAttackPhase();
      const gained = this.discoveries.length - discoveredBefore;

      // Small delay
      await this._sleep(600);

      // Phase 3: Blue team monitoring
      const threats = await this._blueMonitoringPhase(attacks);

      // Small delay
      await this._sleep(600);

      // Phase 4: Blue team response (deploys real defenses into the layer)
      await this._blueResponsePhase(threats);

      // Small delay between rounds
      await this._sleep(1000);

      // Blue has neutralized red once a full round lands no new breaches
      if (gained === 0 && this.currentRound >= 2) {
        console.log('[Swarm] Red team neutralized — no new breaches this round');
        this.broadcastEvent({
          type: 'agent_reasoning',
          agent: 'blue-team',
          text: 'Attack surface hardened — red team can no longer breach'
        });
        break;
      }
    }

    this.stop();
  }

  /**
   * Red team reconnaissance phase
   */
  async _redReconnaissancePhase() {
    console.log('[Swarm] Red team: Reconnaissance');

    for (const agent of this.redTeam) {
      const findings = await agent.reconnaissance(this.targetEndpoints);

      this.broadcastEvent({
        type: 'agent_action',
        agent: agent.id,
        action: 'reconnaissance',
        findings: findings.slice(0, 3) // Top 3 findings
      });

      // Light up the node this agent is about to probe on the surface map
      const probeTarget = this._resolveTarget(agent.focus);
      const probeNode = NODE_BY_ENDPOINT[probeTarget.endpoint];
      if (probeNode) {
        this.broadcastEvent({ type: 'node_probed', node: probeNode });
      }

      // Log agent's thoughts
      this.broadcastEvent({
        type: 'agent_reasoning',
        agent: agent.id,
        text: `Scanned ${findings.length} endpoints, prioritizing ${findings[0]?.endpoint || 'unknown'}`
      });

      await this._sleep(400);
    }
  }

  /**
   * Resolve which endpoint an attack should target.
   * Prefers the endpoint that naturally matches the attack vector, then the
   * agent's planned target by name, then the first available endpoint.
   */
  _resolveTarget(attackType, preferredName) {
    const name = ENDPOINT_BY_ATTACK[attackType];
    return (
      this.targetEndpoints.find(e => e.name === name) ||
      this.targetEndpoints.find(e => e.name === preferredName) ||
      this.targetEndpoints[0]
    );
  }

  /**
   * Red team attack phase
   */
  async _redAttackPhase() {
    console.log('[Swarm] Red team: Attacking');

    const attacks = [];

    for (const agent of this.redTeam) {
      try {
        // Agent decides what to attack
        const plan = await agent.planAttack(this.targetEndpoints);
        const attackType = plan.attackType || agent.focus || 'PROMPT_INJECTION';

        this.broadcastEvent({
          type: 'agent_reasoning',
          agent: agent.id,
          text: `Planning: ${plan.reasoning || 'Trying ' + attackType}`
        });

        // Route the attack to the endpoint that matches the chosen vector
        const target = this._resolveTarget(attackType, plan.target);
        const result = await agent.executeAttack(target, attackType);

        this.stats.attacksAttempted++;

        attacks.push({
          agent: agent.id,
          target: target.endpoint,
          attackType,
          payload: result.vulnerability?.payload,
          result
        });

        if (result.success) {
          this.stats.attacksSuccessful++;
          this.stats.vulnerabilitiesFound++;

          this.discoveries.push(result.vulnerability);

          this.broadcastEvent({
            type: 'vulnerability_found',
            agent: agent.id,
            vulnerability: result.vulnerability,
            node: NODE_BY_ENDPOINT[result.vulnerability.endpoint] || 'System prompt'
          });

          this.broadcastEvent({
            type: 'attack',
            text: `${agent.id} · ${result.vulnerability.type} on ${result.vulnerability.endpoint} [CRITICAL]`
          });

          // Check if exploit chain is forming
          if (agent.exploitChain.length > 1) {
            this.exploitChains.push([...agent.exploitChain]);

            this.broadcastEvent({
              type: 'exploit_chain',
              agent: agent.id,
              chain: agent.exploitChain
            });
          }
        } else {
          this.broadcastEvent({
            type: 'attack',
            text: `${agent.id} · ${attackType} attempt blocked`
          });
        }

        await this._sleep(500);

      } catch (error) {
        console.error(`[Swarm] Red agent ${agent.id} error:`, error);
      }
    }

    return attacks;
  }

  /**
   * Blue team monitoring phase
   */
  async _blueMonitoringPhase(attacks) {
    console.log('[Swarm] Blue team: Monitoring');

    const allThreats = [];

    // Shape each attack into a record the blue agents can score & classify
    const records = attacks.map(a => ({
      endpoint: a.target,
      attackType: a.result?.vulnerability?.type || a.attackType,
      payload: a.result?.vulnerability?.payload || a.payload,
      success: Boolean(a.result?.success),
      result: a.result,
    }));

    for (const agent of this.blueTeam) {
      const threats = await agent.monitorTraffic(records);

      allThreats.push(...threats);

      if (threats.length > 0) {
        this.broadcastEvent({
          type: 'defense',
          text: `${agent.id} · detected ${threats.length} suspicious requests`
        });

        this.broadcastEvent({
          type: 'agent_reasoning',
          agent: agent.id,
          text: `Anomaly scores: ${threats.map(t => t.score.toFixed(2)).join(', ')}`
        });
      }

      await this._sleep(400);
    }

    return allThreats;
  }

  /**
   * Blue team response phase
   */
  async _blueResponsePhase(threats) {
    console.log('[Swarm] Blue team: Responding');

    if (threats.length === 0) return;

    // One distinct endpoint per threat (highest anomaly score wins), so the
    // blue agents spread out and harden every breached surface in parallel
    // instead of all piling onto the same one.
    const distinctThreats = [...new Map(
      threats
        .sort((a, b) => b.score - a.score)
        .map(t => [t.endpoint || t.request?.endpoint, t])
    ).values()];

    let idx = 0;
    for (const agent of this.blueTeam) {
      if (distinctThreats.length === 0) break;

      try {
        const threat = distinctThreats[idx % distinctThreats.length];
        idx++;

        // Agent analyzes attacks
        const analysis = await agent.analyzeAttacks();

        this.broadcastEvent({
          type: 'agent_reasoning',
          agent: agent.id,
          text: `Identified ${Object.keys(analysis.patterns || {}).length} attack patterns`
        });

        // respondToAttack enforces the defense into the shared defenseLayer itself
        const response = await agent.respondToAttack(threat);

        if (response.success) {
          const { endpoint, type, human } = response.defense;

          this.stats.defensesDeployed++;
          this.defenses.push(response.defense);

          this.broadcastEvent({
            type: 'defense_deployed',
            agent: agent.id,
            defense: response.defense,
            enforced: true
          });

          this.broadcastEvent({
            type: 'defense',
            text: `${agent.id} · deployed ${human || type} on ${endpoint} [ENFORCED]`
          });
        }

        await this._sleep(500);

      } catch (error) {
        console.error(`[Swarm] Blue agent ${agent.id} error:`, error);
      }
    }
  }

  /**
   * Get current swarm statistics
   */
  getStats() {
    return {
      ...this.stats,
      currentRound: this.currentRound,
      redTeamSize: this.redTeam.length,
      blueTeamSize: this.blueTeam.length,
      discoveries: this.discoveries.length,
      defenses: this.defenses.length,
      exploitChains: this.exploitChains.length,
      successRate: this.stats.attacksAttempted > 0
        ? (this.stats.attacksSuccessful / this.stats.attacksAttempted)
        : 0,
      duration: this.stats.endTime
        ? (this.stats.endTime - this.stats.startTime)
        : (Date.now() - (this.stats.startTime || Date.now()))
    };
  }

  /**
   * Get detailed report
   */
  getDetailedReport() {
    return {
      stats: this.getStats(),
      discoveries: this.discoveries,
      defenses: this.defenses,
      exploitChains: this.exploitChains,
      redTeam: this.redTeam.map(a => a.getReport()),
      blueTeam: this.blueTeam.map(a => a.getReport())
    };
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
