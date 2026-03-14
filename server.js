const express = require("express");
const path = require("path");
const dayjs = require("dayjs");
const PDFDocument = require("pdfkit");
const bibleBooks = require("./data/bibleBooks");

const app = express();
const port = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Build a flat list of every chapter with its book reference and order.
const chapters = bibleBooks.flatMap((book, bookIndex) =>
  Array.from({ length: book.chapters }, (_, idx) => ({
    book: book.name,
    bookIndex,
    chapter: idx + 1,
  }))
);
const totalChapters = chapters.length;

const defaultStart = dayjs().format("YYYY-MM-DD");
const defaultEnd = dayjs().add(365, "day").format("YYYY-MM-DD");
const defaultStartBook = bibleBooks[0].name;
const defaultEndBook = bibleBooks[bibleBooks.length - 1].name;
const defaultCalendarPlatform = "ios";
const defaultReadingTime = "07:00";
const defaultReminderMode = "before";
const defaultReminderOffsetValue = "15";
const defaultReminderOffsetUnit = "minutes";

const supportedPlatforms = new Set(["ios", "android"]);
const supportedReminderModes = new Set(["none", "atTime", "before"]);
const supportedReminderUnits = new Set(["minutes", "hours", "days"]);

function getFormValues(source = {}) {
  return {
    startDate: source.startDate || defaultStart,
    endDate: source.endDate || defaultEnd,
    startBook: source.startBook || defaultStartBook,
    endBook: source.endBook || defaultEndBook,
    calendarPlatform: source.calendarPlatform || defaultCalendarPlatform,
    readingTime: source.readingTime || defaultReadingTime,
    reminderMode: source.reminderMode || defaultReminderMode,
    reminderOffsetValue: source.reminderOffsetValue || defaultReminderOffsetValue,
    reminderOffsetUnit: source.reminderOffsetUnit || defaultReminderOffsetUnit,
  };
}

function formatRange(startRef, endRef) {
  if (!startRef || !endRef) return "";
  if (startRef.book === endRef.book) {
    if (startRef.chapter === endRef.chapter) {
      return `${startRef.book} ${startRef.chapter}`;
    }
    return `${startRef.book} ${startRef.chapter}-${endRef.chapter}`;
  }
  return `${startRef.book} ${startRef.chapter} - ${endRef.book} ${endRef.chapter}`;
}

function formatUiDate(dateStr) {
  return dayjs(dateStr).format("MMM D, YYYY");
}

function formatTimeLabel(timeStr) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeStr || "");
  if (!match) return timeStr;

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  return dayjs().hour(hour).minute(minute).format("h:mm A");
}

function formatReminderSummary(values) {
  if (values.reminderMode === "none") {
    return "no reminder";
  }

  if (values.reminderMode === "atTime") {
    return "a reminder at the reading time";
  }

  const unitLabel =
    values.reminderOffsetValue === "1"
      ? values.reminderOffsetUnit.replace(/s$/, "")
      : values.reminderOffsetUnit;

  return `a reminder ${values.reminderOffsetValue} ${unitLabel} before`;
}

function describeCalendarSettings(values) {
  const platformLabel =
    values.calendarPlatform === "android" ? "Android calendar" : "iOS calendar";

  return `${platformLabel} at ${formatTimeLabel(values.readingTime)} with ${formatReminderSummary(
    values
  )}`;
}

function pickChapters(startBookName, endBookName) {
  const startIdx = bibleBooks.findIndex((book) => book.name === startBookName);
  const endIdx = bibleBooks.findIndex((book) => book.name === endBookName);

  if (startIdx === -1 || endIdx === -1) {
    return { error: "Please choose valid start and end books." };
  }
  if (endIdx < startIdx) {
    return { error: "End book must be the same or come after the start book." };
  }

  const selected = chapters.filter(
    (chapterRef) =>
      chapterRef.bookIndex >= startIdx && chapterRef.bookIndex <= endIdx
  );

  return { selected, selectedCount: selected.length };
}

