let audioContext;
let audioBuffer;
let audioSource;
let isPlaying = false;
let startTime = 0;
let xScale = 1000;

let scene, camera, renderer, controls;
let line;
let totalVertices = 0; // 顶点总数

let colorArray = [];
let audioFilePath = "";
let colorIndex = 0;

document.getElementById("upload-video").addEventListener("click", uploadVideo);
document.getElementById("play-audio").addEventListener("click", playAudio);
document.getElementById("export-gltf").addEventListener("click", exportGLTF);

function uploadVideo() {
  const videoInput = document.getElementById("video-file-input");
  const file = videoInput.files[0];
  if (!file) {
    alert("請先選擇影片文件。");
    return;
  }

  const formData = new FormData();
  formData.append("video", file);

  // 禁用按钮，显示加载状态
  document.getElementById("upload-video").disabled = true;
  document.getElementById("upload-video").textContent = "影片處理中...";

  fetch("/upload", {
    method: "POST",
    body: formData,
  })
    .then((response) => response.json())
    .then((data) => {
      colorArray = data.colors; // colors 是包含每个时间段颜色的数组
      console.log("Received colorArray:", colorArray);
      audioFilePath = data.audioFile;

      if (colorArray.length === 0) {
        alert("未提取到任何颜色，请检查视频文件和服务器端逻辑。");
        resetUploadButton();
        return;
      }

      // 显示检测到的颜色
      displayDetectedColors(colorArray);

      // 启用播放按钮
      document.getElementById("play-audio").disabled = false;
      document.getElementById("export-gltf").disabled = false;
      // 恢复上传按钮状态
      resetUploadButton();
      // 加载音频文件
      loadAudioFile(audioFilePath);
    })
    .catch((error) => {
      console.error("Error:", error);
      alert("影片處理失敗。");
      // 恢复上传按钮状态
      resetUploadButton();
    });
}

function resetUploadButton() {
  const uploadButton = document.getElementById("upload-video");
  uploadButton.disabled = false;
  uploadButton.textContent = "上傳並處理影片";
}

function loadAudioFile(url) {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  fetch(url)
    .then((response) => response.arrayBuffer())
    .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
    .then((buffer) => {
      audioBuffer = buffer;
      generate3DModel();
    })
    .catch((error) => {
      console.error("音頻加載或解碼錯誤", error);
    });
}

function playAudio() {
  if (!audioBuffer) {
    alert("音頻尚未加載完成。");
    return;
  }

  if (isPlaying) {
    audioSource.stop();
    isPlaying = false;
    return;
  }

  audioSource = audioContext.createBufferSource();
  audioSource.buffer = audioBuffer;

  audioSource.connect(audioContext.destination);

  startTime = audioContext.currentTime;

  audioSource.start();
  isPlaying = true;

  audioSource.onended = function () {
    isPlaying = false;
  };
}

function initThreeJS() {
  const container = document.getElementById("threejs-container");
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    5000
  );
  camera.position.set(0, 0, 1000);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  // 添加 OrbitControls
  controls = new THREE.OrbitControls(camera, renderer.domElement);

  // 创建 DirectionalLight
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
  directionalLight.position.set(0, 0, 100);

  // 创建一个目标对象
  const targetObject = new THREE.Object3D();
  targetObject.position.set(0, 0, -1); // 设置目标位置为 (0, 0, -1)

  // 将目标对象添加到场景中
  scene.add(targetObject);

  // 设置灯光的目标为目标对象
  directionalLight.target = targetObject;

  // 将灯光添加到场景中
  scene.add(directionalLight);

  // 监听窗口大小变化
  window.addEventListener("resize", onWindowResize);

  function onWindowResize() {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }

  // 开始动画循环
  animate();
}

function generate3DModel() {
  if (!scene) initThreeJS();

  // 清除之前的模型
  if (line) {
    scene.remove(line);
    line.geometry.dispose();
    line.material.dispose();
    line = null;
  }

  // 提取音频数据
  const rawData = audioBuffer.getChannelData(0); // 获取左声道数据
  const totalSamples = rawData.length;

  const sampleStep = Math.floor(totalSamples / 10000); // 控制采样点数

  const positions = [];
  const vertexColors = [];

  // 参数调整
  xScale = 1000;
  const yScale = 200;
  const frequency = 0.005;
  const zAmplitude = 200;

  // 生成3D波动线条的点
  for (let i = 0; i < totalSamples; i += sampleStep) {
    const amplitude = rawData[i];

    // 映射到XYZ坐标
    const x = (i / totalSamples) * xScale - xScale / 2;
    const y = amplitude * yScale;
    const z = Math.sin(i * frequency) * zAmplitude;

    positions.push(x, y, z);

    // 为每个顶点分配颜色，初始为白色
    vertexColors.push(1, 1, 1); // R, G, B
  }

  // 记录顶点总数
  totalVertices = positions.length / 3;

  // 创建 BufferGeometry
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(vertexColors, 3)
  );

  // 设置初始绘制范围为0
  geometry.setDrawRange(0, 0);

  // 创建线条材质，启用顶点颜色
  const material = new THREE.LineBasicMaterial({ vertexColors: true });

  // 创建线条对象
  line = new THREE.Line(geometry, material);

  // 添加到场景中
  scene.add(line);

  // 设置相机位置
  camera.position.set(0, 0, 1000);
  camera.lookAt(new THREE.Vector3(0, 0, 0));
}

