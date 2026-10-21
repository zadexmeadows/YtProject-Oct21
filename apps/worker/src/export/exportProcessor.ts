import fs from 'node:fs/promises';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { findMessagesForExport, prisma, type MessageRow } from '@ytbot/db';
import { formatPakistanIso, PAKISTAN_TIME_ZONE } from '@ytbot/shared';
import { nowEventTime, publishRealtime } from '../lib/realtime';
import { env } from '../lib/env';
import { logger } from '../lib/logger';

const EXPORT_LIMIT = 100_000;
const PDF_MESSAGE_LIMIT = 3000;
const PDF_IMAGE_FETCH_LIMIT = 650;
const PDF_IMAGE_FETCH_TIMEOUT_MS = 1600;
const PDF_IMAGE_MAX_BYTES = 1_500_000;
const TWEMOJI_BASE_URL = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72';
const PDF_BRAND_NAME = 'YouTube Live Chat Intelligence';
const PDF_BRAND_ACCENT = '#2563eb';

const pdfStyle = {
  pageBg: '#070b12',
  panelBg: '#0f172a',
  cardBg: '#111827',
  cardBorder: '#263244',
  muted: '#94a3b8',
  subtle: '#64748b',
  text: '#f8fafc',
  message: '#e5e7eb',
  divider: '#1f2937',
  danger: '#f87171',
  success: '#34d399',
  warning: '#fbbf24',
  pageWidth: 595.28,
  pageHeight: 841.89,
  marginX: 30,
  contentTop: 54,
  contentBottom: 784,
  footerY: 807,
  cardGap: 5,
  dateHeaderHeight: 24,
  cardRadius: 8,
  cardPadding: 8,
  avatarSize: 24,
  emojiSize: 11,
  titleSize: 11,
  metaSize: 7,
  nameSize: 8.8,
  messageSize: 8.8,
  streamSize: 6.6,
  messageLineHeight: 13
};

interface PdfPageShellOptions {
  showMetaLine?: boolean;
}

interface PdfFonts {
  regular: string;
  bold: string;
}

interface PdfRenderContext {
  brandName: string;
  accent: string;
  title: string;
  generatedAt: Date;
  streamLabel: string;
  totalMessages: number;
  fonts: PdfFonts;
}

interface PdfMessagePart {
  type: 'text' | 'emoji';
  text: string;
  alt?: string | null;
  src?: string | null;
  fallbackSrc?: string | null;
}

interface PdfLayoutToken {
  type: 'text' | 'emoji';
  text: string;
  width: number;
  src?: string | null;
  fallbackSrc?: string | null;
}

interface PdfLayoutLine {
  tokens: PdfLayoutToken[];
}

interface PdfDateGroup {
  key: string;
  label: string;
  sortTime: number;
  rows: MessageRow[];
}

