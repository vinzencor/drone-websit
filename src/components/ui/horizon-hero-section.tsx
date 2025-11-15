import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export const Component = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLDivElement>(null);
  const scrollProgressRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const smoothCameraPos = useRef({ x: 0, y: 5, z: 50 });

  const [scrollProgress, setScrollProgress] = useState(0);
  const [currentSection, setCurrentSection] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const totalSections = 2;

  const threeRefs = useRef<{
    scene: THREE.Scene | null;
    camera: THREE.PerspectiveCamera | null;
    renderer: THREE.WebGLRenderer | null;
    droneMeshes: THREE.Mesh[];
    animationId: number | null;
    targetCameraX?: number;
    targetCameraY?: number;
    targetCameraZ?: number;
  }>({
    scene: null,
    camera: null,
    renderer: null,
    droneMeshes: [],
    animationId: null
  });

  useEffect(() => {
    const initThree = () => {
      const { current: refs } = threeRefs;

      refs.scene = new THREE.Scene();
      refs.scene.background = new THREE.Color(0x000000);

      refs.camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        2000
      );
      refs.camera.position.z = 50;
      refs.camera.position.y = 5;

      refs.renderer = new THREE.WebGLRenderer({
        canvas: canvasRef.current!,
        antialias: true,
        alpha: false
      });
      refs.renderer.setSize(window.innerWidth, window.innerHeight);
      refs.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      createDroneImages();
      createLighting();

      animate();

      setIsReady(true);
    };

    const createDroneImages = () => {
      const { current: refs } = threeRefs;
      const textureLoader = new THREE.TextureLoader();

      const droneImages = [
        'https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=1200&q=80',
        'https://images.unsplash.com/photo-1507582020474-9a35b7d455d9?w=1200&q=80',
        'https://images.unsplash.com/photo-1508614999368-9260051292e5?w=1200&q=80',
        'https://images.unsplash.com/photo-1527977966376-1c8408f9f108?w=1200&q=80',
        'https://images.unsplash.com/photo-1521405924368-64ab2e13d193?w=1200&q=80',
        'https://images.unsplash.com/photo-1506947411565-14e4e04e4a2f?w=1200&q=80'
      ];

      const positions = [
        { x: -30, y: 10, z: -50, rotation: 0.3 },
        { x: 20, y: -5, z: -80, rotation: -0.2 },
        { x: -15, y: 15, z: -120, rotation: 0.5 },
        { x: 25, y: 5, z: -160, rotation: -0.4 },
        { x: -20, y: -10, z: -200, rotation: 0.2 },
        { x: 15, y: 20, z: -250, rotation: -0.3 }
      ];

      droneImages.forEach((imageUrl, i) => {
        const texture = textureLoader.load(imageUrl);
        const geometry = new THREE.PlaneGeometry(30, 20);
        const material = new THREE.MeshStandardMaterial({
          map: texture,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(positions[i].x, positions[i].y, positions[i].z);
        mesh.rotation.y = positions[i].rotation;
        mesh.userData = {
          baseX: positions[i].x,
          baseY: positions[i].y,
          baseZ: positions[i].z,
          baseRotation: positions[i].rotation,
          index: i
        };

        refs.scene!.add(mesh);
        refs.droneMeshes.push(mesh);
      });
    };

    const createLighting = () => {
      const { current: refs } = threeRefs;

      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      refs.scene!.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      directionalLight.position.set(10, 10, 10);
      refs.scene!.add(directionalLight);

      const pointLight = new THREE.PointLight(0x4488ff, 1, 100);
      pointLight.position.set(0, 0, 20);
      refs.scene!.add(pointLight);
    };

    const animate = () => {
      const { current: refs } = threeRefs;
      refs.animationId = requestAnimationFrame(animate);

      const time = Date.now() * 0.001;

      if (refs.camera && refs.targetCameraX !== undefined) {
        const smoothingFactor = 0.05;

        smoothCameraPos.current.x += (refs.targetCameraX - smoothCameraPos.current.x) * smoothingFactor;
        smoothCameraPos.current.y += (refs.targetCameraY! - smoothCameraPos.current.y) * smoothingFactor;
        smoothCameraPos.current.z += (refs.targetCameraZ! - smoothCameraPos.current.z) * smoothingFactor;

        const floatX = Math.sin(time * 0.3) * 1;
        const floatY = Math.cos(time * 0.2) * 0.5;

        refs.camera.position.x = smoothCameraPos.current.x + floatX;
        refs.camera.position.y = smoothCameraPos.current.y + floatY;
        refs.camera.position.z = smoothCameraPos.current.z;
        refs.camera.lookAt(0, 0, -100);
      }

      refs.droneMeshes.forEach((mesh, i) => {
        const speed = 0.2 + i * 0.1;
        mesh.rotation.y = mesh.userData.baseRotation + Math.sin(time * speed) * 0.1;
        mesh.rotation.x = Math.cos(time * speed * 0.5) * 0.05;

        mesh.position.y = mesh.userData.baseY + Math.sin(time * speed + i) * 2;
      });

      if (refs.renderer && refs.scene && refs.camera) {
        refs.renderer.render(refs.scene, refs.camera);
      }
    };

    initThree();

    const handleResize = () => {
      const { current: refs } = threeRefs;
      if (refs.camera && refs.renderer) {
        refs.camera.aspect = window.innerWidth / window.innerHeight;
        refs.camera.updateProjectionMatrix();
        refs.renderer.setSize(window.innerWidth, window.innerHeight);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      const { current: refs } = threeRefs;

      if (refs.animationId) {
        cancelAnimationFrame(refs.animationId);
      }

      window.removeEventListener('resize', handleResize);

      refs.droneMeshes.forEach(mesh => {
        mesh.geometry.dispose();
        if (mesh.material instanceof THREE.Material) {
          mesh.material.dispose();
        }
      });

      if (refs.renderer) {
        refs.renderer.dispose();
      }
    };
  }, []);

  useEffect(() => {
    if (!isReady) return;

    gsap.set([menuRef.current, titleRef.current, subtitleRef.current, scrollProgressRef.current], {
      visibility: 'visible'
    });

    const tl = gsap.timeline();

    if (menuRef.current) {
      tl.from(menuRef.current, {
        x: -100,
        opacity: 0,
        duration: 1,
        ease: "power3.out"
      });
    }

    if (titleRef.current) {
      tl.from(titleRef.current, {
        y: 100,
        opacity: 0,
        duration: 1.5,
        ease: "power4.out"
      }, "-=0.5");
    }

    if (subtitleRef.current) {
      const subtitleLines = subtitleRef.current.querySelectorAll('.subtitle-line');
      tl.from(subtitleLines, {
        y: 50,
        opacity: 0,
        duration: 1,
        stagger: 0.2,
        ease: "power3.out"
      }, "-=0.8");
    }

    if (scrollProgressRef.current) {
      tl.from(scrollProgressRef.current, {
        opacity: 0,
        y: 50,
        duration: 1,
        ease: "power2.out"
      }, "-=0.5");
    }

    return () => {
      tl.kill();
    };
  }, [isReady]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const maxScroll = documentHeight - windowHeight;
      const progress = Math.min(scrollY / maxScroll, 1);

      setScrollProgress(progress);
      const newSection = Math.min(Math.floor(progress * (totalSections + 1)), totalSections);
      setCurrentSection(newSection);

      const { current: refs } = threeRefs;

      const totalProgress = progress * totalSections;
      const sectionProgress = totalProgress % 1;

      const cameraPositions = [
        { x: 0, y: 5, z: 50 },
        { x: -10, y: 10, z: -50 },
        { x: 5, y: 15, z: -150 }
      ];

      const currentPos = cameraPositions[newSection] || cameraPositions[0];
      const nextPos = cameraPositions[newSection + 1] || currentPos;

      refs.targetCameraX = currentPos.x + (nextPos.x - currentPos.x) * sectionProgress;
      refs.targetCameraY = currentPos.y + (nextPos.y - currentPos.y) * sectionProgress;
      refs.targetCameraZ = currentPos.z + (nextPos.z - currentPos.z) * sectionProgress;

      refs.droneMeshes.forEach((mesh, i) => {
        const parallaxSpeed = 0.5 + i * 0.3;
        const newZ = mesh.userData.baseZ + (scrollY * parallaxSpeed * 0.1);
        mesh.position.z = newZ;

        const fadeStart = 0.7;
        if (progress > fadeStart) {
          const fadeProgress = (progress - fadeStart) / (1 - fadeStart);
          if (mesh.material instanceof THREE.MeshStandardMaterial) {
            mesh.material.opacity = 0.9 * (1 - fadeProgress);
          }
        } else {
          if (mesh.material instanceof THREE.MeshStandardMaterial) {
            mesh.material.opacity = 0.9;
          }
        }
      });
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, [totalSections]);

  return (
    <div ref={containerRef} className="relative w-full" style={{ backgroundColor: '#000000' }}>
      <canvas ref={canvasRef} className="fixed top-0 left-0 w-full h-full" />

      <div ref={menuRef} className="fixed left-8 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-8" style={{ visibility: 'hidden' }}>
        <div className="flex flex-col gap-2">
          <span className="w-8 h-0.5 bg-white"></span>
          <span className="w-8 h-0.5 bg-white"></span>
          <span className="w-8 h-0.5 bg-white"></span>
        </div>
        <div className="[writing-mode:vertical-lr] text-white text-sm tracking-[0.3em] font-light">DRONES</div>
      </div>

      <div className="relative z-10 min-h-screen flex items-center justify-center px-8">
        <div className="text-center">
          <h1 ref={titleRef} className="text-7xl md:text-9xl font-bold text-white mb-8 tracking-wider" style={{ visibility: 'hidden' }}>
            HORIZON
          </h1>

          <div ref={subtitleRef} className="text-xl md:text-2xl text-white/80 font-light leading-relaxed" style={{ visibility: 'hidden' }}>
            <p className="subtitle-line">
              Where vision meets reality,
            </p>
            <p className="subtitle-line">
              we shape the future of tomorrow
            </p>
          </div>
        </div>
      </div>

      <div ref={scrollProgressRef} className="fixed bottom-12 right-12 z-20 flex flex-col items-end gap-4" style={{ visibility: 'hidden' }}>
        <div className="text-white text-xs tracking-[0.3em] font-light">SCROLL</div>
        <div className="w-32 h-0.5 bg-white/30 relative">
          <div
            className="absolute top-0 left-0 h-full bg-white transition-all duration-300"
            style={{ width: `${scrollProgress * 100}%` }}
          />
        </div>
        <div className="text-white text-sm font-light">
          {String(currentSection).padStart(2, '0')} / {String(totalSections).padStart(2, '0')}
        </div>
      </div>

      <div className="relative z-10">
        {[...Array(2)].map((_, i) => {
          const titles = ['COSMOS', 'INFINITY'];
          const subtitles = [
            {
              line1: 'Beyond the boundaries of imagination,',
              line2: 'lies the universe of possibilities'
            },
            {
              line1: 'In the space between thought and creation,',
              line2: 'we find the essence of true innovation'
            }
          ];

          return (
            <section key={i} className="min-h-screen flex items-center justify-center px-8">
              <div className="text-center">
                <h1 className="text-7xl md:text-9xl font-bold text-white mb-8 tracking-wider">
                  {titles[i]}
                </h1>

                <div className="text-xl md:text-2xl text-white/80 font-light leading-relaxed">
                  <p className="subtitle-line">
                    {subtitles[i].line1}
                  </p>
                  <p className="subtitle-line">
                    {subtitles[i].line2}
                  </p>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};
