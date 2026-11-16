// Private service binding only: no public routes or workers.dev hostname.
const worker = {
  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/batch') return new Response(null, { status: 404 });
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('KakaoAK ')) return new Response(null, { status: 401 });
    const text = await request.text();
    if (text.length > 65536) return new Response(null, { status: 413 });
    let urls;
    try { urls = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
    if (!Array.isArray(urls) || !urls.length || urls.length > 40 || !urls.every(value => {
      try {
        const url = new URL(value);
        return url.origin === 'https://dapi.kakao.com' && !url.username && !url.password &&
          ['/v2/local/search/address.json', '/v2/local/search/category.json', '/v2/local/search/keyword.json', '/v2/local/geo/coord2regioncode.json'].includes(url.pathname);
      } catch { return false; }
    })) return new Response(null, { status: 400 });
    const results = [];
    // Stay below both the 50-subrequest and six-open-connection limits. Never
    // follow redirects with credentials; retries remain in the existing client.
    for (let offset = 0; offset < urls.length; offset += 5) {
      results.push(...await Promise.all(urls.slice(offset, offset + 5).map(async url => {
        try {
          const response = await fetch(url, {
            headers: { Authorization: authorization }, redirect: 'manual',
            signal: AbortSignal.timeout(10000), cache: 'no-store',
          });
          return { status: response.status, body: await response.text() };
        } catch (error) {
          console.error('[kakao-egress]', error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[URL]') : 'fetch failed');
          return { error: true };
        }
      })));
    }
    return Response.json(results, { headers: { 'Cache-Control': 'no-store' } });
  },
};
export default worker;
