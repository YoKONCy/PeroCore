# Zeabur Deployment

This repository is configured so Zeabur should deploy the backend-only service for remote Windows frontend connections.

## Files

- `zbpack.json`
  - Forces Zeabur to use `Dockerfile.zeabur`
- `Dockerfile.zeabur`
  - Builds and runs the Python backend service only

## Required Zeabur Settings

- Branch: `electron`
- Root Directory: `/`
- Persistent Volume: mount to `/data`

## Recommended Environment Variables

- `PERO_DATA_DIR=/data`
- `PERO_DATABASE_PATH=/data/perocore.db`
- `PERO_DESKTOP_API_KEY=<your-secret-desktop-key>`

## Notes

- The Windows Electron frontend should connect in remote backend mode.
- The launcher's remote desktop access key must match `PERO_DESKTOP_API_KEY`.
