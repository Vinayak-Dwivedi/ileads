"use client"

import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"

import { Pie, PieChart } from "recharts"

import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart"

import { SentimentBreakdown } from "@/features/dashboard/api/dashboard"
import { EmptyState } from "@/components/ui/page-shell"
import { TrendingUp } from "lucide-react"
import { ClassNameValue } from "tailwind-merge"
import { cn } from "@/lib/utils"

interface SentimentGraphProps {
    sentiment: SentimentBreakdown,
    className?: ClassNameValue
}

export const SentimentGraph = ({
    sentiment,
    className
}: SentimentGraphProps) => {
    const chartData = [
        {
            sentiment: "Positive",
            value: sentiment.positive,
            fill: "#10b981", // emerald-500
        },
        {
            sentiment: "Negative",
            value: sentiment.negative,
            fill: "#f59e0b", // amber-500
        },
        {
            sentiment: "Neutral",
            value: sentiment.neutral,
            fill: "#ef4444", // red-500
        },
    ]

    const chartConfig = {
        value: {
            label: "Sentiment",
        },
        positive: {
            label: "Positive",
            color: "#10b981",
        },
        negative: {
            label: "Negative",
            color: "#f59e0b",
        },
        neutral: {
            label: "Neutral",
            color: "#ef4444",
        },
    } satisfies ChartConfig

    return (
        <Card className={cn(className)}>
            {sentiment.total === 0 ? (
                <EmptyState
                    title="No sentiment data"
                    description="No calls have sentiment values in this filter."
                />
            ) : (
                <div className="flex flex-col">
                    <CardHeader className="items-center pb-0">
                        <CardTitle>Sentiment Breakdown</CardTitle>
                        <CardDescription>
                            Total analyzed calls: {sentiment.total}
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="flex-1 pb-0">
                        <ChartContainer
                            config={chartConfig}
                            className="mx-auto aspect-square max-h-62.5"
                        >
                            <PieChart>
                                <ChartTooltip
                                    cursor={false}
                                    content={<ChartTooltipContent hideLabel />}
                                />

                                <Pie
                                    data={chartData}
                                    dataKey="value"
                                    nameKey="sentiment"
                                    innerRadius={60}
                                    strokeWidth={4}
                                />
                            </PieChart>
                        </ChartContainer>
                    </CardContent>

                    <CardFooter className="flex-col gap-2 text-sm">
                        {/* <div className="flex items-center gap-2 leading-none font-medium">
                            Sentiment overview <TrendingUp className="h-4 w-4" />
                        </div> */}

                        <div className="leading-none text-muted-foreground">
                            Positive: {sentiment.positive} • Neutral:{" "}
                            {sentiment.neutral} • Negative:{" "}
                            {sentiment.negative}
                        </div>
                    </CardFooter>
                </div>
            )}
        </Card>
    )
}