<script context="module" lang="coffee">
  import p5 from "p5"
  import defaultVertShader from "./default.vert?raw"
  import PubSub from 'pubsub-js'

  shaderState =
    shaderObj: null
    cam: null
    paramValues: {}
    imagesCache: {}
    lastShaderDrawError: ""

  DefaultShader = """
    ///////////////////////////////////////////////////////////////////
    //  Fill in the image function below to write your shader!       //
    //  Built-ins:                                                   //
    //    - Uniforms:                                                //
    //      - vec2 iResolution                                       //
    //      - float iTime - seconds since shader load                //
    //    - Functions:                                               //
    //      - vec3 sampleCamera(uv)                                  //
    //      - vec3 samplePrevFrame(uv)                               //
    ///////////////////////////////////////////////////////////////////

    vec3 image(vec2 uv, vec3 color) {
      return color;
    }
  """

  pFive = null
  usesFeedback = false
  startTime = Date.now() / 1000.0

  p5Setup = (_pFive) =>
    pFive = _pFive
    pFive.setup = ->
      aspect_ratio = [4, 3]
      scale = 150
      size = aspect_ratio.map (val) => val * scale

      canvas = pFive.createCanvas(size[0], size[1], pFive.WEBGL)
      canvas.parent("canvas")
      pFive.noStroke()
      shaderState.cam = pFive.createCapture(pFive.VIDEO)
      shaderState.cam.size(size[0], size[1])
      shaderState.cam.hide()
      shaderState.shaderObj = pFive.createShader(
        defaultVertShader,
        buildShader(DefaultShader, [])
      )
      pFive.shader(shaderState.shaderObj)

    pFive.draw = ->
      shaderState.shaderObj.setUniform('tex0', shaderState.cam)
      shaderState.shaderObj.setUniform('iResolution',[710, 400])
      shaderState.shaderObj.setUniform('iTime', startTime - Date.now() / 1000.0)

      if usesFeedback
        shaderState.shaderObj.setUniform('prevFrame', pFive.get())

      Object.entries(shaderState.paramValues).forEach ([paramName, paramVal]) =>
        if paramName.length > 0
          if paramVal.type == "color"
            finalVal = hexToVec3(paramVal.val)
          else if paramVal.type == "float"
            finalVal = paramVal.val
          else if paramVal.type == "boolean"
            finalVal = paramVal.val
          else if paramVal.type == "texture"
            finalVal = null
            record = shaderState.imagesCache[paramVal.val]
            if record && !record.error
              shaderState.shaderObj.setUniform(paramName, record.img)
            else if !record
              successHandler = (img) => shaderState.imagesCache[paramVal.val] = { img: img }
              errorHandler = (e) =>
                comment = "Possibly a CORS error. Try a different image host such as Imgur."
                msg = "Error fetching image #{paramVal.val}\n\n #{e.message}.\n\n #{comment}"
                alreadyShown = shaderState.lastShaderDrawError == msg
                unless alreadyShown
                  shaderState.lastShaderDrawError = msg
                  PubSub.publish("shaderDrawError", msg)
                shaderState.imagesCache[paramVal.val] = { error: true }
              pFive.loadImage(paramVal.val, successHandler, errorHandler)
          if finalVal || paramVal.type == "boolean"
            shaderState.shaderObj.setUniform(paramName, finalVal)

      # Need to add some geometry to get shaders working;
      # this isn't actually visible
      pFive.rect(0,0,1,1)

  hexToVec3 = (hex) ->
    result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    if result then [
      parseFloat(parseInt(result[1], 16)) / 255.0,
      parseFloat(parseInt(result[2], 16)) / 255.0,
      parseFloat(parseInt(result[3], 16)) / 255.0
    ] else [0.0, 0.0, 0.0]

  BuiltInShaderContent = """
      precision mediump float;

      varying vec2 vTexCoord; // grab texcoords from vert shader
      uniform sampler2D tex0; // our texture coming from p5
      uniform vec2 iResolution;
      uniform float iTime;
      uniform sampler2D prevFrame; // only set if the shader text references it

      float round(float val) {
        return floor(val + 0.5);
      }

      vec3 sampleCamera(vec2 uv) {
        return texture2D(tex0, uv).rgb;
      }

      vec3 samplePrevFrame(vec2 uv) {
        uv.x = 1.0 - uv.x;
        return texture2D(prevFrame, uv).rgb;
      }
  """

  buildShader = (shaderText, params) ->
    startTime = Date.now() / 1000.0
    usesFeedback = shaderText.includes("samplePrevFrame")

    paramsString = params.map (param) ->
      paramClass = param.type.split(".").slice(-1)[0]
      uniformType = {
        "FloatShaderParam": "float",
        "ColorShaderParam": "vec3",
        "TextureShaderParam": "sampler2D",
        "BooleanShaderParam": "bool"
      }[paramClass]
      "uniform #{uniformType} #{param.paramName};"
    .join("\n")

    """
      #{BuiltInShaderContent}
      #{paramsString}
      #{shaderText}

      void main() {
          vec2 uv = vTexCoord;
          uv.x = 1.0 - uv.x;
          uv.y = 1.0 - uv.y;
          vec4 tex = texture2D(tex0, uv);
          vec3 finalRGB = image(uv, tex.rgb);
          gl_FragColor = vec4(finalRGB, 1.0);
      }
    """

  buildAndValidateShader = (shaderText, params) ->
    finalShaderText = buildShader(shaderText, params)
    newShaderObj = pFive.createShader(defaultVertShader, finalShaderText)
    shaderError = checkShaderError(shaderState.shaderObj, finalShaderText)
    [newShaderObj, shaderError]


  checkShaderError = (newShaderObj, shaderText) ->
    gl = newShaderObj._renderer.GL
    glFragShader = gl.createShader(gl.FRAGMENT_SHADER)
    gl.shaderSource(glFragShader, shaderText)
    gl.compileShader(glFragShader)
    if !gl.getShaderParameter(glFragShader, gl.COMPILE_STATUS)
      return gl.getShaderInfoLog(glFragShader)
    return null

  export {
    p5Setup,
    checkShaderError,
    shaderState,
    DefaultShader,
    buildAndValidateShader,
    BuiltInShaderContent
  }
</script>
