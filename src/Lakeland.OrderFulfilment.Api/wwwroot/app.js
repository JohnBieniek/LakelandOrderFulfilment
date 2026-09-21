const main = document.querySelector('#main');
const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast('Your browser cannot save this cart between visits.'); } };
let catalog;
let cart = read('lakeland-cart-v1', []);
if (!Array.isArray(cart)) cart = [];
let toastTimer;
let successTimer;
const icons = {
  original: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 26 24 8l-2-3L3 23Zm2-1 3 4 17-17-3-3M22 5l3-3 5 5-3 3"/></svg>',
  clay: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 14h18l-2 14H9L7 14ZM12 13V8a4 4 0 0 1 8 0v5M4 28h24"/></svg>',
  printful: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 8h24v19H4ZM4 15h24M12 8v7m8-7v7M10 8V4h12v4"/></svg>'
};
const kindName = kind => ({ original: 'One of a kind', clay: 'Made to order', printful: 'Printed on demand' })[kind];
const shortDate = value => new Date(value + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const estimate = p => `${shortDate(p.estimate.earliest)} – ${shortDate(p.estimate.latest)}`;
const productFor = id => catalog.products.find(p => p.id === id);
const cartItems = () => cart.map(line => ({ ...line, product: productFor(line.id) })).filter(line => line.product);

function toast(message) {
  const node = document.querySelector('#toast'); node.textContent = message; node.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 3300);
}
function updateCart() {
  const count = cart.reduce((total, item) => total + item.quantity, 0);
  document.querySelector('#cart-count').textContent = count;
  document.querySelector('.cart-link').setAttribute('aria-label', `Cart, ${count} ${count === 1 ? 'item' : 'items'}`);
  save('lakeland-cart-v1', cart);
}
function changeCart(id, amount) {
  const product = productFor(id); if (!product) return;
  const line = cart.find(item => item.id === id);
  const quantity = Math.max(0, Math.min(product.maxQuantity, (line?.quantity ?? 0) + amount));
  if (amount > 0 && !product.available) { toast('This original is currently reserved or sold.'); return; }
  if (quantity === line?.quantity) { toast(product.maxQuantity === 1 ? 'This one-of-a-kind original is already in your cart.' : 'Maximum quantity reached.'); return; }
  cart = cart.filter(item => item.id !== id);
  if (quantity > 0) cart.push({ id, quantity });
  save('lakeland-checkout-request', null);
  updateCart();
  if (location.pathname === '/cart') renderCart();
  else if (amount > 0) toast(`${product.name} added to your cart`);
}
function navigate(url, focus = true) {
  history.pushState({}, '', url); render(); window.scrollTo(0, 0);
  if (focus) main.focus({ preventScroll: true });
}
function intro(eyebrow, title, description) {
  return `<div class="page-intro"><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>`;
}
function renderHome() {
  main.innerHTML = `<div class="wrap"><section class="hero"><div><span class="eyebrow">From our studio to your story</span><h1>Art that feels<br>like <em>you.</em></h1><p>Original paintings, handmade clay, and everyday objects with a little more soul. Made with care. Meant to be loved.</p><div class="hero-buttons"><a href="/products" class="button">Find your piece <span aria-hidden="true">↗</span></a><a class="text-link" href="/gallery">Wander the gallery</a></div><div class="hero-note">Independent artists. A personal touch.</div></div><div class="hero-art"><img src="/art/lake.svg" alt="Illustrative lake landscape in soft green and gold, a beta artwork preview" width="800" height="900" fetchpriority="high"><div class="hero-caption">A quieter kind of beautiful. &nbsp; / &nbsp; Illustrative beta preview</div></div></section>
    <div class="values"><div class="value">${icons.original}<div>Truly original<small>One-of-a-kind paintings</small></div></div><div class="value">${icons.clay}<div>Made by hand<small>Clay pieces, crafted for you</small></div></div><div class="value">${icons.printful}<div>Art for every day<small>Printed just when you order</small></div></div></div>
    <section><div class="section-heading"><div><span class="eyebrow">Something to connect with</span><h2>Find your kind of art.</h2></div><a href="/products" class="text-link">Explore all products ↗</a></div><div class="collection-grid">
    ${[['original', 'lake', 'Original paintings', 'The only one, for your one-of-a-kind space.'], ['clay', 'sculpture', 'Handmade clay', 'A little character. A lot of care.'], ['printful', 'mug', 'Art for the everyday', 'Your daily rituals, a little more inspired.']].map(([kind, image, title, copy]) => `<a class="collection" href="/products?kind=${kind}"><div class="image-wrap"><img src="/art/${image}.svg" alt="${title} illustrative preview" loading="lazy" width="800" height="900"></div><div><div class="collection-title"><h3>${title}</h3><span aria-hidden="true">↗</span></div><p>${copy}</p></div></a>`).join('')}</div></section>
    <section class="studio-band"><div><span class="eyebrow">A small studio. A bigger story.</span><h2>Made with heart.<br>Shared with you.</h2><p>We believe the things you surround yourself with should mean something. Here, every painting, sculpture, and design begins with an artist and an idea.</p><a href="/contact" class="text-link">Say hello to the studio ↗</a></div><div class="quote">“For the wall you walk past.<br>The shelf you love.<br>The cup you reach for.”</div></section></div>`;
}
function filterFields() {
  const artists = [...new Set([...catalog.products, ...catalog.gallery].map(p => p.artist))].sort();
  const params = new URLSearchParams(location.search);
  return `<div class="filter-fields"><label>Artist<select id="artist-filter" aria-label="Artist"><option value="">All artists</option>${artists.map(artist => `<option value="${escape(artist)}" ${params.get('artist') === artist ? 'selected' : ''}>${escape(artist)}</option>`).join('')}</select></label><label>Sort by<select id="sort-filter" aria-label="Sort by">${[['featured', 'Featured'], ['artist', 'Artist A–Z'], ['title', 'Title A–Z'], ...(location.pathname === '/products' ? [['price-low', 'Price: low to high'], ['price-high', 'Price: high to low']] : [])].map(([value, label]) => `<option value="${value}" ${params.get('sort') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>`;
}
function sorted(items) {
  const params = new URLSearchParams(location.search); const artist = params.get('artist');
  const filtered = items.filter(item => !artist || item.artist === artist);
  return filtered.sort((a, b) => {
    switch (params.get('sort')) {
      case 'artist': return a.artist.localeCompare(b.artist) || (a.name || a.title).localeCompare(b.name || b.title);
      case 'title': return (a.name || a.title).localeCompare(b.name || b.title);
      case 'price-low': return a.price - b.price;
      case 'price-high': return b.price - a.price;
      default: return 0;
    }
  });
}
function productCard(p) {
  return `<article class="product-card" id="product-${p.id}"><div class="product-image"><img src="${p.image}" alt="${escape(p.name)} — illustrative sample" loading="lazy" width="800" height="900"><span class="badge">${p.available ? kindName(p.kind) : 'Reserved / sold'}</span></div><div class="artist">${escape(p.artist)} · Sample listing</div><div class="product-title"><h3>${escape(p.name)}</h3><span class="price">${money(p.price)}</span></div><p class="product-description">${escape(p.description)}</p><p class="product-meta">${escape(p.details)}</p><div class="shipping">Estimated ship date: ${estimate(p)}<small>${escape(p.estimate.description)}</small></div><button class="button light" data-add="${p.id}" ${p.available ? '' : 'disabled'} aria-label="Add ${escape(p.name)} to cart">${p.available ? 'Add to cart' : 'Unavailable'} <span aria-hidden="true">+</span></button></article>`;
}
function renderProducts() {
  const kind = new URLSearchParams(location.search).get('kind') || '';
  const items = sorted(catalog.products.filter(p => !kind || p.kind === kind));
  main.innerHTML = `<div class="wrap">${intro('The collection', 'Art to make your own.', 'Something for your walls, something for your shelves, something for your everyday. Find the piece that speaks to you.')}<div class="notice">You’re exploring our beta. Artwork, artist labels, prices, and lead times are samples. No real purchases or shipments are available yet.</div><div class="filters"><div class="tabs" aria-label="Product types">${[['', 'All pieces'], ['original', 'Original paintings'], ['clay', 'Handmade clay'], ['printful', 'Print on demand']].map(([value, label]) => `<button class="tab ${kind === value ? 'selected' : ''}" data-kind="${value}" aria-pressed="${kind === value}">${label}</button>`).join('')}</div>${filterFields()}</div><p class="results-count" aria-live="polite">${items.length} ${items.length === 1 ? 'piece' : 'pieces'} to discover</p>${items.length ? `<div class="product-grid">${items.map(productCard).join('')}</div>` : '<div class="empty"><h2>No pieces found.</h2><p>Try another artist or explore all product types.</p><a class="button light" href="/products">Clear filters</a></div>'}<p class="shipping-note">A note on shipping: these are estimated <strong>dispatch dates</strong>, not arrival dates. Weekends are excluded; holidays, studio capacity, and destination may change timing. Clay is made after you order. Printful items ship separately. Final shipping rates and taxes are still being configured.</p></div>`;
  bindFilters();
}
function galleryCard(work) {
  return `<article class="gallery-card"><img src="${work.image}" alt="${escape(work.title)} — illustrative beta artwork" loading="lazy" width="800" height="900"><div class="artist">${escape(work.artist)} · Sample artwork</div><h3>${escape(work.title)}</h3><p class="medium">${escape(work.medium)}</p>${work.fanArt ? '<span class="fan-tag">For appreciation. Not for sale.</span>' : `<a class="text-link" href="/products?highlight=${work.productId}">View the sample piece ↗</a>`}</article>`;
}
function renderGallery() {
  const selection = new URLSearchParams(location.search).get('section') || '';
  const works = sorted(catalog.gallery);
  const originals = works.filter(w => !w.fanArt); const fan = works.filter(w => w.fanArt);
  main.innerHTML = `<div class="wrap">${intro('A look inside the studio', 'The gallery.', 'Paintings, little clay characters, and the things that spark our imagination. Take your time. There’s no wrong way to look.')}<div class="notice">Illustrative placeholders show the beta layout. Real artist names and artwork will be added before launch.</div><div class="filters"><div class="tabs" aria-label="Gallery sections">${[['', 'All artwork'], ['originals', 'Original work'], ['fan', 'Fan art · Not for sale']].map(([value, label]) => `<button class="tab ${selection === value ? 'selected' : ''}" data-section="${value}" aria-pressed="${selection === value}">${label}</button>`).join('')}</div>${filterFields()}</div>${selection !== 'fan' ? `<p class="results-count">${originals.length} original works</p><div class="gallery-grid">${originals.map(galleryCard).join('')}</div>` : ''}${selection !== 'originals' ? `<section class="fan-section" id="fan-art"><div class="fan-header"><div><span class="eyebrow">Just for the love of it</span><h2>A little fandom.</h2><span class="fan-tag">Gallery only · Nothing for sale</span></div><p>A space for studies inspired by favorite stories and imagined worlds. Fan art lives here for appreciation only, with no products, prints, or purchase options.</p></div>${fan.length ? `<div class="gallery-grid">${fan.map(galleryCard).join('')}</div>` : '<p class="results-count">No fan art by this artist yet. Try another artist.</p>'}</section>` : '<div class="shipping-note">Looking for something different? Explore the fan art section, just for appreciation.</div>'}${!works.length ? '<div class="empty"><h2>No artwork found.</h2><a class="button light" href="/gallery">Clear filters</a></div>' : ''}</div>`;
  bindFilters();
}
function bindFilters() {
  const change = (key, value) => { const params = new URLSearchParams(location.search); if (value) params.set(key, value); else params.delete(key); history.replaceState({}, '', location.pathname + (params.size ? '?' + params : '')); render(); };
  document.querySelector('#artist-filter')?.addEventListener('change', event => change('artist', event.target.value));
  document.querySelector('#sort-filter')?.addEventListener('change', event => change('sort', event.target.value));
  main.querySelectorAll('[data-kind]').forEach(button => button.addEventListener('click', () => change('kind', button.dataset.kind)));
  main.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => change('section', button.dataset.section)));
}
function renderContact() {
  main.innerHTML = `<div class="wrap">${intro('Let’s make a connection', 'Hello, art lover.', 'A question about a piece? An idea for a clay sculpture? Or just a hello? We’d love to hear from you.')}<div class="contact-layout"><div class="contact-details"><span class="eyebrow">A note to the studio</span><a href="mailto:contact@lakelandfinearts.com">contact@lakelandfinearts.com</a><h3>Something made for you.</h3><p>Our clay sculptures are made to order. If you have a particular character, color, or little detail in mind, let’s talk about what’s possible.</p><h3>About your order.</h3><p>Original paintings and clay pieces are packed by our studio. Print-on-demand pieces are made and shipped by Printful, so mixed orders may arrive in separate packages.</p><h3>Here during the beta.</h3><p>We’re still setting things up. Tell us what you love, what feels confusing, or what you’d like to see next.</p></div><form class="contact-form" id="contact-form"><h2>Send a little hello.</h2><div class="field"><label for="contact-name">Your name</label><input id="contact-name" name="name" autocomplete="name" maxlength="100" required placeholder="Name"></div><div class="field"><label for="contact-email">Email address</label><input id="contact-email" name="email" type="email" autocomplete="email" maxlength="200" required placeholder="you@example.com"></div><div class="field"><label for="contact-subject">What’s on your mind?</label><select id="contact-subject" name="subject"><option>A question about the artwork</option>A made-to-order clay sculpture</option>An order or shipping question</option>Beta feedback</option>Just saying hello</option></select></div><div class="field"><label for="contact-message">Your message</label><textarea id="contact-message" name="message" maxlength="3000" required placeholder="Tell us a little about it…"></textarea></div><button type="submit" class="button">Open your email app <span aria-hidden="true">↗</span></button><p class="form-note">This opens a draft in your email app. Review it and send it there. This website does not submit or store your message.</p><p id="contact-status" class="form-note" role="status"></p></form></div></div>`;
  document.querySelector('#contact-form').addEventListener('submit', event => {
    event.preventDefault(); const data = new FormData(event.target);
    const body = `${data.get('message')}\n\nFrom: ${data.get('name')}\nEmail: ${data.get('email')}`;
    window.location.href = `mailto:contact@lakelandfinearts.com?subject=${encodeURIComponent(data.get('subject'))}&body=${encodeURIComponent(body)}`;
    document.querySelector('#contact-status').textContent = 'Your email app should open a draft. If it doesn’t, email contact@lakelandfinearts.com directly.';
  });
}
function renderCart() {
  const items = cartItems();
  const canceled = new URLSearchParams(location.search).get('checkout') === 'canceled';
  main.innerHTML = `<div class="wrap">${intro('Your little collection', 'The good things you found.', 'A painting to treasure. A sculpture made for you. A little art for every day.')} ${canceled ? '<div class="notice">You returned from checkout. Your cart is still here. An original may remain reserved until its checkout session expires.</div>' : ''}${!items.length ? '<div class="empty"><h2>Your cart is waiting for a little art.</h2><p>Take a look around and see what speaks to you.</p><a class="button" href="/products">Explore the collection ↗</a></div>' : `<div class="cart-layout"><section aria-label="Cart items">${items.map(({ product: p, quantity }) => `<article class="cart-item"><img src="${p.image}" alt="${escape(p.name)} sample"><div><div class="product-title"><h3>${escape(p.name)}</h3><span class="price">${money(p.price * quantity)}</span></div><p>${escape(p.artist)} · ${kindName(p.kind)}</p><p>Estimated ship date: ${estimate(p)}</p><p>${escape(p.estimate.description)}</p><div class="cart-controls"><div class="quantity"><button data-change="${p.id}" data-amount="-1" aria-label="Decrease quantity of ${escape(p.name)}">−</button><span aria-label="Quantity ${quantity}">${quantity}</span><button data-change="${p.id}" data-amount="1" ${quantity >= p.maxQuantity ? 'disabled' : ''} aria-label="Increase quantity of ${escape(p.name)}">+</button></div><button class="remove" data-remove="${p.id}">Remove</button>${p.maxQuantity === 1 ? '<span class="product-meta">One of a kind</span>' : ''}</div></div></article>`).join('')}<p class="shipping-note">Ship dates are estimates, not delivery guarantees. Studio-made and Printful items may ship separately. Adding an original to your cart does not reserve it; reservation starts at checkout.</p><a class="text-link" href="/products">← Keep exploring</a></section><aside class="cart-summary"><h2>Your order</h2><div class="total-row"><span>Items (${items.reduce((sum, i) => sum + i.quantity, 0)})</span><span>${money(items.reduce((sum, i) => sum + i.quantity * i.product.price, 0))}</span></div><div class="total-row"><span>Shipping & tax</span><span>Not charged in beta</span></div><div class="total-row main"><span>Test subtotal</span><span>${money(items.reduce((sum, i) => sum + i.quantity * i.product.price, 0))}</span></div><button class="button" id="checkout-button" ${catalog.checkoutReady ? '' : 'disabled'}>${catalog.checkoutReady ? 'Continue to Stripe test checkout ↗' : 'Test checkout coming soon'}</button><p>${catalog.checkoutReady ? 'Use Stripe test card details only. No actual charge or shipment will occur.' : 'Stripe test payments are not connected yet. Your cart stays saved on this device while we finish setting up.'}</p><p>All listings and prices are beta samples. Final shipping rates, taxes, and production lead times will be confirmed before launch.</p><p class="payment-note">Secure hosted payment by Stripe</p><p id="checkout-error" role="alert"></p></aside></div>`}</div>`;
  main.querySelectorAll('[data-change]').forEach(button => button.addEventListener('click', () => changeCart(button.dataset.change, Number(button.dataset.amount))));
  main.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => changeCart(button.dataset.remove, -25)));
  document.querySelector('#checkout-button')?.addEventListener('click', startCheckout);
}
async function startCheckout() {
  const button = document.querySelector('#checkout-button'); button.disabled = true; button.textContent = 'Opening secure checkout…';
  let requestId = read('lakeland-checkout-request', null);
  if (!requestId) { requestId = crypto.randomUUID(); save('lakeland-checkout-request', requestId); }
  try {
    const response = await fetch('/api/shop/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lakeland-Cart': '1' }, body: JSON.stringify({ requestId, items: cart.map(i => ({ productVariantId: i.id, quantity: i.quantity })) }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || (response.status === 429 ? 'Please wait a minute before trying checkout again.' : 'Checkout is temporarily unavailable. Your cart is saved.'));
    const redirect = new URL(result.url);
    if (redirect.protocol !== 'https:' || redirect.hostname !== 'checkout.stripe.com') throw new Error('Checkout returned an unexpected address. Please contact the studio.');
    window.location.assign(redirect.href);
  } catch (error) { document.querySelector('#checkout-error').textContent = error.message; button.disabled = false; button.textContent = 'Try checkout again ↗'; }
}
async function renderSuccess() {
  main.innerHTML = `<div class="wrap"><div class="success"><div class="symbol">✳</div><span class="eyebrow">Stripe test checkout</span><h1>One moment, art lover.</h1><p id="payment-status" role="status">Checking for payment confirmation…</p><a class="button light" href="/products">Back to the collection</a><p class="form-note">This is a beta test. No products will be made or shipped.</p></div></div>`;
  const sessionId = new URLSearchParams(location.search).get('session_id');
  let attempts = 0;
  async function poll() {
    if (location.pathname !== '/checkout/success') return;
    const node = document.querySelector('#payment-status'); if (!node) return;
    if (!sessionId) { node.textContent = 'No checkout session was provided. You can return to your cart and try again.'; return; }
    try {
      const response = await fetch('/api/shop/checkout/status?sessionId=' + encodeURIComponent(sessionId));
      if (!response.ok) throw new Error('We cannot verify this checkout on this device yet. Please contact the studio if it persists.');
      const result = await response.json();
      if (result.status === 'Paid') {
        main.querySelector('h1').textContent = 'Thank you for trying the beta.';
        node.textContent = 'Your test payment has been confirmed by Stripe. No real payment was taken and no products will be shipped.';
        cart = []; updateCart(); save('lakeland-checkout-request', null); return;
      }
      if (result.status === 'Canceled') { node.textContent = 'This checkout has expired. Your cart is still saved.'; return; }
      node.textContent = 'We’re waiting for Stripe’s payment confirmation. This page alone does not confirm payment.';
      if (++attempts < 15) successTimer = setTimeout(poll, 2000);
      else node.textContent += ' Please check again later or contact the studio.';
    } catch (error) { node.textContent = error.message; }
  }
  await poll();
}
function render() {
  clearTimeout(successTimer);
  document.querySelectorAll('[data-nav]').forEach(link => { const active = link.dataset.nav === location.pathname; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  const titles = { '/': 'Art, made personal.', '/products': 'The collection', '/gallery': 'The gallery', '/contact': 'Say hello', '/cart': 'Your cart', '/checkout/success': 'Test checkout' };
  document.title = `${titles[location.pathname] || 'Welcome'} · Lakeland Fine Arts`;
  ({ '/': renderHome, '/products': renderProducts, '/gallery': renderGallery, '/contact': renderContact, '/cart': renderCart, '/checkout/success': renderSuccess }[location.pathname] || renderHome)();
}
document.addEventListener('click', event => {
  const add = event.target.closest('[data-add]'); if (add) { changeCart(add.dataset.add, 1); return; }
  const link = event.target.closest('a');
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
  const url = new URL(link.href);
  if (url.origin === location.origin && !url.hash && ['/', '/gallery', '/products', '/contact', '/cart', '/checkout/success'].includes(url.pathname)) { event.preventDefault(); navigate(url.pathname + url.search); }
});
window.addEventListener('popstate', () => { if (catalog) render(); });
document.querySelector('#year').textContent = new Date().getFullYear();
try {
  const response = await fetch('/api/shop/catalog'); if (!response.ok) throw new Error('The studio is temporarily unavailable. Please try again shortly.');
  catalog = await response.json();
  cart = cart.filter(item => item && typeof item.id === 'string' && Number.isInteger(item.quantity) && item.quantity > 0 && productFor(item.id)).map(item => ({ id: item.id, quantity: Math.min(item.quantity, productFor(item.id).maxQuantity) }));
  cart = [...new Map(cart.map(item => [item.id, item])).values()];
  updateCart(); render();
} catch (error) { main.innerHTML = `<div class="wrap"><div class="empty"><h2>We’ll be right back.</h2><p>${escape(error.message)}</p><a href="/" class="button light">Try again</a></div></div>`; }
