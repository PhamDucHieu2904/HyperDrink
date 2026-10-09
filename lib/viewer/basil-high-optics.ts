/**
 * Label Lab's accepted Glass290 High optical integrator, ported to GLSL ES 3.
 *
 * Source: Glass290HighOptics.shader, Glass290HighRenderer.cs (High, not Ultra).
 * Coordinates are the unscaled Unity shell mesh: radial XY, bottle axis Z.
 * Keep the source shell-local frame. World-distance attenuation uses the actual
 * Label Lab display scale; changing it changes optical depth and seed visibility.
 *
 * Each data texture is RGBA32F/NearestFilter, flattened in original Unity order:
 * residualTriangles: a/e1/e2/n0/n1/n2 (6 texels), residualNodes: lo/hi/range (3),
 * profiles: shape/normals/media (3), profileNodes: lo/hi/range (3),
 * seeds: center/inverseX/inverseY/inverseZ (4), seedNodes: lo/hi/range (3).
 * lo.w is an absolute escape index, range.xy is first primitive/count.
 * Residual nodes hold eight near-first copies, indexed by the ray octant.
 *
 * The host provides linear studio reflection/irradiance and a transmitted matte
 * through basilHighEnvironment() and basilHighBackground(). It owns tone mapping
 * and output color conversion. The returned color is additive radiance; native
 * transparent capture uses premultiplied alpha, exactly as Label Lab's compositor.
 */
