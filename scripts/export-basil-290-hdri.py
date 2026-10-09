"""Read-only Label Lab environment -> linear EXR at its Unity import cap."""
import bpy, hashlib, json, pathlib, traceback
ROOT=pathlib.Path(__file__).resolve().parent.parent
SOURCE=pathlib.Path(r'D:\UnityHubData\Unity_3D_Mockup_Project\Assets\Data\HDRI\a_6.exr')
OUT=ROOT/'public/environments';OUT.mkdir(parents=True,exist_ok=True)
try:
    before=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    image=bpy.data.images.load(str(SOURCE),check_existing=False)
    original=list(image.size);image.colorspace_settings.name='Linear Rec.709'
    width=2048;height=round(original[1]*width/original[0]);image.scale(width,height)
    scene=bpy.context.scene;scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
    scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='16';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.exr_codec='ZIP'
    output=OUT/'label-lab-basil-high.exr';image.save_render(str(output),scene=scene)
    result=dict(state='complete',source=str(SOURCE),sourceSha256=before,sourceUnchanged=before==hashlib.sha256(SOURCE.read_bytes()).hexdigest(),originalResolution=original,outputResolution=[width,height],linear=True,exposure=0,colorDepth=16,unityImportMaximum=2048,output=output.name,bytes=output.stat().st_size,sha256=hashlib.sha256(output.read_bytes()).hexdigest())
except Exception:result=dict(state='failed',error=traceback.format_exc())
(ROOT/'.tmp/basil-290/hdri-export.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
