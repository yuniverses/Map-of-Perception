const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const getPixels = require("get-pixels"); // 用于读取图像像素
const quantize = require("quantize"); // 用于颜色量化
const { getVideoDurationInSeconds } = require("get-video-duration");

const app = express();

// 设置 Multer 存储配置
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // 根据文件类型选择不同的存储目录
    if (file.fieldname === "video") {
      cb(null, "uploads/videos/");
    } else if (file.fieldname === "bpm") {
      cb(null, "uploads/bpm/");
    } else {
      cb(null, "uploads/others/");
    }
  },
  filename: function (req, file, cb) {
    // 保持原文件名
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.static("public")); // 用于提供客户端的静态文件

// 确保上传目录存在
[
  "uploads/videos/",
  "uploads/bpm/",
  "uploads/frames/",
  "uploads/audio/",
].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`创建目录: ${dir}`);
  }
});

// 处理视频和BPM JSON上传
app.post(
  "/upload",
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "bpm", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const videoFile = req.files["video"][0];
      const bpmFile = req.files["bpm"][0];

      const videoPath = videoFile.path;
      const videoName = path.basename(videoPath, path.extname(videoPath));
      const framesDir = path.join(__dirname, "uploads/frames/", videoName);

      console.log(`视频路径: ${videoPath}`);
      console.log(`帧目录: ${framesDir}`);

      if (!fs.existsSync(framesDir)) {
        fs.mkdirSync(framesDir, { recursive: true });
        console.log(`创建帧目录: ${framesDir}`);
      }

      // 获取视频时长
      const durationInSeconds = await getVideoDurationInSeconds(videoPath);
      console.log(`视频时长: ${durationInSeconds} 秒`);

      await extractFrames(videoPath, framesDir, durationInSeconds);

      const frames = fs.readdirSync(framesDir).filter((file) => {
        return [".jpg", ".png"].includes(path.extname(file).toLowerCase());
      });

      console.log(`提取到的帧数量: ${frames.length}`);

      if (frames.length === 0) {
        throw new Error("未提取到任何帧，请检查视频文件和提取逻辑。");
      }

      // 从帧中提取颜色
      const colors = await extractColorsFromFrames(framesDir, frames);
      console.log("颜色提取完成:", colors);

      // 解析BPM JSON文件
      const bpmData = JSON.parse(fs.readFileSync(bpmFile.path, "utf-8"));
      console.log("BPM数据:", bpmData);

      // 确保 audio 目录存在
      const audioDir = path.join(__dirname, "uploads/audio/");
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
        console.log(`创建音频目录: ${audioDir}`);
      }

      // 提取音频
      const audioFileName = `${videoName}.mp3`;
      const audioOutputPath = path.join(audioDir, audioFileName);
      await extractAudio(videoPath, audioOutputPath);

      console.log("音频提取完成:", audioOutputPath);

      // 将颜色数据、BPM数据和音频文件名发送给客户端
      res.json({
        colors: colors, // 包含每个时间段的亮色和暗色
        bpm: bpmData, // BPM数据数组
        audioFile: `/audio/${audioFileName}`,
      });
    } catch (error) {
      console.error("处理视频时出错:", error);
      res.status(500).send("Error processing video.");
    }
  }
);

// 提供音频文件
app.use("/audio", express.static(path.join(__dirname, "uploads/audio")));

// 提供帧图像（如果需要）
app.use("/frames", express.static(path.join(__dirname, "uploads/frames")));

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
      const palette = await getPalette(framePath, 20); // 获取20种颜色
      console.log(`帧 ${frame} 的调色板:`, palette);

      // 计算每个颜色的亮度 (0-765)
      const sortedColors = palette
        .map((color) => ({
          color,
          brightness: color[0] + color[1] + color[2],
        }))
        .sort((a, b) => b.brightness - a.brightness); // 从亮到暗排序

      const brightColors = sortedColors.slice(0, 10).map((c) => c.color); // 前10个亮色
      const darkColors = sortedColors.slice(-2).map((c) => c.color); // 后2个暗色

      console.log(`帧 ${frame} 的亮色:`, brightColors);
      console.log(`帧 ${frame} 的暗色:`, darkColors);

      colors.push({ brightColors, darkColors });
    } catch (error) {
      console.error(`Error extracting colors from ${frame}:`, error);
      colors.push({
        brightColors: Array(10).fill([255, 255, 255]), // 默认白色
        darkColors: [
          [0, 0, 0],
          [0, 0, 0],
        ], // 默认黑色
      });
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
      const colorMap = quantize(pixelData, Math.max(256, colorCount)); // 创建足够大的调色板
      const allColors = colorMap.palette();

      if (allColors.length < colorCount) {
        console.warn(`警告: 从图像中提取的颜色数量少于 ${colorCount} 个。`);
      }

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
        console.log("Audio extracted:", outputPath);
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
