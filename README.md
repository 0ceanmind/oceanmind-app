# OceanMind 🌊

Depth-based interactive AI learning, powered by a real agent. Tell OceanMind what
you want to learn (this MVP covers **Neural Networks**, **AI Agents**, and
**Chatbots**) and the agent — driven by the LLM you connect — reads the source
material, compiles a knowledge map, writes your placement quiz, measures your
depth, and generates a step-by-step lesson that exists only for you.

Depth zones: Sunlight (beginner, 0–200 m) → Twilight (200–1,000 m) → Midnight
(advanced, 1,000–4,000 m).

Nothing the learner sees is canned: knowledge maps, questions, explanations, and
lessons are generated per session, grounded in the resource documents in
`server/content/resources/` (extracted from the uploaded PDFs). The in-lesson
agent demo runs a real think→act→observe loop — the model decides, the server
executes the tools. A tutor chat answers questions grounded in the same sources.

## Requirements

- **Node.js 22.13 or newer** (uses the built-in `node:sqlite` — no native packages).
- An LLM API key: **Google Gemini**, **Anthropic**, or **OpenRouter** (any model).

## Run it

```bash
npm install        # installs server + client dependencies
npm run build      # builds the React client
npm start          # → http://localhost:3001
```

Then open `http://localhost:3001/#/admin`, pick your provider, paste your API
key, hit **Test connection**, and **Save & connect**. The key is stored in the
server's database and never reaches the browser. Until a model is connected,
dives can't start.

Development mode (hot reload): `npm run dev` · Tests: `npm test`

## The three views

- **Learner** — `http://localhost:3001/` — sign in with name + email.
- **Admin** — `#/admin` — connect/switch the LLM provider, key, and model.
- **Support console** — `#/support` — the feedback inbox. Unhappy feedback lands
  here with the full answer-by-answer session breakdown; support picks a
  corrected depth zone and the agent regenerates the lesson, delivered to the
  learner in-app with an email preview.

## Swapping learning sources

Replace or add plain-text files in `server/content/resources/<topic-id>.txt`
and restart. All generation is grounded in these files via keyword retrieval.

## Data

SQLite file at `server/data/oceanmind.db` — users, sessions, generated content,
feedback, reports, notifications, and the AI config all survive restarts.
Delete the file to reset everything (including the saved API key).
