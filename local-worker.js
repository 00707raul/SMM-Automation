require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SERVER_URL = (process.env.SERVER_URL || 'http://localhost:10000').replace(/\/$/, '');
const WORKER_TOKEN = process.env.WORKER_TOKEN || 'dev-token';
const COMFY_URL = (process.env.COMFY_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
const COMFY_INPUT_DIR = process.env.COMFY_INPUT_DIR || path.join(process.cwd(), 'comfy-input');
const WORKFLOWS_API_DIR = process.env.WORKFLOWS_API_DIR || path.join(process.cwd(), 'workflows_api');
const POLL_MS = Number(process.env.WORKER_POLL_MS || 5000);
const DRY_RUN = String(process.env.DRY_RUN || 'true').toLowerCase() === 'true';

fs.mkdirSync(COMFY_INPUT_DIR, { recursive: true });

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function api(pathname, options = {}) {
  const res = await fetch(`${SERVER_URL}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${WORKER_TOKEN}`,
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}

async function downloadToFile(url, filepath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filepath, buffer);
}

function placeholderPngBase64(job) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">
  <rect width="100%" height="100%" fill="#111827"/>
  <text x="50" y="120" fill="#ffffff" font-size="48" font-family="Arial">SMM Automation Test</text>
  <text x="50" y="210" fill="#a7f3d0" font-size="32" font-family="Arial">Job: ${job.id}</text>
  <text x="50" y="280" fill="#e5e7eb" font-size="28" font-family="Arial">Images: ${job.imageCount}</text>
  <text x="50" y="350" fill="#e5e7eb" font-size="28" font-family="Arial">Prompt ready for ComfyUI worker</text>
</svg>`;
  return Buffer.from(svg).toString('base64');
}

function selectWorkflowApi(count) {
  const safeCount = Math.max(1, Math.min(5, Number(count || 1)));
  return path.join(WORKFLOWS_API_DIR, `flux2_${safeCount}_image_api.json`);
}

function patchWorkflowApi(promptApi, job, comfyFilenames) {
  // This expects API-format workflow JSON, not normal UI workflow JSON.
  // Enable ComfyUI dev mode and export/save API format into workflows_api/.
  const prompt = JSON.parse(JSON.stringify(promptApi));

  const loadImageNodeIds = Object.keys(prompt).filter(id => prompt[id]?.class_type === 'LoadImage');
  loadImageNodeIds.forEach((id, index) => {
    if (comfyFilenames[index]) prompt[id].inputs.image = comfyFilenames[index];
  });

  for (const id of Object.keys(prompt)) {
    const node = prompt[id];
    if (!node.inputs) continue;
    if (typeof node.inputs.text === 'string') node.inputs.text = job.prompt;
    if (typeof node.inputs.width === 'number') node.inputs.width = job.width;
    if (typeof node.inputs.height === 'number') node.inputs.height = job.height;
    if (node.class_type === 'SaveImage' && typeof node.inputs.filename_prefix === 'string') {
      node.inputs.filename_prefix = `smm_${job.id}`;
    }
  }
  return prompt;
}

async function runComfy(job) {
  const comfyFilenames = [];
  for (const img of job.images) {
    const ext = path.extname(img.filename) || '.png';
    const comfyName = `${job.id}-${crypto.randomUUID()}${ext}`;
    await downloadToFile(img.url, path.join(COMFY_INPUT_DIR, comfyName));
    comfyFilenames.push(comfyName);
  }

  const workflowPath = selectWorkflowApi(job.imageCount);
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`Missing API workflow: ${workflowPath}. Export API-format workflow from ComfyUI first.`);
  }

  const apiWorkflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const prompt = patchWorkflowApi(apiWorkflow, job, comfyFilenames);

  const queued = await fetch(`${COMFY_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, client_id: 'smm-automation-worker' })
  }).then(r => r.json());

  const promptId = queued.prompt_id;
  if (!promptId) throw new Error(`ComfyUI did not return prompt_id: ${JSON.stringify(queued)}`);

  while (true) {
    await sleep(2000);
    const history = await fetch(`${COMFY_URL}/history/${promptId}`).then(r => r.json());
    const item = history[promptId];
    if (!item) continue;
    const outputs = item.outputs || {};
    for (const out of Object.values(outputs)) {
      if (out.images && out.images[0]) {
        const img = out.images[0];
        const url = `${COMFY_URL}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`;
        const res = await fetch(url);
        const buffer = Buffer.from(await res.arrayBuffer());
        return { imageBase64: buffer.toString('base64'), ext: 'png' };
      }
    }
  }
}

async function processJob(job) {
  console.log('Processing job', job.id);
  await api(`/api/worker/jobs/${job.id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: 'processing', progress: 'Started local worker' })
  });

  if (DRY_RUN) {
    await sleep(1500);
    await api(`/api/worker/jobs/${job.id}/result`, {
      method: 'POST',
      body: JSON.stringify({ imageBase64: placeholderPngBase64(job), ext: 'svg' })
    });
    return;
  }

  const result = await runComfy(job);
  await api(`/api/worker/jobs/${job.id}/result`, {
    method: 'POST',
    body: JSON.stringify(result)
  });
}

async function main() {
  console.log('Local worker started');
  console.log({ SERVER_URL, COMFY_URL, DRY_RUN });

  while (true) {
    try {
      const { job } = await api('/api/worker/next', { method: 'POST', body: JSON.stringify({}) });
      if (job) await processJob(job);
    } catch (err) {
      console.error(err.message);
    }
    await sleep(POLL_MS);
  }
}

main();
