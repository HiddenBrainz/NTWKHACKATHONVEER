/**
 * Swarm Orchestrator - Coordinates multiple AI agents in adversarial testing
 * Manages red team vs blue team dynamics, tracks discoveries, broadcasts events
 */

import { RedAgent } from './red-agent.js';
import { BlueAgent } from './blue-agent.js';
import { completion } from '../llm.js';
import { defenseLayer } from '../target-app/defense-layer.js';
import { sleep } from '../utils.js';
import { REAL_VECTORS, isRealVector, scenarioWeaknesses } from '../scenarios.js';

// The real vulnerable endpoints, keyed by vector (used when a scenario node
// carries a weakness backed by genuine vulnerable code).
const ENDPOINT_FOR_VECTOR = {
  PROMPT_INJECTION: { name: 'chat',  endpoint: '/target/chat',  type: 'llm' },
  SQL_INJECTION:    { name: 'query', endpoint: '/target/query', type: 'database' },
  PATH_TRAVERSAL:   { name: 'file',  endpoint: '/target/file',  type: 'file' },
};

export class SwarmOrchestrator {
  constructor(scenario, eventBroadcaster) {
    this.scenario = scenario;
    this.broadcastEvent = eventBroadcaster;

    // The flat answer key for THIS network (per-node planted weaknesses).
    this.weaknesses = scenarioWeaknesses(scenario);

    // Endpoints the agents can hit. Real-vector weaknesses map to genuine
    // endpoints; the rest are virtual (simulated from the node's tags).
    const realVectors = [...new Set(this.weaknesses.filter(w => w.real).map(w => w.vector))];
    this.targetEndpoints = realVectors.map(v => ENDPOINT_FOR_VECTOR[v]).filter(Boolean);
    // Virtual endpoints for simulated vectors, so every weakness has a target.
    for (const w of this.weaknesses) {
      if (!w.real && !this.targetEndpoints.find(e => e.vector === w.vector)) {
        this.targetEndpoints.push({ name: w.vector.toLowerCase(), endpoint: `/sim/${w.vector}`, type: 'sim', vector: w.vector, simulated: true });
      }
    }
    // Tag real endpoints with their vector too, for routing.
    for (const e of this.targetEndpoints) {
      if (!e.vector) {
        const v = Object.keys(ENDPOINT_FOR_VECTOR).find(k => ENDPOINT_FOR_VECTOR[k].endpoint === e.endpoint);
        if (v) e.vector = v;
      }
    }
    // Map each weakness vector → the scenario node that carries it (for the map).
    this.nodeByVector = {};
    for (const w of this.weaknesses) {
      if (!this.nodeByVector[w.vector]) this.nodeByVector[w.vector] = w.nodeLabel;
    }

    // Agent swarms
    this.redTeam = [];
    this.blueTeam = [];

    // Battle state
    this.isRunning = false;
    this.currentRound = 0;
    this.discoveries = [];
    this.defenses = [];
    this.exploitChains = [];
    this.breachAnnounced = false; // fire the breach finale on the FIRST confirmed vuln

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

    // Assign focuses from the scenario's actual breachable weaknesses, so each
    // red agent hunts a vector that genuinely exists on this network. Falls back
    // to all weakness vectors if everything is pre-neutralized.
    const breachable = this.weaknesses.filter(w => !w.neutralized).map(w => w.vector);
    const focusPool = [...new Set(breachable.length ? breachable : this.weaknesses.map(w => w.vector))];
    if (focusPool.length === 0) focusPool.push('SQL_INJECTION'); // empty network safety

    // Create red team agents, each assigned a distinct attack focus
    for (let i = 0; i < redCount; i++) {
      const focus = focusPool[i % focusPool.length];
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
    const MAX_ROUNDS = this.scenario.config?.rounds || 4;

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
      await sleep(800);

      // Phase 2: Red team attacks
      const discoveredBefore = this.discoveries.length;
      const attacks = await this._redAttackPhase();
      const gained = this.discoveries.length - discoveredBefore;

      // Small delay
      await sleep(600);

      // Phase 3: Blue team monitoring
      const threats = await this._blueMonitoringPhase(attacks);

      // Small delay
      await sleep(600);

      // Phase 4: Blue team response (deploys real defenses into the layer)
      await this._blueResponsePhase(threats);

      // Small delay between rounds
      await sleep(1000);

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
      const probeNode = this._nodeForVector(agent.focus);
      if (probeNode) {
        this.broadcastEvent({ type: 'node_probed', node: probeNode });
      }

      // Log agent's thoughts
      this.broadcastEvent({
        type: 'agent_reasoning',
        agent: agent.id,
        text: `Scanned ${findings.length} endpoints, prioritizing ${findings[0]?.endpoint || 'unknown'}`
      });

      await sleep(400);
    }
  }

