"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/ui/page-shell";
import { cn } from "@/lib/utils";
import type { ClassNameValue } from "tailwind-merge";
import type { DailyQualityPoint } from "@/features/dashboard/api/dashboard";

interface DailyQualityGraphProps {
  data: DailyQualityPoint[];
  className?: ClassNameValue;
}

function shortLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

const chartConfig = {
  averagePercent: {
    label: "Avg %",
    color: "#2563eb",
  },
  auditedCalls: {
    label: "Audited calls",
    color: "#94a3b8",
  },
} satisfies ChartConfig;

export function DailyQualityGraph({ data, className }: DailyQualityGraphProps) {
  const hasData = data.some((d) => d.auditedCalls > 0);
  const chartData = data.map((d) => ({
    ...d,
    label: shortLabel(d.date),
    averagePercent: Math.round(d.averagePercent * 10) / 10,
  }));

  return (
    <Card className={cn("shadow-sm", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Daily Quality Score</CardTitle>
        <CardDescription>
          {hasData
            ? `Average AI audit score over the last ${data.length} days`
            : "Daily quality score will appear after audits are completed."}
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        {!hasData ? (
          <EmptyState
            title="No audit data yet"
            description="Daily quality score will appear after audits are completed."
          />
        ) : (
          <ChartContainer config={chartConfig} className="h-56 w-full">
            <BarChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                fontSize={11}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={11}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                width={36}
              />
              <ChartTooltip
                cursor={{ fill: "#f1f5f9" }}
                content={
                  <ChartTooltipContent
                    formatter={(value, name, item) => {
                      if (name === "averagePercent") {
                        const audited = item?.payload?.auditedCalls ?? 0;
                        return (
                          <div className="flex flex-col">
                            <span className="font-semibold">{`${value}%`}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {audited} audited call{audited === 1 ? "" : "s"}
                            </span>
                          </div>
                        );
                      }
                      return String(value);
                    }}
                  />
                }
              />
              <Bar
                dataKey="averagePercent"
                fill="#2563eb"
                radius={[4, 4, 0, 0]}
                maxBarSize={36}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