function buildSchedule(startDateStr, endDateStr, startBookName, endBookName) {
  const startDate = dayjs(startDateStr);
  const endDate = dayjs(endDateStr);

  if (!startDate.isValid() || !endDate.isValid()) {
    return { error: "Please provide valid start and end dates." };
  }
  if (endDate.isBefore(startDate)) {
    return { error: "End date must be on or after the start date." };
  }

  const range = pickChapters(startBookName, endBookName);
  if (range.error) return { error: range.error };

  const { selected, selectedCount } = range;
  const totalDays = endDate.diff(startDate, "day") + 1;
  const schedule = [];

  for (let day = 0; day < totalDays; day += 1) {
    const currentDate = startDate.add(day, "day");
    const startIdx = Math.floor((day * selectedCount) / totalDays);
    const endIdx = Math.floor(((day + 1) * selectedCount) / totalDays) - 1;

    if (endIdx >= startIdx) {
      const startRef = selected[startIdx];
      const endRef = selected[endIdx];
      const chaptersCount = endIdx - startIdx + 1;
      const minutes = Math.max(5, Math.round(chaptersCount * 4));
      schedule.push({
        date: currentDate.format("MMM D, YYYY"),
        isoDate: currentDate.format("YYYY-MM-DD"),
        reading: formatRange(startRef, endRef),
        chaptersCount,
        minutes,
      });
    } else {
      schedule.push({
        date: currentDate.format("MMM D, YYYY"),
        isoDate: currentDate.format("YYYY-MM-DD"),
        reading: "—",
        chaptersCount: 0,
        minutes: 0,
      });
    }
  }

  return { schedule, totalDays, selectedCount };
}

function averageMinutes(schedule) {
  const scheduledDays = schedule.filter((entry) => entry.minutes > 0);
  if (!scheduledDays.length) return 0;

  return Math.round(
    scheduledDays.reduce((sum, entry) => sum + entry.minutes, 0) /
      scheduledDays.length
  );
}

function buildStats(result) {
  return {
    totalChapters,
    selectedChapters: result ? result.selectedCount : totalChapters,
    totalDays: result ? result.totalDays : null,
  };
}

function renderIndex(res, { status = 200, error = null, schedule = null, values, result = null }) {
  return res.status(status).render("index", {
    error,
    schedule,
    books: bibleBooks,
    values,
    stats: buildStats(result),
    calendarSummary: describeCalendarSettings(values),
    calendarExportCount: schedule
      ? schedule.filter((entry) => entry.chaptersCount > 0).length
      : 0,
  });
}

function validateCalendarOptions(values) {
  if (!supportedPlatforms.has(values.calendarPlatform)) {
    return { error: "Please choose iOS or Android for the calendar export." };
  }

  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(values.readingTime || "");
  if (!timeMatch) {
    return { error: "Please choose a valid daily reading time for the calendar export." };
  }

  if (!supportedReminderModes.has(values.reminderMode)) {
    return { error: "Please choose a valid reminder option." };
  }

  let reminderOffsetValue = 0;
  let reminderOffsetUnit = values.reminderOffsetUnit;

  if (values.reminderMode === "before") {
    if (!supportedReminderUnits.has(reminderOffsetUnit)) {
      return { error: "Please choose minutes, hours, or days for the reminder timing." };
    }

    reminderOffsetValue = Number.parseInt(values.reminderOffsetValue, 10);
    if (!Number.isInteger(reminderOffsetValue) || reminderOffsetValue < 1 || reminderOffsetValue > 365) {
      return {
        error:
          "Please enter a reminder amount between 1 and 365 for the calendar export.",
      };
    }
  } else {
    reminderOffsetUnit = defaultReminderOffsetUnit;
  }

  return {
    calendarConfig: {
      platform: values.calendarPlatform,
      readingTime: values.readingTime,
      startHour: Number.parseInt(timeMatch[1], 10),
      startMinute: Number.parseInt(timeMatch[2], 10),
      reminderMode: values.reminderMode,
      reminderOffsetValue,
      reminderOffsetUnit,
    },
  };
}

