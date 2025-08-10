import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, redirect }) => {
  try {
    const contentType = request.headers.get('content-type') || '';

    let email = '';
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { email?: string };
      email = (body.email || '').toString().trim();
    } else {
      const form = await request.formData();
      email = (form.get('email') || '').toString().trim();
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (contentType.includes('application/json')) {
        return new Response(JSON.stringify({ ok: false, error: 'Invalid email' }), {
          status: 400,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      return new Response('Invalid email', { status: 400 });
    }

    // Stubbed persistence — integrate provider later
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _accepted = true;

    if (contentType.includes('application/json')) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    return redirect('/?subscribed=1', 303);
  } catch (err) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
};


