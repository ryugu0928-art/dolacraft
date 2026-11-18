// ===== 定数設定 =====
const WORLD_SIZE = 64;    // ワールドの大きさ
const CHUNK_SIZE = 16;    // チャンクサイズ
const BLOCK_SIZE = 1;     // 1ブロックの大きさ

// ブロックの種類と色
const BLOCK_TYPES = {
    air:   { id: 0, color: 0x000000, solid: false },
    grass: { id: 1, color: 0x67C240, solid: true },
    dirt:  { id: 2, color: 0x8B5A2B, solid: true },
    stone: { id: 3, color: 0x808080, solid: true },
    wood:  { id: 4, color: 0xA0522D, solid: true },
    sand:  { id: 5, color: 0xF4D03F, solid: true },
};

let currentBlockType = 'grass';

// ===== グローバル変数 =====
let scene, camera, renderer, controls, clock;
let worldData = {};       // ワールドデータ
let blocks = [];          // 表示されているブロック
let keys = {};            // キー入力状態
let player = {
    position: new THREE.Vector3(WORLD_SIZE/2, 15, WORLD_SIZE/2),
    velocity: new THREE.Vector3(0, 0, 0),
    onGround: false,
    height: 1.8,
    speed: 8,
    jumpPower: 8,
    gravity: -20
};
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2(0, 0);

// ===== ノイズ関数（地形生成用）=====
function noise2D(x, z) {
    const hash = (x, z) => {
        let h = Math.imul(x, 374761393) + Math.imul(z, 668265263);
        h ^= h >>> 13;
        h = Math.imul(h, 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const n00 = hash(ix, iz), n01 = hash(ix, iz+1);
    const n10 = hash(ix+1, iz), n11 = hash(ix+1, iz+1);
    const nx0 = n00 * (1-sx) + n10 * sx;
    const nx1 = n01 * (1-sx) + n11 * sx;
    return nx0 * (1-sz) + nx1 * sz;
}

function smoothNoise(x, z, scale = 0.1) {
    let height = 0;
    let amp = 1, freq = scale, total = 0;
    for (let i = 0; i < 4; i++) {
        height += noise2D(freq*x, freq*z) * amp;
        total += amp;
        amp *= 0.5;
        freq *= 2;
    }
    return height / total;
}

// ===== ワールド生成 =====
function generateWorld() {
    for (let x = 0; x < WORLD_SIZE; x++) {
        for (let z = 0; z < WORLD_SIZE; z++) {
            const h = Math.floor(smoothNoise(x, z, 0.08) * 10) + 5;
            for (let y = 0; y <= h; y++) {
                let type;
                if (y === h) type = 'grass';
                else if (h - y < 3) type = 'dirt';
                else type = 'stone';
                setBlock(x, y, z, type);
            }
            // 木を生やす（ランダム）
            if (Math.random() < 0.02) {
                const treeH = Math.floor(Math.random() * 3) + 4;
                for (let ty = h+1; ty <= h+treeH; ty++) {
                    setBlock(x, ty, z, 'wood');
                }
                for (let lx = -2; lx <= 2; lx++) {
                    for (let lz = -2; lz <= 2; lz++) {
                        for (let ly = h+treeH-1; ly <= h+treeH+1; ly++) {
                            if (Math.abs(lx) + Math.abs(lz) + Math.abs(ly - h - treeH) <= 3 && Math.random() < 0.7) {
                                const key = `${x+lx},${ly},${z+lz}`;
                                if (!worldData[key]) setBlock(x+lx, ly, z+lz, 'grass');
                            }
                        }
                    }
                }
            }
        }
    }
}

function getBlockKey(x, y, z) {
    return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
}

function getBlock(x, y, z) {
    return worldData[getBlockKey(x, y, z)] || null;
}

function setBlock(x, y, z, type) {
    const key = getBlockKey(x, y, z);
    if (type === 'air') {
        delete worldData[key];
    } else {
        worldData[key] = type;
    }
}

// ===== ブロックのMesh作成 =====
const blockGeometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
const materialCache = {};

function getBlockMaterial(type) {
    if (!materialCache[type]) {
        materialCache[type] = new THREE.MeshLambertMaterial({ 
            color: BLOCK_TYPES[type].color 
        });
    }
    return materialCache[type];
}

function createBlockMesh(x, y, z, type) {
    const mesh = new THREE.Mesh(blockGeometry, getBlockMaterial(type));
    mesh.position.set(
        Math.floor(x) + 0.5,
        Math.floor(y) + 0.5,
        Math.floor(z) + 0.5
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), type };
    return mesh;
}

function rebuildAllBlocks() {
    blocks.forEach(b => scene.remove(b));
    blocks = [];
    for (const key in worldData) {
        const [x, y, z] = key.split(',').map(Number);
        const type = worldData[key];
        const mesh = createBlockMesh(x, y, z, type);
        scene.add(mesh);
        blocks.push(mesh);
    }
}

function updateBlock(x, y, z, type) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    // 古いものを削除
    blocks = blocks.filter(b => {
        if (b.userData.x === x && b.userData.y === y && b.userData.z === z) {
            scene.remove(b);
            return false;
        }
        return true;
    });
    // 新しいものを追加
    if (type !== 'air' && type) {
        setBlock(x, y, z, type);
        const mesh = createBlockMesh(x, y, z, type);
        scene.add(mesh);
        blocks.push(mesh);
    } else {
        setBlock(x, y, z, 'air');
    }
}

