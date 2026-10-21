function installEventRoutes(app, db) {
  app.get("/api/events", async (_req, res, next) => {
    try {
      const now = new Date();

      const snapshot = await db
        .collection("events")
        .where("endsAt", ">", now)
        .orderBy("endsAt")
        .limit(200)
        .get();

      const events = snapshot.docs.flatMap((doc) => {
        const data = doc.data();

        const startsAt =
          typeof data.startsAt?.toDate === "function"
            ? data.startsAt.toDate()
            : null;

        const endsAt =
          typeof data.endsAt?.toDate === "function"
            ? data.endsAt.toDate()
            : null;

        const { latitude, longitude } = data;

        if (
          data.status !== "published" ||
          typeof data.title !== "string" ||
          !data.title.trim() ||
          typeof data.location !== "string" ||
          !data.location.trim() ||
          typeof latitude !== "number" ||
          !Number.isFinite(latitude) ||
          Math.abs(latitude) > 90 ||
          typeof longitude !== "number" ||
          !Number.isFinite(longitude) ||
          Math.abs(longitude) > 180 ||
          !(startsAt instanceof Date) ||
          !Number.isFinite(startsAt.getTime()) ||
          !(endsAt instanceof Date) ||
          !Number.isFinite(endsAt.getTime()) ||
          endsAt <= now ||
          endsAt <= startsAt
        ) {
          return [];
        }

        return [
          {
            id: doc.id,
            title: data.title.trim(),
            location: data.location.trim(),
            coordinate: {
              latitude,
              longitude,
            },
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            description:
              typeof data.description === "string"
                ? data.description
                : "",
            interests: Array.isArray(data.interests)
              ? data.interests.filter(
                  (value) => typeof value === "string"
                )
              : [],
          },
        ];
      });

      events.sort((a, b) =>
        a.startsAt.localeCompare(b.startsAt)
      );

      res.json({ events });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { installEventRoutes };