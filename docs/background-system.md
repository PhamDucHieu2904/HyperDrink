# Flavor background

`components/FlavorBackground.tsx` owns decorative rendering and motion. It takes a flavor index, a JSON-serializable `config` prop and the stable `BackgroundRenderState` created by `ShowcaseHero`. `lib/background-config.ts` defines the version 1 contract, defaults, bounds and flavor palette. No animation state is stored in React and no extra WebGL context is created.

`lib/background-render-state.ts` supplies the SVG artwork registry, theme transition controller and current pattern offset. Transitions use a 900 ms smoothstep blend and start from the current weights when interrupted. CSS layers and the optional droplet backdrop sampler consume the same weights/offsets rather than running separate animation clocks. `lib/viewer/backdrop-texture.ts` reconstructs these authored layers for clear floating water refraction inside the existing product renderer. The water ripple effect and its GPU simulation remain removed.

## Parameters for a future admin

| Field | Default | Meaning |
| --- | --- | --- |
| cellSize | 88 | Square size in CSS pixels; clamped 48–180 |
| iconSize | 38 | SVG size; limited to 70% of a cell |
| iconSpacing | 3 | One icon per 3×3 tile; minimum 3 keeps eight neighbors empty |
| lineOpacity / iconOpacity | .24 / .65 | White grid/icon strength, 0–1 |
| maxSpeed | 26.4 | Constant travel speed in CSS pixels per second, 0–80; 10% faster than the original 24; legacy field name retained |
| dampingSeconds | 1.3 | Time constant; larger means slower acceleration/deceleration |
| autoDriftEnabled | true | Drift automatically when no mouse pointer controls the hero |
| autoDirectionMinSeconds / autoDirectionMaxSeconds | 2 / 6 | Choose a new random heading after a uniformly random interval in this range; clamped .5–30s with maximum ≥ minimum |
| deadZone | .08 | Legacy saved field; ignored by constant-speed pointer steering |
| enabled | true | Enable pointer and autonomous motion; false retains a static pattern |
| productGlowOpacity | .96 | Product backdrop light strength, 0–1; 0 turns it off |
| productGlowWidth / productGlowHeight | 1.45 / 1.35 | Light size relative to the product container; clamped .5–2 |

Themes currently select a color and a controlled SVG icon ID. Extend the icon registry for new fruit artwork. Do not accept arbitrary SVG/HTML from an admin field. When adding an API, validate the version and palette there, persist these fields, and pass normalized data into the component. Admin UI, persistence and authentication are not implemented here.

The demo palette uses brighter orange, berry pink, coral peach and lime green, derived from the shared flavor registry. `ShowcaseHero` consumes the normalized lighting values as CSS variables. A feathered radial layer uses `mix-blend-mode: overlay` inside the isolated background, so it blends with the flavor color/grid rather than painting a translucent white sheet above the scene. It brightens the background independently of the product's HDRI and PBR lighting. The light is static, passes pointer events through, and needs no extra animation loop or GPU context.

## Motion

Mouse position relative to the visible hero center sets direction only. Every noncentral position has the same target speed (`maxSpeed`); physical X/Y offsets are normalized together, so diagonal movement has that same speed and direction is not skewed by viewport aspect ratio. The exact center has no steering direction and hands control back to autonomous travel. Angular steering is damped separately from the scalar speed: turning cannot slow travel through vector cancellation. Distance from the center never affects it. Integration uses elapsed seconds, exponential damping and a 50ms delta cap. Pattern offsets wrap by the complete tile period, preventing gaps or unbounded coordinates. Switching flavors crossfades color/icons without resetting motion.

Before a mouse enters, after it leaves and on touch devices, `BackgroundAutodrift` supplies a heading in any direction. Its next heading is selected after a random 2–6 second interval by default. This uses the same constant speed and angular damping as mouse steering, so each turn is gradual and a mouse-to-autonomous handoff does not stop or jump. Setting `autoDriftEnabled` false restores pointer-only movement and eases the pattern to a stop when the mouse leaves. Older saved configurations receive the new automatic defaults through normalization. Configuration changes rebuild only this lightweight controller.

Pointer events pass through the decoration. Reduced-motion users see a static pattern; touch users receive automatic movement. Autonomous movement starts at the configured speed on mount without waiting for a click, pointer event or window focus. A window blur releases mouse steering to autonomous movement instead of suspending a still-visible page. Offscreen and hidden pages stop scheduling frames and resume from their existing pattern offset and current timestamp, without accumulating hidden travel or random timers. Listeners, observers and animation frames are cleaned up on unmount/config changes. No image download or per-frame React render is needed.
