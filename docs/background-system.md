# Flavor background

`components/FlavorBackground.tsx` owns decorative rendering and motion. It takes a flavor index, a JSON-serializable `config` prop and the stable `BackgroundRenderState` created by `ShowcaseHero`. `lib/background-config.ts` defines the version 1 contract, defaults, bounds and flavor palette. No animation state is stored in React and no extra WebGL context is created.

`lib/background-render-state.ts` supplies the SVG artwork registry and theme transition controller. Transitions use a 900 ms smoothstep blend and start from the current weights when interrupted. The CSS layers consume the same weights rather than running a separate transition clock. The background is independent of the can's WebGL scene; the water ripple effect and its GPU simulation have been removed.

## Parameters for a future admin

| Field | Default | Meaning |
| --- | --- | --- |
| cellSize | 88 | Square size in CSS pixels; clamped 48–180 |
| iconSize | 38 | SVG size; limited to 70% of a cell |
| iconSpacing | 3 | One icon per 3×3 tile; minimum 3 keeps eight neighbors empty |
| lineOpacity / iconOpacity | .24 / .65 | White grid/icon strength, 0–1 |
| maxSpeed | 24 | Constant travel speed in CSS pixels per second, 0–80; legacy field name retained |
| dampingSeconds | 1.3 | Time constant; larger means slower acceleration/deceleration |
| deadZone | .08 | Legacy saved field; ignored by constant-speed pointer steering |
| enabled | true | Enable pointer motion; false retains a static pattern |
| productGlowOpacity | .82 | Product backdrop light strength, 0–1; 0 turns it off |
| productGlowWidth / productGlowHeight | 1.45 / 1.35 | Light size relative to the product container; clamped .5–2 |

Themes currently select a color and a controlled SVG icon ID. Extend the icon registry for new fruit artwork. Do not accept arbitrary SVG/HTML from an admin field. When adding an API, validate the version and palette there, persist these fields, and pass normalized data into the component. Admin UI, persistence and authentication are not implemented here.

The demo palette uses brighter orange, berry pink, coral peach and lime green, derived from the shared flavor registry. `ShowcaseHero` consumes the normalized lighting values as CSS variables. A feathered radial layer uses `mix-blend-mode: overlay` inside the isolated background, so it blends with the flavor color/grid rather than painting a translucent white sheet above the scene. It brightens the background independently of the product's HDRI and PBR lighting. The light is static, passes pointer events through, and needs no extra animation loop or GPU context.

## Motion

Mouse position relative to the visible hero center sets direction only. Every noncentral position has the same target speed (`maxSpeed`); physical X/Y offsets are normalized together, so diagonal movement has that same speed and direction is not skewed by viewport aspect ratio. The exact center has no direction. Angular steering is damped separately from the scalar speed: turning cannot slow travel through vector cancellation. Speed eases up on entry and down on exit; distance from the center never affects it. Integration uses elapsed seconds, exponential damping and a 50ms delta cap. Pattern offsets wrap by the complete tile period, preventing gaps or unbounded coordinates. Switching flavors crossfades color/icons without resetting motion.

Pointer events pass through the decoration. Touch and reduced-motion users see a static pattern. Offscreen/hidden pages stop scheduling frames; listeners, observers and animation frames are cleaned up on unmount/config changes. No image download or per-frame React render is needed.
