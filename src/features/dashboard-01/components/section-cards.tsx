"use client"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { TrendingUpIcon, TrendingDownIcon } from "lucide-react"

export function SectionCards() {
  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-3 @5xl/main:grid-cols-6 dark:*:data-[slot=card]:bg-card">
      <DashboardCard title={"Total Calls"} stats={"6"} percentageChange={"5"} change="+" />
      <DashboardCard title={"AI Audited"} stats={"6"} />
      <DashboardCard title={"Manual Review"} stats={"3"} />
      <DashboardCard title={"Avg. Quality Score"} stats={"55.3%"} />
      <DashboardCard title={"First Response Time"} stats={"00:05"} />
      <DashboardCard title={"AHT"} stats={"05:19"} />
      {/* <Card className="@container/card">
          <CardHeader>
            <CardDescription>Total Calls</CardDescription>
            <CardAction>
              <Badge variant="outline">
                <TrendingUpIcon
                />
                +12.5%
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums ">
            6
          </CardContent>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              Trending up this month{" "}
              <TrendingUpIcon className="size-4" />
            </div>
            <div className="text-muted-foreground">
              Visitors for the last 6 months
            </div>
          </CardFooter>
        </Card>
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Total Calls</CardDescription>
            <CardAction>
              <Badge variant="outline">
                <TrendingUpIcon
                />
                +12.5%
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums ">
            6
          </CardContent>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              Trending up this month{" "}
              <TrendingUpIcon className="size-4" />
            </div>
            <div className="text-muted-foreground">
              Visitors for the last 6 months
            </div>
          </CardFooter>
        </Card>
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>New Customers</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              1,234
            </CardTitle>
            <CardAction>
              <Badge variant="outline">
                <TrendingDownIcon
                />
                -20%
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              Down 20% this period{" "}
              <TrendingDownIcon className="size-4" />
            </div>
            <div className="text-muted-foreground">
              Acquisition needs attention
            </div>
          </CardFooter>
        </Card>
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Active Accounts</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              45,678
            </CardTitle>
            <CardAction>
              <Badge variant="outline">
                <TrendingUpIcon
                />
                +12.5%
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              Strong user retention{" "}
              <TrendingUpIcon className="size-4" />
            </div>
            <div className="text-muted-foreground">Engagement exceed targets</div>
          </CardFooter>
        </Card>
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Growth Rate</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              4.5%
            </CardTitle>
            <CardAction>
              <Badge variant="outline">
                <TrendingUpIcon
                />
                +4.5%
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              Steady performance increase{" "}
              <TrendingUpIcon className="size-4" />
            </div>
            <div className="text-muted-foreground">Meets growth projections</div>
          </CardFooter>
        </Card> */}
    </div>
  )
}

interface DashboardCardProps {
  title: string,
  stats: string,
  percentageChange?: string,
  change?: "+" | "-"
  footerText?: string
}
export function DashboardCard({ stats, title, footerText, percentageChange, change = "+" }: DashboardCardProps) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        {percentageChange && (
          <CardAction>
            <Badge variant="outline">
              <TrendingUpIcon
              />
              {change}{percentageChange}%
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="text-2xl font-semibold tabular-nums ">
        <span>
          {stats}
        </span>
      </CardContent>
      {footerText && (
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="text-muted-foreground">
            {footerText}
          </div>
        </CardFooter>
      )}
    </Card>
  )
}