/**
 * Dark Reader needs to read cross-origin stylesheets and images. Pages can't do that
 * because of CORS, but userscript managers can via GM.xmlHttpRequest.
 */
export async function gmFetch(url: string): Promise<Response> {
  if (typeof GM === 'undefined' || !GM.xmlHttpRequest) return fetch(url);
  const res = await GM.xmlHttpRequest({ url, method: 'GET', responseType: 'blob', timeout: 20000 });
  if (res.status && (res.status < 200 || res.status >= 300)) {
    throw new Error(`DarkSafari: ${url} responded ${res.status}`);
  }
  const body = res.response instanceof Blob ? res.response : new Blob([String(res.responseText ?? res.response ?? '')]);
  return new Response(body, { status: 200 });
}
