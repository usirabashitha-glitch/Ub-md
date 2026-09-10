const express = require("express");
const app = express();
const path = require("path");
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;

// 1. Pela awurudu weda - Body parser pahala danna
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 2. Static files - css, js, images
app.use(express.static(path.join(__dirname)));

// 3. Pair route eka
let code = require("./pair");
app.use("/code", code);

// 4. HTML page eka serve karanna
app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "pair.html"));
});

// 5. Error handling
app.use((req, res) => {
    res.status(404).send("404 Not Found");
});

require("events").EventEmitter.defaultMaxListeners = 500;

app.listen(PORT, () => {
  console.log(`⏩ Server running on http://localhost:${PORT}`);
});

module.exports = app;
