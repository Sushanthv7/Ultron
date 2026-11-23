import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { sampleSpeechSynthSpectrum } from '../utils/audio';

export type CoreState = 'idle' | 'listening' | 'processing' | 'responding';
export type GeometryMode = 'unified' | 'topology' | 'exploded';
export type AnimationMode = 'standard' | 'atrial-fibrillation';

interface UltronCoreProps {
  coreState: CoreState;
  geometryMode: GeometryMode;
  modeAccent: 'architect' | 'tactical' | 'deep';
  accentColor?: string;
  afibMode?: boolean;
  pulseSignal: number;
  dataBurstSignal?: number;
  isSpeaking: boolean;
  dataLoad?: number;
  getVoiceAnalyser?: () => AnalyserNode | null;
  onCoreClick: () => void;
}

const SPECTRUM_BAR_COUNT = 24;
const RADIAL_TICK_COUNT = 36;

const NODE_COUNT = 96;
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _euler = new THREE.Euler();
const _accentColor = new THREE.Color();
const _warmTint = new THREE.Color();
const _amberColor = new THREE.Color(0xf59e0b);
const _whiteColor = new THREE.Color(0xffffff);
const _deepColor = new THREE.Color(0xf59e0b);
const DEFAULT_CAM_POS = new THREE.Vector3(0, 0.25, 5.2);
const DEFAULT_CAM_DISTANCE = DEFAULT_CAM_POS.length();

