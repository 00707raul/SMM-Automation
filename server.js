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

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { listJobs, getJob, createJob, updateJob, deleteJob, clearJobs, takeNextJob } = require('./src/store');

const app = express();
const PORT = process.env.PORT || 10000;
const MAX_IMAGES = Number(process.env.MAX_IMAGES || 5);
const WORKER_TOKEN = process.env.WORKER_TOKEN || 'dev-token';
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/$/, '');

const MODEL_CONFIGS = {
  // Individual Flux2 Klein workflows restored as separate selectable models.
  flux2_klein_1: {
    key: 'flux2_klein_1',
    label: 'Flux2 Klein 4B — 1 Image',
    mode: 'image',
    minImages: 1,
    maxImages: 1,
    description: 'Uses Workflows1-5/Flux2_Klein_4B_1Image_OfficialBased_Workflow.json and flux2_1_image_api.json.'
  },
  flux2_klein_2: {
    key: 'flux2_klein_2',
    label: 'Flux2 Klein 4B — 2 Images',
    mode: 'image',
    minImages: 2,
    maxImages: 2,
    description: 'Uses Workflows1-5/Flux2_Klein_4B_2Image_OfficialBased_Workflow.json and flux2_2_image_api.json.'
  },
  flux2_klein_3: {
    key: 'flux2_klein_3',
    label: 'Flux2 Klein 4B — 3 Images',
    mode: 'image',
    minImages: 3,
    maxImages: 3,
    description: 'Uses Workflows1-5/Flux2_Klein_4B_3Image_OfficialBased_Workflow.json and flux2_3_image_api.json.'
  },
  flux2_klein_4: {
    key: 'flux2_klein_4',
    label: 'Flux2 Klein 4B — 4 Images',
    mode: 'image',
    minImages: 4,
    maxImages: 4,
    description: 'Uses Workflows1-5/Flux2_Klein_4B_4Image_OfficialBased_Workflow.json and flux2_4_image_api.json.'
  },
  flux2_klein_5: {
    key: 'flux2_klein_5',
    label: 'Flux2 Klein 4B — 5 Images',
    mode: 'image',
    minImages: 5,
    maxImages: 5,
    description: 'Uses Workflows1-5/Flux2_Klein_4B_5Image_OfficialBased_Workflow.json and flux2_5_image_api.json.'
  },

  // Legacy automatic Flux option kept for backward compatibility with old queued jobs.
  flux2_klein: {
    key: 'flux2_klein',
    label: 'Flux2 Klein 4B — Auto 1–5 Images',
    mode: 'image',
    minImages: 1,
    maxImages: 5,
    description: 'Automatically chooses the Flux2 API workflow by uploaded image count.'
  },

  z_image_base_img2img_2: {
    key: 'z_image_base_img2img_2',
    label: 'Z-Image Base 2-Image Img2Img',
    mode: 'img2img',
    minImages: 2,
    maxImages: 2,
    description: 'Image 1 is the base/starter image. Image 2 gives details/reference.'
  },
  z_image_base_t2i: {
    key: 'z_image_base_t2i',
    label: 'Z-Image Base Text-to-Image',
    mode: 'text2image',
    minImages: 0,
    maxImages: 0,
    description: 'Prompt-only generation with positive and negative prompt.'
  }
};

function getModelConfig(modelKey) {
  return MODEL_CONFIGS[modelKey] || MODEL_CONFIGS.flux2_klein_1;
}

