const recipient = 'contact-form@lakelandfinearts.com';
const sender = 'website@lakelandfinearts.com';
const maxBytes = 16_384;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]!));

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders
  } });
}

async function readBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  let bytes = 0;
  let text = '';
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new RangeError('Body too large');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

export async function submitContact(request: Request,
  env: Pick<Env, 'CONTACT_EMAIL' | 'CONTACT_RATE_LIMIT' | 'CONTACT_GLOBAL_LIMIT'>): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
  if (request.headers.get('Origin') !== new URL(request.url).origin)
    return json({ error: 'Please submit the form from this website.' }, 403);
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    return json({ error: 'Send the form as JSON.' }, 415);
  if (Number(request.headers.get('Content-Length')) > maxBytes)
    return json({ error: 'Your message is too large.' }, 413);

  let value: unknown;
  try { value = JSON.parse(await readBody(request)); }
  catch (error) { return json({ error: error instanceof RangeError ? 'Your message is too large.' : 'The form could not be read.' }, error instanceof RangeError ? 413 : 400); }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return json({ error: 'Name, email, and message are required.' }, 400);
  const fields = value as Record<string, unknown>;
  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  const email = typeof fields.email === 'string' ? fields.email.trim() : '';
  const message = typeof fields.message === 'string' ? fields.message.trim() : '';
  if (!name || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)
      || !email || email.length > 254 || !/^[^\s<>@,;"\\]+@[^\s<>@,;"\\]+\.[^\s<>@,;"\\]+$/.test(email)
      || /[\x00-\x1f\x7f]/.test(email)
      || !message || message.length > 3000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message))
    return json({ error: 'Enter your name (up to 100 characters), a valid email address, and a message (up to 3,000 characters).' }, 400);

  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (!(await env.CONTACT_RATE_LIMIT.limit({ key: ip })).success
        || !(await env.CONTACT_GLOBAL_LIMIT.limit({ key: 'contact' })).success)
      return json({ error: 'Too many messages. Please wait a minute before trying again.' }, 429, { 'Retry-After': '60' });
    await env.CONTACT_EMAIL.send({
      from: { email: sender, name: 'Lakeland Fine Arts website' },
      to: recipient,
      replyTo: { email, name },
      subject: 'New message from the Lakeland Fine Arts contact form',
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
      html: `<h1>Website contact</h1><p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${escapeHtml(email)}</p><p>${escapeHtml(message).replace(/\r?\n/g, '<br>')}</p>`
    });
    return json({ message: 'Thank you! Your message has been sent to our studio.' }, 200);
  } catch {
    // Do not log visitor names, addresses, message text, or provider errors containing them.
    console.error(JSON.stringify({ event: 'contact_delivery_failed' }));
    return json({ error: 'We could not confirm your message was sent. Your text is still here. Please try again later or email contact-form@lakelandfinearts.com directly.' }, 503);
  }
}