export async function processExportJob(exportJobId: string) {
  const job = await prisma.exportJob.findUnique({
    where: { id: exportJobId }
  });

  if (!job) {
    logger.warn({ exportJobId }, 'Export job not found');
    return;
  }

  await setExportStatus(exportJobId, 'PROCESSING');

  try {
    await fs.mkdir(env.EXPORT_DIR, { recursive: true });
    const filters = job.filters as Record<string, unknown>;
    const rows = await findMessagesForExport(prisma, filters, EXPORT_LIMIT);
    const generatedAt = new Date();
    const extension = extensionFor(job.format);
    const fileName = `yt-chat-${job.id}.${extension}`;
    const filePath = path.resolve(env.EXPORT_DIR, fileName);

    switch (job.format) {
      case 'CSV':
        await writeCsv(filePath, rows);
        break;
      case 'EXCEL':
        await writeExcel(filePath, rows, filters, generatedAt);
        break;
      case 'JSON':
        await writeJson(filePath, rows, filters, generatedAt);
        break;
      case 'PDF':
        await writePdf(filePath, rows, filters, generatedAt);
        break;
    }

    await prisma.exportJob.update({
      where: { id: exportJobId },
      data: {
        status: 'COMPLETED',
        fileName,
        filePath,
        completedAt: generatedAt,
        errorMessage: null
      }
    });

    await publishRealtime({
      type: 'export.status',
      at: nowEventTime(),
      payload: {
        exportJobId,
        status: 'COMPLETED',
        fileName
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Export generation failed';
    logger.error({ err: error, exportJobId }, 'Export job failed');
    await setExportStatus(exportJobId, 'FAILED', errorMessage);
  }
}

async function setExportStatus(
  exportJobId: string,
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED',
  errorMessage?: string,
) {
  const data = errorMessage !== undefined ? { status, errorMessage } : { status };
  await prisma.exportJob.update({
    where: { id: exportJobId },
    data
  });

  const payload: {
    exportJobId: string;
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    errorMessage?: string | null;
  } = {
    exportJobId,
    status
  };
  if (errorMessage !== undefined) payload.errorMessage = errorMessage;

  await publishRealtime({
    type: 'export.status',
    at: nowEventTime(),
    payload
  });
}

function extensionFor(format: string) {
  return {
    CSV: 'csv',
    EXCEL: 'xlsx',
    JSON: 'json',
    PDF: 'pdf'
  }[format]!;
}

function rowToRecord(row: MessageRow) {
  return {
    captured_at: formatPakistanIso(row.capturedAt),
    original_timestamp: row.originalTimestamp ? formatPakistanIso(row.originalTimestamp) : '',
    stream_title: row.streamTitle ?? '',
    video_id: row.videoId,
    message_id: row.messageId,
    author_name: row.authorName,
    author_channel_id: row.authorChannelId ?? '',
    message_type: row.messageType,
    message_text: row.messageText,
    amount: row.amount ?? '',
    currency: row.currency ?? '',
    badges: JSON.stringify(row.badges ?? [])
  };
}

async function writeCsv(filePath: string, rows: MessageRow[]) {
  const csv = stringify(rows.map(rowToRecord), {
    header: true
  });
  await fs.writeFile(filePath, csv, 'utf8');
}

async function writeJson(
  filePath: string,
  rows: MessageRow[],
  filters: Record<string, unknown>,
  generatedAt: Date,
) {
  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        generatedAt: formatPakistanIso(generatedAt),
        filters,
        summary: summarizeRows(rows),
        messages: rows.map((row) => ({
          ...rowToRecord(row),
          rawPayload: row.rawPayload
        }))
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function writeExcel(
  filePath: string,
  rows: MessageRow[],
  filters: Record<string, unknown>,
  generatedAt: Date,
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'YouTube Live Chat Intelligence';
  workbook.created = generatedAt;

  const summary = workbook.addWorksheet('Summary');
  summary.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 60 }
  ];
  const stats = summarizeRows(rows);
  summary.addRows([
    { metric: 'Generated at', value: formatPakistanIso(generatedAt) },
    { metric: 'Total messages', value: stats.totalMessages },
    { metric: 'Date range', value: `${stats.firstMessageAt ?? 'n/a'} to ${stats.lastMessageAt ?? 'n/a'}` },
    { metric: 'Filters', value: JSON.stringify(filters) }
  ]);

  const worksheet = workbook.addWorksheet('Messages');
  worksheet.columns = [
    { header: 'Captured At', key: 'captured_at', width: 24 },
    { header: 'Original Timestamp', key: 'original_timestamp', width: 24 },
    { header: 'Stream Title', key: 'stream_title', width: 36 },
    { header: 'Video ID', key: 'video_id', width: 16 },
    { header: 'Message ID', key: 'message_id', width: 34 },
    { header: 'Author', key: 'author_name', width: 24 },
    { header: 'Author Channel ID', key: 'author_channel_id', width: 24 },
    { header: 'Type', key: 'message_type', width: 14 },
    { header: 'Message', key: 'message_text', width: 80 },
    { header: 'Amount', key: 'amount', width: 12 },
    { header: 'Currency', key: 'currency', width: 10 },
    { header: 'Badges', key: 'badges', width: 30 }
  ];
  worksheet.addRows(rows.map(rowToRecord));
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  await workbook.xlsx.writeFile(filePath);
}

export async function writePdf(
  filePath: string,
  rows: MessageRow[],
  filters: Record<string, unknown>,
  generatedAt: Date,
) {
  const doc = new PDFDocument({
    margin: 0,
    size: 'A4',
    bufferPages: true,
    autoFirstPage: false
  });

  const stream = createWriteStream(filePath);
  doc.pipe(stream);

  const fonts = await registerPdfFonts(doc);
  const stats = summarizeRows(rows);
  const streamLabel = rows[0]?.streamTitle ?? String(filters.videoId ?? filters.streamId ?? 'Multiple streams');
  const context: PdfRenderContext = {
    brandName: PDF_BRAND_NAME,
    accent: PDF_BRAND_ACCENT,
    title: 'Live Chat Export',
    generatedAt,
    streamLabel,
    totalMessages: rows.length,
    fonts
  };

  addPdfPage(doc, context, { showMetaLine: false });
  drawSummaryCard(doc, stats, filters, context);

  const imageCache = new PdfImageCache();
  const visibleRows = rows.slice(0, PDF_MESSAGE_LIMIT);

  if (visibleRows.length === 0) {
    drawEmptyMessagesCard(doc, context);
  }

  for (const group of groupPdfRowsByDate(visibleRows)) {
    drawPdfDateDivider(doc, group, context);
    for (const row of group.rows) {
      await drawChatMessageCard(doc, row, context, imageCache);
    }
  }

  if (rows.length > PDF_MESSAGE_LIMIT) {
    drawLimitNotice(doc, rows.length, context);
  }

  addPdfFooters(doc, generatedAt, context);
  doc.end();

  await new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function registerPdfFonts(doc: PDFKit.PDFDocument): Promise<PdfFonts> {
  const candidates = [
    {
      regular: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
    },
    {
      regular: '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
      bold: '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf'
    },
    {
      regular: 'C:/Windows/Fonts/arial.ttf',
      bold: 'C:/Windows/Fonts/arialbd.ttf'
    }
  ];

  for (const candidate of candidates) {
    try {
      await Promise.all([fs.access(candidate.regular), fs.access(candidate.bold)]);
      doc.registerFont('ExportRegular', candidate.regular);
      doc.registerFont('ExportBold', candidate.bold);
      return { regular: 'ExportRegular', bold: 'ExportBold' };
    } catch {
      // Keep trying font fallbacks. Helvetica remains available in PDFKit.
    }
  }

  return { regular: 'Helvetica', bold: 'Helvetica-Bold' };
}

function addPdfPage(
  doc: PDFKit.PDFDocument,
  context: PdfRenderContext,
  options: PdfPageShellOptions = {},
) {
  doc.addPage();
  drawPageShell(doc, context, options);
  doc.y = options.showMetaLine === false ? pdfStyle.contentTop : pdfStyle.contentTop + 12;
}

function drawPageShell(
  doc: PDFKit.PDFDocument,
  context: PdfRenderContext,
  { showMetaLine = true }: PdfPageShellOptions = {},
) {
  doc.rect(0, 0, pdfStyle.pageWidth, pdfStyle.pageHeight).fill(pdfStyle.pageBg);

  const y = 24;
  const width = pdfStyle.pageWidth - pdfStyle.marginX * 2;
  doc
    .font(context.fonts.bold)
    .fontSize(pdfStyle.titleSize)
    .fillColor(pdfStyle.text)
    .text(context.title, pdfStyle.marginX, y, { width: 160 });
  doc
    .font(context.fonts.regular)
    .fontSize(pdfStyle.metaSize)
    .fillColor(pdfStyle.muted)
    .text(context.brandName, pdfStyle.marginX + 170, y + 2, {
      width: 150,
      ellipsis: true
    })
    .text(`${context.totalMessages.toLocaleString()} messages`, pdfStyle.marginX + width - 180, y + 2, {
      align: 'right',
      width: 180
    });
  doc
    .strokeColor(pdfStyle.divider)
    .lineWidth(0.5)
    .moveTo(pdfStyle.marginX, y + 20)
    .lineTo(pdfStyle.pageWidth - pdfStyle.marginX, y + 20)
    .stroke();

  if (showMetaLine) {
    doc
      .font(context.fonts.regular)
      .fontSize(6.5)
      .fillColor(pdfStyle.subtle)
      .text(`Generated ${formatPdfDate(context.generatedAt)}`, pdfStyle.marginX, y + 26, {
        width: 190
      })
      .text(`Stream: ${context.streamLabel}`, pdfStyle.marginX + 195, y + 26, {
        align: 'right',
        width: width - 195,
        ellipsis: true
      });
  }
}

function drawSummaryCard(
  doc: PDFKit.PDFDocument,
  stats: ReturnType<typeof summarizeRows>,
  filters: Record<string, unknown>,
  context: PdfRenderContext,
) {
  const x = pdfStyle.marginX;
  const y = doc.y;
  const width = pdfStyle.pageWidth - pdfStyle.marginX * 2;
  const height = 74;
  doc.roundedRect(x, y, width, height, pdfStyle.cardRadius).fillAndStroke(pdfStyle.panelBg, pdfStyle.cardBorder);

  doc
    .font(context.fonts.bold)
    .fontSize(9.5)
    .fillColor(pdfStyle.text)
    .text('Export Summary', x + 12, y + 10, { width: 115 });

  const lineY = y + 10;
  drawSummaryMetric(doc, context, x + 128, lineY, 'Range', `${formatPdfDate(stats.firstMessageAt)} - ${formatPdfDate(stats.lastMessageAt)}`);
  drawSummaryMetric(doc, context, x + 318, lineY, 'Users', stats.uniqueUsers.toLocaleString());
  drawSummaryMetric(doc, context, x + 382, lineY, 'Super Chats', stats.superChats.toLocaleString());
  drawSummaryMetric(doc, context, x + 462, lineY, 'Members', stats.memberships.toLocaleString());

  doc
    .font(context.fonts.regular)
    .fontSize(6.8)
    .fillColor(pdfStyle.muted)
    .text(`Generated: ${formatPdfDate(context.generatedAt)}`, x + 12, y + 34, {
      width: 180,
      ellipsis: true
    })
    .text(`Stream: ${context.streamLabel}`, x + 202, y + 34, {
      width: width - 214,
      ellipsis: true
    })
    .text(`Filters: ${formatFilters(filters)}`, x + 12, y + 52, {
      width: width - 24,
      ellipsis: true
    });

  doc.y = y + height + 7;
}

function drawSummaryMetric(
  doc: PDFKit.PDFDocument,
  context: PdfRenderContext,
  x: number,
  y: number,
  label: string,
  value: string,
) {
  doc.font(context.fonts.regular).fontSize(6.4).fillColor(pdfStyle.subtle).text(label.toUpperCase(), x, y, {
    width: 74
  });
  doc.font(context.fonts.bold).fontSize(8).fillColor(pdfStyle.text).text(value, x, y + 12, {
    width: 185,
    ellipsis: true
  });
}

function drawPdfDateDivider(
  doc: PDFKit.PDFDocument,
  group: PdfDateGroup,
  context: PdfRenderContext,
) {
  const firstRow = group.rows[0];
  let firstCardHeight = 47;
  if (firstRow) {
    const cardWidth = pdfStyle.pageWidth - pdfStyle.marginX * 2;
    const messageWidth = cardWidth - pdfStyle.cardPadding * 2 - pdfStyle.avatarSize - 12;
    firstCardHeight = measureMessageCardHeight(
      doc,
      getPdfMessageParts(firstRow),
      messageWidth,
      context,
      badgeLabels(firstRow).length,
    );
  }

  const maxReservedCardHeight =
    pdfStyle.contentBottom - (pdfStyle.contentTop + 12) - pdfStyle.dateHeaderHeight - pdfStyle.cardGap;
  ensurePdfSpace(
    doc,
    pdfStyle.dateHeaderHeight + pdfStyle.cardGap + Math.min(firstCardHeight, maxReservedCardHeight),
    context,
  );

  const x = pdfStyle.marginX;
  const y = doc.y;
  const width = pdfStyle.pageWidth - pdfStyle.marginX * 2;

  doc
    .roundedRect(x, y, width, pdfStyle.dateHeaderHeight, 6)
    .fillAndStroke(pdfStyle.panelBg, pdfStyle.cardBorder);
  doc
    .font(context.fonts.bold)
    .fontSize(7.4)
    .fillColor(pdfStyle.text)
    .text(group.label.toUpperCase(), x + 11, y + 8, {
      width: width - 150,
      lineBreak: false
    });
  doc
    .font(context.fonts.bold)
    .fontSize(6.8)
    .fillColor(pdfStyle.subtle)
    .text(`${group.rows.length.toLocaleString()} messages`, x + width - 135, y + 8, {
      align: 'right',
      width: 124,
      lineBreak: false
    });

  doc.y = y + pdfStyle.dateHeaderHeight + pdfStyle.cardGap;
}

async function drawChatMessageCard(
  doc: PDFKit.PDFDocument,
  row: MessageRow,
  context: PdfRenderContext,
  imageCache: PdfImageCache,
) {
  const cardWidth = pdfStyle.pageWidth - pdfStyle.marginX * 2;
  const textX = pdfStyle.marginX + pdfStyle.cardPadding + pdfStyle.avatarSize + 12;
  const textWidth = cardWidth - pdfStyle.cardPadding * 2 - pdfStyle.avatarSize - 12;
  const messageParts = getPdfMessageParts(row);
  const messageWidth = textWidth;
  const naturalHeight = measureMessageCardHeight(doc, messageParts, messageWidth, context, badgeLabels(row).length);
  const maxSinglePageHeight = pdfStyle.contentBottom - pdfStyle.contentTop;
  const avatar = await imageCache.get(row.authorAvatarUrl);
  const emojiImages = await loadEmojiImages(messageParts, imageCache);

  if (naturalHeight <= maxSinglePageHeight) {
    ensurePdfSpace(doc, naturalHeight, context);
    drawOneMessageCard(doc, row, messageParts, naturalHeight, context, avatar, emojiImages, false);
    return;
  }

  const chunkMaxTextHeight = maxSinglePageHeight - 88;
  const chunks = splitPartsToChunks(doc, messageParts, messageWidth, chunkMaxTextHeight, context);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    const chunkHeight = measureMessageCardHeight(doc, chunk, messageWidth, context, badgeLabels(row).length);
    ensurePdfSpace(doc, chunkHeight, context);
    drawOneMessageCard(doc, row, chunk, chunkHeight, context, avatar, emojiImages, index > 0);
  }
}

function measureMessageCardHeight(
  doc: PDFKit.PDFDocument,
  parts: PdfMessagePart[],
  messageWidth: number,
  context: PdfRenderContext,
  badgeCount: number,
) {
  const lines = layoutMessageParts(doc, parts, messageWidth, context);
  const messageHeight = Math.max(pdfStyle.messageLineHeight, lines.length * pdfStyle.messageLineHeight);
  const badgeHeight = badgeCount > 0 ? 13 : 0;
  return Math.max(43 + badgeHeight + messageHeight, 47);
}

function ensurePdfSpace(doc: PDFKit.PDFDocument, neededHeight: number, context: PdfRenderContext) {
  if (doc.y + neededHeight > pdfStyle.contentBottom) {
    addPdfPage(doc, context);
  }
}

function drawOneMessageCard(
  doc: PDFKit.PDFDocument,
  row: MessageRow,
  messageParts: PdfMessagePart[],
  height: number,
  context: PdfRenderContext,
  avatar: Buffer | null,
  emojiImages: Map<string, Buffer | null>,
  continuation: boolean,
) {
  const x = pdfStyle.marginX;
  const y = doc.y;
  const width = pdfStyle.pageWidth - pdfStyle.marginX * 2;
  const isSuperChat = row.messageType === 'SUPERCHAT';
  const borderColor = isSuperChat ? pdfStyle.success : pdfStyle.cardBorder;
  const fillColor = isSuperChat ? '#082f2c' : pdfStyle.cardBg;

  doc.roundedRect(x, y, width, height, pdfStyle.cardRadius).fillAndStroke(fillColor, borderColor);

  const avatarX = x + pdfStyle.cardPadding;
  const avatarY = y + pdfStyle.cardPadding;
  drawAvatar(doc, avatar, row.authorName, avatarX, avatarY, pdfStyle.avatarSize, context);

  const textX = avatarX + pdfStyle.avatarSize + 12;
  const textWidth = width - pdfStyle.cardPadding * 2 - pdfStyle.avatarSize - 12;
  const headerY = y + pdfStyle.cardPadding;
  const timestamp = formatPdfTime(row.originalTimestamp ?? row.capturedAt);
  const author = continuation ? `${row.authorName} (continued)` : row.authorName;

  doc
    .font(context.fonts.bold)
    .fontSize(pdfStyle.nameSize)
    .fillColor(authorColor(row.authorName))
    .text(author, textX, headerY, {
      width: textWidth - 82,
      ellipsis: true
    });
  doc
    .font(context.fonts.regular)
    .fontSize(pdfStyle.metaSize)
    .fillColor(pdfStyle.muted)
    .text(timestamp, textX + textWidth - 80, headerY + 1,
    {
      align: 'right',
      width: 80
    });

  let cursorY = headerY + 12;
  const badges = badgeLabels(row);
  if (badges.length > 0 || isSuperChat || row.messageType !== 'NORMAL') {
    cursorY = drawBadgeRow(doc, row, badges, textX, cursorY, context);
  }

  drawMessageParts(doc, messageParts, textX, cursorY + 2, textWidth, context, emojiImages);

  doc
    .font(context.fonts.regular)
    .fontSize(pdfStyle.streamSize)
    .fillColor(pdfStyle.subtle)
    .text(streamLabelForRow(row), textX, y + height - 12, {
      width: textWidth,
      ellipsis: true
    });

  doc.y = y + height + pdfStyle.cardGap;
}

function drawBadgeRow(
  doc: PDFKit.PDFDocument,
  row: MessageRow,
  badges: string[],
  x: number,
  y: number,
  context: PdfRenderContext,
) {
  const chips = [
    ...badges.slice(0, 3),
    row.messageType !== 'NORMAL' ? friendlyMessageType(row) : null,
    row.amount && row.currency ? `${row.currency} ${row.amount}` : null
  ].filter(Boolean) as string[];

  let cursorX = x;
  for (const chip of chips.slice(0, 5)) {
    doc.font(context.fonts.bold).fontSize(6.5);
    const chipWidth = Math.min(doc.widthOfString(chip) + 10, 82);
    doc.roundedRect(cursorX, y, chipWidth, 11, 4).fill(chipColor(chip));
    doc.fillColor(pdfStyle.text).text(chip, cursorX + 5, y + 2.2, {
      width: chipWidth - 10,
      ellipsis: true
    });
    cursorX += chipWidth + 4;
  }

  return y + 13;
}

function drawAvatar(
  doc: PDFKit.PDFDocument,
  avatar: Buffer | null,
  authorName: string,
  x: number,
  y: number,
  size: number,
  context: PdfRenderContext,
) {
  if (avatar) {
    try {
      doc.save();
      doc.circle(x + size / 2, y + size / 2, size / 2).clip();
      doc.image(avatar, x, y, { fit: [size, size] });
      doc.restore();
      return;
    } catch {
      doc.restore();
    }
  }

  doc.circle(x + size / 2, y + size / 2, size / 2).fill(authorColor(authorName));
  doc
    .font(context.fonts.bold)
    .fontSize(9)
    .fillColor('#ffffff')
    .text(initialsFor(authorName), x, y + 7,
    {
      align: 'center',
      width: size
    });
}

function drawEmptyMessagesCard(doc: PDFKit.PDFDocument, context: PdfRenderContext) {
  const x = pdfStyle.marginX;
  const y = doc.y;
  const width = pdfStyle.pageWidth - pdfStyle.marginX * 2;
  doc.roundedRect(x, y, width, 56, pdfStyle.cardRadius).fillAndStroke(pdfStyle.cardBg, pdfStyle.cardBorder);
  doc
    .font(context.fonts.bold)
    .fontSize(10)
    .fillColor(pdfStyle.text)
    .text('No messages found', x + 12, y + 12);
  doc
    .font(context.fonts.regular)
    .fontSize(8)
    .fillColor(pdfStyle.muted)
    .text('The selected export filters did not match any captured chat messages.', x + 12, y + 30, {
      width: width - 24
    });
  doc.y = y + 64;
}

function drawLimitNotice(doc: PDFKit.PDFDocument, totalRows: number, context: PdfRenderContext) {
  ensurePdfSpace(doc, 64, context);
  const x = pdfStyle.marginX;
  const y = doc.y;
  const width = pdfStyle.pageWidth - pdfStyle.marginX * 2;
  doc.roundedRect(x, y, width, 54, 10).fillAndStroke('#2f1f0b', '#92400e');
  doc
    .font(context.fonts.bold)
    .fontSize(10)
    .fillColor(pdfStyle.warning)
    .text('PDF display limit reached', x + 14, y + 12);
  doc
    .font(context.fonts.regular)
    .fontSize(8.5)
    .fillColor(pdfStyle.muted)
    .text(
      `${totalRows.toLocaleString()} messages matched this export. The PDF shows the first ${PDF_MESSAGE_LIMIT.toLocaleString()} messages; CSV, Excel, and JSON exports contain the full available dataset.`,
      x + 14,
      y + 29,
      { width: width - 28 },
    );
  doc.y = y + 68;
}

function addPdfFooters(doc: PDFKit.PDFDocument, generatedAt: Date, context: PdfRenderContext) {
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc
      .strokeColor(pdfStyle.divider)
      .lineWidth(0.6)
      .moveTo(pdfStyle.marginX, pdfStyle.footerY - 13)
      .lineTo(pdfStyle.pageWidth - pdfStyle.marginX, pdfStyle.footerY - 13)
      .stroke();
    doc
      .font(context.fonts.regular)
      .fontSize(6.8)
      .fillColor(pdfStyle.subtle)
      .text(`Generated ${formatPdfDate(generatedAt)}`, pdfStyle.marginX, pdfStyle.footerY, {
        width: 230
      });
    doc.text(`Page ${index + 1} of ${total}`, pdfStyle.marginX, pdfStyle.footerY, {
      align: 'right',
      width: pdfStyle.pageWidth - pdfStyle.marginX * 2
    });
  }
}

function splitPartsToChunks(
  doc: PDFKit.PDFDocument,
  parts: PdfMessagePart[],
  width: number,
  maxHeight: number,
  context: PdfRenderContext,
): PdfMessagePart[][] {
  const chunks: PdfMessagePart[][] = [];
  let current: PdfMessagePart[] = [];

  for (const part of parts) {
    const candidate = [...current, part];
    const height = layoutMessageParts(doc, candidate, width, context).length * pdfStyle.messageLineHeight;
    if (current.length > 0 && height > maxHeight) {
      chunks.push(current);
      current = [part];
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [[{ type: 'text', text: '' }]];
}

function getPdfMessageParts(row: MessageRow): PdfMessagePart[] {
  const rawPayload = row.rawPayload;
  const rawParts =
    rawPayload && typeof rawPayload === 'object' && 'messageParts' in rawPayload
      ? (rawPayload as { messageParts?: unknown }).messageParts
      : null;

  if (Array.isArray(rawParts) && rawParts.length > 0) {
    const parts = rawParts.flatMap((part): PdfMessagePart[] => {
      if (!part || typeof part !== 'object') return [];
      const record = part as Record<string, unknown>;
      const text = typeof record.text === 'string' ? sanitizePdfText(record.text) : '';
      const type = record.type === 'emoji' ? 'emoji' : 'text';

      if (type === 'emoji') {
        const src = typeof record.src === 'string' ? normalizeImageUrl(record.src) : null;
        if (src) {
          return [
            {
              type: 'emoji',
              text: text || String(record.alt ?? '[emoji]'),
              alt: typeof record.alt === 'string' ? record.alt : null,
              src
            }
          ];
        }
      }

      return explodeTextForPdf(text);
    });

    if (parts.length > 0) return parts;
  }

  return explodeTextForPdf(sanitizePdfText(row.messageText || systemMessageText(row.messageType)));
}

function sanitizePdfText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function explodeTextForPdf(value: string): PdfMessagePart[] {
  const parts: PdfMessagePart[] = [];
  let textBuffer = '';

  for (const segment of graphemeSegments(value)) {
    if (isEmojiSegment(segment)) {
      if (textBuffer) {
        parts.push({ type: 'text', text: textBuffer });
        textBuffer = '';
      }
      parts.push({
        type: 'emoji',
        text: segment,
        src: twemojiUrl(segment),
        fallbackSrc: twemojiUrl(segment, { stripVariationSelectors: true })
      });
    } else {
      textBuffer += segment;
    }
  }

  if (textBuffer) parts.push({ type: 'text', text: textBuffer });
  return parts.length > 0 ? parts : [{ type: 'text', text: '' }];
}

function graphemeSegments(value: string): string[] {
  const segmenterFactory = (Intl as unknown as {
    Segmenter?: new (locale: string, options: { granularity: 'grapheme' }) => {
      segment(input: string): Iterable<{ segment: string }>;
    };
  }).Segmenter;

  if (segmenterFactory) {
    return Array.from(new segmenterFactory('en', { granularity: 'grapheme' }).segment(value), (part) => part.segment);
  }

  return Array.from(value);
}

function isEmojiSegment(value: string) {
  return (
    /\p{Extended_Pictographic}/u.test(value) ||
    /[\u{1F1E6}-\u{1F1FF}]/u.test(value) ||
    /[\u{1F300}-\u{1FAFF}]/u.test(value) ||
    /[#*0-9]\uFE0F?\u20E3/u.test(value)
  );
}

function twemojiUrl(value: string, options: { stripVariationSelectors?: boolean } = {}) {
  const codepoints = Array.from(value)
    .map((char) => char.codePointAt(0))
    .filter((codepoint): codepoint is number => typeof codepoint === 'number')
    .filter((codepoint) => !options.stripVariationSelectors || (codepoint !== 0xfe0f && codepoint !== 0xfe0e))
    .map((codepoint) => codepoint.toString(16))
    .join('-');

  return codepoints ? `${TWEMOJI_BASE_URL}/${codepoints}.png` : null;
}

function normalizeImageUrl(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

async function loadEmojiImages(parts: PdfMessagePart[], imageCache: PdfImageCache) {
  const images = new Map<string, Buffer | null>();
  const sources = Array.from(
    new Set(
      parts
        .flatMap((part) => [part.src, part.fallbackSrc])
        .filter((value): value is string => Boolean(value)),
    ),
  );

  await Promise.all(
    sources.map(async (source) => {
      images.set(source, await imageCache.get(source));
    }),
  );

  return images;
}

function layoutMessageParts(
  doc: PDFKit.PDFDocument,
  parts: PdfMessagePart[],
  width: number,
  context: PdfRenderContext,
): PdfLayoutLine[] {
  doc.font(context.fonts.regular).fontSize(pdfStyle.messageSize);
  const lines: PdfLayoutLine[] = [{ tokens: [] }];
  let cursorX = 0;

  const currentLine = () => lines[lines.length - 1]!;
  const pushLine = () => {
    lines.push({ tokens: [] });
    cursorX = 0;
  };

  for (const part of parts) {
    if (part.type === 'emoji') {
      const token: PdfLayoutToken = {
        type: 'emoji',
        text: part.text,
        width: pdfStyle.emojiSize + 2
      };
      if (part.src !== undefined) token.src = part.src;
      if (part.fallbackSrc !== undefined) token.fallbackSrc = part.fallbackSrc;
      if (cursorX > 0 && cursorX + token.width > width) pushLine();
      currentLine().tokens.push(token);
      cursorX += token.width;
      continue;
    }

    for (const tokenText of splitTextTokens(part.text)) {
      if (tokenText === '\n') {
        pushLine();
        continue;
      }
      if (!tokenText.trim() && cursorX === 0) continue;

      const tokenWidth = doc.widthOfString(tokenText);
      if (tokenWidth > width) {
        for (const segment of splitLongToken(doc, tokenText, width)) {
          const segmentWidth = doc.widthOfString(segment);
          if (cursorX > 0 && cursorX + segmentWidth > width) pushLine();
          currentLine().tokens.push({ type: 'text', text: segment, width: segmentWidth });
          cursorX += segmentWidth;
        }
        continue;
      }

      if (cursorX > 0 && cursorX + tokenWidth > width) pushLine();
      currentLine().tokens.push({ type: 'text', text: tokenText, width: tokenWidth });
      cursorX += tokenWidth;
    }
  }

  return lines.filter((line, index) => line.tokens.length > 0 || index === 0);
}

function splitTextTokens(value: string) {
  return Array.from(value.matchAll(/\n|\s+|[^\s\n]+/gu), (match) => match[0]);
}

function splitLongToken(doc: PDFKit.PDFDocument, value: string, width: number) {
  const chunks: string[] = [];
  let chunk = '';

  for (const segment of graphemeSegments(value)) {
    const next = chunk + segment;
    if (chunk && doc.widthOfString(next) > width) {
      chunks.push(chunk);
      chunk = segment;
    } else {
      chunk = next;
    }
  }

  if (chunk) chunks.push(chunk);
  return chunks;
}

function drawMessageParts(
  doc: PDFKit.PDFDocument,
  parts: PdfMessagePart[],
  x: number,
  y: number,
  width: number,
  context: PdfRenderContext,
  emojiImages: Map<string, Buffer | null>,
) {
  const lines = layoutMessageParts(doc, parts, width, context);
  doc.font(context.fonts.regular).fontSize(pdfStyle.messageSize).fillColor(pdfStyle.message);

  lines.forEach((line, index) => {
    let cursorX = x;
    const lineY = y + index * pdfStyle.messageLineHeight;
    for (const token of line.tokens) {
      if (token.type === 'emoji') {
        drawEmojiToken(doc, token, cursorX, lineY + 1, emojiImages, context);
      } else {
        doc
          .font(context.fonts.regular)
          .fontSize(pdfStyle.messageSize)
          .fillColor(pdfStyle.message)
          .text(token.text, cursorX, lineY, {
            lineBreak: false,
            width: token.width + 2
          });
      }
      cursorX += token.width;
    }
  });
}

function drawEmojiToken(
  doc: PDFKit.PDFDocument,
  token: PdfLayoutToken,
  x: number,
  y: number,
  emojiImages: Map<string, Buffer | null>,
  context: PdfRenderContext,
) {
  const image = (token.src ? emojiImages.get(token.src) : null) ?? (token.fallbackSrc ? emojiImages.get(token.fallbackSrc) : null);
  if (image) {
    try {
      doc.image(image, x, y, { fit: [pdfStyle.emojiSize, pdfStyle.emojiSize] });
      return;
    } catch {
      // Fall through to a clean placeholder instead of letting PDFKit print broken glyph codes.
    }
  }

  doc.roundedRect(x, y + 1, pdfStyle.emojiSize, pdfStyle.emojiSize, 2).fill('#263244');
  doc
    .font(context.fonts.bold)
    .fontSize(6.5)
    .fillColor(pdfStyle.muted)
    .text('?', x, y + 2.5, {
      align: 'center',
      lineBreak: false,
      width: pdfStyle.emojiSize
    });
}

function systemMessageText(messageType: string) {
  return messageType === 'SYSTEM' ? 'System event' : '';
}

function formatPdfDate(value: Date | string | null | undefined) {
  if (!value) return 'n/a';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: PAKISTAN_TIME_ZONE
  });
}

function formatPdfTime(value: Date | string | null | undefined) {
  if (!value) return 'n/a';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: PAKISTAN_TIME_ZONE
  });
}

function groupPdfRowsByDate(rows: MessageRow[]): PdfDateGroup[] {
  const groups = new Map<string, PdfDateGroup>();
  const sortedRows = [...rows].sort(
    (left, right) =>
      pdfMessageTime(left) - pdfMessageTime(right) ||
      left.id.localeCompare(right.id),
  );

  for (const row of sortedRows) {
    const date = new Date(row.capturedAt);
    const key = pakistanDateKey(date) ?? 'unknown-date';
    const validDate = key !== 'unknown-date';
    const sortTime = validDate ? Number(key.replaceAll('-', '')) : Number.NEGATIVE_INFINITY;
    const label = validDate
      ? date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: PAKISTAN_TIME_ZONE
        })
      : 'Unknown date';
    const group = groups.get(key) ?? { key, label, sortTime, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }

  return Array.from(groups.values()).sort((left, right) => right.sortTime - left.sortTime);
}

