import { waitUntil } from '@vercel/functions';
import { createHandler } from '../bot/handler.js';
import { application } from '../bot/application.js';

const handler = createHandler({
  schedule: waitUntil,
  env: {
    ...process.env,
    DISCORD_PUBLIC_KEY: process.env.DISCORD_PUBLIC_KEY || application.publicKey,
    DISCORD_APPLICATION_ID: process.env.DISCORD_APPLICATION_ID || application.id,
    WEBSITE_URL: process.env.WEBSITE_URL || application.website,
  },
});

// Web Handler de Vercel: leer el stream original, sin los helpers que parsean req.body.
export async function POST(request) {
  const response = {
    statusCode: 200,
    headers: new Headers(),
    body: '',
    setHeader(name, value) { this.headers.set(name, value); },
    end(body) { this.body = body; },
  };
  const rawRequest = {
    method: request.method,
    headers: Object.fromEntries(request.headers),
    async *[Symbol.asyncIterator]() {
      if (request.body) for await (const chunk of request.body) yield chunk;
    },
  };
  await handler(rawRequest, response);
  return new Response(response.body, { status: response.statusCode, headers: response.headers });
}
