const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ColorThief = require("colorthief");
const { getVideoDurationInSeconds } = require("get-video-duration");

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(express.json());
app.use(express.static("public")); // 用于提供客户端的静态文件

// 处理视频上传和处理
app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    const videoPath = req.file.path;
    const framesDir = path.join(__dirname, "frames", path.basename(videoPath));

    if (!fs.existsSync(framesDir)) {
      fs.mkdirSync(framesDir, { recursive: true });
    }

    // 获取视频时长
    const durationInSeconds = await getVideoDurationInSeconds(videoPath);
    const frameCount = 30; // 提取的帧数
    const interval = durationInSeconds / frameCount; // 计算平均间隔时间

    await extractFrames(videoPath, framesDir, interval); // 使用计算出的间隔提取帧

    const frames = fs.readdirSync(framesDir).filter((file) => {
      return [".jpg", ".png"].includes(path.extname(file).toLowerCase());
    });

    // 从帧中提取颜色
    const colors = await extractColorsFromFrames(framesDir, frames);

    // 提取音频
    const audioFileName = `${path.basename(videoPath)}.mp3`;
    const audioOutputPath = path.join(__dirname, "audio", audioFileName);
    await extractAudio(videoPath, audioOutputPath);

    // 将颜色数据和音频文件名发送给客户端
    res.json({
      colors: colors,
      audioFile: `/audio/${audioFileName}`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error processing video.");
  }
});

// 提供音频文件
app.use("/audio", express.static(path.join(__dirname, "audio")));

// 提供帧图像（如果需要）
app.use("/frames", express.static(path.join(__dirname, "frames")));

const port = 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

// 使用FFmpeg提取帧
function extractFrames(videoPath, framesDir, interval) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .on("end", () => {
        console.log("Frames extracted");
        resolve();
      })
      .on("error", (err) => {
        console.error("Error extracting frames:", err);
        reject(err);
      })
      .screenshots({
        count: 30,
        folder: framesDir,
        filename: "frame-%03d.png",
        timemarks: Array.from({ length: 30 }, (_, i) =>
          (i * interval).toFixed(2)
        ),
      });
  });
}

// 从帧中提取颜色
async function extractColorsFromFrames(framesDir, frames) {
  const colors = [];
  for (const frame of frames) {
    const framePath = path.join(framesDir, frame);
    try {
      const palette = await ColorThief.getPalette(framePath, 5);
      colors.push(palette);
    } catch (error) {
      console.error(`Error extracting colors from ${frame}:`, error);
      colors.push([[255, 255, 255]]); // 默认颜色为白色
    }
  }
  return colors;
}

// 提取音频
function extractAudio(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .save(outputPath)
      .on("end", () => {
        console.log("Audio extracted");
        resolve();
      })
      .on("error", (err) => {
        console.error("Error extracting audio:", err);
        reject(err);
      });
  });
}
