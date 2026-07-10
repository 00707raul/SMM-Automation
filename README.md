# SMM Automation Starter

Render web dashboard + local ComfyUI worker starter.

## What this includes

- Render-ready Node.js backend
- Simple dashboard for creating generation jobs
- Job queue API
- Local worker that polls Render
- Dry-run mode for testing without ComfyUI
- Flux2 Klein image workflows, 1–5 images
- Z-Image Base text-to-image API workflow with negative prompt
- Z-Image Base 2-image img2img API workflow

## Deploy to Render

1. Upload this folder to GitHub.
2. Go to Render → New → Web Service.
3. Connect GitHub repo.
4. Use:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Add env variable:
   - `WORKER_TOKEN` = long random secret
   - `APP_BASE_URL` = your Render URL after first deploy

Or use `render.yaml`.

## Run locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:10000
```

## Run the local worker

Create `.env` from `.env.example`, then:

```bash
npm run worker
```

At first keep:

```text
DRY_RUN=true
```

This lets you test Render + worker without ComfyUI.

## Connect real ComfyUI later

When ready:

1. Start ComfyUI locally: `http://127.0.0.1:8188`
2. Export API-format workflows from ComfyUI into `workflows_api/`
3. Set:

```text
DRY_RUN=false
COMFY_URL=http://127.0.0.1:8188
COMFY_INPUT_DIR=D:\Comfy-Desktop\ComfyUI-Shared\input
```

The worker will:

1. Pull queued jobs from Render.
2. Download job images.
3. Put images into ComfyUI input folder.
4. Send prompt to ComfyUI.
5. Upload final result back to Render.

## Important

The JSON files in `workflows/` are UI workflow files. For `/prompt` automation, use API-format exports in `workflows_api/`.

## Folder structure

```text
public/              dashboard
src/store.js         simple JSON job storage
server.js            Render backend
local-worker.js      local ComfyUI worker
workflows/           normal ComfyUI UI workflows
workflows_api/       exported API workflow files go here
uploads/             uploaded images
results/             generated results
```

## UI Upgrade Included

This ZIP includes the upgraded dashboard:
- scale preset buttons
- image upload previews
- progress bar and ETA
- result image preview modal
- download result button
- delete job
- clean finished history / clear all history
- 1–5 Flux2 ComfyUI API workflow files in `workflows_api/`
- Z-Image Base text-to-image and 2-image img2img API workflows
- model selector in the website UI
- local image fitting/scaling before ComfyUI so mixed image sizes do not squeeze or distort

Important: `.env` is not included for safety. Keep your existing local `.env` file or create it from `.env.example`.


## Image size fix

The local worker now preprocesses uploaded images before sending them to ComfyUI.
Every uploaded image is fitted to the selected Width × Height canvas using Sharp, so different source sizes do not get squeezed or mixed incorrectly.

Default:

```text
IMAGE_FIT_MODE=cover
```

- `cover` keeps aspect ratio and centre-crops to fill the selected canvas.
- `contain` keeps the full image and adds transparent padding.

After downloading this ZIP, run:

```bash
npm.cmd install
```

This installs the new `sharp` dependency used by the worker.


## Restored Flux2 Klein workflow options

This version keeps the original Flux2 workflow files and exposes them in the website as separate selectable models:

- Flux2 Klein 4B — 1 Image
- Flux2 Klein 4B — 2 Images
- Flux2 Klein 4B — 3 Images
- Flux2 Klein 4B — 4 Images
- Flux2 Klein 4B — 5 Images

The matching API workflows are in `workflows_api/flux2_1_image_api.json` through `workflows_api/flux2_5_image_api.json`. The visual workflow copies are still in `workflows/`.
