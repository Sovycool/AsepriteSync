import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  label: string;
  value: string | number;
  icon: LucideIcon;
  isLoading?: boolean;
}

export function StatCard({ label, value, icon: Icon, isLoading }: Props) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          {isLoading ? (
            <Skeleton className="mt-1.5 h-7 w-12" />
          ) : (
            <p className="mt-0.5 text-2xl font-bold">{value}</p>
          )}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}
