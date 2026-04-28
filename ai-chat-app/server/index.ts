import express from "express";
import cors from "cors";
import "dotenv/config";
import chatRouter from "./routes/chat";


const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  cors({ 
    origin: "*",
  })
);

app.use(express.json());

app.use("/api/chat", chatRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${PORT}`);
});

