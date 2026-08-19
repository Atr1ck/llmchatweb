import express from "express";
import type { NextFunction, Request, Response } from "express";
import cors from "cors";
import "dotenv/config";
import chatRouter from "./routes/chat";
import imageRouter from "./routes/images";


const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  cors({ 
    origin: "*",
  })
);

// Reference images are sent as data URLs for RightAPI image-to-image requests.
app.use(express.json({ limit: "30mb" }));

app.use("/api/chat", chatRouter);
app.use("/api/images", imageRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  const bodyError = error as { type?: string };
  if (bodyError.type === "entity.too.large") {
    res.status(413).json({ error: "参考图片过大，请压缩后再试（单次请求上限 30MB）" });
    return;
  }
  next(error);
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${PORT}`);
});
