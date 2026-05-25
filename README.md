# 🎥 YouTube Video Downloader (CLI)

Advanced command-line YouTube video downloader with real-time progress tracking.

The downloader fetches the selected video's real format list first, shows the
available video qualities for that URL, and lets you choose an exact quality
such as 1080p only when that quality exists for the video.

## 📦 Quick Setup

```bash
# Install dependencies
npm install

# Run downloader
node index.js
```

## 📁 Project Structure

```
yt-vd/
├── index.js           # Main CLI application
├── downloads/         # Downloaded videos (auto-created)
└── package.json
```
