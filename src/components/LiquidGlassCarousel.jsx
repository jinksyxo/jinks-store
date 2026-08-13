import { useEffect, useEffectEvent, useRef, useState } from 'react'
import gsap from 'gsap'
import * as THREE from 'three'

const vertexShader = `
  varying vec2 vUv;
  uniform float uFocus;

  void main() {
    vUv = uv;

    vec3 transformed = position;
    vec2 centeredUv = uv - 0.5;
    float radius = length(centeredUv);
    float bloom = 1.0 - smoothstep(0.05, 0.7, radius);

    transformed.z += bloom * (10.0 * uFocus);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`

const fragmentShader = `
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform float uHover;
  uniform float uFocus;
  uniform float uTime;

  void main() {
    vec2 centeredUv = vUv - 0.5;
    float radius = length(centeredUv);
    vec2 direction = normalize(centeredUv + vec2(0.0001));

    float edgeFalloff = 1.0 - smoothstep(0.08, 0.62, radius);
    float ripple = sin((radius * 20.0) - (uTime * 1.6)) * 0.0014 * uFocus;
    vec2 refraction = direction * edgeFalloff * (0.012 * uFocus);

    vec2 uvR = clamp(vUv + (refraction * 0.65) + ripple, 0.0, 1.0);
    vec2 uvG = clamp(vUv + (refraction * 0.45) - ripple * 0.3, 0.0, 1.0);
    vec2 uvB = clamp(vUv + (refraction * 0.2) + ripple * 0.15, 0.0, 1.0);

    vec3 sampled = vec3(
      texture2D(uTexture, uvR).r,
      texture2D(uTexture, uvG).g,
      texture2D(uTexture, uvB).b
    );

    float sheen = pow(1.0 - smoothstep(0.0, 0.58, radius), 1.8) * (0.12 + (0.18 * uFocus));
    float rim = smoothstep(0.74, 0.18, radius) - smoothstep(0.95, 0.72, radius);
    float topSweep = smoothstep(0.0, 0.45, 1.0 - vUv.y) * smoothstep(0.0, 0.65, vUv.x);

    vec3 glassLight = vec3(1.0) * sheen;
    vec3 neutralGlow = vec3(1.0) * rim * (0.06 + (0.1 * uFocus));
    vec3 sweep = vec3(1.0) * topSweep * (0.02 + (0.05 * uHover));

    vec3 color = sampled + glassLight + neutralGlow + sweep;
    float alpha = mix(0.94, 0.995, uFocus);

    gl_FragColor = vec4(color, alpha);
  }
`

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function wrapOffset(value, total) {
  if (!total) {
    return value
  }

  return ((((value % total) + total) % total) + total) % total
}

function fitWithinBox(aspectRatio, maxWidth, maxHeight) {
  const safeAspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
  const boxAspect = maxWidth / maxHeight

  if (safeAspect >= boxAspect) {
    return {
      width: maxWidth,
      height: maxWidth / safeAspect,
    }
  }

  return {
    width: maxHeight * safeAspect,
    height: maxHeight,
  }
}

function supportsWebGl() {
  try {
    const testCanvas = window.document.createElement('canvas')
    return Boolean(
      testCanvas.getContext('webgl2') ||
        testCanvas.getContext('webgl') ||
        testCanvas.getContext('experimental-webgl'),
    )
  } catch {
    return false
  }
}

function buildSyntheticNavEvent() {
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault() {},
  }
}

function FallbackRail({ items, onNavigate }) {
  return (
    <div className="featured-carousel-stage">
      <div className="featured-rail">
        {items.map((item) => (
          item.href ? (
            <a
              key={`fallback-${item.title}`}
              className="featured-card-link"
              href={item.href}
              onClick={(event) => onNavigate(event, item.href)}
            >
              <article className="featured-card">
                <div className="featured-card-image">
                  <img src={item.image} alt={item.title} />
                </div>

                <div className="featured-card-content">
                  <p className="featured-slide-kicker">{item.eyebrow}</p>
                  <div className="featured-slide-heading">
                    <h3>{item.title}</h3>
                    <span>{item.price}</span>
                  </div>
                  <span className="featured-accent">{item.accent}</span>
                </div>
              </article>
            </a>
          ) : (
            <article key={`fallback-${item.title}`} className="featured-card">
              <div className="featured-card-image">
                <img src={item.image} alt={item.title} />
              </div>

              <div className="featured-card-content">
                <p className="featured-slide-kicker">{item.eyebrow}</p>
                <div className="featured-slide-heading">
                  <h3>{item.title}</h3>
                  <span>{item.price}</span>
                </div>
                <span className="featured-accent">{item.accent}</span>
              </div>
            </article>
          )
        ))}
      </div>
    </div>
  )
}

