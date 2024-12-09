// app.js

let canvas = document.getElementById("signature-pad");
let ctx = canvas.getContext("2d");
let drawing = false;
let points = [];

canvas.addEventListener("pointerdown", (e) => {
  drawing = true;
  points.push({
    x: e.offsetX,
    y: e.offsetY,
    time: Date.now(),
  });
  ctx.beginPath();
  ctx.moveTo(e.offsetX, e.offsetY);
});

canvas.addEventListener("pointermove", (e) => {
  if (!drawing) return;
  let point = {
    x: e.offsetX,
    y: e.offsetY,
    time: Date.now(),
  };
  points.push(point);
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
});

canvas.addEventListener("pointerup", () => {
  drawing = false;
});

document.getElementById("clear-signature").addEventListener("click", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  points = [];
});

let scene, camera, renderer, controls;

function generate3DModel() {
  if (!scene) initThreeJS();

  // 清除之前的模型
  while (scene.children.length > 1) {
    scene.remove(scene.children[scene.children.length - 1]);
  }

  if (points.length < 2) return;

  // 計算Z坐標，根據速度或其他算法
  let pathPoints = [];
  for (let i = 0; i < points.length; i++) {
    let x = points[i].x - canvas.width / 2;
    let y = -(points[i].y - canvas.height / 2);
    let z = 0; // 初始化Z坐標

    if (i > 0) {
      // 計算速度
      let dx = points[i].x - points[i - 1].x;
      let dy = points[i].y - points[i - 1].y;
      let dt = points[i].time - points[i - 1].time || 1;
      let speed = Math.hypot(dx, dy) / dt;

      // 調整Z坐標變化的係數，減小移動距離
      z = pathPoints[i - 1].z + speed * 20; // 將50改為20或更小
    }

    pathPoints.push(new THREE.Vector3(x, y, z));
  }

  // 使用CatmullRomCurve3生成平滑曲線
  let curve = new THREE.CatmullRomCurve3(pathPoints);
  let tubularSegments = 200; // 調整曲線的細分程度

  // 使用TubeGeometry生成固定半徑的管道
  let geometry = new THREE.TubeGeometry(curve, tubularSegments, 2, 16, false);

  // 材質，確保使用DoubleSide
  const material = new THREE.MeshPhongMaterial({
    color: 0x156289,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  animate();
}

function initThreeJS() {
  const container = document.getElementById("threejs-container");
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    1000
  );
  camera.position.set(0, 0, 300);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);

  // 添加環境光
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); // 調整強度
  scene.add(ambientLight);

  // 調整定向光的位置
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(0, 0, 300); // 與攝像機位置一致
  scene.add(light);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

document.getElementById("generate-3d").addEventListener("click", () => {
  if (points.length === 0) return;
  generate3DModel();
});

document.getElementById("export-obj").addEventListener("click", () => {
  if (!scene) return;
  const exporter = new THREE.OBJExporter();
  const objString = exporter.parse(scene);

  const blob = new Blob([objString], { type: "text/plain" });
  const link = document.createElement("a");
  link.download = "signature.obj";
  link.href = URL.createObjectURL(blob);
  link.click();
});
