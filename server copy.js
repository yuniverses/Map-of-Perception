const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const getPixels = require("get-pixels"); // 用于读取图像像素
const quantize = require("quantize"); // 用于颜色量化
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
    console.log(`视频时长: ${durationInSeconds} 秒`);

    await extractFrames(videoPath, framesDir, durationInSeconds);

    const frames = fs.readdirSync(framesDir).filter((file) => {
      return [".jpg", ".png"].includes(path.extname(file).toLowerCase());
    });

    if (frames.length === 0) {
      throw new Error("未提取到任何帧，请检查视频文件和提取逻辑。");
    }

    // 从帧中提取颜色
    const colors = await extractColorsFromFrames(framesDir, frames);
    console.log("颜色提取完成:", colors);

    // 确保 audio 目录存在
    const audioDir = path.join(__dirname, "audio");
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    // 提取音频
    const audioFileName = `${path.basename(videoPath)}.mp3`;
    const audioOutputPath = path.join(audioDir, audioFileName);
    await extractAudio(videoPath, audioOutputPath);

    // 将颜色数据和音频文件名发送给客户端
    res.json({
      colors: colors, // 包含每个时间段的亮色和暗色
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

const port = 1000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

// 提取每隔10秒的帧
async function extractFrames(videoPath, framesDir, durationInSeconds) {
  try {
    const timestamps = [];
    for (let t = 0; t < durationInSeconds; t += 10) {
      timestamps.push(t);
    }
    // 确保包括视频的最后一帧
    if (timestamps[timestamps.length - 1] < durationInSeconds) {
      timestamps.push(durationInSeconds);
    }

    console.log("提取帧的时间戳:", timestamps);

    for (let i = 0; i < timestamps.length; i++) {
      const time = timestamps[i];
      const outputPath = path.join(framesDir, `frame-${i}.png`);
      try {
        await extractFrame(videoPath, outputPath, time);
        console.log(`Frame extracted at ${time} 秒: ${outputPath}`);
      } catch (error) {
        console.error(`Failed to extract frame at ${time} 秒:`, error);
      }
    }

    console.log("Frames extracted");
  } catch (error) {
    console.error("Error in extractFrames:", error);
    throw error;
  }
}

function extractFrame(videoPath, outputPath, time) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(time)
      .frames(1)
      .outputOptions("-vf", "scale=-1:480") // 缩放高度为480，宽度自动调整
      .output(outputPath)
      .on("end", () => {
        resolve();
      })
      .on("error", (err, stdout, stderr) => {
        console.error("Error extracting frame:", err);
        console.error("ffmpeg stdout:", stdout);
        console.error("ffmpeg stderr:", stderr);
        reject(err);
      })
      .run();
  });
}

// 从帧中提取最亮和最暗的颜色
async function extractColorsFromFrames(framesDir, frames) {
  const colors = [];
  for (const frame of frames) {
    const framePath = path.join(framesDir, frame);
    try {
      const palette = await getPalette(framePath, 10); // 获取10种颜色
      console.log(`帧 ${frame} 的调色板:`, palette);

      // 计算每个颜色的亮度 (0-765)
      const sortedColors = palette
        .map((color) => ({
          color,
          brightness: color[0] + color[1] + color[2],
        }))
        .sort((a, b) => b.brightness - a.brightness); // 从亮到暗排序

      const brightColors = sortedColors.slice(0, 2).map((c) => c.color);
      const darkColors = sortedColors.slice(-2).map((c) => c.color);

      console.log(`帧 ${frame} 的亮色:`, brightColors);
      console.log(`帧 ${frame} 的暗色:`, darkColors);

      colors.push({ brightColors, darkColors });
    } catch (error) {
      console.error(`Error extracting colors from ${frame}:`, error);
      colors.push({
        brightColors: [
          [255, 255, 255],
          [255, 255, 255],
        ],
        darkColors: [
          [0, 0, 0],
          [0, 0, 0],
        ],
      }); // 默认颜色
    }
  }
  return colors;
}

// 封装 getPalette 为返回 Promise
function getPalette(imagePath, colorCount) {
  return new Promise((resolve, reject) => {
    getPixels(imagePath, function (err, pixels) {
      if (err) {
        console.error("Error reading image pixels:", err);
        reject(err);
        return;
      }

      const pixelData = [];
      for (let i = 0; i < pixels.shape[0]; i++) {
        for (let j = 0; j < pixels.shape[1]; j++) {
          const r = pixels.get(i, j, 0);
          const g = pixels.get(i, j, 1);
          const b = pixels.get(i, j, 2);
          pixelData.push([r, g, b]);
        }
      }

      // 使用 quantize 库获取调色板
      const colorMap = quantize(pixelData, 256); // 创建256色的调色板

      // 获取所有颜色
      const allColors = colorMap.palette();

      resolve(allColors.slice(0, colorCount)); // 返回前 colorCount 种颜色
    });
  });
}

// 提取音频
function extractAudio(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo() // 不输出视频，只保留音频
      .on("end", () => {
        console.log("Audio extracted");
        resolve();
      })
      .on("error", (err, stdout, stderr) => {
        console.error("Error extracting audio:", err);
        console.error("ffmpeg stdout:", stdout);
        console.error("ffmpeg stderr:", stderr);
        reject(err);
      })
      .save(outputPath);
  });
}
