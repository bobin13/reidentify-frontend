const express = require("express");

const API_BASE_URL = "https://api.freenewsapi.io/v1";

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function createFreeNewsRouter({
  fetchImpl = globalThis.fetch,
  getApiKey = () => process.env.NEWS_API_KEY,
} = {}) {
  const router = express.Router();

  async function requestFreeNewsApi(endpoint, params) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new ApiError(503, "News API is not configured");
    }

    const url = new URL(`${API_BASE_URL}/${endpoint}`);
    url.search = new URLSearchParams(params).toString();

    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "x-api-key": apiKey,
        },
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      console.error("FreeNewsApi request failed:", error.message);
      throw new ApiError(
        error.name === "TimeoutError" ? 504 : 502,
        error.name === "TimeoutError"
          ? "News provider request timed out"
          : "News provider is unavailable",
      );
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      console.error("FreeNewsApi returned invalid JSON:", error.message);
      throw new ApiError(502, "News provider returned an invalid response");
    }

    if (!response.ok) {
      console.error(`FreeNewsApi responded with HTTP ${response.status}`);
      throw new ApiError(
        response.status === 429 ? 503 : 502,
        response.status === 429
          ? "News provider rate limit exceeded"
          : "News provider request failed",
      );
    }

    return data;
  }

  async function sendProviderResponse(res, next, endpoint, params) {
    try {
      res.json(await requestFreeNewsApi(endpoint, params));
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      next(error);
    }
  }

  router.get("/articles", async (req, res, next) => {
    const topic =
      typeof req.query.topic === "string" ? req.query.topic.trim() : "";

    if (!topic) {
      return res
        .status(400)
        .json({ error: "The topic query parameter is required" });
    }

    return sendProviderResponse(res, next, "news", { topic });
  });

  router.get("/articles/:uuid", async (req, res, next) => {
    const { uuid } = req.params;

    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(uuid)) {
      return res
        .status(400)
        .json({ error: "A valid article UUID is required" });
    }

    return sendProviderResponse(res, next, "details", { uuid });
  });

  return router;
}

module.exports = { createFreeNewsRouter };
