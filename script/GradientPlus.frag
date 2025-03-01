#version 460 core

in vec2 TexCoord;

layout(location = 0) out vec4 FragColor;

uniform sampler2D texture0;
uniform vec2  resolution;
uniform vec2 pivot;
uniform mat2 rot;
uniform float width;
uniform int gradient_type;
uniform int color_space;
uniform int interp_dir;
uniform vec3 color1;
uniform vec3 color2;

#define PI 3.14159265358979323846
#define TAU (2.0 * PI)

// 無彩色か判定するのに使う誤差を考慮した閾値
#define ChromaThreshold 0.02

// Standard Illuminant D65
const vec3 D65_WHITE = vec3(0.95047, 1.0, 1.08883);

float sd_circle(vec2 p, float r) {
    return length(p) - r;
}

float sd_square(vec2 uv) {
    return max(abs(uv.x), abs(uv.y));
}

// 参考: https://w.wiki/DBwx
float gamma_decode(float x) {
    return x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4);
}

vec3 srgb2linear(vec3 x) {
    return vec3(gamma_decode(x.r), gamma_decode(x.g), gamma_decode(x.b));
    //return pow(x, vec3(2.2));  // 近似
}

// 参考: https://w.wiki/DBx3
float gamma_encode(float x) {
    return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1.0 / 2.4) - 0.055;
}

vec3 linear2srgb(vec3 x) {
    return vec3(gamma_encode(x.r), gamma_encode(x.g), gamma_encode(x.b));
    //return pow(x, vec3(1.0 / 2.2));  // 近似
}

float hue_mix(float hue1, float hue2, float t) {
    float diff = hue2 - hue1;
    switch (interp_dir) {
    case 1:
        if (diff > PI) hue1 += TAU;
        else if (diff < -PI) hue2 += TAU;
        break;
    case 2:
        if (0.0 < diff && diff < PI) hue1 += TAU;
        else if (-PI < diff && diff <= 0.0) hue2 += TAU;
        break;
    }
    float angle = mix(hue1, hue2, t);
    return mod(mod(angle, TAU) + TAU, TAU);
}

// sRGB to HSV
// 参考: https://w.wiki/DD6A
vec3 srgb2hsv(vec3 rgb) {
    float max_val = max(rgb.r, max(rgb.g, rgb.b));
    float min_val = min(rgb.r, min(rgb.g, rgb.b));
    float chroma = max_val - min_val;

    float hue = 0;
    float saturation = 0;

    if (chroma == 0) hue = 0;
    else if (max_val == rgb.r) hue = mod((rgb.g - rgb.b) / chroma, 6.0);
    else if (max_val == rgb.g) hue = (rgb.b - rgb.r) / chroma + 2.0;
    else hue = (rgb.r - rgb.g) / chroma + 4.0;
    hue *= 60.0;

    if (max_val == 0) saturation = 0;
    else saturation = chroma / max_val;

    return vec3(radians(hue), saturation, max_val);
}

// HSV to sRGB
// 参考: https://w.wiki/DD66
float hsv2srgb_f(vec3 hsv, float n) {
    float k = mod((n + degrees(hsv.x) / 60.0), 6.0);
    return hsv.z - hsv.z * hsv.y * max(0.0, min(k, min(4.0 - k, 1.0)));
}
vec3 hsv2srgb(vec3 hsv) {
    return vec3(
        hsv2srgb_f(hsv, 5.0),
        hsv2srgb_f(hsv, 3.0),
        hsv2srgb_f(hsv, 1.0)
    );
}

// sRGB to HSL
// 参考: https://w.wiki/DD6A
vec3 srgb2hsl(vec3 rgb) {
    float max_val = max(rgb.r, max(rgb.g, rgb.b));
    float min_val = min(rgb.r, min(rgb.g, rgb.b));
    float chroma = max_val - min_val;

    float hue = 0;
    if (chroma == 0) hue = 0;
    else if (max_val == rgb.r) hue = mod((rgb.g - rgb.b) / chroma, 6.0);
    else if (max_val == rgb.g) hue = (rgb.b - rgb.r) / chroma + 2.0;
    else hue = (rgb.r - rgb.g) / chroma + 4.0;
    hue *= 60.0;

    float lightness = (max_val + min_val) / 2.0;

    float saturation = 0.0;
    if (lightness != 1.0 && lightness != 0.0) {
        saturation = chroma / (1.0 - abs(2.0 * lightness - 1.0));
    }
    return vec3 (radians(hue), saturation, lightness);
}