function escapeIcsText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldIcsLine(line) {
  const limit = 74;
  if (line.length <= limit) return line;

  let remaining = line;
  const parts = [];

  while (remaining.length > limit) {
    parts.push(remaining.slice(0, limit));
    remaining = ` ${remaining.slice(limit)}`;
  }

  parts.push(remaining);
  return parts.join("\r\n");
}

function toIcsPayload(lines) {
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

function createIcsTimestamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function buildReminderTrigger(calendarConfig) {
  if (calendarConfig.reminderMode === "none") {
    return null;
  }

  if (calendarConfig.reminderMode === "atTime") {
    return "TRIGGER;RELATED=START:PT0M";
  }

  if (calendarConfig.reminderOffsetUnit === "days") {
    return `TRIGGER;RELATED=START:-P${calendarConfig.reminderOffsetValue}D`;
  }

  const unitSymbol = calendarConfig.reminderOffsetUnit === "hours" ? "H" : "M";
  return `TRIGGER;RELATED=START:-PT${calendarConfig.reminderOffsetValue}${unitSymbol}`;
}

function buildCalendarFile(schedule, values, calendarConfig) {
  const generatedAt = createIcsTimestamp();
  const platformLabel =
    calendarConfig.platform === "android" ? "Android Calendar" : "Apple Calendar";
  const reminderTrigger = buildReminderTrigger(calendarConfig);
  const headerLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bible Reading Schedule Generator//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(`Bible Reading Schedule (${platformLabel})`)}`,
    `X-WR-CALDESC:${escapeIcsText(
      `Daily Bible readings from ${formatUiDate(values.startDate)} to ${formatUiDate(
        values.endDate
      )}.`
    )}`,
  ];

  const eventPayloads = schedule
    .filter((entry) => entry.chaptersCount > 0)
    .map((entry, index) => {
      const startAt = dayjs(entry.isoDate)
        .hour(calendarConfig.startHour)
        .minute(calendarConfig.startMinute)
        .second(0)
        .millisecond(0);
      const endAt = startAt.add(Math.max(entry.minutes, 15), "minute");
      const descriptionLines = [
        `Reading: ${entry.reading}`,
        `Date: ${entry.date}`,
        `Chapters: ${entry.chaptersCount}`,
        `Estimated time: about ${entry.minutes} minutes`,
        `Range: ${values.startBook} - ${values.endBook}`,
      ];

      const eventLines = [
        "BEGIN:VEVENT",
        `UID:${entry.isoDate.replace(/-/g, "")}-${index}@bible-reading-schedule-generator`,
        `DTSTAMP:${generatedAt}`,
        `DTSTART:${startAt.format("YYYYMMDDTHHmmss")}`,
        `DTEND:${endAt.format("YYYYMMDDTHHmmss")}`,
        `SUMMARY:${escapeIcsText(`Read ${entry.reading}`)}`,
        `DESCRIPTION:${escapeIcsText(descriptionLines.join("\n"))}`,
        "STATUS:CONFIRMED",
        "TRANSP:OPAQUE",
      ];

      if (reminderTrigger) {
        eventLines.push(
          "BEGIN:VALARM",
          reminderTrigger,
          "ACTION:DISPLAY",
          `DESCRIPTION:${escapeIcsText(
            `Bible reading reminder: ${entry.reading} (${entry.chaptersCount} chapter${
              entry.chaptersCount === 1 ? "" : "s"
            })`
          )}`,
          "END:VALARM"
        );
      }

      eventLines.push("END:VEVENT");
      return toIcsPayload(eventLines);
    });

  return `${toIcsPayload(headerLines)}${eventPayloads.join("")}${toIcsPayload([
    "END:VCALENDAR",
  ])}`;
}

