import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { sumCostsByAgentAsync, sumCostsByJobAsync, sumCostsByProjectAsync, sumCostsTotalAsync, breakdownByModelAsync } from "@/lib/db/costs";

export const GET = withAuth(async (req) => {
  const by = req.nextUrl.searchParams.get("by") || "total";
  const id = req.nextUrl.searchParams.get("id");

  switch (by) {
    case "agent": {
      if (!id) return NextResponse.json({ error: "id required for by=agent" }, { status: 400 });
      const summary = await sumCostsByAgentAsync(id);
      return NextResponse.json({ ...summary, breakdown: [] });
    }
    case "job": {
      if (!id) return NextResponse.json({ error: "id required for by=job" }, { status: 400 });
      const summary = await sumCostsByJobAsync(id);
      return NextResponse.json({ ...summary, breakdown: [] });
    }
    case "project": {
      if (!id) return NextResponse.json({ error: "id required for by=project" }, { status: 400 });
      const [summary, breakdown] = await Promise.all([sumCostsByProjectAsync(id), breakdownByModelAsync(id)]);
      return NextResponse.json({ ...summary, breakdown });
    }
    case "total":
    default: {
      const [summary, breakdown] = await Promise.all([sumCostsTotalAsync(), breakdownByModelAsync()]);
      return NextResponse.json({ ...summary, breakdown });
    }
  }
});
