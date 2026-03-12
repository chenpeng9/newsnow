# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NewsNow is a news aggregator web app that collects trending news from multiple Chinese sources. It features a clean UI with real-time updates, GitHub OAuth login, and data synchronization.

## Tech Stack

- **Frontend**: React 19 + TanStack Router + TanStack Query + Jotai
- **Backend**: Nitro (node-server, deployable to Vercel, Cloudflare Pages, Bun)
- **Database**: SQLite (better-sqlite3 dev, Cloudflare D1 for production)
- **Build**: Vite 6.x + pnpm
- **Styling**: UnoCSS

## Important Notes

- **Vite Version**: Use Vite 6.x only. Vite 7 has compatibility issues with `vite-plugin-with-nitro` causing runtime errors.
- **h3 Override**: Add h3 version override in `package.json`:
  ```json
  "pnpm": {
    "overrides": {
      "h3": "1.15.3"
    }
  }
  ```

## Commands

```bash
pnpm dev          # Start development server
pnpm build        # Build for production
pnpm lint         # Run ESLint
pnpm test         # Run tests with Vitest
pnpm typecheck    # Run TypeScript type checking
pnpm presource    # Regenerate sources.json after adding/modifying sources
pnpm preview      # Preview production build (Cloudflare Pages)
pnpm deploy       # Deploy to Cloudflare Pages
```

## Architecture

```
src/              # Frontend React code (routes, components, hooks, atoms)
server/           # Nitro server API
  ├── api/        # API endpoints (login, oauth, sync, sources, intel)
  ├── sources/    # News source fetchers (one file per source)
  ├── intel/     # Intel filtering (L1/L2/L3 filters)
  ├── database/   # Database operations (cache, user)
  └── utils/      # Utility functions (fetch, date, crypto, scheduler, notify, llm, ollama)
shared/           # Shared types and source configuration
  ├── pre-sources.ts    # Source definitions (name, color, interval, subs)
  ├── sources.json      # Generated from pre-sources.ts
  └── intel-categories.ts # Intel source categories (A/B/C/D)
```

## Adding New Sources

1. **Register source** in `shared/pre-sources.ts`:
   ```typescript
   "sourceid": {
     name: "Source Name",
     color: "blue",
     home: "https://example.com",
     sub: {
       "subsection": { title: "Subsection Title", column: "tech" }
     }
   }
   ```

2. **Implement fetcher** in `server/sources/sourceid.ts`:
   ```typescript
   import * as cheerio from "cheerio"

   export default defineSource(async () => {
     const html = await myFetch(url, { headers: {...} })
     const $ = cheerio.load(html)

     return $("selector").map((_, el) => ({
       id: "unique-id",
       title: $(el).find("title").text(),
       url: $(el).find("a").attr("href"),
       extra: { info: "additional info" }
     })).get()
   })
   ```

3. **Run** `pnpm presource` to regenerate `sources.json`

The `defineSource` helper and `myFetch` are globally available in source files. Return `NewsItem[]` with `id`, `title`, `url`, and optional `extra`.

## Environment Variables

Create `.env.server` from `example.env.server`:
- `G_CLIENT_ID` / `G_CLIENT_SECRET` - GitHub OAuth
- `JWT_SECRET` - Session secret
- `INIT_TABLE` - Set to `true` on first run
- `ENABLE_CACHE` - Cache news (default: true)
- `PRODUCTHUNT_API_TOKEN` - Optional, for Product Hunt source

## Database

Uses db0 with database connectors. For production on Cloudflare Pages, use Cloudflare D1:
1. Create D1 database in Cloudflare dashboard
2. Configure `database_id` and `database_name` in `wrangler.toml`

## AI 情报管家 (Intel)

AI-powered news filtering and daily briefing system with three-layer filtering.

### Intel Categories

News sources are categorized by quality and processing frequency (see `shared/intel-categories.ts`):

- **A 类** (深度/专业级): jin10, wallstreetcn-hot, cls-depth, fastbull-express
- **B 类** (宏观/全球视野): cls-hot, 36kr-quick, cankaoxiaoxi, sputniknewscn, ifeng, thepaper, wallstreetcn-quick
- **C 类** (实时热度/情绪): baidu, weibo, zhihu, 36kr-renqi
- **D 类** (科技社区/生产力): ithome, sspai, juejin, solidot

### Three-Layer Filtering

1. **L1 启发式过滤**: Remove low-quality content (ads, promotions, duplicates)
2. **L2 语义去重**: Use Ollama (bge-m3) for semantic similarity, keep first in each cluster
3. **L3 AI 评分**: Use DeepSeek API to score news (0-100), generate 100-char summary + 20-char comment

### API Endpoints

```bash
POST /api/intel/scan          # Run full intel scan (L1→L2→L3)
POST /api/intel/briefing      # Generate and send daily briefing
POST /api/intel/test-briefing # Send test briefing with mock data
```

### Daily Briefing

Runs at 08:30 daily, scans A category sources only. Sends Feishu card format with:
- Title with date
- Each news item: title, score, source, summary, comment, primary button link
- HR separator between items

### Environment Variables

Additional Intel-related variables in `.env.server`:
- `DEEPSEEK_API_KEY` - DeepSeek API key for L3 scoring
- `OLLAMA_BASE_URL` - Ollama server URL (default: http://localhost:11434)
- `FEISHU_WEBHOOK` - Feishu webhook URL for notifications
- `DISCORD_WEBHOOK` - Discord webhook URL for notifications
- `INTEL_MIN_SCORE` - Minimum score threshold (default: 80)
