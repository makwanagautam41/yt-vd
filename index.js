import ytdlp from "yt-dlp-exec";
import path from "path";
import fs from "fs";
import readline from "readline";
import { spawn } from "child_process";

// ================== CONFIGURATION ==================
const CONFIG = {
  downloadsDir: path.join(process.cwd(), "downloads"),
  defaultQuality: "best",
  qualities: {
    360: {
      format: "bestvideo[height<=360]+bestaudio/best",
      label: "Low (360p)",
    },
    480: {
      format: "bestvideo[height<=480]+bestaudio/best",
      label: "SD (480p)",
    },
    720: {
      format: "bestvideo[height<=720]+bestaudio/best",
      label: "HD (720p)",
    },
    1080: {
      format: "bestvideo[height<=1080]+bestaudio/best",
      label: "Full HD (1080p)",
    },
    1440: {
      format: "bestvideo[height<=1440]+bestaudio/best",
      label: "2K (1440p)",
    },
    2160: {
      format: "bestvideo[height<=2160]+bestaudio/best",
      label: "4K (2160p)",
    },
    audio: { format: "bestaudio/best", label: "Audio Only (Best Quality)" },
    best: {
      format: "bestvideo+bestaudio/best",
      label: "Best Available Quality",
    },
  },
};

// ================== UTILITY FUNCTIONS ==================

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m
      .toString()
      .padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function createProgressBar(percentage, width = 40) {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

function clearLine() {
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
}

function printHeader(text) {
  const line = "=".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(line);
}

function printMessage(type, message) {
  const icons = {
    success: "✓",
    error: "✗",
    info: "ℹ",
    warning: "⚠",
    download: "⬇",
    processing: "⚙",
  };
  const icon = icons[type] || "•";
  console.log(`${icon} ${message}`);
}

function ensureDownloadDirectory() {
  if (!fs.existsSync(CONFIG.downloadsDir)) {
    fs.mkdirSync(CONFIG.downloadsDir, { recursive: true });
    printMessage(
      "success",
      `Created downloads directory: ${CONFIG.downloadsDir}`
    );
  }
}

function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function displayQualityOptions() {
  printHeader("Available Quality Options");
  let index = 1;
  for (const [key, value] of Object.entries(CONFIG.qualities)) {
    console.log(`  ${index}. ${value.label} (${key})`);
    index++;
  }
  console.log();
}

async function getVideoInfo(url) {
  printMessage("info", "Fetching video information...");

  try {
    const info = await ytdlp(url, {
      dumpSingleJson: true,
      skipDownload: true,
      noPlaylist: true,
    });

    printHeader("Video Information");
    console.log(`  Title:        ${info.title || "Unknown"}`);
    console.log(
      `  Channel:      ${info.uploader || info.channel || "Unknown"}`
    );
    console.log(`  Duration:     ${formatTime(info.duration)}`);
    console.log(
      `  Views:        ${info.view_count?.toLocaleString() || "Unknown"}`
    );
    console.log(
      `  Upload Date:  ${
        info.upload_date
          ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(
              4,
              6
            )}-${info.upload_date.slice(6, 8)}`
          : "Unknown"
      }`
    );
    console.log(`  Video ID:     ${info.id || "Unknown"}`);

    // Show available formats
    if (info.formats && info.formats.length > 0) {
      const videoFormats = info.formats
        .filter((f) => f.height)
        .sort((a, b) => b.height - a.height);
      if (videoFormats.length > 0) {
        const maxHeight = videoFormats[0].height;
        printMessage("info", `Maximum available quality: ${maxHeight}p`);
      }
    }
    console.log();

    return info;
  } catch (error) {
    printMessage("error", `Failed to fetch video info: ${error.message}`);
    throw error;
  }
}

async function downloadVideo(url, quality, outputPath) {
  const format =
    CONFIG.qualities[quality]?.format || CONFIG.qualities.best.format;

  printHeader("Download Progress");
  printMessage(
    "download",
    `Quality: ${CONFIG.qualities[quality]?.label || "Best Available"}`
  );
  printMessage("download", `Format: ${format}`);
  printMessage("info", `Output: ${outputPath}`);
  console.log();

  const downloadStartTime = Date.now();
  let lastProgress = -1;
  let isDownloading = false;
  let isMerging = false;

  return new Promise(async (resolve, reject) => {
    // Get yt-dlp executable path from the package
    let ytdlpPath;
    try {
      // Try to import the binary path from yt-dlp-exec
      const { default: ytdlpBinary } = await import("yt-dlp-exec");
      ytdlpPath = ytdlpBinary.path;

      // If path is not available, try to find it in node_modules
      if (!ytdlpPath) {
        const isWindows = process.platform === "win32";
        const binaryName = isWindows ? "yt-dlp.exe" : "yt-dlp";
        ytdlpPath = path.join(
          process.cwd(),
          "node_modules",
          "yt-dlp-exec",
          "bin",
          binaryName
        );
      }

      printMessage("info", `Using yt-dlp from: ${ytdlpPath}`);
    } catch (error) {
      reject(
        new Error(
          "Could not find yt-dlp executable. Make sure yt-dlp-exec is installed."
        )
      );
      return;
    }

    // Prepare arguments
    const args = [
      url,
      "--format",
      format,
      "--output",
      outputPath,
      "--merge-output-format",
      quality === "audio" ? "mp3" : "mp4",
      "--newline",
      "--no-playlist",
    ];

    // Add metadata for audio
    if (quality === "audio") {
      args.push("--embed-thumbnail", "--embed-metadata", "--add-metadata");
    }

    // Try to find ffmpeg
    const ffmpegLocations = [
      path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe"),
      path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
      path.join(
        process.cwd(),
        "node_modules",
        "@ffmpeg-installer",
        "win32-x64",
        "ffmpeg.exe"
      ),
      path.join(
        process.cwd(),
        "node_modules",
        "@ffmpeg-installer",
        "darwin-x64",
        "ffmpeg"
      ),
      path.join(
        process.cwd(),
        "node_modules",
        "@ffmpeg-installer",
        "linux-x64",
        "ffmpeg"
      ),
    ];

    let ffmpegPath = null;
    for (const location of ffmpegLocations) {
      if (fs.existsSync(location)) {
        ffmpegPath = location;
        break;
      }
    }

    if (ffmpegPath) {
      args.push("--ffmpeg-location", ffmpegPath);
      printMessage("info", `Using ffmpeg from: ${ffmpegPath}`);
    } else {
      printMessage(
        "warning",
        "ffmpeg not found - will download best single format without merging"
      );
      // Remove merge format and use single format
      const mergeIndex = args.indexOf("--merge-output-format");
      if (mergeIndex !== -1) {
        args.splice(mergeIndex, 2);
      }
      // Change format to single file format
      const formatIndex = args.indexOf("--format");
      if (formatIndex !== -1 && quality !== "audio") {
        args[formatIndex + 1] = `best[height<=${quality}]/best`;
      }
    }

    printMessage("info", "Starting download...");
    console.log();

    // Check if the executable exists
    if (!fs.existsSync(ytdlpPath)) {
      reject(new Error(`yt-dlp executable not found at: ${ytdlpPath}`));
      return;
    }

    // Spawn the process
    const childProcess = spawn(ytdlpPath, args);

    childProcess.stdout.on("data", (data) => {
      const output = data.toString();
      const lines = output.split("\n");

      for (const line of lines) {
        if (!line.trim()) continue;

        // Download progress
        const downloadMatch = line.match(/\[download\]\s+(\d+\.?\d*)%/);
        if (downloadMatch) {
          isDownloading = true;
          const progress = parseFloat(downloadMatch[1]);

          // Extract additional info
          const sizeMatch = line.match(/of\s+~?\s*(\S+)/);
          const speedMatch = line.match(/at\s+(\S+\/s)/);
          const etaMatch = line.match(/ETA\s+(\S+)/);

          if (
            Math.floor(progress) !== Math.floor(lastProgress) ||
            progress === 100
          ) {
            clearLine();
            let statusLine = `  ${createProgressBar(
              progress
            )} ${progress.toFixed(1)}%`;

            if (speedMatch) statusLine += ` | Speed: ${speedMatch[1]}`;
            if (etaMatch && etaMatch[1] !== "Unknown")
              statusLine += ` | ETA: ${etaMatch[1]}`;
            if (sizeMatch) statusLine += ` | Size: ${sizeMatch[1]}`;

            process.stdout.write(statusLine);
            lastProgress = progress;
          }
        }

        // Destination message
        if (line.includes("[download] Destination:") && !isDownloading) {
          printMessage("info", "Download initialized successfully");
        }

        // Download completed
        if (
          line.includes("[download] 100%") ||
          line.includes("has already been downloaded")
        ) {
          if (!isMerging) {
            console.log();
            printMessage("success", "Download completed!");
          }
        }

        // Merging/Post-processing
        if (line.includes("[Merger]") || line.includes("[ffmpeg]")) {
          if (!isMerging) {
            console.log();
            printMessage("processing", "Merging video and audio streams...");
            isMerging = true;
          }
        }

        // Post-processing
        if (line.includes("Deleting original file")) {
          printMessage("info", "Cleaning up temporary files...");
        }

        // Embedding metadata
        if (line.includes("[EmbedThumbnail]") || line.includes("[Metadata]")) {
          printMessage("processing", "Embedding metadata...");
        }
      }
    });

    childProcess.stderr.on("data", (data) => {
      const error = data.toString();
      if (error.includes("ERROR")) {
        console.log();
        if (error.includes("ffmpeg")) {
          printMessage(
            "warning",
            "ffmpeg not available - downloading best single format"
          );
        } else {
          printMessage("error", error.trim());
        }
      } else if (
        error.includes("WARNING") &&
        error.includes("unable to download")
      ) {
        console.log();
        printMessage("warning", error.trim());
      }
    });

    childProcess.on("close", (code) => {
      console.log();

      if (code === 0 || code === 1) {
        // Code 1 might be ffmpeg warning but file still downloaded
        const downloadTime = ((Date.now() - downloadStartTime) / 1000).toFixed(
          2
        );

        if (code === 1 && isMerging) {
          printMessage(
            "warning",
            `Download completed with warnings in ${downloadTime} seconds`
          );
          printMessage(
            "info",
            "Video and audio may be in separate files or lower quality"
          );
        } else {
          printMessage(
            "success",
            `All operations completed in ${downloadTime} seconds!`
          );
        }

        // Verify file exists
        const baseFileName = path.basename(
          outputPath,
          path.extname(outputPath)
        );
        const ext = quality === "audio" ? ".mp3" : ".mp4";
        const possibleFiles = [
          outputPath,
          path.join(CONFIG.downloadsDir, `${baseFileName}${ext}`),
          path.join(CONFIG.downloadsDir, `${baseFileName}.webm`),
          path.join(CONFIG.downloadsDir, `${baseFileName}.mkv`),
        ];

        let foundFile = null;
        for (const file of possibleFiles) {
          if (fs.existsSync(file)) {
            foundFile = file;
            break;
          }
        }

        if (foundFile) {
          const stats = fs.statSync(foundFile);
          const fileName = path.basename(foundFile);
          printMessage("success", `File saved: ${fileName}`);
          printMessage("info", `File size: ${formatBytes(stats.size)}`);
          printMessage("info", `Location: ${foundFile}`);
        } else {
          printMessage(
            "warning",
            "Download completed but file location could not be verified"
          );
          printMessage("info", `Check folder: ${CONFIG.downloadsDir}`);

          // List all files in downloads directory
          try {
            const allFiles = fs.readdirSync(CONFIG.downloadsDir);
            if (allFiles.length > 0) {
              console.log("\nFiles in downloads folder:");
              allFiles.forEach((file) => {
                const filePath = path.join(CONFIG.downloadsDir, file);
                const stats = fs.statSync(filePath);
                console.log(`  • ${file} (${formatBytes(stats.size)})`);
              });
            }
          } catch (err) {
            // Ignore
          }
        }

        if (code === 1) {
          console.log();
          printMessage(
            "info",
            "To enable video+audio merging, install ffmpeg:"
          );
          printMessage("info", "npm install ffmpeg-static");
          printMessage(
            "info",
            "or download from: https://ffmpeg.org/download.html"
          );
        }

        resolve();
      } else {
        reject(new Error(`yt-dlp process exited with code ${code}`));
      }
    });

    childProcess.on("error", (error) => {
      console.log();
      reject(error);
    });
  });
}

// ================== MAIN APPLICATION ==================

async function main() {
  console.clear();
  printHeader("Advanced YouTube Video Downloader");

  try {
    ensureDownloadDirectory();

    const videoUrl = await promptUser("Enter YouTube video URL: ");

    if (!videoUrl) {
      printMessage("error", "No URL provided!");
      process.exit(1);
    }

    printMessage("info", `Processing URL: ${videoUrl}`);

    const videoInfo = await getVideoInfo(videoUrl);

    displayQualityOptions();

    const qualityInput = await promptUser(
      "Enter quality (360/480/720/1080/1440/2160/audio/best) or number [default: best]: "
    );

    let quality = qualityInput.toLowerCase() || "best";

    const qualityKeys = Object.keys(CONFIG.qualities);
    const qualityIndex = parseInt(qualityInput) - 1;
    if (qualityIndex >= 0 && qualityIndex < qualityKeys.length) {
      quality = qualityKeys[qualityIndex];
    }

    if (!CONFIG.qualities[quality]) {
      printMessage(
        "warning",
        `Invalid quality "${quality}", using "best" instead`
      );
      quality = "best";
    }

    const sanitizedTitle = videoInfo.title
      .replace(/[<>:"/\\|?*]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 200);

    const ext = quality === "audio" ? "mp3" : "mp4";
    const outputPath = path.join(
      CONFIG.downloadsDir,
      `${sanitizedTitle}.%(ext)s`
    );

    await downloadVideo(videoUrl, quality, outputPath);

    printHeader("Download Summary");
    printMessage("success", "All operations completed successfully!");
    console.log();
  } catch (error) {
    console.log();
    printMessage("error", `An error occurred: ${error.message}`);
    console.error("\nFull error details:");
    console.error(error);
    process.exit(1);
  }
}

// ================== RUN APPLICATION ==================

main().catch((error) => {
  printMessage("error", `Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
