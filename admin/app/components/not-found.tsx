import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div className="flex flex-col items-start gap-2">
      <h2 className="text-lg font-medium">页面不存在</h2>
      <Link to="/" className="text-muted-foreground text-sm underline-offset-4 hover:underline">
        回到总览
      </Link>
    </div>
  );
}