function drawPdfStatCard(doc, x, y, width, label, value) {
  doc.save();
  doc.roundedRect(x, y, width, 34, 8).fillAndStroke("#f8fafc", "#d7dde5");
  doc.fillColor("#64748b").fontSize(7).text(label, x + 8, y + 7, { width: width - 16 });
  doc.fillColor("#111827").fontSize(11).text(String(value), x + 8, y + 17, {
    width: width - 16,
  });
  doc.restore();
}

function drawPdfPageHeader(doc, values, result, avgMinutes, compact = false) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const prettyStart = formatUiDate(values.startDate);
  const prettyEnd = formatUiDate(values.endDate);

  if (compact) {
    doc.fontSize(11).fillColor("#0f172a").text("Bible Reading Schedule", left, 24);
    doc
      .fontSize(8)
      .fillColor("#475569")
      .text(
        `${prettyStart} - ${prettyEnd} | ${values.startBook} - ${values.endBook}`,
        left,
        37
      );
    doc.moveTo(left, 50).lineTo(right, 50).strokeColor("#d7dde5").lineWidth(1).stroke();
    return 58;
  }

  doc.fontSize(18).fillColor("#0f172a").text("Bible Reading Schedule", left, 24);
  doc.fontSize(9).fillColor("#475569").text(`${prettyStart} - ${prettyEnd}`, left, 46);
  doc.text(`Books: ${values.startBook} - ${values.endBook}`, left, 58);

  const statWidth = 92;
  const statGap = 8;
  const statY = 24;
  const firstStatX = right - (statWidth * 3 + statGap * 2);
  drawPdfStatCard(doc, firstStatX, statY, statWidth, "Days", result.totalDays);
  drawPdfStatCard(
    doc,
    firstStatX + statWidth + statGap,
    statY,
    statWidth,
    "Chapters",
    result.selectedCount
  );
  drawPdfStatCard(
    doc,
    firstStatX + (statWidth + statGap) * 2,
    statY,
    statWidth,
    "Avg / day",
    avgMinutes ? `~${avgMinutes} min` : "n/a"
  );

  doc.moveTo(left, 72).lineTo(right, 72).strokeColor("#d7dde5").lineWidth(1).stroke();
  return 80;
}

function drawPdfColumnLabels(doc, columns, y, columnWidth) {
  columns.forEach((x) => {
    doc.save();
    doc.roundedRect(x, y, columnWidth, 16, 5).fillAndStroke("#eff4fb", "#d7dde5");
    doc
      .fillColor("#64748b")
      .fontSize(7)
      .text("Done   Date / Reading", x + 7, y + 4.5, { width: columnWidth - 14 });
    doc.restore();
  });

  return y + 20;
}

function getPdfEntryText(entry) {
  const readingText = entry.chaptersCount > 0 ? entry.reading : "Buffer day";
  const metaText =
    entry.chaptersCount > 0
      ? `${entry.chaptersCount} chapter${entry.chaptersCount === 1 ? "" : "s"} | ~${
          entry.minutes
        } min`
      : "No assigned chapters";

  return { readingText, metaText, dateText: entry.date };
}

