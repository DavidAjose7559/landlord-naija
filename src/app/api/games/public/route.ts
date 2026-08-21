import { NextResponse } from "next/server";
import { loadPublicLobbies } from "@/lib/api/game-state";
import { errorResponse } from "@/lib/api/errors";

// (settings.privateRoom) A lightweight join-a-random-room listing — private
// rooms (the default) never appear here, only the room code/map/seat count
// a spectator would need to decide whether to join.
export async function GET() {
  try {
    const games = await loadPublicLobbies();
    return NextResponse.json({
      games: games.map((g) => ({
        roomCode: g.roomCode,
        mapId: g.state.settings.mapId,
        playerCount: g.state.players.length,
        maxPlayers: g.state.settings.maxPlayers,
        createdAt: g.createdAt,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