export const BASIL_HIGH_OPTICS_GLSL = /* glsl */ `
uniform highp sampler2D basilHighResidualTriangles;
uniform highp sampler2D basilHighResidualNodes;
uniform highp sampler2D basilHighProfiles;
uniform highp sampler2D basilHighProfileNodes;
uniform highp sampler2D basilHighSeeds;
uniform highp sampler2D basilHighSeedNodes;
uniform int basilHighDataWidth;
uniform int basilHighResidualNodeStride;
uniform mat4 basilHighLocalToWorld;
uniform vec3 basilHighAbsorption;
uniform vec3 basilHighLiquidColor;
uniform vec3 basilHighSeedColor;
uniform vec3 basilHighLightDirection;
uniform vec3 basilHighLightColor;
uniform float basilHighRayEpsilon;
uniform float basilHighGelThickness;
uniform float basilHighSeedDepth;
uniform float basilHighSpread;
uniform float basilHighRoughness;
uniform float basilHighNativeAlpha;
// NeckVan stores product-local triangles (Y-up), not a circular body profile.
// Its cap is an opaque termination inside the same refracted optical path.
uniform float basilHighNeck;
uniform vec3 basilHighOpaqueColor;

vec3 basilHighEnvironment(vec3 direction, float roughness);
vec3 basilHighBackground(vec3 origin, vec3 direction);

struct BasilHighTriangle { vec4 a; vec4 e1; vec4 e2; vec4 n0; vec4 n1; vec4 n2; };
struct BasilHighNode { vec4 lo; vec4 hi; vec4 range; };
struct BasilHighProfile { vec4 shape; vec4 normals; vec4 media; };
struct BasilHighSeed { vec4 center; vec4 inverseX; vec4 inverseY; vec4 inverseZ; };
struct BasilHighHit { float distance; vec3 normal; vec3 geometric; float outside; float inside; };
struct BasilHighPath { vec3 color; vec3 transmission; float exhausted; };

vec4 basilHighFetch(highp sampler2D source, int index) {
  return texelFetch(source, ivec2(index % basilHighDataWidth, index / basilHighDataWidth), 0);
}
BasilHighTriangle basilHighTriangle(int index) {
  int p = index * 6;
  return BasilHighTriangle(basilHighFetch(basilHighResidualTriangles,p), basilHighFetch(basilHighResidualTriangles,p+1),
    basilHighFetch(basilHighResidualTriangles,p+2), basilHighFetch(basilHighResidualTriangles,p+3),
    basilHighFetch(basilHighResidualTriangles,p+4), basilHighFetch(basilHighResidualTriangles,p+5));
}
BasilHighNode basilHighNode(highp sampler2D source, int index) {
  int p=index*3;
  return BasilHighNode(basilHighFetch(source,p),basilHighFetch(source,p+1),basilHighFetch(source,p+2));
}
BasilHighProfile basilHighProfile(int index) {
  int p=index*3;
  return BasilHighProfile(basilHighFetch(basilHighProfiles,p),basilHighFetch(basilHighProfiles,p+1),basilHighFetch(basilHighProfiles,p+2));
}
BasilHighSeed basilHighSeed(int index) {
  int p=index*4;
  return BasilHighSeed(basilHighFetch(basilHighSeeds,p),basilHighFetch(basilHighSeeds,p+1),
    basilHighFetch(basilHighSeeds,p+2),basilHighFetch(basilHighSeeds,p+3));
}
BasilHighHit basilHighMiss(float limit) { return BasilHighHit(limit,vec3(0),vec3(0),0.0,0.0); }
vec3 basilHighSafeDirection(vec3 direction) {
  return vec3(abs(direction.x)<1e-10?1e-10:direction.x,
    abs(direction.y)<1e-10?1e-10:direction.y,abs(direction.z)<1e-10?1e-10:direction.z);
}
bool basilHighBox(vec3 origin, vec3 inverseDirection, BasilHighNode node, float nearest) {
  vec3 t0=(node.lo.xyz-origin)*inverseDirection,t1=(node.hi.xyz-origin)*inverseDirection;
  vec3 nearV=min(t0,t1),farV=max(t0,t1);
  return max(max(nearV.x,nearV.y),max(nearV.z,0.0))<=min(min(farV.x,farV.y),min(farV.z,nearest));
}
bool basilHighSeedBox(vec3 origin,vec3 inverseDirection,BasilHighNode node,float nearest) {
  vec3 center=(node.lo.xyz+node.hi.xyz)*.5;
  vec3 extent=(node.hi.xyz-node.lo.xyz)*.5+basilHighGelThickness;
  vec3 t0=(center-extent-origin)*inverseDirection,t1=(center+extent-origin)*inverseDirection;
  vec3 nearV=min(t0,t1),farV=max(t0,t1);
  return max(max(nearV.x,nearV.y),max(nearV.z,0.0))<=min(min(farV.x,farV.y),min(farV.z,nearest));
}

BasilHighHit basilHighTraceResidual(vec3 origin,vec3 direction,float limit) {
  BasilHighHit result=basilHighMiss(limit);int bestIndex=-1;vec2 bestBary=vec2(0);
  vec3 inverseDirection=1.0/basilHighSafeDirection(direction);
  int octant=(direction.x<0.0?1:0)+(direction.y<0.0?2:0)+(direction.z<0.0?4:0);
  int node=octant*basilHighResidualNodeStride;
  int end=int(basilHighNode(basilHighResidualNodes,node).lo.w);
  while(node<end) {
    BasilHighNode item=basilHighNode(basilHighResidualNodes,node);
    if(!basilHighBox(origin,inverseDirection,item,result.distance)){node=int(item.lo.w);continue;}
    for(int i=0;i<int(item.range.y);i++) {
      BasilHighTriangle tri=basilHighTriangle(int(item.range.x)+i);
      vec3 p=cross(direction,tri.e2.xyz);float determinant=dot(tri.e1.xyz,p);
      if(abs(determinant)<max(1e-30,tri.e2.w))continue;
      float inverseDeterminant=1.0/determinant;vec3 offset=origin-tri.a.xyz;
      float u=dot(offset,p)*inverseDeterminant;if(u<-.00001||u>1.00001)continue;
      vec3 q=cross(offset,tri.e1.xyz);float v=dot(direction,q)*inverseDeterminant;
      if(v<-.00001||u+v>1.00001)continue;
      float distance=dot(tri.e2.xyz,q)*inverseDeterminant;
      if(distance>basilHighRayEpsilon*.5&&distance<result.distance) {
        result.distance=distance;bestIndex=int(item.range.x)+i;bestBary=vec2(u,v);
      }
    }
    node++;
  }
  if(bestIndex>=0) {
    BasilHighTriangle tri=basilHighTriangle(bestIndex);
    result.normal=normalize(tri.n0.xyz*(1.0-bestBary.x-bestBary.y)+tri.n1.xyz*bestBary.x+tri.n2.xyz*bestBary.y);
    result.geometric=normalize(cross(tri.e1.xyz,tri.e2.xyz));result.outside=tri.a.w;result.inside=tri.e1.w;
  }
  return result;
}
void basilHighAcceptProfile(BasilHighProfile p,vec3 origin,vec3 direction,float distance,inout BasilHighHit hit) {
  if(distance<=basilHighRayEpsilon*.5||distance>=hit.distance)return;
  vec3 position=origin+direction*distance;
  if(position.z<p.shape.x-basilHighRayEpsilon||position.z>p.shape.y+basilHighRayEpsilon)return;
  float along=clamp((position.z-p.shape.x)/(p.shape.y-p.shape.x),0.0,1.0);
  vec2 radial=normalize(position.xy);
  hit.distance=distance;hit.outside=p.media.x;hit.inside=p.media.y;
  hit.geometric=normalize(vec3(radial,-p.shape.w))*p.media.z;
  hit.normal=normalize(vec3(radial*mix(p.normals.x,p.normals.z,along),mix(p.normals.y,p.normals.w,along)));
}
BasilHighHit basilHighTraceProfiles(vec3 origin,vec3 direction,float limit) {
  BasilHighHit hit=basilHighMiss(limit);vec3 inverseDirection=1.0/basilHighSafeDirection(direction);
  int node=0,end=int(basilHighNode(basilHighProfileNodes,0).lo.w);
  while(node<end) {
    BasilHighNode item=basilHighNode(basilHighProfileNodes,node);
    if(!basilHighBox(origin,inverseDirection,item,hit.distance)){node=int(item.lo.w);continue;}
    for(int i=0;i<int(item.range.y);i++) {
      BasilHighProfile p=basilHighProfile(int(item.range.x)+i);
      if(abs(direction.z)<1e-10&&(origin.z<p.shape.x||origin.z>p.shape.y))continue;
      float r=p.shape.z+p.shape.w*(origin.z-p.shape.x),dr=p.shape.w*direction.z;
      float a=dot(direction.xy,direction.xy)-dr*dr;
      float b=dot(origin.xy,direction.xy)-r*dr,c=dot(origin.xy,origin.xy)-r*r;
      if(abs(a)<1e-8){if(abs(b)>1e-20)basilHighAcceptProfile(p,origin,direction,-c/(2.0*b),hit);continue;}
      float discriminant=b*b-a*c;if(discriminant<0.0)continue;
      float q=-b-(b>=0.0?1.0:-1.0)*sqrt(discriminant);
      if(abs(q)<1e-20){basilHighAcceptProfile(p,origin,direction,-b/a,hit);continue;}
      basilHighAcceptProfile(p,origin,direction,q/a,hit);basilHighAcceptProfile(p,origin,direction,c/q,hit);
    }
    node++;
  }
  return hit;
}
BasilHighHit basilHighTraceSeeds(vec3 origin,vec3 direction,float limit) {
  BasilHighHit result=basilHighMiss(limit);float gelDistance=limit;
  vec3 inverseDirection=1.0/basilHighSafeDirection(direction);
  int node=0,end=int(basilHighNode(basilHighSeedNodes,0).lo.w);
  while(node<end) {
    BasilHighNode item=basilHighNode(basilHighSeedNodes,node);
    if(!basilHighSeedBox(origin,inverseDirection,item,result.distance)){node=int(item.lo.w);continue;}
    for(int i=0;i<int(item.range.y);i++) {
      BasilHighSeed seed=basilHighSeed(int(item.range.x)+i);vec3 offset=origin-seed.center.xyz;
      vec3 o=vec3(dot(offset,seed.inverseX.xyz),dot(offset,seed.inverseY.xyz),dot(offset,seed.inverseZ.xyz));
      vec3 d=vec3(dot(direction,seed.inverseX.xyz),dot(direction,seed.inverseY.xyz),dot(direction,seed.inverseZ.xyz));
      float a=dot(d,d),center=-dot(o,d)/a;vec3 closest=o+d*center;
      float closestSquared=dot(closest,closest);
      if(basilHighGelThickness>0.0) {
        vec3 scale=1.0+basilHighGelThickness*vec3(length(seed.inverseX.xyz),length(seed.inverseY.xyz),length(seed.inverseZ.xyz));
        vec3 go=o/scale,gd=d/scale;float ga=dot(gd,gd),gc=-dot(go,gd)/ga;
        vec3 gp=go+gd*gc;float gelSquare=(1.0-dot(gp,gp))/ga;
        if(gelSquare>=0.0) {
          float gelEntry=gc-sqrt(gelSquare);if(gelEntry<=basilHighRayEpsilon*.5)gelEntry=gc+sqrt(gelSquare);
          if(gelEntry>basilHighRayEpsilon*.5&&gelEntry<gelDistance)gelDistance=gelEntry;
        }
      }
      float square=(1.0-closestSquared)/a;if(square<0.0)continue;
      float radius=sqrt(square),distance=center-radius;if(distance<=basilHighRayEpsilon*.5)distance=center+radius;
      if(distance>basilHighRayEpsilon*.5&&distance<result.distance) {
        vec3 n=o+d*distance;result.distance=distance;
        result.normal=normalize(seed.inverseX.xyz*n.x+seed.inverseY.xyz*n.y+seed.inverseZ.xyz*n.z);
      }
    }
    node++;
  }
  result.outside=result.distance;
  if(gelDistance<result.distance){result.distance=gelDistance;result.inside=1.0;}
  return result;
}
float basilHighIOR(float medium) {return medium<.5?1.0:(medium<1.5?1.52:1.333);}
float basilHighFresnel(float cosine,float etaI,float etaT,out float cosineT) {
  float sinT2=(etaI*etaI)/(etaT*etaT)*max(0.0,1.0-cosine*cosine);
  cosineT=sqrt(max(0.0,1.0-sinT2));if(sinT2>=1.0)return 1.0;
  float rs=(etaI*cosine-etaT*cosineT)/max(.000001,etaI*cosine+etaT*cosineT);
  float rp=(etaT*cosine-etaI*cosineT)/max(.000001,etaT*cosine+etaI*cosineT);
  return clamp((rs*rs+rp*rp)*.5,0.0,1.0);
}
BasilHighPath basilHighIntegrate(vec3 origin,vec3 direction,vec3 entryNormal,vec3 entryGeometric,vec2 sampleOffset) {
  BasilHighPath outputPath=BasilHighPath(vec3(0),vec3(0),0.0);
  float medium=1.0;bool spreadApplied=false;
  float entryCosT,entryCos=clamp(-dot(entryNormal,direction),0.0,1.0);
  float entryF=basilHighFresnel(entryCos,1.0,1.52,entryCosT);
  vec3 transmitted=normalize(direction/1.52+(entryCos/1.52-entryCosT)*entryNormal);
  if(dot(transmitted,entryGeometric)>=0.0) {
    entryNormal=entryGeometric;entryCos=clamp(-dot(entryNormal,direction),0.0,1.0);
    entryF=basilHighFresnel(entryCos,1.0,1.52,entryCosT);transmitted=normalize(direction/1.52+(entryCos/1.52-entryCosT)*entryNormal);
  }
  outputPath.color=entryF*basilHighEnvironment(reflect(direction,entryNormal),basilHighRoughness);
  vec3 weight=vec3(1.0-entryF);direction=transmitted;origin-=entryGeometric*(basilHighRayEpsilon*2.0);
  for(int bounce=0;bounce<8;bounce++) {
    BasilHighHit hit=basilHighTraceResidual(origin,direction,1000.0);
    if(basilHighNeck<.5) {
      BasilHighHit profile=basilHighTraceProfiles(origin,direction,hit.distance);
      if(profile.distance<hit.distance)hit=profile;
    }
    float worldDistanceScale=length(mat3(basilHighLocalToWorld)*direction);
    if(basilHighNeck>.5&&hit.distance<999.0&&hit.inside>2.5) {
      vec3 n=dot(hit.normal,direction)>0.0?-hit.normal:hit.normal;
      outputPath.color+=weight*basilHighOpaqueColor*(basilHighEnvironment(reflect(direction,n),.18)*.8+basilHighEnvironment(n,1.0)*.2);
      outputPath.transmission=vec3(0);return outputPath;
    }
    if(medium>1.5) {
      BasilHighHit seed=basilHighTraceSeeds(origin,direction,hit.distance);
      if(seed.distance<hit.distance) {
        float coreDistance=seed.inside>.5?seed.outside:seed.distance;vec3 core=vec3(0);
        if(coreDistance<hit.distance) {
          vec3 n=dot(seed.normal,direction)>0.0?-seed.normal:seed.normal;
          vec3 worldNormal=normalize(mat3(basilHighLocalToWorld)*n);
          vec3 lighting=basilHighEnvironment(n,1.0)+basilHighLightColor*clamp(dot(worldNormal,basilHighLightDirection),0.0,1.0)*0.3183098861837907;
          core=exp(-basilHighAbsorption*coreDistance*worldDistanceScale)*basilHighSeedColor*lighting;
          float visibility=exp(-basilHighSeedDepth*coreDistance*worldDistanceScale);
          core=mix(basilHighLiquidColor*.4,core,visibility);
        }
        if(coreDistance>=hit.distance) {
          vec3 gelTint=mix(vec3(1),clamp(basilHighLiquidColor,0.0,1.0),.5);
          float gelVisibility=exp(-basilHighSeedDepth*seed.distance*worldDistanceScale);
          vec3 haze=gelTint*basilHighEnvironment(-direction,.85)*.28*gelVisibility;
          outputPath.color+=weight*exp(-basilHighAbsorption*seed.distance*worldDistanceScale)*haze;
          weight*=1.0-.15*gelVisibility;
        } else {outputPath.color+=weight*core;outputPath.transmission=vec3(0);return outputPath;}
      }
      weight*=exp(-basilHighAbsorption*min(hit.distance*worldDistanceScale,10.0));
    }
    // High glass absorption is explicitly zero in Glass290HighRenderer.
    if(hit.distance>=999.0) {outputPath.color+=weight*basilHighBackground(origin,direction);outputPath.transmission=weight;return outputPath;}
    bool entering=dot(direction,hit.geometric)<0.0;float target=entering?hit.inside:hit.outside;
    vec3 normal=entering?hit.normal:-hit.normal;
    if(dot(normal,direction)>=-.0001)normal=entering?hit.geometric:-hit.geometric;
    float etaI=basilHighIOR(medium),etaT=basilHighIOR(target),cosT;
    float cosine=clamp(-dot(normal,direction),0.0,1.0),f=basilHighFresnel(cosine,etaI,etaT,cosT);
    origin+=direction*hit.distance;
    if(f>=.999999) {direction=reflect(direction,normal);origin+=(entering?hit.geometric:-hit.geometric)*(basilHighRayEpsilon*2.0);continue;}
    outputPath.color+=weight*f*basilHighEnvironment(reflect(direction,normal),bounce==0?basilHighRoughness:.025);
    weight*=1.0-f;direction=normalize((etaI/etaT)*direction+((etaI/etaT)*cosine-cosT)*normal);medium=target;
    if(medium>1.5&&!spreadApplied) {
      vec3 axis=abs(direction.z)<.9?vec3(0,0,1):vec3(0,1,0);
      vec3 tangent=normalize(cross(direction,axis)),bitangent=normalize(cross(direction,tangent));
      direction=normalize(direction+basilHighSpread*(tangent*sampleOffset.x+bitangent*sampleOffset.y));spreadApplied=true;
    }
    origin+=(entering?-hit.geometric:hit.geometric)*(basilHighRayEpsilon*2.0);
    if(medium<.5&&bounce>0&&basilHighNeck<.5) {outputPath.color+=weight*basilHighBackground(origin,direction);outputPath.transmission=weight;return outputPath;}
  }
  outputPath.color+=weight*basilHighEnvironment(direction,.1);outputPath.exhausted=1.0;outputPath.transmission=vec3(0);return outputPath;
}
vec4 basilHighShade(vec3 positionNative,vec3 normalNative,vec3 cameraNative) {
  vec3 direction=normalize(positionNative-cameraNative);
  vec3 entryGeometric=normalize(cross(dFdx(positionNative),dFdy(positionNative)));
  if(dot(entryGeometric,direction)>0.0)entryGeometric=-entryGeometric;
  vec3 entryNormal=normalize(normalNative);if(dot(entryNormal,direction)>=0.0)entryNormal=entryGeometric;
  BasilHighPath result=basilHighIntegrate(positionNative,direction,entryNormal,entryGeometric,vec2(0));
  if(basilHighSpread>.0001) {
    BasilHighPath a=basilHighIntegrate(positionNative,direction,entryNormal,entryGeometric,vec2(.55,0));
    BasilHighPath b=basilHighIntegrate(positionNative,direction,entryNormal,entryGeometric,vec2(-.55,0));
    BasilHighPath c=basilHighIntegrate(positionNative,direction,entryNormal,entryGeometric,vec2(0,.55));
    BasilHighPath d=basilHighIntegrate(positionNative,direction,entryNormal,entryGeometric,vec2(0,-.55));
    result.color=.3125*result.color+.171875*(a.color+b.color+c.color+d.color);
    result.transmission=.3125*result.transmission+.171875*(a.transmission+b.transmission+c.transmission+d.transmission);
  }
  float alpha=basilHighNativeAlpha>.5?clamp(1.0-dot(result.transmission,vec3(.2126,.7152,.0722)),0.0,1.0):1.0;
  return vec4(max(result.color,vec3(0)),alpha);
}
`;