export default function LiquidGlassCarouselSection({ headingId, items, onNavigate }) {
  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const snapRequestRef = useRef(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [interactionLabel, setInteractionLabel] = useState('drag or scroll')
  const [hasInteractiveSupport] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return false
    }

    return supportsWebGl()
  })
  const selectedItem = items[selectedIndex] || items[0]
  const isFallback = !items.length || !hasInteractiveSupport

  const navigateToItem = useEffectEvent((index) => {
    const targetItem = items[index]

    if (!targetItem?.href || typeof onNavigate !== 'function') {
      return
    }

    onNavigate(buildSyntheticNavEvent(), targetItem.href)
  })

  useEffect(() => {
    if (!items.length || !hasInteractiveSupport) {
      return undefined
    }

    if (typeof window === 'undefined' || !stageRef.current || !canvasRef.current) {
      return undefined
    }

    const stage = stageRef.current
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    })
    renderer.setClearColor(0xffffff, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
    camera.position.z = 400

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const textureLoader = new THREE.TextureLoader()
    const geometry = new THREE.PlaneGeometry(1, 1, 36, 36)
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1, 1, 1)),
      new THREE.LineBasicMaterial({
        color: '#d7d7d7',
        transparent: true,
        opacity: 0.18,
      }),
    )
    frame.visible = false
    scene.add(frame)

    const slides = items.map((item, index) => {
      const slide = {
        mesh: null,
        material: null,
        texture: null,
        aspectRatio: 1,
      }

      const texture = textureLoader.load(item.image, (loadedTexture) => {
        const image = loadedTexture.image
        const width = Number(image?.naturalWidth || image?.videoWidth || image?.width || 0)
        const height = Number(image?.naturalHeight || image?.videoHeight || image?.height || 0)

        if (width > 0 && height > 0) {
          slide.aspectRatio = width / height
        }
      })
      texture.colorSpace = THREE.SRGBColorSpace
      texture.minFilter = THREE.LinearFilter
      texture.magFilter = THREE.LinearFilter

      const material = new THREE.ShaderMaterial({
        transparent: true,
        uniforms: {
          uTexture: { value: texture },
          uHover: { value: 0 },
          uFocus: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader,
        fragmentShader,
      })

      const mesh = new THREE.Mesh(geometry, material)
      mesh.userData.index = index
      scene.add(mesh)

      slide.mesh = mesh
      slide.material = material
      slide.texture = texture

      return slide
    })

    const state = {
      width: 0,
      height: 0,
      cardWidth: 280,
      cardHeight: 340,
      spacing: 340,
      loopWidth: items.length * 340,
      position: 0,
      target: 0,
      velocity: 0,
      hoveredIndex: -1,
      selectedIndex: 0,
      pointerDown: false,
      pointerDragActive: false,
      pointerStartX: 0,
      pointerStartY: 0,
      lastPointerX: 0,
      frameId: 0,
      snapTimeoutId: 0,
      resizeObserver: null,
    }

    const updateSelection = (nextIndex) => {
      if (state.selectedIndex === nextIndex) {
        return
      }

      state.selectedIndex = nextIndex
      setSelectedIndex(nextIndex)
    }

    const nearestTargetForIndex = (index, currentPosition = state.position) => {
      const baseOffset = index * state.spacing
      const candidates = [-1, 0, 1].map((offset) => {
        const loopCount = Math.round((currentPosition - baseOffset) / state.loopWidth)
        return baseOffset + (loopCount + offset) * state.loopWidth
      })

      return candidates.reduce((closest, candidate) => {
        if (closest === null) {
          return candidate
        }

        return Math.abs(candidate - currentPosition) < Math.abs(closest - currentPosition)
          ? candidate
          : closest
      }, null)
    }

    const stopSnapTimer = () => {
      if (state.snapTimeoutId) {
        window.clearTimeout(state.snapTimeoutId)
        state.snapTimeoutId = 0
      }
    }

    const snapToIndex = (index) => {
      stopSnapTimer()
      const nextTarget = nearestTargetForIndex(index)

      if (nextTarget === null) {
        return
      }

      gsap.to(state, {
        target: nextTarget,
        duration: 0.9,
        ease: 'power3.out',
        overwrite: true,
      })
    }

    snapRequestRef.current = snapToIndex

    const scheduleSnap = () => {
      stopSnapTimer()
      state.snapTimeoutId = window.setTimeout(() => {
        snapToIndex(state.selectedIndex)
      }, 140)
    }

    const updatePointer = (event) => {
      const bounds = stage.getBoundingClientRect()
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
      pointer.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1)
    }

    const updateHoverIndex = () => {
      raycaster.setFromCamera(pointer, camera)
      const intersections = raycaster.intersectObjects(slides.map((slide) => slide.mesh), false)
      state.hoveredIndex =
        intersections.length > 0 ? intersections[0].object.userData.index : -1
    }

    const syncDimensions = () => {
      const bounds = stage.getBoundingClientRect()
      const width = Math.max(1, bounds.width)
      const height = Math.max(1, bounds.height)
      const dpr = clamp(window.devicePixelRatio || 1, 1, 1.75)

      state.width = width
      state.height = height
      state.cardWidth = clamp(width * 0.2, 220, 330)
      state.cardHeight = clamp(state.cardWidth * 1.22, 280, 410)
      state.spacing = state.cardWidth * 1.12
      state.loopWidth = Math.max(items.length * state.spacing, 1)

      camera.left = -width / 2
      camera.right = width / 2
      camera.top = height / 2
      camera.bottom = -height / 2
      camera.updateProjectionMatrix()

      renderer.setPixelRatio(dpr)
      renderer.setSize(width, height, false)
    }

    const animate = (time) => {
      state.position += (state.target - state.position) * 0.09
      state.position += state.velocity
      state.velocity *= state.pointerDown ? 0.82 : 0.9

      if (!state.pointerDown && Math.abs(state.velocity) < 0.02) {
        state.velocity = 0
      }

      let closestIndex = state.selectedIndex
      let closestDistance = Number.POSITIVE_INFINITY

      slides.forEach((slide, index) => {
        const baseX = index * state.spacing
        const wrappedX =
          wrapOffset(baseX - state.position + state.loopWidth * 0.5, state.loopWidth) -
          state.loopWidth * 0.5
        const focus = 1 - Math.min(Math.abs(wrappedX) / (state.spacing * 1.6), 1)
        const hoverTarget = state.hoveredIndex === index ? 1 : 0
        const focusTarget = focus > 0.74 ? focus : focus * 0.68
        const scale = 0.92 + focus * 0.12
        const verticalOffset = Math.sin((wrappedX / state.spacing) * 0.55) * 6
        const fittedSize = fitWithinBox(
          slide.aspectRatio,
          state.cardWidth * 0.88,
          state.cardHeight * 0.88,
        )

        slide.material.uniforms.uTime.value = time * 0.001
        slide.material.uniforms.uHover.value = THREE.MathUtils.lerp(
          slide.material.uniforms.uHover.value,
          hoverTarget,
          0.12,
        )
        slide.material.uniforms.uFocus.value = THREE.MathUtils.lerp(
          slide.material.uniforms.uFocus.value,
          focusTarget,
          0.08,
        )

        slide.mesh.position.x = wrappedX
        slide.mesh.position.y = verticalOffset
        slide.mesh.position.z = 18 * focus
        slide.mesh.scale.set(fittedSize.width * scale, fittedSize.height * scale, 1)

        if (Math.abs(wrappedX) < closestDistance) {
          closestDistance = Math.abs(wrappedX)
          closestIndex = index
        }
      })

      const focusSlide = slides[closestIndex]

      if (focusSlide) {
        frame.visible = true
        frame.position.copy(focusSlide.mesh.position)
        frame.position.z = focusSlide.mesh.position.z - 1
        frame.scale.set(
          focusSlide.mesh.scale.x + 18,
          focusSlide.mesh.scale.y + 18,
          1,
        )
      }

      updateSelection(closestIndex)
      renderer.render(scene, camera)
      state.frameId = window.requestAnimationFrame(animate)
    }

    const handleWheel = (event) => {
      const horizontalDelta = event.deltaX
      const verticalDelta = event.deltaY

      if (Math.abs(horizontalDelta) <= Math.abs(verticalDelta) || Math.abs(horizontalDelta) < 1) {
        return
      }

      event.preventDefault()
      gsap.killTweensOf(state)
      state.target += horizontalDelta * 0.7
      setInteractionLabel('scroll to glide')
      scheduleSnap()
    }

    const handlePointerDown = (event) => {
      stage.setPointerCapture?.(event.pointerId)
      gsap.killTweensOf(state)
      stopSnapTimer()
      state.pointerDown = true
      state.pointerDragActive = false
      state.pointerStartX = event.clientX
      state.pointerStartY = event.clientY
      state.lastPointerX = event.clientX
      setInteractionLabel('tap or drag')
    }

    const handlePointerMove = (event) => {
      updatePointer(event)

      if (state.pointerDown) {
        const moveX = event.clientX - state.pointerStartX
        const moveY = event.clientY - state.pointerStartY
        const deadzoneDistance = Math.hypot(moveX, moveY)

        if (!state.pointerDragActive && deadzoneDistance > 8) {
          state.pointerDragActive = true
          setInteractionLabel('dragging')
        }

        if (!state.pointerDragActive) {
          return
        }

        const deltaX = event.clientX - state.lastPointerX
        state.lastPointerX = event.clientX
        state.target -= deltaX * 1.25
        state.velocity = (-deltaX * 1.25) * 0.06
      } else {
        updateHoverIndex()
      }
    }

    const handlePointerUp = (event) => {
      if (!state.pointerDown) {
        return
      }

      stage.releasePointerCapture?.(event.pointerId)
      state.pointerDown = false
      updatePointer(event)
      updateHoverIndex()

      if (!state.pointerDragActive && state.hoveredIndex !== -1) {
        const clickedIndex = state.hoveredIndex
        snapToIndex(clickedIndex)
        navigateToItem(clickedIndex)
        setInteractionLabel('opening product')
        return
      }

      state.pointerDragActive = false
      setInteractionLabel('drag or scroll')
      scheduleSnap()
    }

    const handlePointerLeave = () => {
      state.hoveredIndex = -1

      if (!state.pointerDown) {
        setInteractionLabel('drag or scroll')
      }
    }

    syncDimensions()
    state.frameId = window.requestAnimationFrame(animate)

    if (typeof ResizeObserver === 'function') {
      state.resizeObserver = new ResizeObserver(syncDimensions)
      state.resizeObserver.observe(stage)
    } else {
      window.addEventListener('resize', syncDimensions)
    }

    stage.addEventListener('wheel', handleWheel, { passive: false })
    stage.addEventListener('pointerdown', handlePointerDown)
    stage.addEventListener('pointermove', handlePointerMove)
    stage.addEventListener('pointerup', handlePointerUp)
    stage.addEventListener('pointerleave', handlePointerLeave)
    stage.addEventListener('pointercancel', handlePointerUp)

    return () => {
      snapRequestRef.current = null
      stopSnapTimer()
      window.cancelAnimationFrame(state.frameId)
      gsap.killTweensOf(state)
      stage.removeEventListener('wheel', handleWheel)
      stage.removeEventListener('pointerdown', handlePointerDown)
      stage.removeEventListener('pointermove', handlePointerMove)
      stage.removeEventListener('pointerup', handlePointerUp)
      stage.removeEventListener('pointerleave', handlePointerLeave)
      stage.removeEventListener('pointercancel', handlePointerUp)

      if (state.resizeObserver) {
        state.resizeObserver.disconnect()
      } else {
        window.removeEventListener('resize', syncDimensions)
      }

      slides.forEach((slide) => {
        slide.texture.dispose()
        slide.material.dispose()
        scene.remove(slide.mesh)
      })

      frame.geometry.dispose()
      frame.material.dispose()
      geometry.dispose()
      renderer.dispose()
    }
  }, [hasInteractiveSupport, items])

  if (!items.length) {
    return null
  }

  if (isFallback || !selectedItem) {
    return <FallbackRail items={items} onNavigate={onNavigate} />
  }

  return (
    <div className="liquid-carousel-shell" aria-labelledby={headingId}>
      <div className="liquid-carousel-stage" ref={stageRef}>
        <canvas ref={canvasRef} className="liquid-carousel-canvas" />
        <div className="liquid-carousel-overlay" aria-hidden="true">
          <span className="liquid-carousel-status">{interactionLabel}</span>
        </div>
      </div>

      <div className="liquid-carousel-meta">
        <div className="liquid-carousel-meta-copy">
          <p className="featured-slide-kicker">{selectedItem.eyebrow}</p>
          <div className="liquid-carousel-meta-heading">
            <h3>{selectedItem.title}</h3>
            <span>{selectedItem.price}</span>
          </div>
        </div>

        <div className="liquid-carousel-meta-side">
          <span className="featured-accent">{selectedItem.accent}</span>
        </div>
      </div>
    </div>
  )
}