// ===== 衝突判定 =====
function checkCollision(x, y, z) {
    const margin = 0.3;
    const py = y - player.height/2;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            for (let dy = 0; dy <= Math.ceil(player.height); dy++) {
                const bx = Math.floor(x + dx * margin);
                const by = Math.floor(py + dy);
                const bz = Math.floor(z + dz * margin);
                const block = getBlock(bx, by, bz);
                if (block && BLOCK_TYPES[block].solid) {
                    return { x: bx, y: by, z: bz };
                }
            }
        }
    }
    return null;
}

function getGroundHeight(x, z) {
    for (let y = 30; y >= 0; y--) {
        const block = getBlock(Math.floor(x), y, Math.floor(z));
        if (block && BLOCK_TYPES[block].solid) {
            return y + 1;
        }
    }
    return 0;
}

// ===== 初期化 =====
function init() {
    const canvas = document.getElementById('gameCanvas');
    
    // シーン・カメラ・レンダラー
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 30, 100);
    
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
    
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    
    // コントロール
    controls = new THREE.PointerLockControls(camera, document.body);
    clock = new THREE.Clock();
    
    // 照明
    const ambientLight = new THREE.AmbientLight(0x909090, 0.6);
    scene.add(ambientLight);
    
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
    sunLight.position.set(50, 100, 50);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 200;
    sunLight.shadow.camera.left = -80;
    sunLight.shadow.camera.right = 80;
    sunLight.shadow.camera.top = 80;
    sunLight.shadow.camera.bottom = -80;
    scene.add(sunLight);
    
    // ワールド生成
    generateWorld();
    rebuildAllBlocks();
    
    // プレイヤー初期位置
    player.position.y = getGroundHeight(player.position.x, player.position.z) + player.height;
    
    // イベントリスナー
    setupEventListeners();
    
    // ゲームループ開始
    animate();
}

function setupEventListeners() {
    // スタートボタン
    document.getElementById('startBtn').addEventListener('click', () => {
        document.getElementById('startOverlay').style.display = 'none';
        document.getElementById('crosshair').style.display = 'block';
        document.getElementById('blockSelector').style.display = 'flex';
        controls.lock();
    });
    
    // キーボード
    document.addEventListener('keydown', e => {
        keys[e.code] = true;
        // ブロック切り替え
        if (e.key === '1') selectBlock('grass');
        if (e.key === '2') selectBlock('dirt');
        if (e.key === '3') selectBlock('stone');
        if (e.key === '4') selectBlock('wood');
    });
    document.addEventListener('keyup', e => keys[e.code] = false);
    
    // マウス：クリックでブロック操作
    document.addEventListener('mousedown', e => {
        if (!controls.isLocked) return;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(blocks);
        if (intersects.length > 0) {
            const hit = intersects[0];
            if (e.button === 0) {
                // 左クリック：破壊
                const b = hit.object.userData;
                updateBlock(b.x, b.y, b.z, 'air');
            } else if (e.button === 2) {
                // 右クリック：設置（法線方向に）
                const pos = hit.point.add(hit.face.normal.multiplyScalar(0.5));
                // プレイヤー位置と重ならないか確認
                const px = Math.floor(pos.x), py = Math.floor(pos.y), pz = Math.floor(pos.z);
                const p = player.position;
                if (!(Math.abs(px - Math.floor(p.x)) < 1 && 
                      py >= Math.floor(p.y - player.height) && 
                      py <= Math.floor(p.y) &&
                      Math.abs(pz - Math.floor(p.z)) < 1)) {
                    updateBlock(px, py, pz, currentBlockType);
                }
            }
        }
    });
    
    // ブロック選択UI
    document.querySelectorAll('.block-selector .slot').forEach(slot => {
        slot.addEventListener('click', () => selectBlock(slot.dataset.block));
    });
    
    // 右クリックメニューを抑制
    document.addEventListener('contextmenu', e => e.preventDefault());
    
    // リサイズ対応
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function selectBlock(type) {
    currentBlockType = type;
    document.querySelectorAll('.block-selector .slot').forEach(s => {
        s.classList.toggle('selected', s.dataset.block === type);
    });
}

// ===== ゲームループ =====
function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());
    
    if (controls.isLocked) {
        updatePlayer(dt);
    }
    
    renderer.render(scene, camera);
}

function updatePlayer(dt) {
    // 移動方向
    const dir = new THREE.Vector3();
    if (keys['KeyW']) dir.z -= 1;
    if (keys['KeyS']) dir.z += 1;
    if (keys['KeyA']) dir.x -= 1;
    if (keys
