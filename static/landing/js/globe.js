/**
 * RetailBrain AI — Rotating Earth scene (Three.js)
 *
 * Phase 2 of the landing build. Clicking the globe currently redirects
 * straight to /dashboard as a working placeholder — Phase 3 will replace
 * that with the cloud-transition + India map sequence instead.
 */
(function () {
    // ---------------------------------------------------------------
    // 1. Lightweight ambient starfield (2D canvas, cheap, no library)
    // ---------------------------------------------------------------
    function drawStarfield() {
        const canvas = document.getElementById("starfield");
        const ctx = canvas.getContext("2d");

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener("resize", resize);

        const STAR_COUNT = Math.floor((window.innerWidth * window.innerHeight) / 4000);
        const stars = Array.from({ length: STAR_COUNT }, () => ({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            r: Math.random() * 1.1 + 0.2,
            twinkleSpeed: Math.random() * 0.015 + 0.003,
            phase: Math.random() * Math.PI * 2,
        }));

        function frame(t) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "#0d1220";
            for (const s of stars) {
                const alpha = 0.35 + 0.65 * Math.abs(Math.sin(s.phase + t * s.twinkleSpeed));
                ctx.beginPath();
                ctx.fillStyle = `rgba(230, 238, 248, ${alpha.toFixed(2)})`;
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fill();
            }
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }
    drawStarfield();

    // ---------------------------------------------------------------
    // 2. The 3D Earth
    // ---------------------------------------------------------------
    const panel = document.getElementById("globe-panel");
    const canvas = document.getElementById("globe-canvas");

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.z = 6.5;

    // Earth sphere
    const textureLoader = new THREE.TextureLoader();
    const earthTexture = textureLoader.load(
        "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/planets/earth_atmos_2048.jpg"
    );

    const earthGeometry = new THREE.SphereGeometry(1.6, 64, 64);
    const earthMaterial = new THREE.MeshPhongMaterial({
        map: earthTexture,
        shininess: 6,
    });
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    scene.add(earth);

    // Thin atmospheric glow rim (slightly larger sphere, backside, additive)
    const glowGeometry = new THREE.SphereGeometry(1.65, 64, 64);
    const glowMaterial = new THREE.MeshBasicMaterial({
        color: 0x4facfe,
        transparent: true,
        opacity: 0.18,
        side: THREE.BackSide,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    scene.add(glow);

    // Lighting — a key light plus soft ambient fill so the night side isn't pure black
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(5, 2, 5);
    scene.add(keyLight);
    scene.add(new THREE.AmbientLight(0x8899bb, 0.35));

    function resizeRenderer() {
        const w = panel.clientWidth;
        const h = panel.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
    resizeRenderer();
    window.addEventListener("resize", resizeRenderer);

    // Gentle continuous rotation — roughly one full turn every ~18 seconds
    const ROTATION_SPEED = (2 * Math.PI) / (18 * 60); // radians per frame at ~60fps
    let hovering = false;

    function animate() {
        requestAnimationFrame(animate);
        const speed = hovering ? ROTATION_SPEED * 0.4 : ROTATION_SPEED;
        earth.rotation.y += speed;
        glow.rotation.y += speed;
        renderer.render(scene, camera);
    }
    animate();

    // ---------------------------------------------------------------
    // 3. Interaction — slows on hover, click continues into the app
    // ---------------------------------------------------------------
    panel.addEventListener("mouseenter", () => (hovering = true));
    panel.addEventListener("mouseleave", () => (hovering = false));

    function enterCommandTower() {
        // Phase 4: now heads into the India map instead of straight to
        // the dashboard. india-map.html calls CloudTransition.revealOnLoad()
        // on arrival, so the clouds genuinely part to reveal the map.
        if (window.CloudTransition) {
            window.CloudTransition.coverAndNavigate("/india-map");
        } else {
            // Safety fallback in case cloud-transition.js failed to load
            window.location.href = "/india-map";
        }
    }

    panel.addEventListener("click", enterCommandTower);

    // Exposed so Phase 3's cloud-transition.js can call in and take over
    window.RetailBrainLanding = { enterCommandTower };
})();
