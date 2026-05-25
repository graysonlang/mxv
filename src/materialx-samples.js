export const materialSamples = {
  standard: `<?xml version="1.0"?>
<materialx version="1.39" colorspace="lin_rec709">
  <standard_surface name="SR_standard" type="surfaceshader">
    <input name="base" type="float" value="1.0" />
    <input name="base_color" type="color3" value="0.8, 0.8, 0.8" />
    <input name="diffuse_roughness" type="float" value="0.2" />
    <input name="specular" type="float" value="1" />
    <input name="specular_color" type="color3" value="1, 1, 1" />
    <input name="specular_roughness" type="float" value="0.2" />
    <input name="specular_IOR" type="float" value="1.5" />
    <input name="metalness" type="float" value="0" />
    <input name="transmission" type="float" value="0" />
    <input name="thin_walled" type="boolean" value="false" />
    <input name="opacity" type="color3" value="1, 1, 1" />
  </standard_surface>
  <surfacematerial name="MAT_standard" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="SR_standard" />
  </surfacematerial>
</materialx>`,
  pearl: `<?xml version="1.0"?>
<materialx version="1.39" colorspace="lin_rec709">
  <standard_surface name="SR_pearl" type="surfaceshader">
    <input name="base" type="float" value="1.0" />
    <input name="base_color" type="color3" value="0.965, 0.945, 0.902" />
    <input name="diffuse_roughness" type="float" value="0.180" />
    <input name="specular" type="float" value="1" />
    <input name="specular_color" type="color3" value="0.969, 0.957, 1.000" />
    <input name="specular_roughness" type="float" value="0.180" />
    <input name="specular_IOR" type="float" value="1.520" />
    <input name="metalness" type="float" value="0" />
    <input name="transmission" type="float" value="0.080" />
    <input name="transmission_color" type="color3" value="1.000, 0.973, 0.906" />
    <input name="subsurface" type="float" value="0.380" />
    <input name="subsurface_color" type="color3" value="1.000, 0.941, 0.847" />
    <input name="subsurface_radius" type="color3" value="1.000, 0.851, 0.749" />
    <input name="subsurface_scale" type="float" value="0.420" />
    <input name="sheen" type="float" value="0.220" />
    <input name="sheen_color" type="color3" value="0.812, 0.847, 1.000" />
    <input name="sheen_roughness" type="float" value="0.380" />
    <input name="coat" type="float" value="0.920" />
    <input name="coat_color" type="color3" value="0.973, 0.984, 1.000" />
    <input name="coat_roughness" type="float" value="0.060" />
    <input name="coat_IOR" type="float" value="1.620" />
    <input name="coat_affect_color" type="float" value="0.350" />
    <input name="coat_affect_roughness" type="float" value="0.180" />
    <input name="thin_film_thickness" type="float" value="520.000" />
    <input name="thin_film_IOR" type="float" value="1.420" />
    <input name="thin_walled" type="boolean" value="false" />
    <input name="opacity" type="color3" value="1, 1, 1" />
  </standard_surface>
  <surfacematerial name="MAT_pearl" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="SR_pearl" />
  </surfacematerial>
</materialx>`,
};
