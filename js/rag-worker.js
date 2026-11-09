/**
 * Local embedding worker.
 *
 * Uses Transformers.js (loaded lazily from the CDN, cached by the browser) to
 * generate sentence embeddings on-device. Nothing is uploaded.
 *
 * If the model cannot load (offline first run, old browser), the main thread
 * falls back to recent-message context + keyword search.
 */
var TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';
var MODEL = 'Xenova/all-MiniLM-L6-v2';
var pipelinePromise = null;

function getPipeline() {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async function () {
    importScripts(TRANSFORMERS_URL);
    var T = self.Transformers;
    if (!T) throw new Error('Transformers.js failed to load');
    T.env.allowLocalModels = false;
    T.env.useBrowserCache = true;
    return T.pipeline('feature-extraction', MODEL, { quantized: true });
  })();
  return pipelinePromise;
}

self.onmessage = async function (event) {
  var data = event.data || {};
  var id = data.id;
  try {
    var texts = Array.isArray(data.texts) ? data.texts : [String(data.text || '')];
    if (!texts.length) {
      self.postMessage({ id: id, vectors: [] });
      return;
    }
    var pipe = await getPipeline();
    var output = await pipe(texts, { pooling: 'mean', normalize: true });
    var dims = output.dims || [];
    var dim = dims.length > 1 ? dims[dims.length - 1] : output.data.length / texts.length;
    var flat = output.data;
    var vectors = [];
    for (var i = 0; i < texts.length; i++) {
      vectors.push(Array.prototype.slice.call(flat, i * dim, (i + 1) * dim));
    }
    self.postMessage({ id: id, vectors: vectors, dim: dim });
  } catch (err) {
    self.postMessage({ id: id, error: (err && err.message) || String(err) });
  }
};
