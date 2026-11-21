import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }, { title: "rmv 管理后台" }],
  }),
  component: () => (
    <html lang="zh-CN">
      <head><HeadContent /></head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
