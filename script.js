// ===== 定数設定 =====
const WORLD_SIZE = 64;
const BLOCK_SIZE = 1;

const BLOCK_TYPES = {
    air:   { id: 0, color: 0x000000, solid: false },
    grass: { id: 1, color: 0x67C240, solid: true },
    dirt:  { id: 2, color: 0x8B5A2B, solid: true },
    stone: { id: 3, color: 0x808080, solid: true },
    wood:  { id: 4, color: 0xA0522D, solid: true },
};

let currentBlockType = 'grass';

// ===== グローバル変数 =====
let scene, camera, renderer, controls, clock;
let worldData = {};
let blocks = [];
let keys = {};
let player = {
    position: new THREE.Vector3(WORLD_SIZE/2, 20, WORLD_SIZE/2),
    velocity: new THREE.Vector3(0, 0, 0),
    onGround: false,
    height: 1.8,
    speed: 7,
    jumpPower: 8,
    gravity: -22
};
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2(0, 0);

// ===== ノイズ関数 =====
function noise2D(x, z) {
    const hash = (x, z) => {
        let h = Math.imul(Math.floor(x), 374761393) + Math.imul(Math.floor(z), 668265263);
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
    let height = 0, amp = 1, freq = scale, total = 0;
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
                let type = y === h ? 'grass' : (h - y < 3 ? 'dirt' : 'stone');
                setBlock(x, y, z, type);
            }
            // 木を生やす
            if (Math.random() < 0.025) {
                const treeH = Math.floor(Math.random() * 2) + 4;
                for (let ty = h+1; ty <= h+treeH; ty++) setBlock(x, ty, z, 'wood');
                for (let lx = -2; lx <= 2; lx++) {
                    for (let lz = -2; lz <= 2; lz++) {
                        for (let ly = h+treeH-1; ly <= h+treeH+1; ly++) {
                            if (Math.abs(lx)+Math.abs(lz)+Math.abs(ly-h-treeH) <= 3 && Math.random() < 0.65) {
                                if (!getBlock(x+lx, ly, z+lz)) setBlock(x+lx, ly, z+lz, 'grass');
                            }
                        }
                    }
                }
            }
        }
    }
}

