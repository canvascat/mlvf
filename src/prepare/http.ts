export const CLIENT_NAME = "mlvf";
export const CLIENT_VERSION = "1.0.0";
export const USER_AGENT = `${CLIENT_NAME}/${CLIENT_VERSION}`;
export const LRCLIB_USER_AGENT = `${CLIENT_NAME}/${CLIENT_VERSION} (lyrics lookup)`;

export const PROVIDER_TIMEOUT_MS = 8000;
export const LOOKUP_TIMEOUT_MS = 20_000;

export function mergeSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal {
  const present = signals.filter((signal): signal is AbortSignal =>
    Boolean(signal),
  );
  if (present.length === 0) {
    return AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  }
  if (present.length === 1) {
    return present[0];
  }
  return AbortSignal.any(present);
}

export function providerSignal(parent?: AbortSignal): AbortSignal {
  return mergeSignals(parent, AbortSignal.timeout(PROVIDER_TIMEOUT_MS));
}

export function unwrapJson<T>(raw: string): T {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("响应不是 JSON");
  }
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

export function unwrapJsonArray<T>(raw: string): T {
  const objectStart = raw.indexOf("{");
  const arrayStart = raw.indexOf("[");
  const start =
    arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart)
      ? arrayStart
      : objectStart;
  const closer = start === arrayStart ? "]" : "}";
  const end = raw.lastIndexOf(closer);
  if (start < 0 || end <= start) {
    throw new Error("响应不是 JSON");
  }
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

export async function fetchText(
  url: string,
  options: {
    signal?: AbortSignal;
    headers?: Record<string, string>;
    method?: string;
    body?: string;
  } = {},
): Promise<string> {
  const response = await fetch(url, {
    method: options.method,
    body: options.body,
    signal: options.signal,
    headers: {
      "User-Agent": USER_AGENT,
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}`);
  }
  return response.text();
}

export async function fetchRaw(
  url: string,
  options: {
    signal?: AbortSignal;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; text: string }> {
  const response = await fetch(url, {
    signal: options.signal,
    headers: {
      "User-Agent": USER_AGENT,
      ...options.headers,
    },
  });
  return { status: response.status, text: await response.text() };
}

export async function fetchJson<T>(
  url: string,
  options: {
    signal?: AbortSignal;
    headers?: Record<string, string>;
    method?: string;
    body?: string;
    array?: boolean;
  } = {},
): Promise<T> {
  const raw = await fetchText(url, options);
  return options.array ? unwrapJsonArray<T>(raw) : unwrapJson<T>(raw);
}

export async function fetchBytes(
  url: string,
  options: {
    signal?: AbortSignal;
    headers?: Record<string, string>;
  } = {},
): Promise<{ data: Uint8Array; mimeType: string }> {
  const response = await fetch(url, {
    signal: options.signal,
    headers: {
      "User-Agent": USER_AGENT,
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}`);
  }
  const data = new Uint8Array(await response.arrayBuffer());
  const mimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "image/jpeg";
  return { data, mimeType };
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function stripNeteaseEscapes(text: string): string {
  return text.replace(/\\'/g, "'");
}
