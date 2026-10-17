export interface RiderPlayerIdVerificationRequest {
  body?: unknown;
}

export interface RiderPlayerIdVerificationResponse {
  status(code: number): RiderPlayerIdVerificationResponse;
  json(body: Record<string, unknown>): unknown;
}

export interface RiderPlayerIdVerificationDependencies {
  getAuthenticatedRiderId(
    req: RiderPlayerIdVerificationRequest,
    res: RiderPlayerIdVerificationResponse,
  ): string | null;
  findRiderById(
    riderId: string,
  ): Promise<{ playerId?: unknown } | null>;
}

export function createRiderPlayerIdVerificationHandler(
  dependencies: RiderPlayerIdVerificationDependencies,
) {
  return async (
    req: RiderPlayerIdVerificationRequest,
    res: RiderPlayerIdVerificationResponse,
  ): Promise<void> => {
    const riderId = dependencies.getAuthenticatedRiderId(req, res);
    if (!riderId) return;

    const body =
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>)
        : {};
    const playerId = body.playerId;
    if (
      playerId !== undefined &&
      playerId !== null &&
      typeof playerId !== "string"
    ) {
      res.status(400).json({ message: "playerId must be a string" });
      return;
    }

    try {
      const rider = await dependencies.findRiderById(riderId);
      if (!rider) {
        res.status(404).json({ message: "Rider not found" });
        return;
      }

      const savedPlayerId =
        typeof rider.playerId === "string" ? rider.playerId.trim() : "";
      const currentPlayerId =
        typeof playerId === "string" ? playerId.trim() : "";
      res.json({
        savedSubscriptionPresent: Boolean(savedPlayerId),
        matchesCurrentSubscription:
          Boolean(currentPlayerId) && savedPlayerId === currentPlayerId,
      });
    } catch (error) {
      console.error("POST /api/rider/player-id/verify error", error);
      res
        .status(500)
        .json({ message: "Could not check notification registration" });
    }
  };
}