function getBlockKey(x, y, z) { return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`; }
function getBlock(x, y, z) { return worldData[getBlockKey(x, y, z)] || null; }
function setBlock(x, y, z, type) {
    worldData[getBlockKey(x, y, z)] = type;
}

// ===== ブロック描画 =====
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
    mesh.position.set(x+0.5, y+0.5, z+0.5);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { x, y, z, type };
    return mesh;
}

function rebuildAllBlocks() {
    blocks.forEach(b => scene.remove(b));
    blocks = [];
    for (const key in worldData) {
        const [x, y, z] = key.split(',').map(Number);
        scene.add(createBlockMesh(x, y, z, worldData[key]));
        blocks.push(scene.children[scene.children.length-1]);
    }
}

function updateBlock(x, y, z, type) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    blocks = blocks.filter(b => {
        if (b.userData.x === x && b.userData.y === y && b.userData.z === z) {
            scene.remove(b); return false;
        }
        return true;
    });
    if (type !== 'air' && type) {
        setBlock(x, y, z, type);
        const m = createBlockMesh(x, y, z, type);
        scene.add(m); blocks.push(m);
    } else {
        delete worldData[getBlockKey(x, y, z)];
    }
}

// ===== 衝突判定 =====
function checkCollision(px, py, pz) {
    const rx = Math.floor(px - 0.3), rX = Math.floor(px + 0.3);
    const ry = Math.floor(py - player.height/2), rY = Math.floor(py);
    const rz = Math.floor(pz - 0.3), rZ = Math.floor(pz + 0.3);
    for (let x = rx; x <= rX; x++) {
        for (let y = ry; y <= rY; y++) {
            for (let z = rz; z <= rZ; z++) {
                const b = getBlock(x, y, z);
                if (b && BLOCK_TYPES[b].solid) return true;
            }
        }
    }
    return false;
}

function getGroundHeight(x, z) {
    for (let y = 40; y >= 0; y--) {
        const b = getBlock(Math.floor(x), y, Math.floor(z));
        if (b && BLOCK_TYPES[b].solid) return y + 1;
    }
    return 0;
}

// ===== 初期化 =====
function init() {
    const canvas = document.getElementById('gameCanvas');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 30, 90);
    
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    
    controls = new THREE.PointerLockControls(camera, document.body);
    clock = new THREE.Clock();
    
    // 照明
    scene.add(new THREE.AmbientLight(0x909090, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(60, 100, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    scene.add(sun);
    
    // ワールド生成
    generateWorld();
    rebuildAllBlocks();
    
    // プレイヤー位置
    player.position.y = getGroundHeight(player.position.x, player.position.z) + player.height;
    camera.position.copy(player.position);
    
    setupEventListeners();
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
        if (e.key === '1') selectBlock('grass');
        if (e.key === '2') selectBlock('dirt');
        if (e.key === '3') selectBlock('stone');
        if (e.key === '4') selectBlock('wood');
    });
    document.addEventListener('keyup', e => keys[e.code] = false);
    
    // マウスクリック
    document.addEventListener('mousedown', e => {
        if (!controls.isLocked) return;
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(blocks);
        if (hits.length > 0) {
            const h = hits[0];
            if (e.button === 0) {
                const b = h.object.userData;
                updateBlock(b.x, b.y, b.z, 'air');
            } else if (e.button === 2) {
                const np = h.point.add(h.face.normal.multiplyScalar(0.5));
                const px = Math.floor(np.x), py = Math.floor(np.y), pz = Math.floor(np.z);
                const p = player.position;
                const inPlayer = Math.abs(px - Math.floor(p.x)) < 1 &&
                    py >= Math.floor(p.y - player.height) &&
                    py <= Math.floor(p.y) &&
                    Math.abs(pz - Math.floor(p.z)) < 1;
                if (!inPlayer) updateBlock(px, py, pz, currentBlockType);
            }
        }
    });
    
    // ブロック選択
    document.querySelectorAll('.slot').forEach(s => {
        s.addEventListener('click', () => selectBlock(s.dataset.block));
    });
    
    document.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function selectBlock(type) {
    currentBlockType = type;
    document.querySelectorAll('.slot').forEach(s => {
        s.classList.toggle('selected', s.dataset.block === type);
    });
}

// ===== ゲームループ =====
function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());
    
    if (controls.isLocked) updatePlayer(dt);
    camera.position.copy(player.position);
    renderer.render(scene, camera);
}

function updatePlayer(dt) {
    // 移動方向
    const dir = new THREE.Vector3();
    if (keys['KeyW']) dir.z -= 1;
    if (keys['KeyS']) dir.z += 1;
    if (keys['KeyA']) dir.x -= 1;
    if (keys['KeyD']) dir.x += 1;
    dir.normalize();
    dir.applyQuaternion(camera.quaternion);
    dir.y = 0;
    dir.normalize();
    
    // 重力とジャンプ
    player.velocity.y += player.gravity * dt;
    if (keys['Space'] && player.onGround) {
        player.velocity.y = player.jumpPower;
        player.onGround = false;
    }
    
    // 水平移動（衝突チェック）
    const newPos = player.position.clone();
    const move = dir.multiplyScalar(player.speed * dt);
    
    if (!checkCollision(player.position.x + move.x, player.position.y, player.position.z)) {
        newPos.x += move.x;
    }
    if (!checkCollision(player.position.x, player.position.y, player.position.z + move.z)) {
        newPos.z += move.z;
    }
    
    // 垂直移動
    newPos.y += player.velocity.y * dt;
    if (checkCollision(newPos.x, newPos.y, newPos.z)) {
        if (player.velocity.y < 0) {
            player.onGround = true;
            while (checkCollision(newPos.x, newPos.y, newPos.z)) newPos.y += 0.05;
        }
        player.velocity.y = 0;
    } else {
        player.onGround = false;
    }
    
    // 落下防止
    if (newPos.y < -10) {
        newPos.y = getGroundHeight(newPos.x, newPos.z) + player.height;
        player.velocity.y = 0;
    }
    
    player.position.copy(newPos);
}

// 起動
init();
