---
uid: task-025
status: open
priority: normal
scheduled: 2026-05-15
pomodoros: 0
contexts:
- phase:4
- slicer
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# Wire slicer into docker-compose

**Files:** `docker-compose.yml`

- [ ] **Step 1: Add slicer service**

Update `docker-compose.yml` (keep the existing postgres block):

```yaml
services:
  postgres:
    image: postgres:16
    container_name: 3dgen-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - 3dgen-pgdata:/var/lib/postgresql/data

  slicer:
    build: ./slicer
    container_name: 3dgen-slicer
    restart: unless-stopped
    environment:
      QT_QPA_PLATFORM: offscreen
      PORT: "8787"
    ports:
      - "8787:8787"

volumes:
  3dgen-pgdata:
```

- [ ] **Step 2: Bring it up**

```bash
docker compose up -d slicer
sleep 5
curl -s http://localhost:8787/health
```

Expect `{"ok":true,...}`. If it doesn't come up, `docker compose logs slicer` and debug.

- [ ] **Step 3: Smoke `/slice` with a tiny STL fixture**

```bash
# Generate a 10mm cube STL via a tiny node one-liner against the existing runner
pnpm exec tsx -e "
import { runJscad } from './src/lib/jscad/runner.ts'
const r = await runJscad(\`const main = () => jscad.primitives.cuboid({ size: [10, 10, 10] }); module.exports = { main }\`)
if (r.ok) console.log(Buffer.from(r.stl).toString('base64'))
" > /tmp/cube.stl.b64

# Send to slicer
curl -s -X POST http://localhost:8787/slice \
  -H 'content-type: application/json' \
  -d "{\"stl_base64\":\"$(cat /tmp/cube.stl.b64 | tr -d '\n')\"}" \
  | head -c 500
```

Expect: JSON with `bytes_base64` (long string) + `meta`. If you see `error: OrcaSlicer failed`, inspect `stderr` in the response.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add slicer service to docker-compose"
```