function publicModels() {
  return Object.values(MODEL_CONFIGS).map(({ key, label, mode, minImages, maxImages, description }) => ({
    key, label, mode, minImages, maxImages, description
  }));
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const RESULT_DIR = process.env.RESULT_DIR || path.join(process.cwd(), 'results');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(RESULT_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/results', express.static(RESULT_DIR));
app.use(express.static(path.join(process.cwd(), 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, UPLOAD_DIR),
    filename: (_, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${crypto.randomUUID()}-${safe}`);
    }
  }),
  limits: { files: MAX_IMAGES, fileSize: 25 * 1024 * 1024 }
});

function baseUrl(req) {
  return APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function removeIfExists(filepath) {
  try {
    if (filepath && fs.existsSync(filepath)) fs.unlinkSync(filepath);
  } catch {}
}

function cleanupJobFiles(job) {
  if (!job) return;
  for (const img of job.images || []) {
    removeIfExists(path.join(UPLOAD_DIR, img.filename));
  }
  if (job.result?.url) {
    const filename = path.basename(job.result.url);
    removeIfExists(path.join(RESULT_DIR, filename));
  }
}

function requireWorker(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || token !== WORKER_TOKEN) return res.status(401).json({ error: 'Unauthorized worker token' });
  next();
}

app.get('/health', (_, res) => res.json({ ok: true, service: 'smm-automation-starter' }));
app.get('/api/models', (_, res) => res.json({ models: publicModels() }));

app.post('/api/jobs', upload.array('images', MAX_IMAGES), (req, res) => {
  const files = req.files || [];
  const modelKey = req.body.modelKey || 'flux2_klein_1';
  const model = getModelConfig(modelKey);

  if (files.length < model.minImages) {
    return res.status(400).json({ error: `${model.label} needs at least ${model.minImages} image(s)` });
  }
  if (files.length > model.maxImages) {
    return res.status(400).json({ error: `${model.label} allows maximum ${model.maxImages} image(s)` });
  }
  if (files.length > MAX_IMAGES) return res.status(400).json({ error: `Maximum ${MAX_IMAGES} images allowed` });

  const width = Math.max(256, Math.round(Number(req.body.width || 1080)));
  const height = Math.max(256, Math.round(Number(req.body.height || 1350)));

  const id = crypto.randomUUID();
  const job = {
    id,
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    prompt: req.body.prompt || 'Create a premium social media advertising image.',
    negativePrompt: req.body.negativePrompt || '',
    title: req.body.title || '',
    description: req.body.description || '',
    tags: req.body.tags || '',
    platform: req.body.platform || 'instagram',
    modelKey: model.key,
    modelLabel: model.label,
    modelMode: model.mode,
    scaleLabel: req.body.scaleLabel || '',
    width,
    height,
    blendFactor: Number(req.body.blendFactor || 0.2),
    imageCount: files.length,
    images: files.map(f => ({
      originalName: f.originalname,
      filename: f.filename,
      url: `${baseUrl(req)}/uploads/${encodeURIComponent(f.filename)}`
    })),
    result: null,
    error: null,
    progress: 'Queued'
  };

  createJob(job);
  res.status(201).json(job);
});

app.get('/api/jobs', (_, res) => res.json({ jobs: listJobs() }));

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.delete('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  cleanupJobFiles(job);
  deleteJob(req.params.id);
  res.json({ ok: true });
});

app.post('/api/jobs/clear', (req, res) => {
  const mode = req.body.mode || 'finished';
  const jobs = listJobs();
  for (const job of jobs) {
    const matches =
      mode === 'all' ||
      (mode === 'completed' && job.status === 'completed') ||
      (mode === 'failed' && job.status === 'failed') ||
      (mode === 'finished' && ['completed', 'failed'].includes(job.status));
    if (matches) cleanupJobFiles(job);
  }
  const removed = clearJobs(mode);
  res.json({ ok: true, removed });
});

app.post('/api/worker/next', requireWorker, (req, res) => {
  const job = takeNextJob();
  if (!job) return res.json({ job: null });
  res.json({ job });
});

app.post('/api/worker/jobs/:id/status', requireWorker, (req, res) => {
  const job = updateJob(req.params.id, {
    status: req.body.status || 'processing',
    progress: req.body.progress || null,
    error: req.body.error || null
  });
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.post('/api/worker/jobs/:id/result', requireWorker, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  let resultUrl = req.body.resultUrl || null;
  if (req.body.imageBase64) {
    const ext = req.body.ext || 'png';
    const filename = `${job.id}-result.${ext}`;
    const buffer = Buffer.from(req.body.imageBase64, 'base64');
    fs.writeFileSync(path.join(RESULT_DIR, filename), buffer);
    resultUrl = `${APP_BASE_URL || ''}/results/${encodeURIComponent(filename)}`;
  }

  const updated = updateJob(job.id, {
    status: 'completed',
    progress: 'Completed',
    completedAt: new Date().toISOString(),
    result: { url: resultUrl, completedAt: new Date().toISOString() },
    error: null
  });
  res.json(updated);
});

app.post('/api/worker/jobs/:id/fail', requireWorker, (req, res) => {
  const updated = updateJob(req.params.id, {
    status: 'failed',
    progress: 'Failed',
    error: req.body.error || 'Generation failed'
  });
  if (!updated) return res.status(404).json({ error: 'Job not found' });
  res.json(updated);
});

app.listen(PORT, () => {
  console.log(`SMM Automation Starter running on port ${PORT}`);
});