function parseHexRgba(hex: string, alpha: number): string {
  const valid = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#ef4444';
  const r = parseInt(valid.slice(1, 3), 16);
  const g = parseInt(valid.slice(3, 5), 16);
  const b = parseInt(valid.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

export function UltronCore({
  coreState,
  geometryMode,
  modeAccent,
  accentColor = '#ef4444',
  afibMode = false,
  pulseSignal,
  dataBurstSignal = 0,
  isSpeaking,
  dataLoad = 0,
  getVoiceAnalyser,
  onCoreClick,
}: UltronCoreProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [zoomFactor, setZoomFactor] = useState(1);
  const resettingCameraRef = useRef(false);

  const resolvedAccent = /^#[0-9a-fA-F]{6}$/.test(accentColor)
    ? accentColor
    : '#ef4444';

  const clampedDataLoad = THREE.MathUtils.clamp(dataLoad, 0, 1);

  // Keep reactive props in refs so WebGL scene never tears down on UI state changes
  const stateRef = useRef<CoreState>(coreState);
  const geomRef = useRef<GeometryMode>(geometryMode);
  const accentRef = useRef(modeAccent);
  const afibRef = useRef(afibMode);
  const hexAccentRef = useRef(resolvedAccent);
  const hexAccentDirtyRef = useRef(true);
  const speakingRef = useRef(isSpeaking);
  const dataLoadRef = useRef(clampedDataLoad);
  const getAnalyserRef = useRef(getVoiceAnalyser);
  const voiceAmplitudeRef = useRef(0);
  const radialTickRefs = useRef<Array<SVGLineElement | null>>([]);
  const spectrumBarRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const burstRef = useRef(0);
  const heavyBurstRef = useRef(0);

  stateRef.current = coreState;
  geomRef.current = geometryMode;
  accentRef.current = modeAccent;
  afibRef.current = afibMode;
  speakingRef.current = isSpeaking;
  dataLoadRef.current = clampedDataLoad;
  getAnalyserRef.current = getVoiceAnalyser;

  useEffect(() => {
    hexAccentRef.current = resolvedAccent;
    hexAccentDirtyRef.current = true;
  }, [resolvedAccent]);

  useEffect(() => {
    if (pulseSignal > 0) {
      burstRef.current = 1.0;
    }
  }, [pulseSignal]);

  useEffect(() => {
    if (dataBurstSignal > 0) {
      heavyBurstRef.current = 1.0;
      burstRef.current = 1.0;
    }
  }, [dataBurstSignal]);

  // Real-time audio spectrum analyzer driving subtle perimeter & base light bars
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    const smoothedBars = new Float32Array(SPECTRUM_BAR_COUNT);
    const smoothedTicks = new Float32Array(RADIAL_TICK_COUNT);
    const synthBins = new Float32Array(SPECTRUM_BAR_COUNT);
    let freqBytes: Uint8Array<ArrayBuffer> | null = null;
    let rafId = 0;
    let activeLoop = true;

    const halfBars = SPECTRUM_BAR_COUNT / 2;

    const applyVisuals = (avgAmp: number) => {
      voiceAmplitudeRef.current = avgAmp;

      for (let i = 0; i < SPECTRUM_BAR_COUNT; i++) {
        const el = spectrumBarRefs.current[i];
        if (!el) continue;
        const level = smoothedBars[i];
        const scaleY = 0.14 + level * 0.86;
        const opacity = 0.2 + level * 0.74;
        el.style.transform = `scaleY(${scaleY.toFixed(3)})`;
        el.style.opacity = opacity.toFixed(3);
      }

      for (let i = 0; i < RADIAL_TICK_COUNT; i++) {
        const line = radialTickRefs.current[i];
        if (!line) continue;
        const angleDeg = i * 10;
        const rad = (angleDeg * Math.PI) / 180;
        const baseLen = i % 3 === 0 ? 11 : 6;
        const r1 = 158;
        const r2 = r1 + baseLen + smoothedTicks[i] * 14;
        line.setAttribute('x2', (180 + Math.cos(rad) * r2).toFixed(2));
        line.setAttribute('y2', (180 + Math.sin(rad) * r2).toFixed(2));
        const baseOpacity = i % 3 === 0 ? 0.68 : 0.32;
        line.setAttribute(
          'stroke-opacity',
          Math.min(0.98, baseOpacity + smoothedTicks[i] * 0.6).toFixed(2),
        );
      }
    };

    const stepSpectrum = (nowMs: number) => {
      if (!activeLoop) return;

      const analyser = getAnalyserRef.current?.() ?? null;
      const speaking = speakingRef.current;

      let hasLiveAudio = false;
      if (analyser && speaking) {
        if (!freqBytes || freqBytes.length !== analyser.frequencyBinCount) {
          freqBytes = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        }
        analyser.getByteFrequencyData(freqBytes);
        hasLiveAudio = true;
      } else if (speaking) {
        sampleSpeechSynthSpectrum(synthBins, nowMs, true);
      } else {
        synthBins.fill(0);
      }

      if (prefersReducedMotion) {
        const staticLevel = speaking ? 0.42 : 0;
        smoothedBars.fill(staticLevel);
        smoothedTicks.fill(staticLevel);
        applyVisuals(staticLevel);
        if (speaking) {
          rafId = requestAnimationFrame(stepSpectrum);
        }
        return;
      }

      let maxEnergy = 0;
      let sumEnergy = 0;

      for (let i = 0; i < SPECTRUM_BAR_COUNT; i++) {
        // Symmetric distribution from center (low-mid fundamentals) outward to highs
        const distFromCenter = Math.abs(i - (halfBars - 0.5)) / halfBars;
        let target = 0;

        if (hasLiveAudio && freqBytes) {
          const binIdx = Math.min(
            freqBytes.length - 1,
            Math.floor(distFromCenter * Math.min(18, freqBytes.length - 1)),
          );
          const raw = freqBytes[binIdx] / 255;
          target = Math.pow(raw, 0.85);
        } else if (speaking) {
          const binIdx = Math.min(
            SPECTRUM_BAR_COUNT - 1,
            Math.floor(distFromCenter * (SPECTRUM_BAR_COUNT - 1)),
          );
          target = synthBins[binIdx];
        }

        const rate = target > smoothedBars[i] ? 0.42 : 0.16;
        smoothedBars[i] += (target - smoothedBars[i]) * rate;
        if (smoothedBars[i] < 0.004) smoothedBars[i] = 0;
        if (smoothedBars[i] > maxEnergy) maxEnergy = smoothedBars[i];
        sumEnergy += smoothedBars[i];
      }

      for (let i = 0; i < RADIAL_TICK_COUNT; i++) {
        // Map 36 radial ticks symmetrically to lower-half spectrum bins
        const symNorm =
          Math.abs(((i % 18) - 8.5) / 8.5);
        const mappedIdx = Math.min(
          SPECTRUM_BAR_COUNT - 1,
          Math.floor(symNorm * halfBars + (halfBars - 1) * (i % 2 === 0 ? 0.1 : 0.4)),
        );
        const targetTick = speaking ? smoothedBars[mappedIdx] : 0;
        smoothedTicks[i] += (targetTick - smoothedTicks[i]) * 0.35;
        if (smoothedTicks[i] < 0.004) smoothedTicks[i] = 0;
      }

      applyVisuals(sumEnergy / SPECTRUM_BAR_COUNT);

      if (speaking || maxEnergy > 0.004) {
        rafId = requestAnimationFrame(stepSpectrum);
      } else {
        voiceAmplitudeRef.current = 0;
      }
    };

    rafId = requestAnimationFrame(stepSpectrum);

    return () => {
      activeLoop = false;
      cancelAnimationFrame(rafId);
    };
  }, [isSpeaking]);

  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const isSoftwareGl = detectSoftwareWebGL();
    let renderer: THREE.WebGLRenderer;

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const width = mount.clientWidth || 340;
    const height = mount.clientHeight || 340;
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.copy(DEFAULT_CAM_POS);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = true;
    controls.zoomSpeed = 0.85;
    controls.minDistance = 2.0;
    controls.maxDistance = 8.5;
    controls.enablePan = false;
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.65;

    let lastReportedZoom = 1;
    const onControlsStart = () => {
      resettingCameraRef.current = false;
    };
    const onControlsChange = () => {
      const dist = camera.position.distanceTo(controls.target);
      if (dist <= 0.001) return;
      const nextZoom = Number((DEFAULT_CAM_DISTANCE / dist).toFixed(2));
      if (Math.abs(nextZoom - lastReportedZoom) >= 0.04) {
        lastReportedZoom = nextZoom;
        setZoomFactor(nextZoom);
      }
    };
    controls.addEventListener('start', onControlsStart);
    controls.addEventListener('change', onControlsChange);

    // Warm key, cool fill, dynamic core rim lighting
    const hemiLight = new THREE.HemisphereLight(0x94a3b8, 0x0f172a, 0.9);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffedd5, 2.2);
    keyLight.position.set(4, 5, 4);
    scene.add(keyLight);

    const coreLight = new THREE.PointLight(0xef4444, 5.5, 12);
    coreLight.position.set(0, 0, 0);
    scene.add(coreLight);

    const rimLight = new THREE.DirectionalLight(0xf59e0b, 1.4);
    rimLight.position.set(-4, -3, -3);
    scene.add(rimLight);

    // Composite ULTRON Neural Core Group
    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    // 1. Inner pulsing plasma nucleus
    const nucleusGeo = new THREE.IcosahedronGeometry(0.68, 3);
    const nucleusMat = new THREE.MeshStandardMaterial({
      color: 0x1e1b22,
      emissive: 0xef4444,
      emissiveIntensity: 1.9,
      roughness: 0.25,
      metalness: 0.4,
    });
    const nucleusMesh = new THREE.Mesh(nucleusGeo, nucleusMat);
    rootGroup.add(nucleusMesh);

    // 2. Geodesic lattice cage
    const cageGeo = new THREE.IcosahedronGeometry(0.88, 2);
    const cageMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xdc2626,
      emissiveIntensity: 0.85,
      wireframe: true,
      transparent: true,
      opacity: 0.62,
    });
    const cageMesh = new THREE.Mesh(cageGeo, cageMat);
    rootGroup.add(cageMesh);

    // 3. Outer precision metallic containment gimbal rings
    const ringMatA = new THREE.MeshPhysicalMaterial({
      color: 0x1e2430,
      metalness: 0.92,
      roughness: 0.2,
      clearcoat: 0.8,
      clearcoatRoughness: 0.15,
    });
    const ringMatB = new THREE.MeshPhysicalMaterial({
      color: 0x272d3d,
      metalness: 0.94,
      roughness: 0.18,
      emissive: 0x7f1d1d,
      emissiveIntensity: 0.3,
    });

    const ringGeo1 = new THREE.TorusGeometry(1.18, 0.028, 16, 80);
    const ring1 = new THREE.Mesh(ringGeo1, ringMatA);
    ring1.rotation.set(Math.PI / 3.2, 0.3, 0);
    rootGroup.add(ring1);

    const ringGeo2 = new THREE.TorusGeometry(1.36, 0.022, 16, 96);
    const ring2 = new THREE.Mesh(ringGeo2, ringMatB);
    ring2.rotation.set(-Math.PI / 4, Math.PI / 3, 0.4);
    rootGroup.add(ring2);

    const ringGeo3 = new THREE.TorusGeometry(1.52, 0.016, 12, 96);
    const ring3 = new THREE.Mesh(ringGeo3, ringMatA);
    ring3.rotation.set(Math.PI / 2.2, -0.4, 0.2);
    rootGroup.add(ring3);

    // 4. InstancedMesh synaptic node constellation
    const nodeGeo = new THREE.OctahedronGeometry(0.036, 0);
    const nodeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xef4444,
      emissiveIntensity: 1.4,
      roughness: 0.2,
      metalness: 0.6,
    });
    const nodeInstanced = new THREE.InstancedMesh(nodeGeo, nodeMat, NODE_COUNT);
    nodeInstanced.frustumCulled = false;

    const nodeSeeds: Array<{
      theta: number;
      phi: number;
      baseRadius: number;
      speed: number;
      phase: number;
      isAmber: boolean;
    }> = [];

    for (let i = 0; i < NODE_COUNT; i++) {
      const y = 1 - (i / (NODE_COUNT - 1)) * 2;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const goldenAngle = i * 2.399963229728653;
      const phi = Math.acos(y);
      const theta = goldenAngle;
      const isAmber = i % 3 === 0;
      const baseRadius = 1.02 + (i % 5) * 0.14;

      nodeSeeds.push({
        theta,
        phi,
        baseRadius,
        speed: (0.16 + (i % 7) * 0.04) * (i % 2 === 0 ? 1 : -1),
        phase: i * 0.37,
        isAmber,
      });

      _pos.set(
        Math.cos(theta) * radiusAtY * baseRadius,
        y * baseRadius,
        Math.sin(theta) * radiusAtY * baseRadius,
      );
      _scale.setScalar(1);
      _euler.set(i * 0.2, i * 0.4, 0);
      _quat.setFromEuler(_euler);
      _mat.compose(_pos, _quat, _scale);
      nodeInstanced.setMatrixAt(i, _mat);
      nodeInstanced.setColorAt(i, _amberColor);
    }
    nodeInstanced.instanceMatrix.needsUpdate = true;
    if (nodeInstanced.instanceColor) nodeInstanced.instanceColor.needsUpdate = true;
    nodeInstanced.computeBoundingSphere();
    rootGroup.add(nodeInstanced);

    // Post-processing bloom pipeline (GPU WebGL only per Three.js software-GL guard)
    let composerTarget: THREE.WebGLRenderTarget | null = null;
    let composer: EffectComposer | null = null;
    let renderPass: RenderPass | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    let outputPass: OutputPass | null = null;

    if (!isSoftwareGl) {
      const pixelRatio = renderer.getPixelRatio();
      composerTarget = new THREE.WebGLRenderTarget(
        Math.max(1, Math.floor(width * pixelRatio)),
        Math.max(1, Math.floor(height * pixelRatio)),
        {
          type: THREE.HalfFloatType,
          format: THREE.RGBAFormat,
          samples: 4,
        },
      );
      composer = new EffectComposer(renderer, composerTarget);
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);

      renderPass = new RenderPass(
        scene,
        camera,
        undefined,
        new THREE.Color(0x000000),
        0,
      );
      composer.addPass(renderPass);

      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.38,
        0.48,
        0.74,
      );
      composer.addPass(bloomPass);

      outputPass = new OutputPass();
      composer.addPass(outputPass);

      renderer.compile(scene, camera);
    }

    const handleResize = () => {
      if (!mount) return;
      const w = mount.clientWidth || 340;
      const h = mount.clientHeight || 340;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composer && bloomPass) {
        const pr = renderer.getPixelRatio();
        composer.setPixelRatio(pr);
        composer.setSize(w, h);
        bloomPass.resolution.set(w * pr, h * pr);
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(mount);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglUnavailable(true);
    };
    const onContextRestored = () => {
      setWebglUnavailable(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    let frameId = 0;
    let disposed = false;
    const clock = new THREE.Clock();
    let currentScale = 1;
    let currentExplode = 0;
    let currentNodeSpread = 1;
    let currentIntensity = 1.8;
    let currentDataLoad = 0;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      if (disposed) return;

      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.getElapsedTime();
      const st = stateRef.current;
      const gm = geomRef.current;
      const accent = accentRef.current;
      const speaking = speakingRef.current;

      burstRef.current = THREE.MathUtils.damp(burstRef.current, 0, 4.5, delta);
      heavyBurstRef.current = THREE.MathUtils.damp(
        heavyBurstRef.current,
        0,
        12.0,
        delta,
      );
      const burst = burstRef.current;
      const heavyBurst = heavyBurstRef.current;

      // Sync custom primary accent color into Three.js materials without GC
      if (hexAccentDirtyRef.current) {
        _accentColor.set(hexAccentRef.current);
        _warmTint.copy(_accentColor).lerp(_whiteColor, 0.4);
        cageMat.emissive.copy(_accentColor);
        ringMatB.emissive.copy(_accentColor);
        nodeMat.emissive.copy(_accentColor);

        for (let i = 0; i < NODE_COUNT; i++) {
          const isAmber = nodeSeeds[i].isAmber;
          nodeInstanced.setColorAt(
            i,
            isAmber ? _amberColor : i % 5 === 0 ? _warmTint : _accentColor,
          );
        }
        if (nodeInstanced.instanceColor) {
          nodeInstanced.instanceColor.needsUpdate = true;
        }
        hexAccentDirtyRef.current = false;
      }

      const rawLoad = dataLoadRef.current;
      const voiceAmp = voiceAmplitudeRef.current;
      const stateFloor =
        st === 'processing'
          ? 0.42
          : st === 'responding'
            ? 0.34
            : st === 'listening'
              ? 0.16
              : 0;
      const targetDataLoad = Math.min(
        1.25,
        Math.max(rawLoad, stateFloor) + burst * 0.35 + voiceAmp * 0.45,
      );
      const loadLambda = targetDataLoad > currentDataLoad ? 6.5 : 2.6;
      currentDataLoad = THREE.MathUtils.damp(
        currentDataLoad,
        targetDataLoad,
        loadLambda,
        delta,
      );

      const activityMultiplier =
        (st === 'processing'
          ? 2.6
          : st === 'responding'
            ? 2.1
            : st === 'listening'
              ? 1.7
              : 1.0) +
        currentDataLoad * 1.1;

      const motionFactor = prefersReducedMotion ? 0.15 : 1.0;

      const afibJitter = afibRef.current
        ? Math.sin(elapsed * 5.7) * 0.032 +
          Math.sin(elapsed * 13.4) * 0.02 +
          Math.sin(elapsed * 21.8) * 0.012
        : 0;

      const pulseWave =
        st === 'responding' || speaking
          ? Math.sin(elapsed * 9.5) * 0.08 + Math.sin(elapsed * 17.0) * 0.035 + afibJitter
          : st === 'processing'
            ? Math.sin(elapsed * 6.5) * 0.065 + afibJitter
            : Math.sin(elapsed * 2.3) * 0.04 + afibJitter;

      const targetScale =
        1 +
        pulseWave * motionFactor +
        burst * 0.16 +
        heavyBurst * 0.14 +
        voiceAmp * 0.08 * motionFactor +
        currentDataLoad * 0.05;
      currentScale = THREE.MathUtils.damp(currentScale, targetScale, 8, delta);
      nucleusMesh.scale.setScalar(currentScale);

      const cagePulse =
        1 +
        pulseWave * 1.2 * motionFactor +
        burst * 0.22 +
        heavyBurst * 0.22 +
        voiceAmp * 0.11 * motionFactor +
        currentDataLoad * 0.06;
      cageMesh.scale.setScalar(cagePulse);

      const targetIntensity =
        (st === 'processing' ? 2.8 : st === 'responding' ? 2.4 : 1.7) +
        currentDataLoad * 2.25 +
        burst * 1.8 +
        heavyBurst * 2.4 +
        voiceAmp * 1.35 +
        (afibRef.current ? Math.abs(afibJitter) * 6.5 : 0) +
        (speaking ? Math.abs(Math.sin(elapsed * 12)) * 0.45 : 0);
      currentIntensity = THREE.MathUtils.damp(currentIntensity, targetIntensity, 7, delta);
      nucleusMat.emissiveIntensity = currentIntensity;
      cageMat.emissiveIntensity =
        0.8 + currentDataLoad * 1.55 + burst * 0.8 + heavyBurst * 1.4;
      ringMatB.emissiveIntensity =
        0.25 + currentDataLoad * 0.95 + burst * 0.45 + heavyBurst * 1.1;
      nodeMat.emissiveIntensity =
        1.35 + currentDataLoad * 1.75 + burst * 0.9 + heavyBurst * 1.6;
      coreLight.intensity = 4.2 + currentIntensity * 1.35 + heavyBurst * 4.5;

      if (heavyBurst > 0.01 && !prefersReducedMotion) {
        rootGroup.position.set(
          Math.sin(elapsed * 95) * 0.09 * heavyBurst,
          Math.cos(elapsed * 110) * 0.07 * heavyBurst,
          Math.sin(elapsed * 80) * 0.08 * heavyBurst,
        );
      } else {
        rootGroup.position.set(0, 0, 0);
      }

      if (bloomPass) {
        const bloomPulse =
          currentDataLoad > 0.25
            ? Math.sin(elapsed * 5.5) * 0.12 * currentDataLoad * motionFactor
            : 0;
        bloomPass.strength = THREE.MathUtils.clamp(
          0.34 + currentDataLoad * 1.42 + burst * 0.45 + heavyBurst * 1.15 + bloomPulse,
          0.3,
          2.6,
        );
        bloomPass.radius = THREE.MathUtils.clamp(
          0.42 + currentDataLoad * 0.44 + burst * 0.15 + heavyBurst * 0.25,
          0.35,
          1.0,
        );
        bloomPass.threshold = THREE.MathUtils.clamp(
          0.78 - currentDataLoad * 0.36 - heavyBurst * 0.18,
          0.24,
          0.8,
        );
      }

      _accentColor.set(hexAccentRef.current);
      if (accent === 'deep') {
        _warmTint.copy(_accentColor).lerp(_deepColor, 0.35);
        nucleusMat.emissive.copy(_warmTint);
        coreLight.color.copy(_warmTint);
      } else {
        nucleusMat.emissive.copy(_accentColor);
        coreLight.color.copy(_accentColor);
      }

      const targetExplode = (gm === 'exploded' ? 0.42 : 0) + heavyBurst * 0.26;
      currentExplode = THREE.MathUtils.damp(currentExplode, targetExplode, 5, delta);

      const targetNodeSpread = gm === 'topology' ? 1.26 : gm === 'exploded' ? 1.18 : 1.0;
      currentNodeSpread = THREE.MathUtils.damp(currentNodeSpread, targetNodeSpread, 5, delta);

      const spin = delta * (activityMultiplier + heavyBurst * 3.5) * motionFactor;
      nucleusMesh.rotation.y += spin * 0.45;
      cageMesh.rotation.y -= spin * 0.35;
      cageMesh.rotation.x += spin * 0.2;

      ring1.rotation.z += spin * 0.55;
      ring1.rotation.x += spin * 0.12;
      ring1.scale.setScalar(1 + currentExplode * 0.35);

      ring2.rotation.y -= spin * 0.7;
      ring2.rotation.z -= spin * 0.22;
      ring2.scale.setScalar(1 + currentExplode * 0.6);

      ring3.rotation.x += spin * 0.45;
      ring3.rotation.y += spin * 0.32;
      ring3.scale.setScalar(1 + currentExplode * 0.85);

      for (let i = 0; i < NODE_COUNT; i++) {
        const seed = nodeSeeds[i];
        const angleOffset = elapsed * seed.speed * (0.4 + activityMultiplier * 0.35) * motionFactor;
        const theta = seed.theta + angleOffset;
        const radialBreath =
          Math.sin(elapsed * 2.2 + seed.phase) * 0.06 * motionFactor +
          burst * 0.28 +
          heavyBurst * 0.38;
        const r = seed.baseRadius * currentNodeSpread + radialBreath;

        const sinPhi = Math.sin(seed.phi);
        _pos.set(
          r * sinPhi * Math.cos(theta),
          r * Math.cos(seed.phi),
          r * sinPhi * Math.sin(theta),
        );

        const nodeScale =
          (gm === 'topology' ? 1.35 : 1.0) +
          (st === 'processing' || st === 'responding'
            ? Math.sin(elapsed * 7 + seed.phase) * 0.25 * motionFactor
            : 0);
        _scale.setScalar(Math.max(0.4, nodeScale));
        _euler.set(elapsed * 0.6 + seed.phase, theta, 0);
        _quat.setFromEuler(_euler);
        _mat.compose(_pos, _quat, _scale);
        nodeInstanced.setMatrixAt(i, _mat);
      }
      nodeInstanced.instanceMatrix.needsUpdate = true;

      if (resettingCameraRef.current) {
        camera.position.x = THREE.MathUtils.damp(
          camera.position.x,
          DEFAULT_CAM_POS.x,
          6,
          delta,
        );
        camera.position.y = THREE.MathUtils.damp(
          camera.position.y,
          DEFAULT_CAM_POS.y,
          6,
          delta,
        );
        camera.position.z = THREE.MathUtils.damp(
          camera.position.z,
          DEFAULT_CAM_POS.z,
          6,
          delta,
        );
        if (camera.position.distanceTo(DEFAULT_CAM_POS) < 0.02) {
          camera.position.copy(DEFAULT_CAM_POS);
          resettingCameraRef.current = false;
        }
      }

      controls.update();
      if (composer) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }

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
      controls.removeEventListener('start', onControlsStart);
      controls.removeEventListener('change', onControlsChange);
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);

      bloomPass?.dispose();
      outputPass?.dispose();
      composer?.dispose();
      composerTarget?.dispose();
      nucleusGeo.dispose();
      nucleusMat.dispose();
      cageGeo.dispose();
      cageMat.dispose();
      ringGeo1.dispose();
      ringGeo2.dispose();
      ringGeo3.dispose();
      ringMatA.dispose();
      ringMatB.dispose();
      nodeGeo.dispose();
      nodeMat.dispose();
      envTarget.dispose();
      renderer.dispose();

      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  const isActive =
    coreState === 'processing' || coreState === 'responding' || coreState === 'listening';
  const haloBoost = isActive ? Math.max(0.18, clampedDataLoad * 0.32) : clampedDataLoad * 0.22;
  const glowColor =
    coreState === 'listening'
      ? parseHexRgba(resolvedAccent, Math.min(0.85, 0.45 + haloBoost))
      : parseHexRgba(resolvedAccent, Math.min(0.85, 0.38 + haloBoost));

  const secondaryGlow =
    modeAccent === 'deep'
      ? `rgba(245, 158, 11, ${Math.min(0.55, 0.22 + haloBoost * 0.6)})`
      : parseHexRgba(resolvedAccent, Math.min(0.5, 0.16 + haloBoost * 0.55));

  // 36 radial waveform ticks around the circular hub
  const waveTicks = Array.from({ length: 36 }, (_, idx) => {
    const angleDeg = idx * 10;
    const rad = (angleDeg * Math.PI) / 180;
    const baseLen = idx % 3 === 0 ? 11 : 6;
    const dynamicLen =
      isActive || isSpeaking ? baseLen + ((idx * 7) % 10) : baseLen;
    const r1 = 158;
    const r2 = r1 + dynamicLen;
    return {
      x1: 180 + Math.cos(rad) * r1,
      y1: 180 + Math.sin(rad) * r1,
      x2: 180 + Math.cos(rad) * r2,
      y2: 180 + Math.sin(rad) * r2,
      major: idx % 3 === 0,
    };
  });

  return (
    <div className="flex flex-col items-center">
      <div
        ref={containerRef}
        className="relative flex h-[320px] w-[320px] items-center justify-center sm:h-[370px] sm:w-[370px]"
      >
        {/* Ambient pulsing circular aura */}
        <div
          aria-hidden="true"
          className="ultron-pulse-halo pointer-events-none absolute inset-3 rounded-full"
          style={{
            background: `radial-gradient(circle, ${glowColor} 0%, ${secondaryGlow} 42%, transparent 72%)`,
            filter: 'blur(18px)',
          }}
        />

        {/* Expanding harmonic circular pulse rings */}
        <div
          aria-hidden="true"
          className="ultron-wave-expand pointer-events-none absolute inset-6 rounded-full border"
          style={{
            borderColor: parseHexRgba(resolvedAccent, isActive ? 0.5 : 0.24),
          }}
        />
        <div
          aria-hidden="true"
          className="ultron-wave-expand pointer-events-none absolute inset-6 rounded-full border"
          style={{
            borderColor:
              modeAccent === 'deep'
                ? 'rgba(245, 158, 11, 0.35)'
                : parseHexRgba(resolvedAccent, 0.2),
            animationDelay: '1.3s',
          }}
        />

        {/* Precision SVG concentric orbital calibration rings */}
        <svg
          viewBox="0 0 360 360"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          <defs>
            <linearGradient id="ultronArcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={resolvedAccent} stopOpacity="0.92" />
              <stop offset="50%" stopColor="#f59e0b" stopOpacity="0.65" />
              <stop offset="100%" stopColor={resolvedAccent} stopOpacity="0.12" />
            </linearGradient>
          </defs>

          {/* Outer static calibration hairline */}
          <circle
            cx="180"
            cy="180"
            r="174"
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
          />

          {/* Real-time radial spectrum light bars */}
          <g className={isActive || isSpeaking ? 'opacity-95 transition-opacity' : 'opacity-45 transition-opacity'}>
            {waveTicks.map((t, i) => (
              <line
                key={i}
                ref={(el) => {
                  radialTickRefs.current[i] = el;
                }}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                stroke={t.major ? resolvedAccent : '#f59e0b'}
                strokeOpacity={t.major ? 0.68 : 0.32}
                strokeWidth={t.major ? 2 : 1.4}
                strokeLinecap="round"
              />
            ))}
          </g>

        {/* Rotating outer orbital arc */}
        <g className="ultron-spin-slow origin-center">
          <circle
            cx="180"
            cy="180"
            r="148"
            fill="none"
            stroke="url(#ultronArcGrad)"
            strokeWidth="1.75"
            strokeDasharray="110 55 32 55"
            strokeLinecap="round"
          />
        </g>

        {/* Counter-rotating inner orbital arc */}
        <g className="ultron-spin-medium origin-center">
          <circle
            cx="180"
            cy="180"
            r="134"
            fill="none"
            stroke={
              modeAccent === 'deep'
                ? 'rgba(245,158,11,0.55)'
                : parseHexRgba(resolvedAccent, 0.48)
            }
            strokeWidth="1.25"
            strokeDasharray="60 35 18 45"
            strokeLinecap="round"
          />
        </g>

        {/* High-energy inner ring when active */}
        <g className={isActive ? 'ultron-spin-fast origin-center' : 'ultron-spin-slow origin-center'}>
          <circle
            cx="180"
            cy="180"
            r="116"
            fill="none"
            stroke="rgba(255,255,255,0.14)"
            strokeWidth="1"
            strokeDasharray="14 14"
          />
        </g>
      </svg>

      {/* Isolated Three.js WebGL Mount (Zero backdrop-blur over WebGL) */}
      <div
        ref={canvasMountRef}
        className="relative z-10 h-[250px] w-[250px] cursor-grab overflow-hidden rounded-full active:cursor-grabbing sm:h-[290px] sm:w-[290px]"
        onClick={onCoreClick}
        onDoubleClick={() => {
          resettingCameraRef.current = true;
        }}
        role="button"
        tabIndex={0}
        title="Drag to orbit · Scroll to zoom · Double-click to reset view"
        aria-label="Ultron central neural core. Drag to orbit, scroll to zoom, double-click to reset view, or click to pulse core and focus command input."
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onCoreClick();
          }
        }}
      >
        {webglUnavailable && (
          <div
            className="flex h-full w-full items-center justify-center rounded-full"
            style={{
              background: `radial-gradient(circle, ${parseHexRgba(resolvedAccent, 0.32)} 0%, rgba(245,158,11,0.12) 45%, transparent 72%)`,
            }}
          >
            <svg viewBox="0 0 120 120" className="h-36 w-36">
              <circle
                cx="60"
                cy="60"
                r="42"
                fill="none"
                stroke={resolvedAccent}
                strokeWidth="1.5"
                strokeDasharray="12 6"
              />
              <circle
                cx="60"
                cy="60"
                r="26"
                fill={parseHexRgba(resolvedAccent, 0.22)}
                stroke="#f59e0b"
                strokeWidth="1.5"
              />
            </svg>
          </div>
        )}
      </div>

      {Math.abs(zoomFactor - 1) > 0.06 && (
        <button
          type="button"
          onClick={() => {
            resettingCameraRef.current = true;
          }}
          className="absolute bottom-1 right-1 z-20 rounded-md border border-white/10 bg-[#0D1017] px-2 py-1 font-mono text-[11px] tabular-nums text-slate-300 transition-colors hover:border-white/25 hover:text-white"
          title="Reset core camera zoom"
        >
          {zoomFactor.toFixed(1)}× · Reset
        </button>
      )}
      </div>

      {/* Subtle Voice Response Audio Spectrum Light Bars */}
      <div
        aria-label="Voice response audio spectrum"
        className="mt-0.5 flex h-5 items-end justify-center gap-[3px]"
      >
        {Array.from({ length: SPECTRUM_BAR_COUNT }, (_, idx) => {
          const isCenterBand = idx >= 7 && idx <= 16;
          return (
            <span
              key={idx}
              ref={(el) => {
                spectrumBarRefs.current[idx] = el;
              }}
              aria-hidden="true"
              className="block h-5 w-[2.5px] origin-bottom rounded-full will-change-transform"
              style={{
                background: isCenterBand
                  ? `linear-gradient(to top, ${resolvedAccent}, #f59e0b)`
                  : resolvedAccent,
                opacity: 0.2,
                transform: 'scaleY(0.14)',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