// HSL to sRGB
// 参考: https://w.wiki/DD6D
float hsl2rgb_f(vec3 hsl, float n) {
    float k = mod((n + degrees(hsl.x) / 30.0), 12.0);
    float a = hsl.y * min(hsl.z, 1.0 - hsl.z);
    return hsl.z - a * max(-1.0, min(k - 3.0, min(9.0 - k, 1.0)));
}
vec3 hsl2srgb(vec3 hsl) {
    return vec3(
        hsl2rgb_f(hsl, 0.0),
        hsl2rgb_f(hsl, 8.0),
        hsl2rgb_f(hsl, 4.0)
    );
}

// HSLも同じ補間を行う
vec3 hsv_mix(vec3 a, vec3 b, float x) {
    float hue = 0.0;
    if (a.y == 0.0 && b.y == 0.0) hue = 0.0;
    else if (a.y == 0.0) hue = b.x;
    else if (b.y == 0.0) hue = a.x;
    else hue = hue_mix(a.x, b.x, x);
    vec3 hsv = vec3(hue, mix(a.yz, b.yz, x));
    return hsv;
}

// linear sRGB to XYZ(D65)
// 参考: http://www.brucelindbloom.com/Eqn_RGB_XYZ_Matrix.html
vec3 linear2xyz(vec3 linear_rgb) {
    float x = (0.4124564 * linear_rgb.r + 0.3575761 * linear_rgb.g + 0.1804375 * linear_rgb.b);
    float y = (0.2126729 * linear_rgb.r + 0.7151522 * linear_rgb.g + 0.0721750 * linear_rgb.b);
    float z = (0.0193339 * linear_rgb.r + 0.1191920 * linear_rgb.g + 0.9503041 * linear_rgb.b);
    return vec3(x, y, z);
}

// XYZ(D65) to linear sRGB
// 参考: http://www.brucelindbloom.com/Eqn_RGB_XYZ_Matrix.html
vec3 xyz2linear(vec3 xyz) {
    float r = (xyz.x *  3.2404542 + xyz.y * -1.5371385 + xyz.z * -0.4985314);
    float g = (xyz.x * -0.9692660 + xyz.y *  1.8760108 + xyz.z *  0.0415560);
    float b = (xyz.x *  0.0556434 + xyz.y * -0.2040259 + xyz.z *  1.0572252);
    return vec3(r, g, b);
}

// XYZ(D65) to CIELAB
// 参考: http://www.brucelindbloom.com/Eqn_XYZ_to_Lab.html
float xyz2lab_f(float x) {
    return x > 0.008856 ? pow(x, 0.333333333) : (903.3 * x + 16.0) / 116.0;
}
vec3 xyz2lab(vec3 xyz) {
    vec3 xyz_scaled = xyz / D65_WHITE;
    xyz_scaled = vec3(
        xyz2lab_f(xyz_scaled.x),
        xyz2lab_f(xyz_scaled.y),
        xyz2lab_f(xyz_scaled.z)
    );
    return vec3(
        (116.0 * xyz_scaled.y) - 16.0,
         500.0 * (xyz_scaled.x - xyz_scaled.y),
         200.0 * (xyz_scaled.y - xyz_scaled.z)
    );
}

// CIELAB to XYZ(D65)
// 参考: http://www.brucelindbloom.com/Eqn_Lab_to_XYZ.html
float lab2xyz_f(float x) {
    return pow(x, 3.0) > 0.008856 ? pow(x, 3.0) : (116.0 * x - 16.0) / 903.3;
}
vec3 lab2xyz(vec3 lab) {
    float f = (lab.x + 16.0) / 116.0;
    float y = lab.x > 0.008856 * 903.3 ? pow((lab.x + 16.0) / 116.0, 3.0) : lab.x / 903.3;
    return D65_WHITE * vec3(
        lab2xyz_f(f + lab.y / 500.0),
        y,
        lab2xyz_f(f - lab.z / 200.0)
    );
}

