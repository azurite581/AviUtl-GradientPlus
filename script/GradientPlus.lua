local GradientPlus = {}

-- 参考: https://github.com/Mr-Ojii/AviUtl-RotBlur_M-Script/blob/c3a92c7c4895750cfb8e0e1c67ec5b2de3b9a57f/script/RotBlur_M.lua#L4
local function script_path()
    return debug.getinfo(1).source:match("@?(.*[/\\])")
end

local function rotate(deg)
    local rad = math.rad(deg)
    return {math.cos(rad), -math.sin(rad),
            math.sin(rad),  math.cos(rad)}
end

local GLShaderKit = require("GLShaderKit")
local shader_path = script_path() .. "GradientPlus.frag"

if GLShaderKit.isInitialized() then
    GradientPlus.GradientPlus = function(
        offset_x,       -- 中心点からX方向へのオフセット値
        offset_y,       -- 中心点からY方向へのオフセット値
        angle,          -- 角度
        width,          -- 幅
        strength,       -- 強さ
        blend_mode,     -- 合成モード
        gradient_type,  -- 形状
        color_space,    -- 色空間
        interp_dir,     -- 補間方向
        color1,         -- 開始色
        color2,         -- 終了色
        reload          -- 再読み込み
    )
        strength = math.max(0, math.min(1, strength / 100))

        -- 四角形 or 四角ループのときは角度を調整
        if gradient_type == 3 or gradient_type == 6 then
            angle = angle - 45
        end

        local r1, g1, b1 = RGB(color1)
        local r2, g2, b2 = RGB(color2)
        local VERTEX_NUM = 1
        local data, w, h = obj.getpixeldata()

        obj.setoption("drawtarget", "tempbuffer", w, h)
        obj.draw()

        GLShaderKit.activate()
        GLShaderKit.setPlaneVertex(VERTEX_NUM)
        GLShaderKit.setShader(shader_path, reload)

        GLShaderKit.setFloat("resolution", w, h)
        GLShaderKit.setFloat("pivot", offset_x, offset_y)
        GLShaderKit.setMatrix("rot", "2x2", false, rotate(-angle))
        GLShaderKit.setFloat("width", width)
        GLShaderKit.setInt("gradient_type", gradient_type)
        GLShaderKit.setInt("color_space", color_space)
        GLShaderKit.setInt("interp_dir", interp_dir)
        GLShaderKit.setFloat("color1", r1 / 255, g1 / 255, b1 / 255)
        GLShaderKit.setFloat("color2", r2 / 255, g2 / 255, b2 / 255)
        GLShaderKit.setTexture2D(0, data, w, h)

        GLShaderKit.draw("TRIANGLES", data, w, h)
        GLShaderKit.deactivate()

        obj.putpixeldata(data)
        obj.setoption("blend", blend_mode - 1)
        obj.draw(0, 0, 0, 1, strength)
        obj.copybuffer("obj", "tmp")
    end
else
    GradientPlus.GradientPlus = function(offset_x, offset_y, angle, width, strength, gradient_type, color_space, interp_dir, color1, color2)
        io.stderr:write("\27[91m[GradientPlus][ERROR] GradientPlus is not available.\27[0m\n")
    end
end

return GradientPlus
