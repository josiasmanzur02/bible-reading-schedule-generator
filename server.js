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
      schedule.push({ date: label, reading: formatRange(startRef, endRef) });
    } else {
      schedule.push({ date: label, reading: "—" });
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

  doc.fontSize(20).text("Bible Reading Schedule", { align: "left" });
  doc.moveDown(0.3);
  doc.fontSize(12).text(`Start date: ${prettyStart}`);
  doc.text(`End date: ${prettyEnd}`);
  doc.text(`Books: ${startBook} - ${endBook}`);
  doc.text(`Chapters in range: ${result.selectedCount} of ${totalChapters}`);
  doc.text(`Days: ${result.totalDays}`);
  doc.moveDown();

  const drawHeader = () => {
    const y = doc.y;
    doc.fontSize(11).text("Done", 50, y, { width: 30 });
    doc.text("Date", 90, y, { width: 80 });
    doc.text("Reading", 180, y, { width: 350 });
    doc.moveTo(50, y + 14).lineTo(540, y + 14).strokeColor("#cccccc").stroke();
    doc.moveDown(0.6);
  };

  drawHeader();

  result.schedule.forEach((entry) => {
    if (doc.y > doc.page.height - 80) {
      doc.addPage();
      drawHeader();
    }
    const rowY = doc.y;
    doc.rect(50, rowY - 2, 10, 10).strokeColor("#555555").stroke();
    doc.fontSize(10).fillColor("#111111");
    doc.text(entry.date, 90, rowY, { width: 80 });
    doc.text(entry.reading, 180, rowY, { width: 330 });
    doc.moveDown(0.5);
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
