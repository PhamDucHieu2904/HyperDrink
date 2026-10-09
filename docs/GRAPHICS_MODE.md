# Manual storefront graphics mode

The circular gem button at the upper right of the hero product controls a shared
graphics preference. First visit defaults to **standard**. The explicit choice
is retained between products, flavors and visits (`vinut.graphics-mode.v1`);
blocked local storage still allows session switching. No benchmark, frame-rate
classifier or automatic promotion/demotion runs.

- **Standard:** the existing optimized white liquid reservoir, shared softbox
  HDRI, internal bottle/gel refraction and calibrated inclusions remain intact.
- **Enhanced:** Aloe 500 ml, Basil 290 ml and Cojo 320 ml can additionally refract
  the real hero backdrop, rear splash and accent objects. Metal packaging stays
  opaque. Basil retains the web instance/cone pipeline; this does not reactivate
  the expensive Label Lab High BVH renderer.

`ProductVisual` requests the optional existing backdrop pass only for the selected
refractive product (or existing native decoration requirements). The same small
512/768-pixel capture is shared with the decorative lenses. Disabled bottle-only
captures dispose their canvas texture, resize observer and GPU target; preexisting
native-water decorations keep their own established behavior.

The controller binds a scene-owned sampler. Material draw callbacks consult that
sampler, so warmed/pooled flavors cannot retain an obsolete target. Mode changes
do not reload geometry, labels or HDRI, rebuild seeds/pulp, or recompile the optical
programs. Native transmission of water/inclusions stays in place: Aloe samples
the projected refracted exit ray; Basil/Cojo replace the white rear reservoir
before the existing front lens bends it. Cap/print capture exclusions stay intact.

The button has a 46 px touch target, keyboard support, `aria-pressed`, translated
accessible name and a focus/touch tooltip. It sits left of the featured card on
desktop and at the upper right of the product on mobile. Mockup native PNG export
retains its existing independent linear/RGBA pipeline.

Validation: `npm run test:graphics`, viewer/catalog/Basil/water/Mockup suites,
TypeScript, scoped ESLint and production build. Browser checks cover on/off,
product/flavor continuity, reload persistence and responsive placement. Enhanced
graphics remains an explicit higher-cost option; automated tests do not constitute
a physical-phone or DevTools 4× CPU performance measurement.