function pakistanDateKey(date: Date) {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: PAKISTAN_TIME_ZONE
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function pdfMessageTime(row: MessageRow) {
  const time = new Date(row.capturedAt).getTime();
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function formatFilters(filters: Record<string, unknown>) {
  const entries = Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) return 'None';
  return entries
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join(' | ');
}

function streamLabelForRow(row: MessageRow) {
  return row.streamTitle ? `${row.streamTitle} (${row.videoId})` : row.videoId;
}

function friendlyMessageType(row: MessageRow) {
  if (row.messageType === 'SUPERCHAT') return 'Super Chat';
  if (row.messageType === 'MEMBERSHIP') return 'Membership';
  if (row.messageType === 'PINNED') return 'Pinned';
  if (row.messageType === 'MODERATOR') return 'Moderator';
  if (row.messageType === 'OWNER') return 'Owner';
  if (row.messageType === 'SYSTEM') return 'System';
  return 'Text';
}

function badgeLabels(row: MessageRow) {
  if (!Array.isArray(row.badges)) return [];
  return row.badges
    .map((badge) => {
      if (typeof badge === 'string') return badge;
      if (badge && typeof badge === 'object') {
        const record = badge as Record<string, unknown>;
        return String(record.label ?? record.name ?? record.type ?? '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

function chipColor(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes('member')) return '#065f46';
  if (lower.includes('moderator') || lower.includes('mod')) return '#5b21b6';
  if (lower.includes('owner')) return '#9f1239';
  if (lower.includes('super')) return '#0f766e';
  return '#334155';
}

function initialsFor(authorName: string) {
  const clean = authorName.replace(/^@/, '').trim();
  if (!clean) return '?';
  return Array.from(clean)[0]?.toUpperCase() ?? '?';
}

function authorColor(authorName: string) {
  const palette = ['#60a5fa', '#f472b6', '#a78bfa', '#34d399', '#fb923c', '#22d3ee', '#f87171'];
  let hash = 0;
  for (let index = 0; index < authorName.length; index += 1) {
    hash = (hash * 31 + authorName.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length]!;
}

class PdfImageCache {
  private readonly cache = new Map<string, Promise<Buffer | null>>();
  private fetchCount = 0;

  async get(url: string | null | undefined) {
    const normalizedUrl = url ? normalizeImageUrl(url) : null;
    if (!normalizedUrl || this.fetchCount >= PDF_IMAGE_FETCH_LIMIT) return null;
    if (!this.cache.has(normalizedUrl)) {
      this.fetchCount += 1;
      this.cache.set(normalizedUrl, this.fetchImage(normalizedUrl));
    }
    return this.cache.get(normalizedUrl)!;
  }

  private async fetchImage(url: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PDF_IMAGE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'image/png,image/jpeg,image/webp,image/*;q=0.8,*/*;q=0.5'
        }
      });
      const contentType = response.headers.get('content-type') ?? '';
      const length = Number(response.headers.get('content-length') ?? 0);
      if (!response.ok || !contentType.startsWith('image/') || length > PDF_IMAGE_MAX_BYTES) return null;
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > PDF_IMAGE_MAX_BYTES) return null;
      return await sharp(Buffer.from(arrayBuffer)).png().toBuffer();
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function summarizeRows(rows: MessageRow[]) {
  const authorCounts = new Map<string, number>();
  for (const row of rows) {
    authorCounts.set(row.authorName, (authorCounts.get(row.authorName) ?? 0) + 1);
  }

  return {
    totalMessages: rows.length,
    firstMessageAt: rows[0] ? formatPakistanIso(rows[0].capturedAt) : null,
    lastMessageAt: rows.at(-1) ? formatPakistanIso(rows.at(-1)!.capturedAt) : null,
    uniqueUsers: authorCounts.size,
    superChats: rows.filter((row) => row.messageType === 'SUPERCHAT').length,
    memberships: rows.filter((row) => row.messageType === 'MEMBERSHIP').length,
    topUsers: Array.from(authorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([authorName, count]) => ({ authorName, count }))
  };
}
