import { Router } from "express";
import { DeepSeekError, generateContent } from "../services/deepseekClient.js";

export const generateRouter = Router();

generateRouter.post("/generate", async (req, res, next) => {
  try {
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";

    if (!content) {
      res.status(400).json({
        error: "Request body must include a non-empty string field: content",
      });
      return;
    }

    const result = await generateContent(content);

    res.json({
      content: result,
    });
  } catch (error) {
    if (error instanceof DeepSeekError) {
      res.status(error.statusCode).json({
        error: error.message,
      });
      return;
    }

    next(error);
  }
});
