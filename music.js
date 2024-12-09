let audioContext;
let audioBuffer;
let audioSource;
let isPlaying = false;
let startTime = 0;
let xScale = 1000; // 將 xScale 提升為全局變量

// 錄音相關變量
let mediaRecorder;
let recordedChunks = [];

document
  .getElementById("audio-file-input")
  .addEventListener("change", handleFiles);
document
  .getElementById("start-recording")
  .addEventListener("click", startRecording);
document
  .getElementById("stop-recording")
  .addEventListener("click", stopRecording);

function handleFiles(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = function (e) {
    const arrayBuffer = e.target.result;
    initAudio(arrayBuffer);
  };

  reader.readAsArrayBuffer(file);
}

function initAudio(arrayBuffer) {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  audioContext.decodeAudioData(
    arrayBuffer,
    function (buffer) {
      audioBuffer = buffer;
      generate3DModel();
    },
    function (e) {
      console.error("音頻解碼錯誤", e);
    }
  );
}

document.getElementById("play-audio").addEventListener("click", playAudio);

function playAudio() {
  if (!audioBuffer) {
    alert("請先選擇音樂文件或錄製音頻。");
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

  startTime = audioContext.currentTime; // 記錄音樂開始播放的時間

  audioSource.start();
  isPlaying = true;

  animate();
}

let scene, camera, renderer, controls;
let line, lineGeometry;
let totalPositions = [];

function initThreeJS() {
  const container = document.getElementById("threejs-container");
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    2000
  );
  camera.position.set(0, 0, 500);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);

  // 添加環境光
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  // 添加定向光
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(0, 0, 100);
  scene.add(light);
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

  // 提取音頻數據
  const rawData = audioBuffer.getChannelData(0); // 取得左聲道數據
  const totalSamples = rawData.length;

  const sampleStep = Math.floor(totalSamples / 10000); // 控制取樣點數，調整以改變線條細節

  totalPositions = [];

  // 參數調整
  xScale = 1000; // X軸範圍
  const yScale = 200; // Y軸縮放
  const frequency = 0.005; // Z軸波動的頻率
  const zAmplitude = 200; // Z軸波動幅度

  // 生成3D波動線條的點
  for (let i = 0; i < totalSamples; i += sampleStep) {
    const amplitude = rawData[i];

    // 映射到XYZ坐標
    const x = (i / totalSamples) * xScale - xScale / 2; // X軸範圍從 -xScale/2 到 xScale/2
    const y = amplitude * yScale; // 振幅映射到Y軸

    // Z軸添加平滑的波動，使線條具有立體感
    const z = Math.sin(i * frequency) * zAmplitude;

    totalPositions.push(new THREE.Vector3(x, y, z));
  }

  // 創建曲線
  const curve = new THREE.CatmullRomCurve3(totalPositions);
  const curvePoints = curve.getPoints(totalPositions.length * 2); // 增加曲線的平滑度

  // 創建管道幾何體，將線條轉換為具有厚度的3D模型
  const tubeGeometry = new THREE.TubeGeometry(curve, 1000, 2, 8, false);

  // 創建着色器材質
  const material = new THREE.ShaderMaterial({
    uniforms: {
      progress: { value: 0 }, // 用於控制顯示進度的 uniform
    },
    vertexShader: `
      varying vec3 vPosition;
      void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float progress;
      varying vec3 vPosition;
      void main() {
        float displayProgress = (vPosition.x + ${xScale / 2}.0) / ${xScale}.0;
        if (displayProgress > progress) {
          discard; // 超過進度的部分不渲染
        }
        gl_FragColor = vec4(1.0, 1.0, 0.0, 1.0); // 設置線條顏色為綠色
      }
    `,
    transparent: true,
  });

  // 創建網格並添加到場景中
  line = new THREE.Mesh(tubeGeometry, material);
  scene.add(line);

  // 初始渲染
  renderer.render(scene, camera);
}

function animate() {
  if (isPlaying) {
    requestAnimationFrame(animate);

    // 計算已經播放的時間
    const elapsedTime = audioContext.currentTime - startTime;

    // 計算播放進度，確保在 0 到 1 之間
    const totalDuration = audioBuffer.duration;
    let progress = elapsedTime / totalDuration;
    if (progress > 1) progress = 1;

    // 更新材質的 progress uniform
    line.material.uniforms.progress.value = progress;

    controls.update();
    renderer.render(scene, camera);
  }
}

// 錄音功能實現
function startRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("您的瀏覽器不支持錄音功能。");
    return;
  }

  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.start();
      recordedChunks = [];

      mediaRecorder.ondataavailable = function (e) {
        if (e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = function () {
        const blob = new Blob(recordedChunks, {
          type: "audio/wav; codecs=MS_PCM",
        });
        const reader = new FileReader();
        reader.onload = function (e) {
          const arrayBuffer = e.target.result;
          initAudio(arrayBuffer);
        };
        reader.readAsArrayBuffer(blob);
      };

      document.getElementById("start-recording").disabled = true;
      document.getElementById("stop-recording").disabled = false;
      document.getElementById("recording-status").textContent = "正在錄音...";
    })
    .catch((err) => {
      console.error("錄音失敗：", err);
      alert("無法訪問麥克風。");
    });
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    document.getElementById("start-recording").disabled = false;
    document.getElementById("stop-recording").disabled = true;
    document.getElementById("recording-status").textContent = "";
  }
}

document.getElementById("export-obj").addEventListener("click", () => {
  if (!scene) return;
  const exporter = new THREE.OBJExporter();
  const objString = exporter.parse(scene);

  const blob = new Blob([objString], { type: "text/plain" });
  const link = document.createElement("a");
  link.download = "music-visualization.obj";
  link.href = URL.createObjectURL(blob);
  link.click();
});
