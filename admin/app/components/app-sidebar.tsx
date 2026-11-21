import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Clapperboard, Disc3, History, LayoutDashboard, ListTodo, Send, Settings } from "lucide-react";
import type * as React from "react";
import { NavMain, type NavItem } from "@/components/nav-main";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useTRPC } from "@/lib/trpc";

export const NAV: readonly NavItem[] = [
  { to: "/", title: "总览", icon: LayoutDashboard },
  { to: "/library", title: "曲库", icon: Disc3 },
  { to: "/jobs", title: "任务", icon: ListTodo },
  { to: "/releases", title: "投稿", icon: Send },
  { to: "/history", title: "历史", icon: History },
  { to: "/settings", title: "设置", icon: Settings },
];

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const trpc = useTRPC();
  const overview = useQuery(trpc.overview.get.queryOptions(undefined, { refetchInterval: 10_000 }));
  const online = overview.data?.runner.online;
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:p-1.5!">
              <Link to="/">
                <Clapperboard className="size-5!" />
                <span className="text-base font-semibold">rmv 管理后台</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={NAV} />
      </SidebarContent>
      <SidebarFooter className="gap-2 px-4 py-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">runner</span>
          <Badge variant={online ? "secondary" : "destructive"}>{online ? "在线" : "离线"}</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">在跑任务</span>
          <span className="tabular-nums">{overview.data?.running.length ?? 0}</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
