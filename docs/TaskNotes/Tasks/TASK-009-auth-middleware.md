---
uid: task-009
status: open
priority: normal
scheduled: 2026-05-15
pomodoros: 0
contexts:
- phase:1
- jscad-mvp
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# Auth middleware

**Files:** `middleware.ts`

- [ ] **Step 1: Middleware**

```ts
import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const isLoggedIn = !!req.auth
  const { pathname } = req.nextUrl
  const isPublic = pathname === '/sign-in' || pathname.startsWith('/api/auth')
  if (isPublic) return NextResponse.next()
  if (!isLoggedIn) {
    const url = req.nextUrl.clone()
    url.pathname = '/sign-in'
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 2: Run homepage smoke test**

```bash
pnpm test:e2e tests/e2e/homepage.spec.ts
```

Expected: passes (sign-in page renders for anonymous user).

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat(auth): middleware gating non-public routes"
```
