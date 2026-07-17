# SMM AI Engine

Professional three-column dashboard for Render + a local ComfyUI worker.

## Included workflows

- Face Swap — 2 images, fixed prompt
  - 1. Reference: face and hair source
  - 2. Your model: body and composition to keep
  - Output size follows the model image
- Flux2 Klein 4B — 1 to 5 image workflows
- Z-Image Base — 2-image img2img
- Z-Image Base — text-to-image

## Interface

- Left: workflow, uploads, hand-written prompt and generation settings
- Centre: live progress, current result and generation history
- Right: AI prompt improver
- The prompt and AI improver are automatically disabled for Face Swap because its prompt is already set in the workflow.

## Install

```bash
npm install
```

Create `.env` from `.env.example` and keep your real secrets only in `.env` or Render environment variables.

## Start the web dashboard

```bash
npm start
```

Open:

```text
http://localhost:10000
```

## Start the local worker

```bash
npm run worker
```

For real ComfyUI generation, use:

```text
DRY_RUN=false
COMFY_URL=http://127.0.0.1:8188
COMFY_INPUT_DIR=D:\Comfy-Desktop\ComfyUI-Shared\input
```

## Face Swap requirements

The Face Swap workflow uses:

- `flux-2-klein-4b.safetensors`
- `qwen_3_4b.safetensors`
- `flux2-vae.safetensors`
- `KiaraReferenceLatent`
- `ImageComparer`

The website uploads the images in this order:

1. Reference face/hair
2. Your model/body

The worker automatically maps them to the correct ComfyUI LoadImage nodes.

## Project structure

```text
public/index.html       website UI
server.js               web server and job API
local-worker.js         local ComfyUI worker
src/store.js            JSON job storage
workflows/              visual ComfyUI workflows
workflows_api/          API-format ComfyUI workflows
uploads/                temporary input uploads
results/                generated results
```
