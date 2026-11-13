// Thin pass-through routes onto FreeNewsAPI. Not mounted by server.js yet;
// kept for a later feature. Requests share the rate-limited client and its
// caches with /api/news/for-you (see interest-news-routes.js).

const express = require("express");
const {
  FreeNewsError,
  createFreeNewsClient,
  sharedFreeNewsClient,
} = require("./free-news-client");

function createFreeNewsRouter({ fetchImpl, getApiKey, client } = {}) {
  const router = express.Router();
  const news =
    client ||
    (fetchImpl || getApiKey
      ? createFreeNewsClient({ fetchImpl, getApiKey })
      : sharedFreeNewsClient());

  const respond = (res, next, work) =>
    work().then(
      (value) => res.json(value),
      (error) =>
        error instanceof FreeNewsError
          ? res.status(error.status).json({ message: error.message })
          : next(error),
    );

  router.get("/articles", (req, res, next) => {
    const topic =
      typeof req.query.topic === "string" ? req.query.topic.trim() : "";
    const offset =
      typeof req.query.offset === "string" && /^\d{1,5}$/.test(req.query.offset)
        ? Number(req.query.offset)
        : 0;
    if (!topic || topic.length > 60) {
      return res.status(400).json({ message: "Choose a news topic." });
    }
    return respond(res, next, () => news.listTopic(topic, offset));
  });

  router.get("/articles/:uuid", (req, res, next) => {
    const { uuid } = req.params;
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(uuid)) {
      return res.status(400).json({ message: "Choose a valid article." });
    }
    return respond(res, next, () => news.articleDetails(uuid.toLowerCase()));
  });

  return router;
}

module.exports = { createFreeNewsRouter };