  /**
   * Resolve which endpoint an attack should target — the one whose vector
   * matches, else the agent's preferred, else the first available.
   */
  _resolveTarget(attackType, preferredName) {
    return (
      this.targetEndpoints.find(e => e.vector === attackType) ||
      this.targetEndpoints.find(e => e.name === preferredName) ||
      this.targetEndpoints[0]
    );
  }

  /** The scenario node label a vector lands on (for the map). */
  _nodeForVector(vector) {
    return this.nodeByVector[vector] || this.scenario.nodes.find(n => n.isTarget)?.label || 'target';
  }

  /**
   * Simulate a non-real vector (XSS / SSRF / IDOR / RCE / AUTH_BYPASS) from the
   * scenario node's tags. It breaches iff the node has the weakness and no
   * matching strength; difficulty just shapes the evidence text. Deterministic
   * by design so a given network scores consistently.
   */
  _simulateAttack(vector) {
    const w = this.weaknesses.find(x => x.vector === vector);
    if (!w || w.neutralized) {
      return { success: false, blockedByDefense: w?.neutralized || false,
               defense: w?.neutralized ? 'structural strength' : null,
               message: w ? 'neutralized by node strength' : 'no such weakness on this network' };
    }
    const node = this.scenario.nodes.find(n => n.label === w.nodeLabel);
    const evidenceByVector = {
      XSS: 'reflected payload executed in victim browser context',
      SSRF: 'server fetched attacker-controlled internal URL (169.254.169.254)',
      IDOR: 'accessed another tenant\'s object by id enumeration',
      RCE: 'achieved code execution via unsandboxed eval',
      AUTH_BYPASS: 'forged session / skipped auth check',
    };
    const vulnerability = {
      type: vector,
      endpoint: `/sim/${vector}`,
      payload: `«${vector.toLowerCase()} exploit»`,
      crafted: false,
      severity: (node?.difficulty || 1) >= 3 ? 'CRITICAL' : 'HIGH',
      exploitable: true,
      simulated: true,
      evidence: evidenceByVector[vector] || 'sensitive operation performed',
      details: node?.secret ? { secret: node.secret } : undefined,
    };
    return { success: true, vulnerability, payload: vulnerability.payload, response: { simulated: true, leaked: true } };
  }

  /**
   * Red team attack phase
   */
  async _redAttackPhase() {
    console.log('[Swarm] Red team: Attacking');

    const attacks = [];

    // Order agents so the fastest-breaching vectors (SQLi, traversal) go first
    // and the money shot lands within a second; the slow prompt-injection
    // (a real victim-model call) comes last so it never gates the finale.
    const ORDER = { SQL_INJECTION: 0, PATH_TRAVERSAL: 1, XSS: 2, PROMPT_INJECTION: 3 };
    const ordered = [...this.redTeam].sort(
      (a, b) => (ORDER[a.focus] ?? 9) - (ORDER[b.focus] ?? 9)
    );

    for (const agent of ordered) {
      try {
        // Agent decides what to attack (LLM, with a fast heuristic fallback)
        const plan = await agent.planAttack(this.targetEndpoints);
        const attackType = plan.attackType || agent.focus || 'PROMPT_INJECTION';

        this.broadcastEvent({
          type: 'agent_reasoning',
          agent: agent.id,
          text: `Planning: ${plan.reasoning || 'Trying ' + attackType}`
        });

        // Route the attack to the endpoint that matches the chosen vector.
        // Real vectors hit genuine vulnerable code; simulated ones resolve from
        // the scenario node's weakness/strength tags + a difficulty roll.
        const target = this._resolveTarget(attackType, plan.target);
        const result = target?.simulated
          ? this._simulateAttack(attackType)
          : await agent.executeAttack(target, attackType);

        this.stats.attacksAttempted++;

        attacks.push({
          agent: agent.id,
          target: target?.endpoint,
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
            node: this._nodeForVector(result.vulnerability.type)
          });

          this.broadcastEvent({
            type: 'attack',
            text: `${agent.id} · ${result.vulnerability.type} on ${result.vulnerability.endpoint} [CRITICAL]`
          });

          // The FIRST confirmed critical breach is the money shot — fire the
          // finale immediately so the demo never waits out a full battle. The
          // blue-team counterplay continues underneath for the full story.
          if (!this.breachAnnounced && result.vulnerability.severity === 'CRITICAL') {
            this.breachAnnounced = true;
            this.broadcastEvent({
              type: 'breach_confirmed',
              stats: this.getStats(),
              first: true,
              message: `First breach: ${result.vulnerability.type} on ${result.vulnerability.endpoint}`
            });
          }

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

        await sleep(500);

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

      await sleep(400);
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

        await sleep(500);

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
}