function getPdfEntryLayout(doc, entry, width) {
  const { readingText, metaText, dateText } = getPdfEntryText(entry);
  const metrics = {
    topBandHeight: 11,
    sideRailWidth: 4,
    checkboxSize: 8,
    checkboxY: 5,
    checkboxGap: 5,
    innerX: 8,
    headerY: 5,
    headerGap: 4,
    readingGap: 4,
    metaPaddingX: 4,
    metaPaddingY: 2,
    bottomPadding: 6,
    minHeight: 46,
    dateFontSize: 6.3,
    readingFontSize: 7.8,
    readingLineGap: 0.2,
    metaFontSize: 6.2,
  };

  const textWidth = width - metrics.innerX * 2;
  const dateX = metrics.innerX + metrics.checkboxSize + metrics.checkboxGap;
  const dateWidth = width - dateX - metrics.innerX;
  const metaTextWidth = textWidth - metrics.metaPaddingX * 2;

  doc.font("Helvetica").fontSize(metrics.dateFontSize);
  const dateHeight = doc.heightOfString(dateText, { width: dateWidth, lineGap: 0 });

  doc.font("Helvetica-Bold").fontSize(metrics.readingFontSize);
  const readingHeight = doc.heightOfString(readingText, {
    width: textWidth,
    lineGap: metrics.readingLineGap,
  });

  doc.font("Helvetica").fontSize(metrics.metaFontSize);
  const metaHeight = doc.heightOfString(metaText, {
    width: metaTextWidth,
    lineGap: 0,
    align: "left",
  });

  const dateY = metrics.headerY;
  const headerHeight = Math.max(metrics.checkboxSize, dateHeight);
  const readingY = dateY + headerHeight + metrics.headerGap;
  const metaY = readingY + readingHeight + metrics.readingGap;
  const metaBoxHeight = metaHeight + metrics.metaPaddingY * 2;
  const cardHeight = Math.max(
    metrics.minHeight,
    metaY + metaBoxHeight + metrics.bottomPadding
  );

  return {
    ...metrics,
    dateText,
    readingText,
    metaText,
    textWidth,
    dateX,
    dateWidth,
    metaTextWidth,
    dateHeight,
    headerHeight,
    readingHeight,
    metaHeight,
    metaBoxHeight,
    dateY,
    readingY,
    metaY,
    cardHeight,
  };
}

function measurePdfEntryHeight(doc, entry, width) {
  return getPdfEntryLayout(doc, entry, width).cardHeight;
}

function drawPdfEntry(doc, entry, x, y, width, index) {
  const cardFill = index % 2 === 0 ? "#ffffff" : "#f9fbfd";
  const accentFill = entry.chaptersCount > 0 ? "#9ab0cb" : "#c2ccd8";
  const metaFill = entry.chaptersCount > 0 ? "#eef3f8" : "#f4f6f8";
  const layout = getPdfEntryLayout(doc, entry, width);

  doc.save();
  doc.roundedRect(x, y, width, layout.cardHeight, 9).fillAndStroke(cardFill, "#d5dde7");
  doc
    .roundedRect(x + 1.5, y + 1.5, width - 3, layout.topBandHeight, 7)
    .fill("#f4f7fa");
  doc
    .roundedRect(x + 1.5, y + 1.5, layout.sideRailWidth, layout.cardHeight - 3, 4)
    .fill(accentFill);
  doc
    .roundedRect(
      x + layout.innerX,
      y + layout.headerY,
      layout.checkboxSize,
      layout.checkboxSize,
      3
    )
    .lineWidth(0.8)
    .stroke("#9daab8");
  doc
    .font("Helvetica")
    .fillColor("#0f172a")
    .fontSize(layout.dateFontSize)
    .text(layout.dateText, x + layout.dateX, y + layout.dateY, {
      width: layout.dateWidth,
      align: "left",
      lineGap: 0,
    });
  doc
    .font("Helvetica-Bold")
    .fillColor("#111827")
    .fontSize(layout.readingFontSize)
    .text(layout.readingText, x + layout.innerX, y + layout.readingY, {
      width: layout.textWidth,
      lineGap: layout.readingLineGap,
    });
  doc
    .roundedRect(
      x + layout.innerX,
      y + layout.metaY,
      layout.textWidth,
      layout.metaBoxHeight,
      5
    )
    .fill(metaFill);
  doc
    .font("Helvetica")
    .fillColor("#596474")
    .fontSize(layout.metaFontSize)
    .text(
      layout.metaText,
      x + layout.innerX + layout.metaPaddingX,
      y + layout.metaY + layout.metaPaddingY,
      {
        width: layout.metaTextWidth,
        align: "left",
        lineGap: 0,
      }
    );
  doc.restore();

  // Reset the base font after custom card styling so later text uses a consistent default.
  doc.font("Helvetica");

  return layout.cardHeight;
}

