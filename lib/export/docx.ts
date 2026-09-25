import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

import type { ExportBlock, ExportResume } from "./model";

// DOCX rendering (task 1.25): single column, Word's own Heading 1 style for
// the standard section headings, real bulleted lists, a common font, and no
// tables, text boxes, images, headers, or footers, which ATS parsers skip.

const FONT = "Calibri";
/** Half-points. */
const BODY_SIZE = 21;
const NAME_SIZE = 32;
const HEADING_SIZE = 24;
/** Twips (1 inch = 1440). */
const MARGIN = 1080;

function blockParagraphs(block: ExportBlock): Paragraph[] {
  switch (block.kind) {
    case "text":
      return [new Paragraph({ text: block.text, spacing: { after: 60 } })];
    case "list":
      return block.items.map((text) => new Paragraph({ text, bullet: { level: 0 } }));
    case "entry":
      return [
        new Paragraph({
          children: [new TextRun({ text: block.title, bold: true })],
          spacing: { before: 120 },
          keepNext: true,
        }),
        ...(block.meta
          ? [new Paragraph({ children: [new TextRun({ text: block.meta, italics: true })] })]
          : []),
        ...block.bullets.map((text) => new Paragraph({ text, bullet: { level: 0 } })),
      ];
  }
}

export function renderDocx(resume: ExportResume): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: resume.name })],
    }),
  ];
  if (resume.contact.length > 0) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        text: resume.contact.join(" | "),
        spacing: { after: 120 },
      }),
    );
  }
  for (const section of resume.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        text: section.heading,
        keepNext: true,
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
      }),
    );
    for (const block of section.blocks) children.push(...blockParagraphs(block));
  }

  const doc = new Document({
    creator: "Resume Tailor",
    title: `${resume.name} resume`,
    styles: {
      default: {
        document: { run: { font: FONT, size: BODY_SIZE, color: "000000" } },
        title: {
          run: { font: FONT, size: NAME_SIZE, bold: true, color: "000000" },
          paragraph: { spacing: { after: 40 } },
        },
        heading1: {
          run: { font: FONT, size: HEADING_SIZE, bold: true, color: "000000" },
          paragraph: { spacing: { before: 240, after: 80 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
