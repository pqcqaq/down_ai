import multer from "multer";
import { Router } from "express";
import { ArtifactStore } from "../storage/artifactStore.js";
import { ParserRegistry } from "../parsers/parserRegistry.js";
import { ReportFileService } from "../services/reportFileService.js";

export const reportsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
});
const artifactStore = new ArtifactStore();
const reportFileService = new ReportFileService();
const parserRegistry = new ParserRegistry();

reportsRouter.post("/upload", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Missing multipart file field: file" });
      return;
    }

    const stored = await artifactStore.saveUpload(req.file);
    res.json({
      fileId: stored.id,
      filePath: stored.filePath,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
    });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get("/:fileId/parse", async (req, res, next) => {
  try {
    const buffer = await reportFileService.readReportBuffer(req.params.fileId);
    const parsed = await parserRegistry.parsePdf(buffer);
    reportFileService.markParsed(req.params.fileId, Number(parsed.metadata.totalPages) || undefined);

    res.json({
      fileId: req.params.fileId,
      parsed,
      findings: parserRegistry.getPdfParser().toFindings(parsed),
    });
  } catch (error) {
    next(error);
  }
});
