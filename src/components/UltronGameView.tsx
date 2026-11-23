import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';

export interface GameScoreRecord {
  id: number;
  score: number;
  wave: number;
  accuracyPct: number;
  createdAt?: string;
}

type GamePhase = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';

interface UltronGameViewProps {
  callsign: string;
  isSignedIn: boolean;
  topScores: GameScoreRecord[];
  onSubmitScore: (result: {
    score: number;
    wave: number;
    accuracyPct: number;
  }) => Promise<boolean | void>;
  onRequestSignIn: () => void;
}

interface EnemyEntity {
  group: THREE.Group;
  visorMat: THREE.MeshStandardMaterial;
  x: number;
  z: number;
  vx: number;
  vz: number;
  hp: number;
  maxHp: number;
  speed: number;
  windupTimer: number;
  telegraphing: boolean;
}

interface ProjectileEntity {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
}

interface ParticleEntity {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export function UltronGameView({
  callsign,
  isSignedIn,
  topScores,
  onSubmitScore,
  onRequestSignIn,
}: UltronGameViewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<GamePhase>('TITLE_MENU');
  const [hud, setHud] = useState({
    score: 0,
    wave: 1,
    integrity: 100,
    accuracyPct: 100,
  });
  const [muted, setMuted] = useState(false);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [scoreSubmitted, setScoreSubmitted] = useState(false);

  const phaseRef = useRef<GamePhase>('TITLE_MENU');
  const mutedRef = useRef<boolean>(false);
  const resetActionRef = useRef<() => void>(() => {});
  const audioCtxRef = useRef<AudioContext | null>(null);

  phaseRef.current = phase;
  mutedRef.current = muted;

  const playGameSfx = useCallback(
    (kind: 'shoot' | 'hit' | 'explode' | 'damage' | 'wave') => {
      if (mutedRef.current || typeof window === 'undefined') return;
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      try {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        if (kind === 'shoot') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(520, now);
          osc.frequency.exponentialRampToValueAtTime(170, now + 0.08);
          gain.gain.setValueAtTime(0.045, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
        } else if (kind === 'hit') {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(310, now);
          osc.frequency.exponentialRampToValueAtTime(640, now + 0.06);
          gain.gain.setValueAtTime(0.05, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
        } else if (kind === 'explode') {
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(160, now);
          osc.frequency.exponentialRampToValueAtTime(42, now + 0.22);
          gain.gain.setValueAtTime(0.075, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
        } else if (kind === 'damage') {
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(110, now);
          osc.frequency.exponentialRampToValueAtTime(48, now + 0.28);
          gain.gain.setValueAtTime(0.09, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
        } else {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.exponentialRampToValueAtTime(440, now + 0.25);
          gain.gain.setValueAtTime(0.06, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
        }
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.32);
      } catch {
        // Optional SFX
      }
    },
    [],
  );

  const onSubmitScoreRef = useRef(onSubmitScore);
  onSubmitScoreRef.current = onSubmitScore;

  const isSignedInRef = useRef(isSignedIn);
  isSignedInRef.current = isSignedIn;

  const startNewRun = useCallback(() => {
    setScoreSubmitted(false);
    resetActionRef.current();
    setPhase('PLAYING');
    phaseRef.current = 'PLAYING';
    playGameSfx('wave');
  }, [playGameSfx]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (phaseRef.current === 'PLAYING') {
          setPhase('PAUSED');
        } else if (phaseRef.current === 'PAUSED') {
          setPhase('PLAYING');
        }
      } else if (e.key === 'Enter') {
        if (
          phaseRef.current === 'TITLE_MENU' ||
          phaseRef.current === 'GAME_OVER'
        ) {
          e.preventDefault();
          startNewRun();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [startNewRun]);

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const isSoftwareGl = detectSoftwareWebGL();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2),
    );
    renderer.setClearColor(0x06070a, 1);

    const width = mount.clientWidth || 960;
    const height = mount.clientHeight || 620;
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x06070a, 0.022);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 140);
    const baseCameraPos = new THREE.Vector3(0, 15.5, 16.5);
    camera.position.copy(baseCameraPos);
    camera.lookAt(0, 0, 0);

    // Three-point + core lighting
    const hemi = new THREE.HemisphereLight(0x94a3b8, 0x090b10, 0.85);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff1f2, 2.2);
    keyLight.position.set(10, 18, 10);
    scene.add(keyLight);

