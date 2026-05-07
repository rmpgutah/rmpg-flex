import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const SLC_LAT = 40.7608;
const SLC_LNG = -111.891;
const GOLD = 0xd4a017;

function latLngToVec3(latDeg: number, lngDeg: number, radius: number): THREE.Vector3 {
  const phi = (90 - latDeg) * (Math.PI / 180);
  const theta = (lngDeg + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

interface LoginGlobeProps {
  className?: string;
}

export default function LoginGlobe({ className }: LoginGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 200);
    camera.position.set(0, 0.4, 5.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // ── Lights ──
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const goldLight = new THREE.PointLight(GOLD, 0.6);
    goldLight.position.set(5, 3, 5);
    scene.add(goldLight);

    // ── Globe group ──
    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    // Solid dark core (occludes back-side wireframe)
    globeGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(1.99, 64, 64),
      new THREE.MeshBasicMaterial({ color: 0x050505 }),
    ));

    // Gold wireframe surface
    globeGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(2, 48, 32),
      new THREE.MeshBasicMaterial({ color: GOLD, wireframe: true, transparent: true, opacity: 0.32 }),
    ));

    // Inner dim shell for depth
    globeGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(2.01, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0x3a2a08, wireframe: true, transparent: true, opacity: 0.18 }),
    ));

    // SLC marker dot
    const slcPos = latLngToVec3(SLC_LAT, SLC_LNG, 2.02);
    const slcDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 16, 16),
      new THREE.MeshBasicMaterial({ color: GOLD }),
    );
    slcDot.position.copy(slcPos);
    globeGroup.add(slcDot);

    // SLC pulse ring (oriented to surface tangent)
    const pulseRing = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.12, 32),
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    pulseRing.position.copy(slcPos);
    pulseRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), slcPos.clone().normalize());
    globeGroup.add(pulseRing);

    // Atmospheric back-side fresnel glow
    const atmosphereMat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.55 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.4);
          gl_FragColor = vec4(0.83, 0.63, 0.09, 1.0) * intensity * 0.6;
        }
      `,
    });
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(2, 48, 32), atmosphereMat);
    atmosphere.scale.setScalar(1.12);
    globeGroup.add(atmosphere);

    // ── Starfield (cheap point sprites) ──
    const starGeom = new THREE.BufferGeometry();
    const STAR_COUNT = 1500;
    const starPositions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      // Distribute on a sphere shell
      const r = 30 + Math.random() * 50;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = r * Math.cos(phi);
    }
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
      starGeom,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, transparent: true, opacity: 0.55, sizeAttenuation: true }),
    );
    scene.add(stars);

    // ── Orbiting unit pings — small gold satellites ──
    const orbits: { mesh: THREE.Mesh; radius: number; speed: number; tilt: number; phase: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 12, 12),
        new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.85 }),
      );
      scene.add(m);
      orbits.push({
        mesh: m,
        radius: 2.6 + i * 0.15,
        speed: 0.18 + i * 0.04,
        tilt: (i - 1.5) * 0.4,
        phase: i * 1.7,
      });
    }

    // ── Animation loop ──
    let rafId = 0;
    const clock = new THREE.Clock();
    let active = true;

    const tick = () => {
      if (!active) return;
      rafId = requestAnimationFrame(tick);
      const t = clock.getElapsedTime();

      globeGroup.rotation.y = t * 0.06;
      globeGroup.rotation.x = Math.sin(t * 0.04) * 0.08 - 0.15;

      // SLC pulse
      const pulse = (Math.sin(t * 1.6) + 1) * 0.5;
      pulseRing.scale.setScalar(0.4 + pulse * 0.9);
      (pulseRing.material as THREE.MeshBasicMaterial).opacity = 0.7 - pulse * 0.65;

      // Orbiting satellites
      orbits.forEach((o) => {
        const a = t * o.speed + o.phase;
        const x = Math.cos(a) * o.radius;
        const z = Math.sin(a) * o.radius;
        const y = Math.sin(a) * Math.sin(o.tilt) * o.radius * 0.6;
        o.mesh.position.set(x, y, z);
      });

      atmosphereMat.uniforms.uTime.value = t;
      renderer.render(scene, camera);
    };

    if (reduceMotion) {
      // Single render only
      renderer.render(scene, camera);
    } else {
      tick();
    }

    // ── Resize handler — both window resize and container layout shifts ──
    const handleResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      if (w < 4 || h < 4) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    // Run once after first paint to catch late layout
    requestAnimationFrame(handleResize);

    // ── Pause when tab hidden ──
    const handleVisibility = () => {
      if (document.hidden) {
        active = false;
        cancelAnimationFrame(rafId);
      } else if (!reduceMotion) {
        active = true;
        clock.start();
        tick();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibility);
      resizeObserver.disconnect();
      renderer.dispose();
      starGeom.dispose();
      // Walk scene & dispose geometries/materials
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={containerRef} className={className} aria-hidden="true" />;
}
