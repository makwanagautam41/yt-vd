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

function isUsableVideoFormat(format) {
  return format.height && format.vcodec && format.vcodec !== "none";
}

function hasAudio(format) {
  return format.acodec && format.acodec !== "none";
}

function getApproxFormatSize(format) {
  return format.filesize || format.filesize_approx || 0;
}

function getFormatScore(format) {
  return (
    (format.quality || 0) * 1000000 +
    (format.tbr || format.vbr || 0) * 1000 +
    (format.fps || 0) * 10 +
    getApproxFormatSize(format)
  );
}

function pickBestFormat(formats) {
  return [...formats].sort((a, b) => getFormatScore(b) - getFormatScore(a))[0];
}

function pickBestAudioFormat(formats) {
  return [...formats]
    .filter((format) => hasAudio(format) && (!format.vcodec || format.vcodec === "none"))
    .sort((a, b) => {
      const aScore = (a.abr || a.tbr || 0) * 1000 + getApproxFormatSize(a);
      const bScore = (b.abr || b.tbr || 0) * 1000 + getApproxFormatSize(b);
      return bScore - aScore;
    })[0];
}

function getQualityLabel(height) {
  const configuredLabel = CONFIG.qualities[height]?.label;
  return configuredLabel || `${height}p`;
}

function createExactHeightFormat(height, videoFormat, audioFormat) {
  const formatSelectors = [];

  if (videoFormat?.format_id && audioFormat?.format_id && !hasAudio(videoFormat)) {
    formatSelectors.push(`${videoFormat.format_id}+${audioFormat.format_id}`);
  }

  if (videoFormat?.format_id) {
    formatSelectors.push(videoFormat.format_id);
  }

  formatSelectors.push(
    `bestvideo[height=${height}]+bestaudio/best[height=${height}]`
  );

  return formatSelectors.join("/");
}

function buildAvailableQualityOptions(info) {
  const videoFormats = (info.formats || []).filter(isUsableVideoFormat);
  const formatsByHeight = new Map();

  for (const format of videoFormats) {
    const height = Number(format.height);
    if (!formatsByHeight.has(height)) {
      formatsByHeight.set(height, []);
    }
    formatsByHeight.get(height).push(format);
  }

  const videoOptions = [...formatsByHeight.entries()]
    .sort(([heightA], [heightB]) => heightB - heightA)
    .map(([height, formats]) => {
      const bestVideoFormat = pickBestFormat(formats);
      const bestAudioFormat = pickBestAudioFormat(info.formats || []);
      const maxFps = Math.max(...formats.map((format) => format.fps || 0));
      const bestSize = Math.max(...formats.map(getApproxFormatSize));
      const exts = [...new Set(formats.map((format) => format.ext).filter(Boolean))];
      const progressiveCount = formats.filter(hasAudio).length;
      const details = [
        maxFps ? `${maxFps}fps` : null,
        bestVideoFormat?.format_id ? `format ${bestVideoFormat.format_id}` : null,
        exts.length ? exts.join("/") : null,
        bestSize ? `~${formatBytes(bestSize)}` : null,
        progressiveCount ? "single file available" : "video+audio merge",
      ].filter(Boolean);

      return {
        key: String(height),
        type: "video",
        height,
        label: getQualityLabel(height),
        format: createExactHeightFormat(height, bestVideoFormat, bestAudioFormat),
        details,
      };
    });

  return [
    ...videoOptions,
    {
      key: "audio",
      type: "audio",
      label: CONFIG.qualities.audio.label,
      format: CONFIG.qualities.audio.format,
      details: ["best audio stream"],
    },
    {
      key: "best",
      type: "best",
      label: CONFIG.qualities.best.label,
      format: CONFIG.qualities.best.format,
      details: ["highest quality yt-dlp can combine"],
    },
  ];
}

function displayQualityOptions(qualityOptions) {
  printHeader("Available Quality Options");
  qualityOptions.forEach((option, index) => {
    const details = option.details?.length ? ` - ${option.details.join(", ")}` : "";
    console.log(`  ${index + 1}. ${option.label} (${option.key})${details}`);
  });
  console.log();
}

function resolveQualitySelection(input, qualityOptions) {
  const selection = input.trim().toLowerCase();
  if (!selection) {
    return qualityOptions.find((option) => option.key === CONFIG.defaultQuality);
  }

  const selectedIndex = Number.parseInt(selection, 10) - 1;
  if (
    Number.isInteger(selectedIndex) &&
    selectedIndex >= 0 &&
    selectedIndex < qualityOptions.length
  ) {
    return qualityOptions[selectedIndex];
  }

  const normalizedSelection = selection.endsWith("p")
    ? selection.slice(0, -1)
    : selection;

  return qualityOptions.find((option) => option.key === normalizedSelection);
}