    const coreLight = new THREE.PointLight(0xef4444, 6, 18);
    coreLight.position.set(0, 1.4, 0);
    scene.add(coreLight);

    // Arena Grid & Perimeter Ring
    const gridHelper = new THREE.GridHelper(32, 32, 0x7f1d1d, 0x1e2430);
    scene.add(gridHelper);

    const arenaRingGeo = new THREE.RingGeometry(13.8, 14.05, 72);
    const arenaRingMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45,
    });
    const arenaRing = new THREE.Mesh(arenaRingGeo, arenaRingMat);
    arenaRing.rotation.x = -Math.PI / 2;
    arenaRing.position.y = 0.02;
    scene.add(arenaRing);

    // Composite Multi-Part Sentinel Turret (7 distinct geometric parts)
    const turretGroup = new THREE.Group();
    scene.add(turretGroup);

    const armorMat = new THREE.MeshPhysicalMaterial({
      color: 0x1e2533,
      metalness: 0.9,
      roughness: 0.24,
      clearcoat: 0.7,
    });
    const crimsonEmissiveMat = new THREE.MeshStandardMaterial({
      color: 0x3b0a0a,
      emissive: 0xef4444,
      emissiveIntensity: 2.1,
      roughness: 0.25,
    });
    const amberAccentMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 1.4,
      metalness: 0.7,
      roughness: 0.2,
    });

    // 1. Base pedestal
    const pedestalGeo = new THREE.CylinderGeometry(1.15, 1.45, 0.45, 12);
    const pedestalMesh = new THREE.Mesh(pedestalGeo, armorMat);
    pedestalMesh.position.y = 0.225;
    turretGroup.add(pedestalMesh);

    // 2. Stabilizer halo ring around pedestal
    const haloGeo = new THREE.TorusGeometry(1.55, 0.055, 12, 48);
    const haloMesh = new THREE.Mesh(haloGeo, amberAccentMat);
    haloMesh.rotation.x = Math.PI / 2;
    haloMesh.position.y = 0.16;
    turretGroup.add(haloMesh);

    // Rotating upper turret head
    const turretHead = new THREE.Group();
    turretHead.position.y = 0.78;
    turretGroup.add(turretHead);

    // 3. Armored chassis hull
    const hullGeo = new THREE.BoxGeometry(1.25, 0.56, 1.4);
    const hullMesh = new THREE.Mesh(hullGeo, armorMat);
    turretHead.add(hullMesh);

    // 4. Central plasma reactor sphere
    const reactorGeo = new THREE.IcosahedronGeometry(0.42, 2);
    const reactorMesh = new THREE.Mesh(reactorGeo, crimsonEmissiveMat);
    reactorMesh.position.y = 0.34;
    turretHead.add(reactorMesh);

    // 5 & 6. Twin forward plasma barrels
    const barrelGeo = new THREE.CylinderGeometry(0.11, 0.14, 1.35, 10);
    barrelGeo.rotateX(Math.PI / 2);
    const leftBarrel = new THREE.Mesh(barrelGeo, armorMat);
    leftBarrel.position.set(-0.42, 0.04, 0.95);
    turretHead.add(leftBarrel);

    const rightBarrel = new THREE.Mesh(barrelGeo, armorMat);
    rightBarrel.position.set(0.42, 0.04, 0.95);
    turretHead.add(rightBarrel);

    // 7. Muzzle energy tips
    const tipGeo = new THREE.SphereGeometry(0.12, 8, 8);
    const leftTip = new THREE.Mesh(tipGeo, crimsonEmissiveMat);
    leftTip.position.set(-0.42, 0.04, 1.62);
    turretHead.add(leftTip);

    const rightTip = new THREE.Mesh(tipGeo, crimsonEmissiveMat);
    rightTip.position.set(0.42, 0.04, 1.62);
    turretHead.add(rightTip);

    // Shared geometries for projectiles, enemies, particles
    const boltGeo = new THREE.CapsuleGeometry(0.09, 0.45, 4, 8);
    boltGeo.rotateX(Math.PI / 2);
    const boltMat = new THREE.MeshBasicMaterial({ color: 0xfca5a5 });

    const droneBodyGeo = new THREE.OctahedronGeometry(0.48, 0);
    const droneWingGeo = new THREE.BoxGeometry(1.35, 0.08, 0.42);
    const droneVisorGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const droneThrusterGeo = new THREE.TorusGeometry(0.26, 0.045, 8, 20);
    const droneArmorMat = new THREE.MeshStandardMaterial({
      color: 0x262d3d,
      metalness: 0.85,
      roughness: 0.3,
    });

    const particleGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    const particleMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });

    const enemies: EnemyEntity[] = [];
    const projectiles: ProjectileEntity[] = [];
    const particles: ParticleEntity[] = [];

    let score = 0;
    let wave = 1;
    let integrity = 100;
    let shotsFired = 0;
    let shotsHit = 0;
    let killsThisWave = 0;
    let spawnCooldown = 0.8;
    let fireCooldown = 0;
    let aimAngle = 0;
    let pointerDown = false;
    let spaceDown = false;
    let hitstopTimer = 0;
    let shakeIntensity = 0;
    let barrelToggle = false;

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.8);
    const hitPoint = new THREE.Vector3();

    const syncHud = () => {
      const accuracyPct =
        shotsFired === 0
          ? 100
          : Math.min(100, Math.round((shotsHit / shotsFired) * 100));
      setHud({ score, wave, integrity, accuracyPct });
    };

    const spawnBurst = (x: number, y: number, z: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(particleGeo, particleMat);
        mesh.position.set(x, y, z);
        scene.add(mesh);
        const angle = Math.random() * Math.PI * 2;
        const speed = 2.5 + Math.random() * 5.5;
        particles.push({
          mesh,
          vx: Math.cos(angle) * speed,
          vy: 1.5 + Math.random() * 4.5,
          vz: Math.sin(angle) * speed,
          life: 0.45 + Math.random() * 0.25,
          maxLife: 0.7,
        });
      }
    };

    const spawnEnemy = () => {
      const angle = Math.random() * Math.PI * 2;
      const radius = 14.5;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      const group = new THREE.Group();
      group.position.set(x, 0.78, z);

      const body = new THREE.Mesh(droneBodyGeo, droneArmorMat);
      group.add(body);

      const wings = new THREE.Mesh(droneWingGeo, droneArmorMat);
      group.add(wings);

      const visorMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xef4444,
        emissiveIntensity: 1.4,
      });
      const visor = new THREE.Mesh(droneVisorGeo, visorMat);
      visor.position.z = 0.35;
      group.add(visor);

      const thruster = new THREE.Mesh(droneThrusterGeo, amberAccentMat);
      thruster.position.z = -0.38;
      group.add(thruster);

      group.lookAt(0, 0.78, 0);
      scene.add(group);

      const dirX = -x / radius;
      const dirZ = -z / radius;
      const speed = 2.1 + Math.min(wave * 0.28, 3.2) + Math.random() * 0.7;
      const hp = wave >= 4 && Math.random() < 0.3 ? 2 : 1;

      enemies.push({
        group,
        visorMat,
        x,
        z,
        vx: dirX * speed,
        vz: dirZ * speed,
        hp,
        maxHp: hp,
        speed,
        windupTimer: 0.55,
        telegraphing: false,
      });
    };

    const fireProjectile = () => {
      if (fireCooldown > 0 || phaseRef.current !== 'PLAYING') return;
      fireCooldown = 0.14;
      shotsFired += 1;

      const sideOffset = barrelToggle ? 0.42 : -0.42;
      barrelToggle = !barrelToggle;

      const forwardX = Math.sin(aimAngle);
      const forwardZ = Math.cos(aimAngle);
      const rightX = Math.cos(aimAngle);
      const rightZ = -Math.sin(aimAngle);

      const spawnX = forwardX * 1.6 + rightX * sideOffset;
      const spawnZ = forwardZ * 1.6 + rightZ * sideOffset;

      const mesh = new THREE.Mesh(boltGeo, boltMat);
      mesh.position.set(spawnX, 0.82, spawnZ);
      mesh.rotation.y = aimAngle;
      scene.add(mesh);

      const boltSpeed = 24;
      projectiles.push({
        mesh,
        x: spawnX,
        z: spawnZ,
        vx: forwardX * boltSpeed,
        vz: forwardZ * boltSpeed,
        life: 0.9,
      });

      playGameSfx('shoot');
      syncHud();
    };

    const clearEntities = () => {
      for (const e of enemies) {
        scene.remove(e.group);
        e.visorMat.dispose();
      }
      enemies.length = 0;

      for (const p of projectiles) {
        scene.remove(p.mesh);
      }
      projectiles.length = 0;

      for (const pt of particles) {
        scene.remove(pt.mesh);
      }
      particles.length = 0;
    };

    resetActionRef.current = () => {
      clearEntities();
      score = 0;
      wave = 1;
      integrity = 100;
      shotsFired = 0;
      shotsHit = 0;
      killsThisWave = 0;
      spawnCooldown = 0.6;
      fireCooldown = 0;
      hitstopTimer = 0;
      shakeIntensity = 0;
      syncHud();
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        aimAngle = Math.atan2(hitPoint.x, hitPoint.z);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      onPointerMove(e);
      pointerDown = true;
      fireProjectile();
    };

    const onPointerUp = () => {
      pointerDown = false;
    };

    const onKeyDownSpace = (e: KeyboardEvent) => {
      if (e.code === 'Space' && phaseRef.current === 'PLAYING') {
        e.preventDefault();
        if (!e.repeat) {
          spaceDown = true;
          fireProjectile();
        }
      }
    };

    const onKeyUpSpace = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown = false;
      }
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDownSpace);
    window.addEventListener('keyup', onKeyUpSpace);

    const handleResize = () => {
      if (!mount) return;
      const w = mount.clientWidth || 960;
      const h = mount.clientHeight || 620;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(mount);

    let frameId = 0;
    let disposed = false;
    const clock = new THREE.Clock();

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 50);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const st = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (st === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 50);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      if (disposed) return;

      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.getElapsedTime();
      const currentPhase = phaseRef.current;

      // Ambient title/paused camera motion
      if (currentPhase === 'TITLE_MENU' || currentPhase === 'GAME_OVER') {
        const orbitAngle = elapsed * 0.22;
        camera.position.set(
          Math.sin(orbitAngle) * 16.5,
          14.5,
          Math.cos(orbitAngle) * 16.5,
        );
        camera.lookAt(0, 0.5, 0);
        turretHead.rotation.y = elapsed * 0.6;
        reactorMesh.scale.setScalar(1 + Math.sin(elapsed * 3.5) * 0.06);
      } else {
        // Playing or Paused
        camera.position.copy(baseCameraPos);
        if (shakeIntensity > 0.005) {
          camera.position.x += (Math.random() - 0.5) * shakeIntensity;
          camera.position.y += (Math.random() - 0.5) * shakeIntensity * 0.6;
          shakeIntensity = THREE.MathUtils.damp(shakeIntensity, 0, 12, delta);
        }
        camera.lookAt(0, 0, 0);
      }

      haloMesh.rotation.z += delta * 0.8;

      if (currentPhase === 'PLAYING') {
        if (hitstopTimer > 0) {
          hitstopTimer -= delta;
        } else {
          // Smoothly rotate turret toward aimAngle
          const diff =
            Math.atan2(
              Math.sin(aimAngle - turretHead.rotation.y),
              Math.cos(aimAngle - turretHead.rotation.y),
            );
          turretHead.rotation.y += diff * Math.min(1, delta * 18);

          if (fireCooldown > 0) fireCooldown -= delta;
          if (pointerDown || spaceDown) {
            fireProjectile();
          }

          spawnCooldown -= delta;
          if (spawnCooldown <= 0 && enemies.length < 6 + wave * 2) {
            spawnEnemy();
            spawnCooldown = Math.max(0.38, 1.35 - wave * 0.1);
          }

          // Update projectiles
          for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            p.x += p.vx * delta;
            p.z += p.vz * delta;
            p.life -= delta;
            p.mesh.position.set(p.x, 0.82, p.z);
            if (p.life <= 0 || Math.hypot(p.x, p.z) > 16.5) {
              scene.remove(p.mesh);
              projectiles.splice(i, 1);
            }
          }

          // Update enemies & collisions
          for (let i = enemies.length - 1; i >= 0; i--) {
            const e = enemies[i];
            const distToCore = Math.hypot(e.x, e.z);

            // Telegraph surge when approaching inner defense perimeter
            if (distToCore < 5.0 && !e.telegraphing) {
              e.telegraphing = true;
              e.visorMat.emissive.setHex(0xffffff);
              e.visorMat.emissiveIntensity = 3.2;
            }

            if (e.telegraphing && e.windupTimer > 0) {
              e.windupTimer -= delta;
              e.group.position.y = 0.78 + Math.sin(elapsed * 28) * 0.08;
            } else {
              const boost = e.telegraphing ? 1.75 : 1.0;
              e.x += e.vx * boost * delta;
              e.z += e.vz * boost * delta;
              e.group.position.set(e.x, 0.78, e.z);
            }

            // Check projectile hits
            let destroyed = false;
            for (let j = projectiles.length - 1; j >= 0; j--) {
              const p = projectiles[j];
              if (Math.hypot(p.x - e.x, p.z - e.z) < 0.88) {
                scene.remove(p.mesh);
                projectiles.splice(j, 1);
                shotsHit += 1;
                e.hp -= 1;

                if (e.hp <= 0) {
                  spawnBurst(e.x, 0.85, e.z, 12);
                  scene.remove(e.group);
                  e.visorMat.dispose();
                  enemies.splice(i, 1);

                  score += 100 * wave;
                  killsThisWave += 1;
                  hitstopTimer = 0.032;
                  shakeIntensity = 0.35;
                  playGameSfx('explode');

                  if (killsThisWave >= 6 + wave * 3) {
                    wave += 1;
                    killsThisWave = 0;
                    playGameSfx('wave');
                  }
                  syncHud();
                  destroyed = true;
                  break;
                } else {
                  playGameSfx('hit');
                  e.visorMat.emissive.setHex(0xf59e0b);
                }
              }
            }

            if (destroyed) continue;

            // Core impact check
            if (distToCore < 1.65) {
              spawnBurst(e.x, 0.85, e.z, 16);
              scene.remove(e.group);
              e.visorMat.dispose();
              enemies.splice(i, 1);

              integrity = Math.max(0, integrity - 20);
              hitstopTimer = 0.045;
              shakeIntensity = 0.85;
              playGameSfx('damage');
              syncHud();

              if (integrity <= 0) {
                const finalAccuracy =
                  shotsFired === 0
                    ? 100
                    : Math.min(100, Math.round((shotsHit / shotsFired) * 100));
                phaseRef.current = 'GAME_OVER';
                setPhase('GAME_OVER');
                if (isSignedInRef.current && score > 0) {
                  void onSubmitScoreRef
                    .current({
                      score,
                      wave,
                      accuracyPct: finalAccuracy,
                    })
                    .then((ok) => {
                      if (ok !== false) {
                        setScoreSubmitted(true);
                      }
                    })
                    .catch(() => {});
                }
                break;
              }
            }
          }

          // Update particles
          for (let i = particles.length - 1; i >= 0; i--) {
            const pt = particles[i];
            pt.life -= delta;
            pt.vy -= 12 * delta;
            pt.mesh.position.x += pt.vx * delta;
            pt.mesh.position.y = Math.max(0.08, pt.mesh.position.y + pt.vy * delta);
            pt.mesh.position.z += pt.vz * delta;
            const s = Math.max(0.05, pt.life / pt.maxLife);
            pt.mesh.scale.setScalar(s);
            if (pt.life <= 0) {
              scene.remove(pt.mesh);
              particles.splice(i, 1);
            }
          }
        }
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    if (isSoftwareGl) {
      afterDraw(tick);
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDownSpace);
      window.removeEventListener('keyup', onKeyUpSpace);
      clearEntities();

      arenaRingGeo.dispose();
      arenaRingMat.dispose();
      pedestalGeo.dispose();
      haloGeo.dispose();
      hullGeo.dispose();
      reactorGeo.dispose();
      barrelGeo.dispose();
      tipGeo.dispose();
      armorMat.dispose();
      crimsonEmissiveMat.dispose();
      amberAccentMat.dispose();
      boltGeo.dispose();
      boltMat.dispose();
      droneBodyGeo.dispose();
      droneWingGeo.dispose();
      droneVisorGeo.dispose();
      droneThrusterGeo.dispose();
      droneArmorMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      envTarget.dispose();
      renderer.dispose();

      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [playGameSfx]);

  return (
    <div className="relative h-[calc(100vh-4rem)] min-h-[540px] w-full overflow-hidden bg-[#06070A]">
      {/* Isolated WebGL Mount — Zero backdrop-blur over WebGL */}
      <div ref={mountRef} className="h-full w-full cursor-crosshair" />

      {webglUnavailable && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#06070A] p-6 text-center">
          <div className="max-w-md rounded-xl border border-white/10 bg-[#0D1017] p-6">
            <div className="font-display text-lg font-semibold text-white">
              WebGL2 Acceleration Required
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Enable hardware acceleration in your browser settings to run the 3D Neural Defense simulation.
            </p>
          </div>
        </div>
      )}

      {/* Minimal Low-Occlusion HUD (pointer-events-none during active play) */}
      {phase === 'PLAYING' && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-6 rounded-lg border border-white/10 bg-[#06070A]/85 px-4 py-2.5">
            <div>
              <div className="text-[11px] text-slate-400">Score</div>
              <div className="font-mono text-lg font-semibold tabular-nums text-white">
                {hud.score.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">Wave</div>
              <div className="font-mono text-lg font-semibold tabular-nums text-amber-300">
                {hud.wave}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">Core Integrity</div>
              <div
                className={`font-mono text-lg font-semibold tabular-nums ${
                  hud.integrity <= 40 ? 'text-red-400' : 'text-emerald-400'
                }`}
              >
                {hud.integrity}%
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">Accuracy</div>
              <div className="font-mono text-lg font-semibold tabular-nums text-slate-200">
                {hud.accuracyPct}%
              </div>
            </div>
          </div>

          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute game audio' : 'Mute game audio'}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 bg-[#06070A]/90 text-slate-300 transition-colors hover:text-white"
            >
              {muted ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="ultron-accent-text h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setPhase('PAUSED')}
              aria-label="Pause game"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-white/15 bg-[#06070A]/90 px-3 text-xs font-medium text-slate-200 transition-colors hover:border-white/30 hover:text-white"
            >
              <Pause className="h-3.5 w-3.5" />
              <span>Pause</span>
            </button>
          </div>
        </div>
      )}

      {/* Title Screen */}
      {phase === 'TITLE_MENU' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#06070A]/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#0D1017]/95 p-6 text-center shadow-2xl sm:p-8">
            <svg
              viewBox="0 0 80 80"
              aria-hidden="true"
              className="mx-auto h-16 w-16"
            >
              <circle
                cx="40"
                cy="40"
                r="34"
                fill="none"
                stroke="#ef4444"
                strokeWidth="2"
                strokeDasharray="16 8"
              />
              <polygon
                points="40,14 62,54 18,54"
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2"
              />
              <circle cx="40" cy="41" r="8" fill="#ef4444" />
            </svg>

            <h1 className="mt-4 font-display text-3xl font-bold tracking-[0.12em] text-white">
              NEURAL DEFENSE
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Command the Sentinel Core for {callsign}. Intercept incoming rogue drone swarms before they breach the perimeter.
            </p>

            <div className="mt-6 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={startNewRun}
                className="ultron-accent-bg inline-flex min-h-[46px] w-full max-w-xs items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white transition-colors"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Start Defense</span>
              </button>
              <div className="font-mono text-xs text-slate-400">
                Mouse Aim · Click / Space Fire · Esc Pause
              </div>
            </div>

            {/* Personal High Scores */}
            <div className="mt-6 border-t border-white/10 pt-5 text-left">
              <div className="flex items-center justify-between text-xs">
                <span className="font-display font-semibold text-white">
                  Personal Best Runs
                </span>
                {!isSignedIn && (
                  <button
                    type="button"
                    onClick={onRequestSignIn}
                    className="ultron-accent-text hover:opacity-85"
                  >
                    Sign in to save scores
                  </button>
                )}
              </div>

              {topScores.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  No recorded defense runs yet. Complete a session to log your personal record.
                </p>
              ) : (
                <div className="mt-2.5 space-y-1.5">
                  {topScores.slice(0, 5).map((entry, idx) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#06070A] px-3 py-1.5 font-mono text-xs tabular-nums"
                    >
                      <span className="text-slate-400">#{idx + 1}</span>
                      <span className="font-semibold text-white">
                        {entry.score.toLocaleString()} pts
                      </span>
                      <span className="text-amber-300">Wave {entry.wave}</span>
                      <span className="text-slate-400">{entry.accuracyPct}% acc</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Paused Modal */}
      {phase === 'PAUSED' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#06070A]/75 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#0D1017] p-6 text-center">
            <h2 className="font-display text-2xl font-bold text-white">
              Simulation Paused
            </h2>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => setPhase('PLAYING')}
                className="ultron-accent-bg min-h-[44px] rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={startNewRun}
                className="min-h-[44px] rounded-lg border border-white/15 bg-[#06070A] px-4 py-2 text-sm font-medium text-slate-200 hover:text-white"
              >
                Restart Run
              </button>
              <button
                type="button"
                onClick={() => setPhase('TITLE_MENU')}
                className="min-h-[44px] rounded-lg border border-white/10 px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
              >
                Return to Title
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game Over Modal */}
      {phase === 'GAME_OVER' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#06070A]/80 p-4">
          <div className="w-full max-w-md rounded-2xl border border-red-500/35 bg-[#0D1017] p-6 text-center">
            <h2 className="font-display text-2xl font-bold text-white">
              Perimeter Breached
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {scoreSubmitted
                ? `Run logged to ${callsign}'s personal leaderboard.`
                : isSignedIn
                  ? 'Run complete.'
                  : 'Sign in with Google to save scores to your personal vault.'}
            </p>

            <div className="mt-5 grid grid-cols-3 gap-3 rounded-xl border border-white/10 bg-[#06070A] p-4">
              <div>
                <div className="text-[11px] text-slate-400">Score</div>
                <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-white">
                  {hud.score.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Wave</div>
                <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-amber-300">
                  {hud.wave}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Accuracy</div>
                <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-emerald-400">
                  {hud.accuracyPct}%
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={startNewRun}
                className="ultron-accent-bg inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Play Again</span>
              </button>
              <button
                type="button"
                onClick={() => setPhase('TITLE_MENU')}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-white/15 bg-[#06070A] px-4 py-2 text-sm font-medium text-slate-200 hover:text-white"
              >
                Title Screen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
