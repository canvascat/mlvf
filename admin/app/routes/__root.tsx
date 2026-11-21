import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }, { title: "rmv 管理后台" }],
    links: [{ rel: "stylesheet", href: appCss }, { rel: "icon", href: "data:," }],
  }),
  component: () => (
    <html lang="zh-CN">
      <head><HeadContent /></head>
      <body>
        <AppShell />
        <Toaster richColors />
        <Scripts />
      </body>
    </html>
  ),
});
