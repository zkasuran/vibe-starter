// Minimal REST client for the KeeperHub API used by this quickstart.
//
// - Session calls set cookies, so we keep a keyed jar. A rotated session cookie
//   replaces the old one rather than being sent alongside it.
// - Not every response is JSON. A 429 or an edge error can be text or HTML, so
//   we read the body as text first and fall back instead of throwing over the
//   status you actually need to read.

export type ApiResponse<T = unknown> = {
  status: number;
  body: T;
  headers: Headers;
};

export function createClient(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const cookies = new Map<string, string>();

  async function api<T = unknown>(
    path: string,
    init: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const res = await fetch(base + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        Cookie: Array.from(cookies, ([k, v]) => `${k}=${v}`).join("; "),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq > 0) {
        cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
      }
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text.slice(0, 300) };
    }
    return { status: res.status, body: body as T, headers: res.headers };
  }

  return { base, api };
}

export function must<T>(res: ApiResponse<T>, what: string): T {
  if (res.status >= 400) {
    throw new Error(`${what}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}
