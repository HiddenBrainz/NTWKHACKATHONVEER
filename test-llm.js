import dotenv from 'dotenv';
import { initLLM, completion, healthCheck } from './src/llm.js';

dotenv.config();

async function testLLM() {
  console.log('Testing LLM module...\n');

  initLLM();

  console.log('1. Health check:');
  const health = await healthCheck();
  console.log(health);

  console.log('\n2. Red attacker completion:');
  const redText = await completion('red-attacker', 'Scanning the target app for vulnerabilities');
  console.log(`Response: "${redText}"`);

  console.log('\n3. Blue defender completion:');
  const blueText = await completion('blue-defender', 'Monitoring defensive systems');
  console.log(`Response: "${blueText}"`);

  console.log('\nTest complete!');
}

testLLM().catch(console.error);
