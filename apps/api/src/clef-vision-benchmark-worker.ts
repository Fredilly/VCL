interface Env {
  AI: {
    run(model: string, input: {
      model: string;
      state: unknown;
      questions: Record<string, unknown>;
      images?: string[];
    }): Promise<unknown>;
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

    let body: { state?: unknown; questions?: Record<string, unknown>; images?: string[] };
    try {
      body = await request.json() as typeof body;
    } catch {
      return json({ error: 'invalid json' }, 400);
    }

    if (!body.questions || !Array.isArray(body.images) || body.images.length === 0) {
      return json({ error: 'questions and images are required' }, 400);
    }

    try {
      const result = await env.AI.run('@cf/cloudflare/clef', {
        model: 'clef',
        state: body.state ?? {},
        questions: body.questions,
        images: body.images,
      });
      return json({ result });
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : String(error),
      }, 502);
    }
  },
};
