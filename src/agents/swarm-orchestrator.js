/**
 * Swarm Orchestrator - Coordinates multiple AI agents in adversarial testing
 * Manages red team vs blue team dynamics, tracks discoveries, broadcasts events
 */

import { RedAgent } from './red-agent.js';
import { BlueAgent } from './blue-agent.js';
import { completion } from '../llm.js';

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

    // Create red team agents
    for (let i = 0; i < redCount; i++) {
      const agent = new RedAgent(`red-${i + 1}`, completion, this.targetEndpoints);
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
    const MAX_ROUNDS = 10;

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
      const attacks = await this._redAttackPhase();

      // Small delay
      await this._sleep(600);

      // Phase 3: Blue team monitoring
      const threats = await this._blueMonitoringPhase(attacks);

      // Small delay
      await this._sleep(600);

      // Phase 4: Blue team response
      await this._blueResponsePhase(threats);

      // Small delay between rounds
      await this._sleep(1000);

      // Check if we should continue
      if (this.discoveries.length > 5) {
        console.log('[Swarm] Enough vulnerabilities found, ending battle');
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
   * Red team attack phase
   */
  async _redAttackPhase() {
    console.log('[Swarm] Red team: Attacking');

    const attacks = [];

    for (const agent of this.redTeam) {
      try {
        // Agent decides what to attack
        const plan = await agent.planAttack(this.targetEndpoints);

        this.broadcastEvent({
          type: 'agent_reasoning',
          agent: agent.id,
          text: `Planning: ${plan.reasoning || 'Trying ' + plan.attackType}`
        });

        // Execute the attack
        const target = this.targetEndpoints.find(e => e.name === plan.target) || this.targetEndpoints[0];
        const result = await agent.executeAttack(target, plan.attackType || 'PROMPT_INJECTION');

        this.stats.attacksAttempted++;

        attacks.push({
          agent: agent.id,
          target: target.endpoint,
          result
        });

        if (result.success) {
          this.stats.attacksSuccessful++;
          this.stats.vulnerabilitiesFound++;

          this.discoveries.push(result.vulnerability);

          this.broadcastEvent({
            type: 'vulnerability_found',
            agent: agent.id,
            vulnerability: result.vulnerability
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
            text: `${agent.id} · ${plan.attackType} attempt blocked`
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

    for (const agent of this.blueTeam) {
      const threats = await agent.monitorTraffic(attacks.map(a => ({
        endpoint: a.target,
        ...a.result
      })));

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

    for (const agent of this.blueTeam) {
      if (threats.length === 0) continue;

      try {
        // Agent analyzes attacks
        const analysis = await agent.analyzeAttacks();

        this.broadcastEvent({
          type: 'agent_reasoning',
          agent: agent.id,
          text: `Identified ${Object.keys(analysis.patterns || {}).length} attack patterns`
        });

        // Deploy defenses for most severe threats
        const topThreat = threats.sort((a, b) => b.score - a.score)[0];

        if (topThreat) {
          const response = await agent.respondToAttack(topThreat);

          if (response.success) {
            this.stats.defensesDeployed++;
            this.defenses.push(response.defense);

            this.broadcastEvent({
              type: 'defense_deployed',
              agent: agent.id,
              defense: response.defense
            });

            this.broadcastEvent({
              type: 'defense',
              text: `${agent.id} · deployed ${response.defense.type} on ${response.defense.endpoint}`
            });
          }
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
