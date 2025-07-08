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

// WebSocket connections
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
  if (url.includes("youtube.com/shorts/")) {
    const videoId = url.split("/shorts/")[1].split("?")[0];
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
  return url;
}

// 📄 Get video info (title & thumbnail)
app.post("/info", express.urlencoded({ extended: true }), async (req, res) => {

  const url = normalizeYouTubeUrl(req.body.url);
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
    console.error("Error fetching info:", err);
    res.status(500).json({ error: "Unable to fetch video info" });
  }
});

// 📥 Handle download request
app.post("/download", async (req, res) => {
  try {
    const videoURL = normalizeYouTubeUrl(req.body.url);
    const format = req.body.quality || "best";
    const filename = `video-${Date.now()}.mp4`;
    const output = path.join(__dirname, "downloads", filename);

    // Make sure yt-dlp and ffmpeg are executable
    const ffmpegPath = path.join(__dirname, "ffmpeg");
    const ytDlpPath = path.join(__dirname, "yt-dlp");

    fs.chmodSync(ffmpegPath, 0o755);
    fs.chmodSync(ytDlpPath, 0o755);

    const ytdlp = spawn(ytDlpPath, [
      "-f", format,
      "--merge-output-format", "mp4",
      "--ffmpeg-location", ffmpegPath,
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

    ytdlp.stderr.on("data", (data) => {
      console.error(data.toString());
    });

    ytdlp.on("close", () => {
      if (fs.existsSync(output)) {
        const stats = fs.statSync(output);
        const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

        const fileInfo = {
          fileName: filename,
          fileSize: `${sizeInMB} MB`,
          filePath: `/download-file?file=${filename}`, // Updated path
        };

        sendProgress(`done|${JSON.stringify(fileInfo)}`);
        res.status(200).end();
      } else {
        sendProgress("error");
        res.status(500).send("Download failed");
      }
    });
  } catch (error) {
    console.error("Error in /download:", error);
    return res.status(500).send("Internal Server Error");

  }

});

// 📤 Serve + delete file on download
app.get("/download-file", (req, res) => {
  try {
    const filePath = path.join(__dirname, "downloads", req.query.file);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send("File not found");
    }

    res.download(filePath, (err) => {
      if (err) {
        console.error("Error sending file:", err.message);
      } else {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error("❌ Failed to delete:", unlinkErr.message);
          } else {
            console.log("✅ File deleted:", req.query.file);
          }
        });
      }
    });
  } catch (error) {
    console.error("Error in /download-file:", error);
    res.status(500).send("Internal Server Error");

  }

  // const filePath = path.join(__dirname, "downloads", req.query.file);

  // if (!fs.existsSync(filePath)) {
  //   return res.status(404).send("File not found");
  // }

  // res.download(filePath, (err) => {
  //   if (err) {
  //     console.error("Error sending file:", err.message);
  //   } else {
  //     fs.unlink(filePath, (unlinkErr) => {
  //       if (unlinkErr) {
  //         console.error("❌ Failed to delete:", unlinkErr.message);
  //       } else {
  //         console.log("✅ File deleted:", req.query.file);
  //       }
  //     });
  //   }
  // });
});

server.listen(3000, () => {
  console.log("✅ Server running at http://localhost:3000");
});
