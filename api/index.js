// Vercel serverless entry — wraps the Express app. Vercel routes /api/* here
// (see vercel.json); the static client is served from client/dist by Vercel's
// static hosting, so this function only handles the API.
import { createApp } from '../server/app.js';

const app = createApp();

export default function handler(req, res) {
  return app(req, res);
}
