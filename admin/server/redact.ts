const RULES: [RegExp, string][] = [
  [/(bili_jct|SESSDATA|DedeUserID(?:__ckMd5)?|access_token|access_key|refresh_token)(["']?\s*[:=]\s*["']?)([^"'\s;,&}]+)/gi, "$1$2***"],
  [/(csrf=)[^&\s"']+/gi, "$1***"],
  [/(Cookie:\s*).+/gi, "$1***"],
];

export function redactSecrets(text: string): string {
  return RULES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
