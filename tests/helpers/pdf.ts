import PDFDocument from "pdfkit";

export async function createPdfBuffer(lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text("AIGC Style Review Report", { underline: true });
    doc.moveDown();
    doc.fontSize(10);
    for (const line of lines) {
      doc.text(line, { paragraphGap: 8 });
    }
    doc.end();
  });
}
