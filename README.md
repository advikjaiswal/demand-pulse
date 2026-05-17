# Demand Pulse

Demand Pulse is a standalone free-beta SaaS for mining real audience questions and turning them into content ideas.

It scans Reddit plus optional web search sources, clusters questions by topic/pain point, and gives beta users a simple content calendar.

## What Ships

- Public beta landing page: `/`
- Beta app: `/app`
- Email/password accounts
- One or more workspaces per user
- Workspace-specific demand scans
- Topic clusters and source posts
- Content ideas and calendar
- Feedback capture
- Render-ready and Docker-ready deployment

## Local Setup

```bash
npm install
cp .env.example .env
# fill DATABASE_URL
npm test
npm start
```

Open:

- `http://localhost:3000`
- `http://localhost:3000/app`
- `http://localhost:3000/health`

## Deploy Right Now On Render

1. Create a new GitHub repo for this folder.

```bash
cd /Users/advikjaiswal/Downloads/demand-pulse
git init
git add .
git commit -m "initial demand pulse beta"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/demand-pulse.git
git push -u origin main
```

2. Create a Postgres database.

Use one of:

- Render Postgres
- Neon
- Supabase
- any hosted Postgres provider

Copy the database connection string.

3. Create a Render Web Service.

In Render:

- New → Web Service
- Connect the GitHub repo
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`

4. Add environment variables.

Required:

```bash
DATABASE_URL=postgresql://...
DEMAND_BETA_OPEN=true
```

Optional:

```bash
APP_URL=https://your-render-app.onrender.com
DEMAND_QUERIES_PER_SCAN=8
DEMAND_MIN_RELEVANCE=24
BRAVE_API_KEY=your_brave_key
```

5. Deploy.

After the first deploy, open:

- `https://your-app.onrender.com`
- `https://your-app.onrender.com/app`

The database schema is created automatically on boot.

## Deploy Anywhere Else

Any host that can run a long-lived Node server works:

- Render
- Fly.io
- DigitalOcean App Platform
- Heroku
- a VPS
- Docker on any container host

Generic commands:

```bash
npm install
npm start
```

Required env:

```bash
DATABASE_URL=postgresql://...
PORT=3000
```

Docker:

```bash
docker build -t demand-pulse .
docker run -p 3000:3000 --env-file .env demand-pulse
```

## Search Sources

Reddit works without an API key.

If you do not set a search API key, Demand Pulse falls back to DuckDuckGo HTML search. This is good enough for early beta testing, but it is slower and less predictable than a paid/search API.

For better X, Quora, and Facebook discovery through web search, set one of:

```bash
BRAVE_API_KEY=
```

or:

```bash
GOOGLE_CSE_API_KEY=
GOOGLE_CSE_ID=
```

Brave is the simplest paid/API path once you have a card. Until then, leave the keys blank.

## Beta Notes

This version intentionally has no billing, team seats, email verification, or admin approval queue. Use it to get free testers, watch what they ask for, and only then add paid plans.
