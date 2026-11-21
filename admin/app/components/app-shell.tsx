import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Disc3, History, LayoutDashboard, ListTodo, Send, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider,
} from "@/components/ui/sidebar";
import { useJobStream } from "@/hooks/use-job-stream";
import { useTRPC } from "@/lib/trpc";

const NAV = [
  { to: "/", label: "总览", icon: LayoutDashboard },
  { to: "/library", label: "曲库", icon: Disc3 },
  { to: "/jobs", label: "任务", icon: ListTodo },
  { to: "/releases", label: "投稿", icon: Send },
  { to: "/history", label: "历史", icon: History },
  { to: "/settings", label: "设置", icon: Settings },
] as const;

export function AppShell() {
  useJobStream();
  const trpc = useTRPC();
  const overview = useQuery(trpc.overview.get.queryOptions(undefined, { refetchInterval: 10_000 }));
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const running = overview.data?.running.length ?? 0;
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="px-4 py-3 text-base font-semibold">rmv 管理后台</SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((item) => {
                  const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active}>
                        <Link to={item.to}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="gap-2 px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">runner</span>
            <Badge variant={overview.data?.runner.online ? "secondary" : "destructive"}>
              {overview.data?.runner.online ? "在线" : "离线"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">在跑任务</span>
            <span className="tabular-nums">{running}</span>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <main className="flex flex-col gap-6 p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
