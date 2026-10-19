export const waterVertexShader = `#version 300 es
  in vec2 a_position;
  out vec2 v_uv;
  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

/** R is the current height, G is the previous height. Two targets propagate the surface. */
export const waterSimulationShader = `#version 300 es
  precision highp float;
  uniform sampler2D u_state;
  uniform vec2 u_texel;
  uniform vec2 u_size;
  uniform vec2 u_from;
  uniform vec2 u_to;
  uniform float u_impulse;
  in vec2 v_uv;
  out vec4 outColor;

  void main() {
    vec2 state = texture(u_state, v_uv).rg;
    float neighbors = texture(u_state, v_uv + vec2(u_texel.x, 0.0)).r
                    + texture(u_state, v_uv - vec2(u_texel.x, 0.0)).r
                    + texture(u_state, v_uv + vec2(0.0, u_texel.y)).r
                    + texture(u_state, v_uv - vec2(0.0, u_texel.y)).r;
    float height = (state.r * 2.0 - state.g + (neighbors - state.r * 4.0) * 0.45) * 0.985;
    vec2 p = v_uv * u_size;
    vec2 a = u_from * u_size;
    vec2 segment = (u_to - u_from) * u_size;
    float along = clamp(dot(p - a, segment) / max(dot(segment, segment), 0.0001), 0.0, 1.0);
    float distanceToStroke = length(p - a - segment * along);
    height -= exp(-distanceToStroke * distanceToStroke / 5.0) * u_impulse;
    // Absorb the edge instead of reflecting a hard rectangular boundary.
    vec2 edge = min(v_uv, 1.0 - v_uv) / u_texel;
    height *= smoothstep(0.0, 5.0, min(edge.x, edge.y));
    outColor = vec4(clamp(height, -1.5, 1.5), state.r, 0.0, 1.0);
  }
`;

export const waterSurfaceShader = `#version 300 es
  precision highp float;
  uniform sampler2D u_state;
  uniform sampler2D u_pattern;
  uniform vec2 u_texel;
  uniform vec2 u_size;
  uniform float u_period;
  uniform float u_offset;
  uniform float u_time;
  uniform vec3 u_base;
  uniform vec3 u_accent;
  in vec2 v_uv;
  out vec4 outColor;

  void main() {
    vec2 slope = vec2(
      texture(u_state, v_uv + vec2(u_texel.x, 0.0)).r - texture(u_state, v_uv - vec2(u_texel.x, 0.0)).r,
      texture(u_state, v_uv + vec2(0.0, u_texel.y)).r - texture(u_state, v_uv - vec2(0.0, u_texel.y)).r
    );
    vec2 pixel = vec2(v_uv.x, 1.0 - v_uv.y) * u_size;
    // Refract the actual grid and icons, rather than adding a translucent color overlay.
    vec2 refracted = pixel + vec2(slope.x, -slope.y) * 90.0;
    vec4 pattern = texture(u_pattern, (refracted - u_offset) / u_period);
    vec2 uv = refracted / u_size;
    vec3 paper = vec3(0.978, 0.976, 0.940);
    vec3 flavor = mix(u_base, vec3(1.0), 0.42);
    float centerLight = exp(-dot((uv - vec2(0.53, 0.45)) * vec2(1.8, 1.1), (uv - vec2(0.53, 0.45)) * vec2(1.8, 1.1)) * 3.0);
    float flow = sin(uv.x * 4.0 + uv.y * 2.0 + u_time * 0.16) * 0.035;
    vec3 background = mix(flavor, paper, clamp(centerLight * 0.84 + flow, 0.0, 1.0));
    vec3 surface = mix(background, pattern.rgb, pattern.a);
    vec3 normal = normalize(vec3(slope * 2.8, 1.0));
    vec3 light = normalize(vec3(-0.5, 0.65, 1.0));
    float relief = dot(normal, light) - light.z;
    surface += relief * 0.32;
    surface += vec3(0.95, 1.0, 0.97) * pow(max(relief, 0.0), 1.2) * 0.40;
    surface = mix(surface, u_accent * 0.55, clamp(-relief, 0.0, 0.4) * 0.16);
    outColor = vec4(surface, 1.0);
  }
`;
