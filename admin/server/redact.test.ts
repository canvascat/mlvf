import assert from "node:assert/strict";
import { test } from "node:test";
import { redactSecrets } from "./redact";

test("遮住登录态和 csrf，其他内容原样保留", () => {
  assert.equal(redactSecrets("Cookie: SESSDATA=abc; bili_jct=def"), "Cookie: ***");
  assert.equal(redactSecrets('{"bili_jct":"def","x":1}'), '{"bili_jct":"***","x":1}');
  assert.equal(redactSecrets("POST /x?csrf=abc123&a=1"), "POST /x?csrf=***&a=1");
  assert.equal(redactSecrets("access_key=zzz refresh_token: yyy"), "access_key=*** refresh_token: ***");
  assert.equal(redactSecrets("Rendered 12/100"), "Rendered 12/100");
});
