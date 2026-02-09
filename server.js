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

function pickChapters(startBookName, endBookName) {
  const startIdx = bibleBooks.findIndex((b) => b.name === startBookName);
  const endIdx = bibleBooks.findIndex((b) => b.name === endBookName);

  if (startIdx === -1 || endIdx === -1) {
    return { error: "Please choose valid start and end books." };
  }
  if (endIdx < startIdx) {
    return { error: "End book must be the same or come after the start book." };
  }

  const selected = chapters.filter(
    (c) => c.bookIndex >= startIdx && c.bookIndex <= endIdx
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
    const label = startDate.add(day, "day").format("MMM D, YYYY");
    const startIdx = Math.floor((day * selectedCount) / totalDays);
    const endIdx = Math.floor(((day + 1) * selectedCount) / totalDays) - 1;

    if (endIdx >= startIdx) {
      const startRef = selected[startIdx];
      const endRef = selected[endIdx];
      const chaptersCount = endIdx - startIdx + 1;
      const minutes = Math.max(5, Math.round(chaptersCount * 4)); // rough estimate
      schedule.push({
        date: label,
        reading: formatRange(startRef, endRef),
        chaptersCount,
        minutes,
      });
    } else {
      schedule.push({ date: label, reading: "—", chaptersCount: 0, minutes: 0 });
    }
  }

  return { schedule, totalDays, selectedCount };
}

app.get("/", (req, res) => {
  res.render("index", {
    error: null,
    schedule: null,
    books: bibleBooks,
    values: {
      startDate: defaultStart,
      endDate: defaultEnd,
      startBook: defaultStartBook,
      endBook: defaultEndBook,
    },
    stats: { totalChapters, selectedChapters: totalChapters, totalDays: null },
  });
});

app.get("/schedule", (req, res) => {
  const start = req.query.startDate || defaultStart;
  const end = req.query.endDate || defaultEnd;
  const startBook = req.query.startBook || defaultStartBook;
  const endBook = req.query.endBook || defaultEndBook;
  const result = buildSchedule(start, end, startBook, endBook);

  const values = { startDate: start, endDate: end, startBook, endBook };

  if (result.error) {
    return res.status(400).render("index", {
      error: result.error,
      schedule: null,
      books: bibleBooks,
      values,
      stats: { totalChapters, selectedChapters: null, totalDays: null },
    });
  }

  return res.render("index", {
    error: null,
    schedule: result.schedule,
    books: bibleBooks,
    values,
    stats: {
      totalChapters,
      selectedChapters: result.selectedCount,
      totalDays: result.totalDays,
    },
  });
});

app.get("/download", (req, res) => {
  const start = req.query.startDate || defaultStart;
  const end = req.query.endDate || defaultEnd;
  const startBook = req.query.startBook || defaultStartBook;
  const endBook = req.query.endBook || defaultEndBook;
  const result = buildSchedule(start, end, startBook, endBook);
  const values = { startDate: start, endDate: end, startBook, endBook };

  if (result.error) {
    return res.status(400).render("index", {
      error: result.error,
      schedule: null,
      books: bibleBooks,
      values,
      stats: { totalChapters, selectedChapters: null, totalDays: null },
    });
  }

  const doc = new PDFDocument({ margin: 50, size: "A4" });
  res.setHeader("Content-Disposition", "attachment; filename=bible-reading-schedule.pdf");
  res.setHeader("Content-Type", "application/pdf");
  doc.pipe(res);

  const prettyStart = dayjs(values.startDate).format("MMM D, YYYY");
  const prettyEnd = dayjs(values.endDate).format("MMM D, YYYY");

  const avgMinutes =
    result.schedule.length && result.schedule.some((s) => s.minutes > 0)
      ? Math.round(
          result.schedule.reduce((sum, s) => sum + s.minutes, 0) /
            Math.max(1, result.schedule.filter((s) => s.minutes > 0).length)
        )
      : 0;

  doc.fontSize(20).text("Bible Reading Schedule", { align: "left" });
  doc.moveDown(0.3);
  doc.fontSize(12).text(`Start date: ${prettyStart}`);
  doc.text(`End date: ${prettyEnd}`);
  doc.text(`Books: ${startBook} - ${endBook}`);
  doc.text(`Chapters in range: ${result.selectedCount} of ${totalChapters}`);
  doc.text(`Days: ${result.totalDays}`);
  if (avgMinutes) {
    doc.text(`Approx. daily time: ~${avgMinutes} minutes`);
  }
  doc.moveDown();

  const columnWidth = 155;
  const gap = 10;
  const columns = [50, 50 + columnWidth + gap, 50 + 2 * (columnWidth + gap)];
  const textWidth = columnWidth - 32;

  const drawHeader = () => {
    const y0 = doc.y;
    columns.forEach((x) => {
      doc.save();
      doc.lineWidth(0.5).rect(x, y0, columnWidth, 22).fillAndStroke("#f2f2f2", "#cccccc");
      doc.fillColor("#111111").fontSize(10).text("Done   Date   Reading", x + 8, y0 + 6, {
        width: columnWidth - 16,
      });
      doc.restore();
    });
    doc.moveDown(0.5);
    return y0 + 26;
  };

  let y = drawHeader();
  let colIndex = 0;

  result.schedule.forEach((entry) => {
    const readingHeight = doc.heightOfString(entry.reading, { width: textWidth, align: "left" });
    const rowHeight = Math.max(32, readingHeight + 18);

    if (y + rowHeight > doc.page.height - 60) {
      doc.addPage();
      y = drawHeader();
      colIndex = 0;
    }

    const x = columns[colIndex];
    doc.lineWidth(0.5).rect(x, y, columnWidth, rowHeight).stroke("#cccccc");
    doc.rect(x + 8, y + 8, 12, 12).stroke("#777777");
    doc.fontSize(10).fillColor("#111111");
    doc.text(entry.date, x + 26, y + 6, { width: textWidth });
    doc.text(entry.reading, x + 26, y + 18, { width: textWidth });

    if (colIndex === columns.length - 1) {
      y += rowHeight + 8;
      colIndex = 0;
    } else {
      colIndex += 1;
    }
  });

  doc.end();
});

app.use((req, res) => {
  res.status(404).render("index", {
    error: "That route was not found. Use the form to generate a schedule.",
    schedule: null,
    books: bibleBooks,
    values: {
      startDate: defaultStart,
      endDate: defaultEnd,
      startBook: defaultStartBook,
      endBook: defaultEndBook,
    },
    stats: { totalChapters, selectedChapters: totalChapters, totalDays: null },
  });
});

app.listen(port, () => {
  console.log(`Bible reading schedule generator listening on port ${port}`);
});
