const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'jobs.json');

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ jobs: [] }, null, 2));
}

function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { jobs: [] };
  }
}

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function listJobs() {
  return readStore().jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getJob(id) {
  return readStore().jobs.find(j => j.id === id) || null;
}

function createJob(job) {
  const data = readStore();
  data.jobs.push(job);
  writeStore(data);
  return job;
}

function updateJob(id, patch) {
  const data = readStore();
  const idx = data.jobs.findIndex(j => j.id === id);
  if (idx === -1) return null;
  data.jobs[idx] = { ...data.jobs[idx], ...patch, updatedAt: new Date().toISOString() };
  writeStore(data);
  return data.jobs[idx];
}

function deleteJob(id) {
  const data = readStore();
  const before = data.jobs.length;
  data.jobs = data.jobs.filter(j => j.id !== id);
  if (data.jobs.length === before) return false;
  writeStore(data);
  return true;
}

function clearJobs(mode = 'all') {
  const data = readStore();
  const before = data.jobs.length;
  if (mode === 'completed') {
    data.jobs = data.jobs.filter(j => j.status !== 'completed');
  } else if (mode === 'finished') {
    data.jobs = data.jobs.filter(j => !['completed', 'failed'].includes(j.status));
  } else if (mode === 'failed') {
    data.jobs = data.jobs.filter(j => j.status !== 'failed');
  } else {
    data.jobs = [];
  }
  writeStore(data);
  return before - data.jobs.length;
}

function takeNextJob() {
  const data = readStore();
  const job = data.jobs.find(j => j.status === 'queued');
  if (!job) return null;
  job.status = 'processing';
  job.workerStartedAt = new Date().toISOString();
  job.updatedAt = new Date().toISOString();
  writeStore(data);
  return job;
}

module.exports = { listJobs, getJob, createJob, updateJob, deleteJob, clearJobs, takeNextJob };
