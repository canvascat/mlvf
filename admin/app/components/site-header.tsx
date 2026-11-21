import { useRouterState } from "@tanstack/react-router";
import { NAV } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

function titleFor(pathname: string): string {
  if (pathname.startsWith("/library/albums")) return "专辑详情";
  if (pathname.startsWith("/jobs/")) return "任务详情";
  const hit = NAV.find((item) => (item.to === "/" ? pathname === "/" : pathname.startsWith(item.to)));
  return hit?.title ?? "rmv 管理后台";
}

export function SiteHeader() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <h1 className="text-base font-medium">{titleFor(pathname)}</h1>
      </div>
    </header>
  );
}