/** Unpolarized dielectric Fresnel, including total internal reflection. */
export function basilHighFresnel(cosine: number, etaI: number, etaT: number): number {
  const sinT2 = (etaI * etaI) / (etaT * etaT) * Math.max(0, 1 - cosine * cosine);
  if (sinT2 >= 1) return 1;
  const cosineT = Math.sqrt(Math.max(0, 1 - sinT2));
  const rs = (etaI * cosine - etaT * cosineT) / Math.max(1e-6, etaI * cosine + etaT * cosineT);
  const rp = (etaT * cosine - etaI * cosineT) / Math.max(1e-6, etaT * cosine + etaI * cosineT);
  return Math.min(1, Math.max(0, (rs * rs + rp * rp) * .5));
}

/** Defaults and UI response copied from Glass290HighRenderer.ConfigureProperties. */
export function basilHighLiquidParameters(
  colorSrgb: readonly [number, number, number],
  smoothness: number,
  turbidityRatio = 1,
  opacityRatio = 1,
  seedDepthFade = .6,
  depthAwareness = .606,
) {
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
  const density = 7.5 * Math.min(3, Math.max(0, turbidityRatio)) * Math.min(3, Math.max(0, opacityRatio));
  return {
    absorption: colorSrgb.map((channel) => density * (1 - clamp01(channel))) as [number, number, number],
    seedDepth: (.5 + 17.5 * clamp01(seedDepthFade)) * .1 * clamp01(depthAwareness) * density / 7.5,
    spread: .015 * Math.pow(1 - clamp01(smoothness), 1.5),
  };
}
