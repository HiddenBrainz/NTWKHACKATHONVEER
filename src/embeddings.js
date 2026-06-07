/**
 * Local semantic embedding engine — zero dependencies, fully offline.
 *
 * This is the "feature hashing trick" (the same idea behind vector search and
 * AI firewalls), implemented from scratch so the whole arena runs without an
 * embeddings API. Each string becomes a fixed-length L2-normalized vector built
 * from word unigrams + character trigrams hashed into the vector space. Cosine
 * similarity on these vectors is a genuine (if lightweight) semantic signal:
 * paraphrases of the same attack land near each other, benign chatter clusters
 * elsewhere. That is exactly what the vector firewall exploits.
 *
 * If an OpenAI key is present we *could* swap in real embeddings, but keeping it
 * local guarantees the demo never stalls and never costs a cent.
 */

export const DIM = 128;

/**
 * Deterministic 32-bit string hash (FNV-1a). Stable across runs/machines so the
 * 2-D projection and centroids are reproducible.
 */
function fnv1a(str, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Extract the bag of features (word unigrams, bigrams, char trigrams). */
function features(text) {
  const clean = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  const feats = [];

  const words = clean.split(/[^a-z0-9]+/).filter(Boolean);
  for (const w of words) feats.push('w:' + w);
  for (let i = 0; i < words.length - 1; i++) feats.push('b:' + words[i] + '_' + words[i + 1]);

  // Character trigrams capture obfuscation/leetspeak that word tokens miss.
  const compact = clean.replace(/ /g, '_');
  for (let i = 0; i < compact.length - 2; i++) feats.push('c:' + compact.slice(i, i + 3));

  return feats;
}

/**
 * Embed a string into a DIM-dimensional L2-normalized vector.
 * @returns {Float64Array}
 */
export function embed(text) {
  const v = new Float64Array(DIM);
  for (const f of features(text)) {
    const h = fnv1a(f);
    const idx = h % DIM;
    const sign = (h & 0x10000) ? 1 : -1; // signed hashing reduces collisions
    v[idx] += sign;
  }
  // L2 normalize so cosine == dot product.
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

/** Cosine similarity of two normalized vectors (== dot product). */
export function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < DIM; i++) dot += a[i] * b[i];
  return dot;
}

/** Running-mean update of a centroid; result is re-normalized. */
export function foldCentroid(centroid, vec, count) {
  const out = new Float64Array(DIM);
  for (let i = 0; i < DIM; i++) out[i] = (centroid[i] * count + vec[i]) / (count + 1);
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) out[i] /= norm;
  return out;
}

// Two fixed pseudo-random unit axes for projecting DIM-space down to 2-D for the
// live scatter plot. Seeded so points don't jump around between frames.
function randomAxis(seed) {
  const v = new Float64Array(DIM);
  let s = seed >>> 0;
  for (let i = 0; i < DIM; i++) {
    // xorshift32 PRNG → uniform in [-1, 1]
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    v[i] = (s / 0xffffffff) * 2 - 1;
  }
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

const AXIS_X = randomAxis(0xC0FFEE);
const AXIS_Y = randomAxis(0xBADF00D);

/**
 * Project an embedding to 2-D coordinates in roughly [-1, 1] for visualization.
 * @returns {{x:number, y:number}}
 */
export function project(vec) {
  return { x: cosine(vec, AXIS_X), y: cosine(vec, AXIS_Y) };
}
