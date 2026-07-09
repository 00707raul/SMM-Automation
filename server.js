require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { listJobs, getJob, createJob, updateJob, takeNextJob } = require('./src/store');

const app = express();
const PORT = process.env.PORT || 10000;
const MAX_IMAGES = Number(process.env.MAX_IMAGES || 5);
const WORKER_TOKEN = process.env.WORKER_TOKEN || 'dev-token';
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/$/, '');

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

function requireWorker(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || token !== WORKER_TOKEN) return res.status(401).json({ error: 'Unauthorized worker token' });
  next();
}

app.get('/health', (_, res) => res.json({ ok: true, service: 'smm-automation-starter' }));

app.post('/api/jobs', upload.array('images', MAX_IMAGES), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Upload at least 1 image' });
  if (files.length > MAX_IMAGES) return res.status(400).json({ error: `Maximum ${MAX_IMAGES} images allowed` });

  const id = crypto.randomUUID();
  const job = {
    id,
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    prompt: req.body.prompt || 'Create a premium social media advertising image.',
    title: req.body.title || '',
    description: req.body.description || '',
    tags: req.body.tags || '',
    platform: req.body.platform || 'instagram',
    width: Number(req.body.width || 1080),
    height: Number(req.body.height || 1350),
    imageCount: files.length,
    images: files.map(f => ({
      originalName: f.originalname,
      filename: f.filename,
      url: `${baseUrl(req)}/uploads/${encodeURIComponent(f.filename)}`
    })),
    result: null,
    error: null
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
    result: { url: resultUrl, completedAt: new Date().toISOString() },
    error: null
  });
  res.json(updated);
});

app.post('/api/worker/jobs/:id/fail', requireWorker, (req, res) => {
  const updated = updateJob(req.params.id, {
    status: 'failed',
    error: req.body.error || 'Generation failed'
  });
  if (!updated) return res.status(404).json({ error: 'Job not found' });
  res.json(updated);
});

app.listen(PORT, () => {
  console.log(`SMM Automation Starter running on port ${PORT}`);
});
