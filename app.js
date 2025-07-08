const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const bodyParser = require("body-parser");
const http = require("http");
const WebSocket = require("ws");
const ytdl = require("youtube-dl-exec");
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(bodyParser.urlencoded({ extended: true }));
app.use("/downloads", express.static(path.join(__dirname, "downloads")));
app.use(express.static(path.join(__dirname, "public")));

let clients = [];

wss.on("connection", (ws) => {
  clients.push(ws);
  ws.on("close", () => {
    clients = clients.filter((client) => client !== ws);
  });
});

function sendProgress(percent) {
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(percent);
    }
  });
}
function normalizeYouTubeUrl(url) {
  // Convert shorts URLs to standard
  if (url.includes("youtube.com/shorts/")) {
    const videoId = url.split("/shorts/")[1].split("?")[0];
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
  return url;
}
app.post("/info", express.urlencoded({ extended: true }), async (req, res) => {
  const url = req.body.url;
  try {
    const result = await ytdl(url, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
      noWarnings: true,
    });
    const info = typeof result === 'string' ? JSON.parse(result) : result;

    
    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
    });
  } catch (err) {
    console.error("Error fetching info:", err.message);
    res.status(500).json({ error: "Unable to fetch video info" });
  }
});

app.post("/download", async (req, res) => {
  const videoURL = req.body.url;
  const format = req.body.quality || "best";
  const filename = `video-${Date.now()}.mp4`;
  const output = path.join(__dirname, "downloads", filename);

  const ytdlp = spawn("yt-dlp", [
    "-f", format,
    "--merge-output-format", "mp4",
    "-o", output,
    videoURL,
  ]);

  ytdlp.stdout.on("data", (data) => {
    const line = data.toString();
    const match = line.match(/\[download\]\s+(\d+\.\d+)%/);

    if (match) {
      sendProgress(match[1]);
    }
  });

  ytdlp.on("close", () => {
    const files = fs.readdirSync(path.join(__dirname, "downloads"));
    const downloadedFile = files.find(file => file.startsWith(filename));

    if (downloadedFile) {
      const absolutePath = path.join(__dirname, "downloads", downloadedFile);
      const stats = fs.statSync(absolutePath);
      const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

      const fileInfo = {
        fileName: downloadedFile,
        fileSize: `${sizeInMB} MB`,
        filePath: `/downloads/${downloadedFile}`,
      };

      // sendProgress("done|/downloads/filename.mp4") → changed to JSON string
      sendProgress(`done|${JSON.stringify(fileInfo)}`);
      res.status(200).end();
    } else {
      sendProgress("error");
      res.status(500).send("Download failed");
    }
  });


});

server.listen(3000, () => {
  console.log("✅ Server running at http://localhost:3000");
});