vec3 linear2lab(vec3 linear_rgb) {
    vec3 xyz = linear2xyz(linear_rgb);
    return xyz2lab(xyz);
}

vec3 lab2linear(vec3 lab) {
    vec3 xyz = lab2xyz(lab);
    return xyz2linear(xyz);
}

// CIELAB to CIELCH
// 参考: http://www.brucelindbloom.com/Eqn_Lab_to_LCH.html
float atan2(float y, float x) {
    return x == 0.0 ? sign(y) * PI * 0.5 : atan(y, x);
}
vec3 lab2lch(vec3 lab) {
    float chroma = length(vec2(lab.y, lab.z));
    float hue = 0.0;
    // 無彩色でない場合のみHueを計算
    if (chroma > ChromaThreshold) {
        hue = atan2(lab.z, lab.y);
        hue = hue < 0.0 ? hue + TAU : hue;
    }
    return vec3(
        lab.x,
        chroma,
        hue
    );
}

// CIELCH to CIELAB
// 参考: http://www.brucelindbloom.com/Eqn_LCH_to_Lab.html
vec3 lch2lab(vec3 lch) {
    return vec3(
        lch.x,
        lch.y * cos(lch.z),
        lch.y * sin(lch.z)
    );
}

// linear sRGB to CIELCH
vec3 linear2lch(in vec3 linear_rgb) {
    vec3 xyz = linear2xyz(linear_rgb);
    vec3 lab = xyz2lab(xyz);
    return lab2lch(lab);
}

// CIELCH to linear sRGB
vec3 lch2linear(in vec3 lch) {
    vec3 lab = lch2lab(lch);
    vec3 xyz = lab2xyz(lab);
    return xyz2linear(xyz);
}

vec3 lch_mix(vec3 a, vec3 b, float x) {
    float lightness = mix(a.x, b.x, x);
    float chroma = mix(a.y, b.y, x);
    float hue = 0.0;
    // 無彩色かどうかに基づいてHueを変更
    if (a.y > ChromaThreshold && b.y > ChromaThreshold) hue = hue_mix(a.z, b.z, x);
    else if (a.y > ChromaThreshold) hue = a.z;
    else if (b.y > ChromaThreshold) hue = b.z;
    else hue = 0.0;
    return vec3(lightness, chroma, hue);
}

float cbrt(float x) {
    return sign(x) * pow(abs(x), 1.0 / 3.0);
}

// linear sRGB to Oklab
// 参考: https://bottosson.github.io/posts/oklab/#converting-from-linear-srgb-to-oklab
vec3 linear2oklab(vec3 linear_rgb) {
    float l = 0.4122214708 * linear_rgb.r + 0.5363325363 * linear_rgb.g + 0.0514459929 * linear_rgb.b;
	float m = 0.2119034982 * linear_rgb.r + 0.6806995451 * linear_rgb.g + 0.1073969566 * linear_rgb.b;
	float s = 0.0883024619 * linear_rgb.r + 0.2817188376 * linear_rgb.g + 0.6299787005 * linear_rgb.b;

    float l_ = cbrt(l);
    float m_ = cbrt(m);
    float s_ = cbrt(s);

    return vec3(
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    );
}

// Oklab to linear sRGB
// 参考: https://bottosson.github.io/posts/oklab/#converting-from-linear-srgb-to-oklab
vec3 oklab2linear(vec3 oklab) {
    float l_ = oklab.x + 0.3963377774 * oklab.y + 0.2158037573 * oklab.z;
    float m_ = oklab.x - 0.1055613458 * oklab.y - 0.0638541728 * oklab.z;
    float s_ = oklab.x - 0.0894841775 * oklab.y - 1.2914855480 * oklab.z;

    float l = l_ * l_ * l_;
    float m = m_ * m_ * m_;
    float s = s_ * s_ * s_;

    return vec3(
		 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    );
}

