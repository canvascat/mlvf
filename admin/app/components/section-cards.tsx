import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export type StatCardProps = {
  label: string;
  value: ReactNode;
  badge?: ReactNode;
  headline?: ReactNode;
  detail?: ReactNode;
};

export function StatCard({ label, value, badge, headline, detail }: StatCardProps) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{value}</CardTitle>
        {badge != null && (
          <CardAction>
            <Badge variant="outline">{badge}</Badge>
          </CardAction>
        )}
      </CardHeader>
      {(headline != null || detail != null) && (
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          {headline != null && <div className="line-clamp-1 font-medium">{headline}</div>}
          {detail != null && <div className="text-muted-foreground">{detail}</div>}
        </CardFooter>
      )}
    </Card>
  );
}

export function SectionCards({ cards }: { cards: StatCardProps[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      {cards.map((card) => (
        <StatCard key={card.label} {...card} />
      ))}
    </div>
  );
}
