import { NextResponse } from "next/server";
import { getConfiguredLeagueIds, isConfiguredLeagueId } from "../../../lib/config.js";
import { buildLeagueSnapshot } from "../../../lib/sleeper.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("league") || getConfiguredLeagueIds()[0];
  const compact = searchParams.get("compact") !== "0";

  try {
    if (requested === "all") {
      const snapshots = await Promise.all(
        getConfiguredLeagueIds().map((id) => buildLeagueSnapshot(id, { freeAgentLimit: compact ? 35 : 100 }))
      );
      return NextResponse.json({ leagues: snapshots });
    }

    if (!isConfiguredLeagueId(requested)) {
      return NextResponse.json(
        { error: "Unknown league id", configured_league_ids: getConfiguredLeagueIds() },
        { status: 400 }
      );
    }

    const snapshot = await buildLeagueSnapshot(requested, {
      freeAgentLimit: compact ? 35 : 100,
    });

    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        league_id: requested,
      },
      { status: 502 }
    );
  }
}