app.get("/", (req, res) => {
  const values = getFormValues();
  renderIndex(res, { values });
});

app.get("/schedule", (req, res) => {
  const values = getFormValues(req.query);
  const result = buildSchedule(
    values.startDate,
    values.endDate,
    values.startBook,
    values.endBook
  );

  if (result.error) {
    return renderIndex(res, {
      status: 400,
      error: result.error,
      values,
    });
  }

  return renderIndex(res, {
    values,
    schedule: result.schedule,
    result,
  });
});

app.get("/download", (req, res) => {
  const values = getFormValues(req.query);
  const result = buildSchedule(
    values.startDate,
    values.endDate,
    values.startBook,
    values.endBook
  );

  if (result.error) {
    return renderIndex(res, {
      status: 400,
      error: result.error,
      values,
    });
  }

  const doc = new PDFDocument({ margin: 24, size: "A4" });
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=bible-reading-schedule.pdf"
  );
  res.setHeader("Content-Type", "application/pdf");
  doc.pipe(res);

  const columnCount = 4;
  const columnGap = 6;
  const rowGap = 5;
  const usableWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const columnWidth =
    (usableWidth - columnGap * (columnCount - 1)) / columnCount;
  const columns = Array.from({ length: columnCount }, (_, idx) => {
    return doc.page.margins.left + idx * (columnWidth + columnGap);
  });
  const avgMinutes = averageMinutes(result.schedule);
  let currentY = 0;

  const resetGrid = (compact) => {
    const startY = drawPdfPageHeader(doc, values, result, avgMinutes, compact);
    const contentStartY = drawPdfColumnLabels(doc, columns, startY, columnWidth);
    currentY = contentStartY;
  };

  resetGrid(false);

  for (let index = 0; index < result.schedule.length; index += columnCount) {
    const rowEntries = result.schedule.slice(index, index + columnCount);
    const rowHeight = Math.max(
      ...rowEntries.map((entry) => measurePdfEntryHeight(doc, entry, columnWidth))
    );
    const pageBottom = doc.page.height - doc.page.margins.bottom;

    if (currentY + rowHeight > pageBottom) {
      doc.addPage({ margin: 24, size: "A4" });
      resetGrid(true);
    }

    rowEntries.forEach((entry, colIndex) => {
      drawPdfEntry(doc, entry, columns[colIndex], currentY, columnWidth, index + colIndex);
    });

    currentY += rowHeight + rowGap;
  }

  doc.end();
});

app.get("/download/calendar", (req, res) => {
  const values = getFormValues(req.query);
  const result = buildSchedule(
    values.startDate,
    values.endDate,
    values.startBook,
    values.endBook
  );

  if (result.error) {
    return renderIndex(res, {
      status: 400,
      error: result.error,
      values,
    });
  }

  const validation = validateCalendarOptions(values);
  if (validation.error) {
    return renderIndex(res, {
      status: 400,
      error: validation.error,
      values,
      schedule: result.schedule,
      result,
    });
  }

  const fileNameSuffix =
    validation.calendarConfig.platform === "android" ? "android" : "ios";
  const calendarFile = buildCalendarFile(
    result.schedule,
    values,
    validation.calendarConfig
  );

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=bible-reading-schedule-${fileNameSuffix}.ics`
  );
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.send(calendarFile);
});

app.use((req, res) => {
  const values = getFormValues();
  renderIndex(res, {
    status: 404,
    error: "That route was not found. Use the form to generate a schedule.",
    values,
  });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Bible reading schedule generator listening on port ${port}`);
  });
}

module.exports = app;