function updateVertexColors(geometry) {
  const colorAttribute = geometry.attributes.color;
  const positionAttribute = geometry.attributes.position;
  const numVertices = positionAttribute.count;

  // 计算每个时间段对应的顶点数量
  const verticesPerSegment = Math.floor(numVertices / colorArray.length);

  for (let i = 0; i < numVertices; i++) {
    // 确定当前顶点所属的时间段
    const segmentIndex = Math.floor(i / verticesPerSegment);
    const segmentColors = colorArray[segmentIndex] || {
      brightColors: [
        [255, 255, 255],
        [255, 255, 255],
      ],
      darkColors: [
        [0, 0, 0],
        [0, 0, 0],
      ],
    };

    // 在每个时间段内，交替使用亮色和暗色
    let colorRGB;
    if (i % 4 < 2) {
      // 使用亮色
      colorRGB = segmentColors.brightColors[i % 2];
    } else {
      // 使用暗色
      colorRGB = segmentColors.darkColors[i % 2];
    }

    const r = colorRGB[0] / 255;
    const g = colorRGB[1] / 255;
    const b = colorRGB[2] / 255;

    colorAttribute.setXYZ(i, r, g, b);

    // 调试日志（可选）
    if (i < 10) {
      // 仅打印前10个顶点，避免过多日志
      console.log(`Vertex ${i}: R=${r}, G=${g}, B=${b}`);
    }
  }

  colorAttribute.needsUpdate = true;
}

function animate() {
  requestAnimationFrame(animate);

  if (line) {
    // 更新绘制范围
    let drawCount = totalVertices; // 默认绘制全部

    if (isPlaying) {
      // 计算已经播放的时间
      const elapsedTime = audioContext.currentTime - startTime;

      // 计算播放进度
      const totalDuration = audioBuffer.duration;
      let progress = elapsedTime / totalDuration;
      if (progress > 1) progress = 1;

      // 计算应绘制的顶点数量
      drawCount = Math.floor(progress * totalVertices);
    }

    // 更新绘制范围
    line.geometry.setDrawRange(0, drawCount);

    // 更新顶点颜色
    updateVertexColors(line.geometry);
  }

  controls.update();

  renderer.render(scene, camera);
}

function displayDetectedColors(colorArray) {
  const container = document.getElementById("colors-container");
  container.innerHTML = "<h2>檢測到的顏色：</h2>";
  colorArray.forEach((palette, index) => {
    const paletteDiv = document.createElement("div");
    paletteDiv.className = "palette-segment";

    const title = document.createElement("div");
    title.className = "palette-title";
    title.textContent = `第 ${index + 1} 時段：亮色 & 暗色`;
    paletteDiv.appendChild(title);

    const brightColorsDiv = document.createElement("div");
    brightColorsDiv.className = "colors";
    palette.brightColors.forEach((color, idx) => {
      const colorDiv = document.createElement("div");
      colorDiv.className = "color-box";
      colorDiv.style.backgroundColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
      colorDiv.title = `亮色 ${idx + 1}: rgb(${color[0]}, ${color[1]}, ${
        color[2]
      })`;
      brightColorsDiv.appendChild(colorDiv);
    });
    paletteDiv.appendChild(brightColorsDiv);

    const darkColorsDiv = document.createElement("div");
    darkColorsDiv.className = "colors";
    palette.darkColors.forEach((color, idx) => {
      const colorDiv = document.createElement("div");
      colorDiv.className = "color-box";
      colorDiv.style.backgroundColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
      colorDiv.title = `暗色 ${idx + 1}: rgb(${color[0]}, ${color[1]}, ${
        color[2]
      })`;
      darkColorsDiv.appendChild(colorDiv);
    });
    paletteDiv.appendChild(darkColorsDiv);

    container.appendChild(paletteDiv);
  });
}

function exportGLTF() {
  if (!scene) return;
  const exporter = new THREE.GLTFExporter();
  exporter.parse(
    scene,
    function (result) {
      const output = JSON.stringify(result, null, 2);
      const blob = new Blob([output], { type: "application/json" });
      saveBlob(blob, "model.gltf");
    },
    {
      binary: false,
      // 其他导出选项可以在此添加
    }
  );
}

function saveBlob(blob, filename) {
  const link = document.createElement("a");
  link.style.display = "none";
  document.body.appendChild(link);
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}