vec3 linear2oklch(vec3 linear_rgb) {
    vec3 oklab = linear2oklab(linear_rgb);
    return lab2lch(oklab);
}

vec3 oklch2linear(vec3 oklch) {
    vec3 oklab = lch2lab(oklch);
    return oklab2linear(oklab);
}

void main() {
    vec2 uv = (gradient_type == 8) ? TexCoord * resolution - 0.5 * resolution + vec2(resolution.x * 0.5, resolution.y * 0.5) - pivot
                                   : TexCoord * resolution - 0.5 * resolution - pivot;
    uv *= rot;
    float w = width;
    vec3 col1 = color1;
    vec3 col2 = color2;
    float t = 0.0;
    float dist = 0.0;

    switch (gradient_type) {
    case 1:  // 線
        w = max(1.0, w);  // アンチエイリアスのために最低でも1.0にする
        t = smoothstep(-w * 0.5, w * 0.5, uv.y);
        break;
    case 2:  // 円
        dist = sd_circle(uv, w * 0.5);
        t = smoothstep(-w * 0.5, w * 0.5, dist);
        break;
    case 3:  // 四角形
        uv *= sqrt(2.0);
        dist = sd_square(uv);
        t = smoothstep(0.0, w, dist);
        break;
    case 4:  // 凸形
        t = smoothstep(0.0, w, abs(uv.y));
        break;
    case 5:  // 円ループ
        w = max(1.0, w);
        dist = sd_circle(uv, w);
        dist = mod(dist + w, 2.0 * w) - w;
        t = smoothstep(w, 0.0, abs(dist));
        break;
    case 6:  // 四角ループ
        w = max(1.0, w);
        uv *= sqrt(2.0);
        dist = sd_square(uv);
        dist = mod(dist + w, 2.0 * w) - w;
        t = smoothstep(0.0, w, abs(dist));
        break;
    case 7:  // 凸ループ
    case 8:  // 凸ループ2
        w = max(1.0, w);
        dist = mod(uv.y + w, 2.0 * w) - w;
        t = smoothstep(0.0, w, abs(dist));
        break;
    }

    vec3 color = vec3(0.0);
    switch (color_space) {
    case 1:  // Linear sRGB
        color = mix(srgb2linear(col1), srgb2linear(col2), t);
        color = linear2srgb(color);
        break;
    case 2:  // HSV
        vec3 hsv1 = srgb2hsv(col1);
        vec3 hsv2 = srgb2hsv(col2);
        color = hsv2srgb(hsv_mix(hsv1, hsv2, t));
        break;
    case 3:  // HSL
        vec3 hsl1 = srgb2hsl(col1);
        vec3 hsl2 = srgb2hsl(col2);
        color = hsl2srgb(hsv_mix(hsl1, hsl2, t));
        break;
    case 4:  // L*a*b* (CIELAB)
        vec3 lab1 = linear2lab(srgb2linear(col1));
        vec3 lab2 = linear2lab(srgb2linear(col2));
        color = lab2linear(mix(lab1, lab2, t));
        color = linear2srgb(color);
        break;
    case 5:  // LCh
        vec3 lch1 = linear2lch(srgb2linear(col1));
        vec3 lch2 = linear2lch(srgb2linear(col2));
        color = lch2linear(lch_mix(lch1, lch2, t));
        color = linear2srgb(color);
        break;
    case 6:  // Oklab
        vec3 oklab1 = linear2oklab(srgb2linear(col1));
        vec3 oklab2 = linear2oklab(srgb2linear(col2));
        color = oklab2linear(mix(oklab1, oklab2, t));
        color = linear2srgb(color);
        break;
    case 7:  // OkLCh
        vec3 oklch1 = linear2oklch(srgb2linear(col1));
        vec3 oklch2 = linear2oklch(srgb2linear(col2));
        color = oklch2linear(lch_mix(oklch1, oklch2, t));
        color = linear2srgb(color);
        break;
    }

    float alpha = texture(texture0, TexCoord).a;
    FragColor = vec4(color, alpha);
}