async function getVideoInfo(url) {
  printMessage("info", "Fetching video information...");

  try {
    const info = await ytdlp(url, {
      dumpSingleJson: true,
      skipDownload: true,
      noPlaylist: true,
      jsRuntimes: "node",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      noCheckCertificates: true,
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
      `  Upload Date:  ${info.upload_date
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

async function downloadVideo(url, qualityOption, outputPath) {
  const quality = qualityOption?.key || CONFIG.defaultQuality;
  const format = qualityOption?.format || CONFIG.qualities.best.format;
  const qualityLabel =
    qualityOption?.label || CONFIG.qualities[quality]?.label || "Best Available";

  printHeader("Download Progress");
  printMessage("download", `Quality: ${qualityLabel}`);
  printMessage("download", `Format: ${format}`);
  printMessage("info", `Output: ${outputPath}`);
  console.log();

  const downloadStartTime = Date.now();
  let lastProgress = -1;
  let isDownloading = false;
  let isMerging = false;

  return new Promise(async (resolve, reject) => {
    // RESOLVE BINARY PATHS
    // -------------------

    // 1. Find yt-dlp executable
    const isWindows = process.platform === "win32";
    const binaryName = isWindows ? "yt-dlp.exe" : "yt-dlp";
    const localBinPath = path.join(process.cwd(), "node_modules", "yt-dlp-exec", "bin", binaryName);

    let ytdlpPath = localBinPath;
    if (!fs.existsSync(ytdlpPath)) {
      // Fallback or error
      try {
        // Try resolving via package if local file missing (backup method)
        const ytdlpExec = await import("yt-dlp-exec");
        if (ytdlpExec.default && ytdlpExec.default.path) {
          ytdlpPath = ytdlpExec.default.path;
        }
      } catch (e) {
        // Ignore
      }
    }

    if (!fs.existsSync(ytdlpPath)) {
      reject(new Error(`yt-dlp executable not found. Please run 'npm run update-ytdlp'`));
      return;
    }

    printMessage("info", `Using yt-dlp from: ${ytdlpPath}`);

    // 2. Find ffmpeg executable
    const ffmpegLocations = [
      path.join(process.cwd(), "node_modules", "ffmpeg-static", isWindows ? "ffmpeg.exe" : "ffmpeg"),
      path.join(process.cwd(), "node_modules", "ffmpeg-static", "bin", isWindows ? "ffmpeg.exe" : "ffmpeg"), // some versions have bin
      path.join(process.cwd(), "ffmpeg", isWindows ? "ffmpeg.exe" : "ffmpeg"),
    ];

    // Add env path or other common locations if needed

    let ffmpegPath = null;
    for (const location of ffmpegLocations) {
      if (fs.existsSync(location)) {
        ffmpegPath = location;
        break;
      }
    }

    // CONSTRUCT ARGUMENTS
    // -------------------

    const args = [
      url,
      "--format", format,
      "--output", outputPath,
      "--newline",
      "--no-playlist",
      "--no-check-certificates",
      "--js-runtimes", "node",

      // Anti-bot Bypass Options
      "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",

      // Network/Retry Options
      "--retries", "10",
      "--fragment-retries", "10",
      "--retry-sleep", "3",
      "--concurrent-fragments", "5",
      "--throttled-rate", "100K",
    ];

    // Merge Format Logic
    if (ffmpegPath) {
      args.push("--ffmpeg-location", ffmpegPath);
      if (quality !== "audio") {
        args.push("--merge-output-format", "mkv");
      }
      printMessage("info", `Using ffmpeg from: ${ffmpegPath}`);
    } else {
      printMessage("warning", "ffmpeg not found - will download best single format without merging");
      // Simplify format if no ffmpeg
      if (qualityOption?.type === "video") {
        // Replace the format arg we added earlier
        const fmtIndex = args.indexOf("--format");
        if (fmtIndex !== -1) {
          args[fmtIndex + 1] = `best[height=${quality}]`;
        }
      }
    }

    // Metadata
    if (quality === "audio") {
      args.push("--embed-thumbnail", "--embed-metadata", "--add-metadata");
    }

    printMessage("info", "Starting download...");
    console.log();


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

      if (code === 0) {
        const downloadTime = ((Date.now() - downloadStartTime) / 1000).toFixed(
          2
        );

        printMessage(
          "success",
          `All operations completed in ${downloadTime} seconds!`
        );

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

    const qualityOptions = buildAvailableQualityOptions(videoInfo);
    displayQualityOptions(qualityOptions);

    const qualityInput = await promptUser(
      "Enter an available quality, audio, best, or number [default: best]: "
    );

    let selectedQuality = resolveQualitySelection(qualityInput, qualityOptions);

    if (!selectedQuality) {
      printMessage(
        "warning",
        `Invalid or unavailable quality "${qualityInput}", using "best" instead`
      );
      selectedQuality = qualityOptions.find((option) => option.key === "best");
    }

    const sanitizedTitle = videoInfo.title
      .replace(/[<>:"/\\|?*]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 200);

    const ext = selectedQuality.key === "audio" ? "mp3" : "mp4";
    const outputPath = path.join(
      CONFIG.downloadsDir,
      `${sanitizedTitle}.%(ext)s`
    );

    await downloadVideo(videoUrl, selectedQuality, outputPath);

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
