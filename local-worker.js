function loadEnv() {
  try {
    require('dotenv').config();
    return;
  } catch {
    // Fallback: lets local-worker.js run even before npm install.
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}
loadEnv();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let sharp = null;
try {
  sharp = require('sharp');
} catch {
  // Sharp is needed only for real image jobs. Dry-run can still work.
}

const SERVER_URL = (process.env.SERVER_URL || process.env.APP_BASE_URL || 'http://localhost:10000').replace(/\/$/, '');
const WORKER_TOKEN = process.env.WORKER_TOKEN || 'dev-token';
const COMFY_URL = (process.env.COMFY_URL || process.env.COMFYUI_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
const COMFY_INPUT_DIR = process.env.COMFY_INPUT_DIR || path.join(process.cwd(), 'comfy-input');
const WORKFLOWS_API_DIR = process.env.WORKFLOWS_API_DIR || path.join(process.cwd(), 'workflows_api');
const POLL_MS = Number(process.env.WORKER_POLL_MS || 5000);
const DRY_RUN = String(process.env.DRY_RUN || 'true').toLowerCase() === 'true';
const IMAGE_FIT_MODE = String(process.env.IMAGE_FIT_MODE || 'cover').toLowerCase(); // cover = no squeeze, centre crop. contain = no crop, transparent padding.

fs.mkdirSync(COMFY_INPUT_DIR, { recursive: true });

const MODEL_WORKFLOWS = {
  // Individual Flux2 Klein API workflows restored.
  flux2_klein_1: {
    label: 'Flux2 Klein 4B — 1 Image',
    mode: 'image',
    workflowFile: () => 'flux2_1_image_api.json',
    minImages: 1,
    maxImages: 1
  },
  flux2_klein_2: {
    label: 'Flux2 Klein 4B — 2 Images',
    mode: 'image',
    workflowFile: () => 'flux2_2_image_api.json',
    minImages: 2,
    maxImages: 2
  },
  flux2_klein_3: {
    label: 'Flux2 Klein 4B — 3 Images',
    mode: 'image',
    workflowFile: () => 'flux2_3_image_api.json',
    minImages: 3,
    maxImages: 3
  },
  flux2_klein_4: {
    label: 'Flux2 Klein 4B — 4 Images',
    mode: 'image',
    workflowFile: () => 'flux2_4_image_api.json',
    minImages: 4,
    maxImages: 4
  },
  flux2_klein_5: {
    label: 'Flux2 Klein 4B — 5 Images',
    mode: 'image',
    workflowFile: () => 'flux2_5_image_api.json',
    minImages: 5,
    maxImages: 5
  },

  // Legacy automatic Flux option kept for old jobs.
  flux2_klein: {
    label: 'Flux2 Klein 4B — Auto 1–5 Images',
    mode: 'image',
    workflowFile: job => `flux2_${Math.max(1, Math.min(5, Number(job.imageCount || 1)))}_image_api.json`,
    minImages: 1,
    maxImages: 5
  },

  face_swap: {
    label: 'Face Swap',
    mode: 'face_swap',
    workflowFile: () => 'face_swap_api.json',
    minImages: 2,
    maxImages: 2,
    fixedPrompt: true,
    preserveInputAspect: true,
    useWorkflowSizing: true,
    // Website order is Reference first, Your model second.
    // Workflow node 12 expects body/model; node 13 expects face reference.
    imageNodeMap: { '12': 1, '13': 0 }
  },

  z_image_base_img2img_2: {
    label: 'Z-Image Base 2-Image Img2Img',
    mode: 'img2img',
    workflowFile: () => 'z_image_base_img2img_2image_api.json',
    minImages: 2,
    maxImages: 2
  },
  z_image_base_t2i: {
    label: 'Z-Image Base Text-to-Image',
    mode: 'text2image',
    workflowFile: () => 'z_image_base_text2image_api.json',
    minImages: 0,
    maxImages: 0
  }
};

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

async function safeApi(pathname, options = {}) {
  try {
    return await api(pathname, options);
  } catch (err) {
    console.error('Failed to update server:', err.message);
    return null;
  }
}

async function downloadToFile(url, filepath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filepath, buffer);
}

function placeholderPngBase64(job) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${job.width || 1080}" height="${job.height || 1350}">
  <rect width="100%" height="100%" fill="#111827"/>
  <text x="50" y="120" fill="#ffffff" font-size="48" font-family="Arial">SMM Automation Test</text>
  <text x="50" y="210" fill="#a7f3d0" font-size="32" font-family="Arial">Job: ${job.id}</text>
  <text x="50" y="300" fill="#93c5fd" font-size="28" font-family="Arial">${job.modelLabel || job.modelKey || 'model'} · ${job.width}×${job.height}</text>
</svg>`;
  return Buffer.from(svg).toString('base64');
}

function getModelConfig(job) {
  return MODEL_WORKFLOWS[job.modelKey] || MODEL_WORKFLOWS.flux2_klein_1;
}

function selectWorkflowApi(job) {
  const model = getModelConfig(job);
  return path.join(WORKFLOWS_API_DIR, model.workflowFile(job));
}

function sortLoadImageIds(ids) {
  return ids.sort((a, b) => {
    const na = Number(String(a).split(':')[0]);
    const nb = Number(String(b).split(':')[0]);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return String(a).localeCompare(String(b));
  });
}

function targetSize(job) {
  return {
    width: Math.max(256, Math.round(Number(job.width || 1080))),
    height: Math.max(256, Math.round(Number(job.height || 1350)))
  };
}

async function resizeForComfy(inputPath, outputPath, job) {
  if (!sharp) {
    throw new Error('Missing dependency: sharp. Run npm.cmd install in D:\\SMM-Automation, then start the worker again.');
  }

  const { width, height } = targetSize(job);
  const fit = IMAGE_FIT_MODE === 'contain' ? 'contain' : 'cover';

  // This is the scaler fix: every uploaded image becomes the exact selected canvas size
  // without stretching/squeezing. cover crops from centre; contain pads transparently.
  await sharp(inputPath)
    .rotate()
    .resize({
      width,
      height,
      fit,
      position: 'center',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toFile(outputPath);
}

async function prepareInputImages(job) {
  const comfyFilenames = [];
  const images = job.images || [];
  const model = getModelConfig(job);

  for (let index = 0; index < images.length; index++) {
    const img = images[index];
    const originalExt = path.extname(img.filename) || '.png';
    const rawName = `${job.id}-${index + 1}-raw-${crypto.randomUUID()}${originalExt}`;
    const processedName = `${job.id}-${index + 1}-${model.preserveInputAspect ? 'original' : 'fit'}-${crypto.randomUUID()}.png`;
    const rawPath = path.join(COMFY_INPUT_DIR, rawName);
    const processedPath = path.join(COMFY_INPUT_DIR, processedName);

    await downloadToFile(img.url, rawPath);

    if (model.preserveInputAspect) {
      if (!sharp) {
        throw new Error('Missing dependency: sharp. Run npm.cmd install before starting the worker.');
      }
      // Rotate from EXIF and convert to PNG, but preserve the original aspect ratio and dimensions.
      await sharp(rawPath).rotate().png().toFile(processedPath);
    } else {
      await resizeForComfy(rawPath, processedPath, job);
    }

    comfyFilenames.push(processedName);
    try { fs.unlinkSync(rawPath); } catch {}
  }
  return comfyFilenames;
}

function patchWorkflowApi(promptApi, job, comfyFilenames) {
  const prompt = JSON.parse(JSON.stringify(promptApi));
  const model = getModelConfig(job);
  const { width, height } = targetSize(job);
  const largestSize = Math.max(width, height);
  const negativePrompt = job.negativePrompt || 'bad anatomy, deformed body, distorted face, extra fingers, extra arms, extra legs, missing fingers, fused fingers, malformed hands, blurry, low quality, low detail, text, watermark, cropped, duplicate body parts';
  const blendFactor = Math.max(0, Math.min(1, Number(job.blendFactor || 0.2)));

  const loadImageNodeIds = sortLoadImageIds(Object.keys(prompt).filter(id => prompt[id]?.class_type === 'LoadImage'));
  if (model.imageNodeMap) {
    for (const [nodeId, uploadIndex] of Object.entries(model.imageNodeMap)) {
      if (prompt[nodeId]?.inputs && comfyFilenames[uploadIndex]) {
        prompt[nodeId].inputs.image = comfyFilenames[uploadIndex];
      }
    }
  } else {
    loadImageNodeIds.forEach((id, index) => {
      if (comfyFilenames[index]) prompt[id].inputs.image = comfyFilenames[index];
    });
  }

  for (const id of Object.keys(prompt)) {
    const node = prompt[id];
    if (!node.inputs) continue;

    const title = String(node._meta?.title || '');

    if (!model.fixedPrompt) {
      if (node.class_type === 'CLIPTextEncode' && typeof node.inputs.text === 'string') {
        if (/negative/i.test(title)) {
          node.inputs.text = negativePrompt;
        } else {
          node.inputs.text = job.prompt;
        }
      } else if (typeof node.inputs.text === 'string') {
        node.inputs.text = job.prompt;
      }
    }

    // Only patch literal numeric canvas values. Preserve linked inputs used by workflows
    // such as Face Swap, where the output size follows the uploaded model image.
    if (!model.useWorkflowSizing) {
      if (Object.prototype.hasOwnProperty.call(node.inputs, 'width') && typeof node.inputs.width === 'number') node.inputs.width = width;
      if (Object.prototype.hasOwnProperty.call(node.inputs, 'height') && typeof node.inputs.height === 'number') node.inputs.height = height;
      if (Object.prototype.hasOwnProperty.call(node.inputs, 'largest_size') && typeof node.inputs.largest_size === 'number') node.inputs.largest_size = largestSize;
    }

    // Two-image Z workflow blend control.
    if (node.class_type === 'ImageBlend' && Object.prototype.hasOwnProperty.call(node.inputs, 'blend_factor')) {
      node.inputs.blend_factor = blendFactor;
    }

    if (node.class_type === 'RandomNoise' && typeof node.inputs.noise_seed === 'number') {
      node.inputs.noise_seed = Math.floor(Math.random() * 9007199254740991);
    }

    if (node.class_type === 'KSampler' && typeof node.inputs.seed === 'number') {
      node.inputs.seed = Math.floor(Math.random() * 9007199254740991);
    }

    // Z-Image Base expects qwen_3_4b.safetensors.
    // qwen_3_8b_fp8mixed.safetensors causes the RuntimeError:
    // expected normalized_shape=[2560], but got hidden size 12288.
    if ((job.modelKey || '').startsWith('z_image') && node.class_type === 'CLIPLoader') {
      node.inputs.clip_name = 'qwen_3_4b.safetensors';
      node.inputs.type = 'lumina2';
    }

    if (node.class_type === 'SaveImage' && typeof node.inputs.filename_prefix === 'string') {
      node.inputs.filename_prefix = `smm_${job.id}`;
    }
  }
  return prompt;
}

async function runComfy(job) {
  const model = getModelConfig(job);
  await safeApi(`/api/worker/jobs/${job.id}/status`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'processing',
      progress: job.imageCount
        ? (model.preserveInputAspect ? 'Preparing reference and model images' : 'Downloading and fitting input images')
        : 'Preparing text-to-image workflow'
    })
  });

  const comfyFilenames = await prepareInputImages(job);

  const workflowPath = selectWorkflowApi(job);
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`Missing API workflow: ${workflowPath}`);
  }

  await safeApi(`/api/worker/jobs/${job.id}/status`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'processing',
      progress: model.useWorkflowSizing
        ? `Sending ${model.label} to ComfyUI · output follows model image`
        : `Sending ${model.label} · ${job.width}×${job.height} to ComfyUI`
    })
  });

  const apiWorkflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const prompt = patchWorkflowApi(apiWorkflow, job, comfyFilenames);

  const queued = await fetch(`${COMFY_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, client_id: 'smm-automation-worker' })
  }).then(async r => {
    const text = await r.text();
    try { return JSON.parse(text); } catch { return { error: text }; }
  });

  const promptId = queued.prompt_id;
  if (!promptId) throw new Error(`ComfyUI did not return prompt_id: ${JSON.stringify(queued)}`);

  await safeApi(`/api/worker/jobs/${job.id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: 'processing', progress: `ComfyUI generation started (${promptId})` })
  });

  let ticks = 0;
  while (true) {
    await sleep(2000);
    ticks++;
    if (ticks % 5 === 0) {
      await safeApi(`/api/worker/jobs/${job.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'processing', progress: `Generating image... ${Math.round(ticks * 2)}s` })
      });
    }

    const history = await fetch(`${COMFY_URL}/history/${promptId}`).then(r => r.json());
    const item = history[promptId];
    if (!item) continue;

    const status = item.status || {};
    if (status.status_str === 'error') {
      throw new Error(`ComfyUI generation failed: ${JSON.stringify(status)}`);
    }

    const outputs = item.outputs || {};
    for (const out of Object.values(outputs)) {
      if (out.images && out.images[0]) {
        const img = out.images[0];
        const url = `${COMFY_URL}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch generated image from ComfyUI: ${res.status} ${res.statusText}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        return { imageBase64: buffer.toString('base64'), ext: 'png' };
      }
    }
  }
}

async function processJob(job) {
  console.log('Processing job', job.id, job.modelKey || 'flux2_klein');
  try {
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
  } catch (err) {
    console.error(err.message);
    await safeApi(`/api/worker/jobs/${job.id}/fail`, {
      method: 'POST',
      body: JSON.stringify({ error: err.message })
    });
  }
}

async function main() {
  console.log('Local worker started');
  console.log({ SERVER_URL, COMFY_URL, WORKFLOWS_API_DIR, DRY_RUN, IMAGE_FIT_MODE, hasSharp: Boolean(sharp) });

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
