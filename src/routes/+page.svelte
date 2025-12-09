<script lang="coffee">

  import jQuery from 'jquery';
  import defaultVertShader from "./../../src/default.vert?raw"
  import p5 from "p5"
  import { onMount } from "svelte"
  import {EditorView, basicSetup} from "codemirror"
  import {lineNumbers} from "@codemirror/view"
  import {StreamLanguage} from "@codemirror/language"
  import {shader} from "@codemirror/legacy-modes/mode/clike"
  import { browser } from '$app/environment'
  import {
    shaderState, p5Setup, checkShaderError, DefaultShader, buildAndValidateShader,
    BuiltInShaderContent
  } from "./../../src/shaderUtils.svelte"
  import {
    firebaseApp, db, initLogin, initLogout, _firebaseState, getUserShaders,
    getTemplateShaders, getUserList, saveShader, deleteShader
  } from "./../../src/firebaseUtils.svelte"
  import PubSub from 'pubsub-js'

  import "@melloware/coloris/dist/coloris.css";
  import Coloris from "@melloware/coloris";

  if browser
    Coloris.init();
    Coloris({el: ".color-picker", alpha: false});
    window.$ = jQuery

  pFive = null
  editorView = null
  params = []
  discoverUserUid = null
  isShaderPublic = false
  defaultTextureUrl = "https://upload.wikimedia.org/wikipedia/commons/9/9a/512x512_Dissolve_Noise_Texture.png"

  firebaseState = _firebaseState
  PubSub.subscribe "firebaseStateUpdated", ->
    firebaseState = _firebaseState

  PubSub.subscribe "shaderDrawError", (topic, msg) ->
    alert(msg)

  onMount =>
    pFive = new p5(p5Setup)

    formatLineNumber = (n) =>
      n + BuiltInShaderContent.split("\n").length + Math.max(1, params.length)

    editorView = new EditorView
      extensions: [
        basicSetup,
        StreamLanguage.define(shader),
        lineNumbers({formatNumber: formatLineNumber})
      ],
      parent: jQuery("#editorWrapper")[0]

    editorView.dispatch
      changes:
        from: 0
        to: editorView.state.doc.length
        insert: DefaultShader

    jQuery("#cameraTab").removeClass("hidden")
    getTemplateShaders()
    getUserList()

  updateButtonClick = ->
    tryUseShader editorView.state.doc.toString(), params

  saveButtonClick = ->
    mismatched_defaults = params.some (param) ->
      { val } = shaderState.paramValues[param.paramName]
      val != param.val
    if mismatched_defaults
      should_fix = confirm("Update defaults to match current values?")
      if should_fix
        params.forEach (param) ->
          { val } = shaderState.paramValues[param.paramName]
          param.default = val
    # if params.some (param) ->
    #   param.val
    shaderText = editorView.state.doc.toString()
    name = jQuery("#shader-name").val()
    isPublic = jQuery("#isPublic")[0].checked
    isTemplate = jQuery("#isTemplate")[0]?.checked
    [shaderObj, error] = await saveShader(name, shaderText, params, isPublic, isTemplate)
    if error
      alert(error)
    else
      alert("saved")
      if firebaseState.user && firebaseState.user.uid == discoverUserUid
        firebaseState.discoverShaders[firebaseState.user.uid][name] = shaderObj
      if isTemplate
        firebaseState.templateShaders[name] = shaderObj
      else
        firebaseState.userShaders[name] = shaderObj
    tryUseShader(shaderText, params)

  deleteButtonClick = ->
    return unless confirm "are you sure?"
    name = jQuery("#shader-name").val()
    isTemplate = jQuery("#isTemplate")[0]?.checked
    err = deleteShader(name, isTemplate)
    return alert(err) if err
    if firebaseState.user && firebaseState.user.uid == discoverUserUid
      delete firebaseState.discoverShaders[firebaseState.user.uid][name]
    delete firebaseState.userShaders[name]
    firebaseState.userShaders = firebaseState.userShaders
    firebaseState.discoverShaders[firebaseState.user.uid] = firebaseState.discoverShaders[firebaseState.user.uid]
    alert("deleted")
    clearShader()

  tryUseShader = (shaderText, params) ->
    jQuery("[data-tab='cameraTab']").trigger("click")
    [newShaderObj, shaderError] = buildAndValidateShader(shaderText, params)
    if (shaderError)
      alert(shaderError)
      false
    else
      shaderState.shaderObj = newShaderObj
      pFive.shader(shaderState.shaderObj)
      true

  switchTab = ->
    button = jQuery(this)
    jQuery(".nav-btn").removeClass("selected")
    button.addClass("selected")
    id = "##{button.data("tab")}"
    tab = jQuery(id)
    jQuery(".tab").addClass("hidden")
    tab.removeClass("hidden")

  loadShader = (name, shaderData) ->
    params = JSON.parse(shaderData.paramsJson)
    shaderState.paramValues = {}
    jQuery("#shader-name").val(name)
    success = tryUseShader(shaderData.shaderMainText, params)
    isShaderPublic = shaderData.isPublic
    for key, val of shaderState.paramValues
      delete shaderState.paramValues[key]
    shaderState.imagesCache = {}
    params.forEach (param) ->
      valueType = null
      if param.type.includes("ColorShaderParam")
        valueType = "color"
      else if param.type.includes("FloatShaderParam")
        valueType = "float"
      else if param.type.includes("TextureShaderParam")
        valueType = "texture"
      else if param.type.includes("BooleanShaderParam")
        valueType = "boolean"
      shaderState.paramValues[param.paramName] =
        type: valueType,
        val: param.default
    editorView.dispatch
      changes:
        from: 0,
        to: editorView.state.doc.length,
        insert: shaderData.shaderMainText

  clearShader = ->
    loadShader "",
      shaderMainText: DefaultShader,
      paramsJson: JSON.stringify([])

  clearShaderOnClick = ->
    clearShader()
    alert("cleared")

  updateParamName = ->
    input = jQuery(this)
    section = input.closest(".shaderParam")
    oldName = section.attr("data-param-name")
    newName = input.val()
    oldParam = params.find (param) -> param.paramName == oldName
    oldParam.paramName = newName
    params = params
    section.attr("data-param-name", newName)
    oldVal = shaderState.paramValues[oldName]
    delete shaderState.paramValues[oldName]
    shaderState.paramValues[newName] = oldVal

  addParam = ->
    console.log("TODO: make param types compatible with app")
    params.push
      paramName: "",
      type: "FOO.BAR.FloatShaderParam",
      default: 1.0,
      min: 0.0,
      max: 10.0,
    params = params
    shaderState.paramValues[""] =
      type: "float",
      val: 1.0

  deleteParam = ->
    return unless confirm("are you sure?")
    field = jQuery(this)
    section = field.closest(".shaderParam")
    paramName = section.attr("data-param-name")
    delete shaderState.paramValues[paramName]
    params = params.filter (param) -> param.paramName != paramName

  paramTypeChange = ->
    select = jQuery(this)
    newType = select.val().split(".").slice(-1)[0]
    section = select.closest(".shaderParam")
    paramName = section.attr("data-param-name")
    options = section.find(".shaderOptions")
    options.addClass("hidden")
    activeOption = section.find(".shaderOptions[data-param-type='#{newType}']")
    activeOption.removeClass("hidden")

    param = params.find (param) -> param.paramName == paramName
    if newType == "FloatShaderParam"
      Object.assign(param, type: "Foo.Bar.FloatShaderParam", default: 1.0, min: 0.0, max: 10.0)
      shaderState.paramValues[paramName] = { type: "float", val: 1.0 }
    else if newType == "ColorShaderParam"
      shaderState.paramValues[paramName] = { type: "color", val: "#ff0000" }
      Object.assign(param, type: "Foo.Bar.ColorShaderParam", default: "#ff0000")
    else if newType == "TextureShaderParam"
      shaderState.paramValues[paramName] = { type: "texture", val: defaultTextureUrl }
      Object.assign(param, type: "Foo.Bar.TextureShaderParam", default: defaultTextureUrl)
    else if newType == "BooleanShaderParam"
      shaderState.paramValues[paramName] = { type: "boolean", val: defaultTextureUrl }
      Object.assign(param, type: "Foo.Bar.BooleanShaderParam", default: true)

    params = params

  textureParamDirectSet = ->
    field = jQuery(this)
    section = field.closest(".shaderParam")
    paramName = section.attr("data-param-name")
    shaderState.paramValues[paramName] = {
      type: "texture",
      val: field.val()
    }

  textureParamDefaultChanged = ->
    field = jQuery(this)
    section = field.closest(".shaderParam")
    paramName = section.attr("data-param-name")
    param = params.find (param) -> param.paramName == paramName
    param.default = field.val()
    params = params
    shaderState.paramValues[paramName] =
      type: "texture",
      val: field.val()

  booleanParamDirectSet = ->
    field = jQuery(this)
    section = field.closest(".shaderParam")
    paramName = section.attr("data-param-name")
    shaderState.paramValues[paramName] = {
      type: "boolean",
      val: field[0].checked
    }

  booleanParamDefaultChanged = ->
    field = jQuery(this)
    section = field.closest(".shaderParam")
    paramName = section.attr("data-param-name")
    param = params.find (param) -> param.paramName == paramName
    param.default = field[0].checked
    params = params
    shaderState.paramValues[paramName] =
      type: "boolean",
      val: field[0].checked

  colorParamDirectSet = ->
    field = jQuery(this)
    section = field.closest(".shaderParam")
    paramName = section.attr("data-param-name")
    shaderState.paramValues[paramName] = {
      type: "color",
      val: field.val()
    }

  colorParamDefaultChanged = ->
    field = jQuery(this)
    section = field.closest(".shaderParam")
    paramName = section.attr("data-param-name")
    param = params.find (param) -> param.paramName == paramName
    param.default = field.val()
    params = params
    shaderState.paramValues[paramName] =
      type: "color",
      val: field.val()

  floatParamDirectSet = ->
    field = jQuery(this)
    section = field.closest(".shaderParam")
    paramName = section.attr("data-param-name")
    slider = section.find(".float-param-slider")
    slider.val(field.val())
    shaderState.paramValues[paramName] = {
      type: "float",
      val: field.val()
    }

  floatParamMinChanged = ->
    field = jQuery(this)
    section = field.closest(".shaderParam")
    paramName = section.attr("data-param-name")
    param = params.find (param) -> param.paramName == paramName
    param.min = field.val()
    params = params

  floatParamDefaultChanged = ->
    field = jQuery(this)
    section = field.closest(".shaderParam")
    paramName = section.attr("data-param-name")
    param = params.find (param) -> param.paramName == paramName
    param.default = field.val()
    params = params
    shaderState.paramValues[paramName] =
      type: "float",
      val: field.val()

  floatParamMaxChanged = ->
    field = jQuery(this)
    section = field.closest(".shaderParam")
    paramName = section.attr("data-param-name")
    param = params.find (param) -> param.paramName == paramName
    param.max = field.val()
    params = params

  floatParamSliderChanged = ->
    field = jQuery(this)
    section = field.closest(".shaderParam")
    paramName = section.attr("data-param-name")
    directSetField = section.find(".float-param-val-direct-set")
    directSetField.val(field.val())
    shaderState.paramValues[paramName] = {
      type: "float",
      val: field.val()
    }

  selectDiscoverUser = (uid) ->
    userShaders = await getUserShaders(uid, true)
    _firebaseState.discoverShaders ||= {}
    _firebaseState.discoverShaders[uid] = userShaders
    firebaseState = _firebaseState
    discoverUserUid = uid

  unselectDiscoverUser = ->
    discoverUserUid = null

</script>
<container id="page">

  <!-- NAV BUTTONS AND LOGIN -->
  <div id="tab-nav">
    <button class="nav-btn selected" on:click={switchTab} data-tab="cameraTab">Camera</button>
    <button class="nav-btn" on:click={switchTab} data-tab="templateShadersTab">Template Shaders</button>
    <button class="nav-btn" on:click={switchTab} data-tab="userShadersTab">My Shaders</button>
    <button class="nav-btn" on:click={switchTab} data-tab="discoverShadersTab">Discover Shaders</button>
    <button class="nav-btn" on:click={switchTab} data-tab="aboutTab">About</button>
    {#if firebaseState.user}
      <button class="nav-btn" on:click={initLogout} id="logout">Logout ({firebaseState.user.email})</button>
    {:else}
      <button class="nav-btn" on:click={initLogin} id="login">Login (to save & share)</button>
    {/if}
  </div>

  <div id="tabs">

    <!-- CAMERA VIEW -->
    <div class="tab hidden" id="cameraTab">
      <div id="canvas"></div>

      <div class="controls-column">
        <!-- Shader Metadata Section -->
        <div class="control-panel">
          <div class="panel-content">
            <div class="form-row">
              <label for="shader-name">Name</label>
              <input id="shader-name" type="text" placeholder="Enter shader name" />
              <div class="checkbox-group">
                <label>
                  <input type="checkbox" id="isPublic" checked={isShaderPublic} value="Public" />
                  <span>Public</span>
                </label>
                {#if firebaseState.isAdmin}
                  <label>
                    <input type="checkbox" id="isTemplate" value="Template" />
                    <span>Template</span>
                  </label>
                {/if}
              </div>
            </div>
          </div>
        </div>

        <!-- Action Buttons Section -->
        <div class="control-panel">
          <div class="panel-content">
            <div class="button-row">
              <button on:click={updateButtonClick} id="update">Update Preview</button>
              <button on:click={saveButtonClick} id="save">Save Shader</button>
              <button on:click={deleteButtonClick} id="delete">Delete Shader</button>
              <button on:click={clearShaderOnClick} id="clear">Clear Shader</button>
            </div>
          </div>
        </div>

        <!-- Parameters -->
        <div id="params" class="control-panel">
          <!-- PARAM EDITOR -->
          <div class="panel-content">
            <div class="param-header-row">
              <button on:click={addParam}>Add Parameter</button>
              <span class="param-description">Auto-defines a uniform in the shader</span>
            </div>
        <ol>
          {#each params as param}
            <li
              class="shaderParam"
              data-param-name={param.paramName}
            >
              <input
                type="text"
                class="paramName"
                value={param.paramName}
                placeholder="param name"
                on:change={updateParamName}
              />
              <select
                on:change={paramTypeChange}
                class="type-select"
              >
                <option
                  value="FOO.BAR.FloatShaderParam"
                  selected={param.type.split(".").slice(-1)[0] == "FloatShaderParam"}
                >Float</option>
                <option
                  value="FOO.BAR.ColorShaderParam"
                  selected={param.type.split(".").slice(-1)[0] == "ColorShaderParam"}
                >Color</option>
                <option
                  value="FOO.BAR.TextureShaderParam"
                  selected={param.type.split(".").slice(-1)[0] == "TextureShaderParam"}
                >Texture</option>
                <option
                  value="FOO.BAR.BooleanShaderParam"
                  selected={param.type.split(".").slice(-1)[0] == "BooleanShaderParam"}
                >Boolean</option>
              </select>

              {#if param.type.includes("TextureShaderParam")}
                <span class="param-group">
                  <span class="param-label">Value:</span>
                  <input
                    class="texture-param-val-direct-set small-number-input"
                    type="text"
                    value={param.default || ""}
                    on:input={textureParamDirectSet}
                  />
                </span>
                <span class="param-group">
                  <span class="param-label">Default:</span>
                  <input
                    class="texture-param-default small-number-input"
                    type="text"
                    value={param.default || ""}
                    on:input={textureParamDefaultChanged}
                  />
                </span>
              {/if}

              {#if param.type.includes("BooleanShaderParam")}
                <span class="param-group">
                  <span class="param-label">Value:</span>
                  <input
                    class="boolean-param-val-direct-set"
                    type="checkbox"
                    checked={param.default || false}
                    on:input={booleanParamDirectSet}
                  />
                </span>
                <span class="param-group">
                  <span class="param-label">Default:</span>
                  <input
                    class="boolean-param-default"
                    type="checkbox"
                    checked={param.default}
                    on:input={booleanParamDefaultChanged}
                  />
                </span>
              {/if}

              {#if param.type.includes("ColorShaderParam")}
                <span class="param-group">
                  <span class="param-label">Value:</span>
                  <input
                    class="color-picker color-param-val-direct-set small-number-input"
                    type="text"
                    value={param.default || ""}
                    on:input={colorParamDirectSet}
                  />
                </span>
                <span class="param-group">
                  <span class="param-label">Default:</span>
                  <input
                    class="color-picker color-param-default small-number-input"
                    type="text"
                    value={param.default || ""}
                    on:input={colorParamDefaultChanged}
                  />
                </span>
              {/if}

              {#if param.type.includes("FloatShaderParam")}
                <span class="param-group">
                  <span class="param-label">Value:</span>
                  <input
                    class="float-param-val-direct-set small-number-input"
                    type="number"
                    step="0.001"
                    value={param.type.includes("FloatShaderParam") ? (param.default || 0.5) : 0.5}
                    on:change={floatParamDirectSet}
                  />
                </span>
                <span class="param-group">
                  <span class="param-label">Default:</span>
                  <input
                    class="float-param-default small-number-input"
                    type="number"
                    step="0.001"
                    value={param.type.includes("FloatShaderParam") ? (param.default || 0.5) : 0.5}
                    on:change={floatParamDefaultChanged}
                  />
                </span>
                <span class="param-group">
                  <span class="param-label">Min:</span>
                  <input
                    class="float-param-min small-number-input"
                    type="number"
                    step="0.001"
                    value={param.type.includes("FloatShaderParam") ? (param.min || 0.0) : 0.0}
                    on:change={floatParamMinChanged}
                  />
                </span>
                <span class="param-group">
                  <span class="param-label">Max:</span>
                  <input
                    class="float-param-max small-number-input"
                    type="number"
                    step="0.001"
                    value={param.type.includes("FloatShaderParam") ? (param.max || 1.0) : 1.0}
                    on:change={floatParamMaxChanged}
                  />
                </span>
                <input
                  class="float-param-slider"
                  type="range"
                  step="0.001"
                  min={param.type.includes("FloatShaderParam") ? (param.min || 0.0) : 0.0}
                  max={param.type.includes("FloatShaderParam") ? (param.max || 1.0) : 1.0}
                  value={param.default || 1.0}
                  on:input={floatParamSliderChanged}
                />
              {/if}
              <button
                on:click={deleteParam}
                class="delete-param"
              >Delete</button>
            </li>
          {/each}
          </ol>
          </div>
        </div>
      </div>

      <div class="controls-column">
        <!-- Code Editor Section -->
        <div class="control-panel">
          <div class="panel-content" style="padding: 0;">
            <div id="editorWrapper"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- TEMPLATE SHADER LIST -->
    <div class="tab hidden shader-list-tab" id="templateShadersTab">
      <div class="control-panel">
        <div class="panel-header">Template Shaders</div>
        <div class="panel-content">
          {#if Object.keys(firebaseState.templateShaders || {}).length == 0}
            <p class="empty-state">No template shaders found.</p>
          {:else}
            <div class="shader-grid">
              {#each Object.entries(firebaseState.templateShaders || {}).sort(([k,v]) => k) as [name, shaderData]}
                <button class="shader-card" on:click={loadShader(name, shaderData)}>
                  <span class="shader-name">{name}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- MY SHADER LIST -->
    <div class="tab hidden shader-list-tab" id="userShadersTab">
      <div class="control-panel">
        <div class="panel-header">My Shaders</div>
        <div class="panel-content">
          {#if Object.keys(firebaseState.userShaders || {}).length == 0}
            <p class="empty-state">No saved shaders found.</p>
          {:else}
            <div class="shader-grid">
              {#each Object.entries(firebaseState.userShaders || {}) as [name, shaderData]}
                <button class="shader-card" on:click={loadShader(name, shaderData)}>
                  <span class="shader-name">{name}</span>
                  <span class="shader-badge {shaderData.isPublic ? 'public' : 'private'}">
                    {shaderData.isPublic ? "Public" : "Private"}
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- DISCOVER SHADER LIST -->
    <div class="tab hidden shader-list-tab" id="discoverShadersTab">
      <div class="control-panel">
        {#if discoverUserUid}
          <div class="panel-header">
            <span>User Shaders</span>
            <button on:click={unselectDiscoverUser} class="back-btn">← Back to Users</button>
          </div>
          <div class="panel-content">
            {#if Object.keys(firebaseState.discoverShaders[discoverUserUid] || {}).length == 0}
              <p class="empty-state">This user has no public shaders.</p>
            {:else}
              <div class="shader-grid">
                {#each Object.entries(firebaseState.discoverShaders[discoverUserUid] || {}) as [name, shaderData]}
                  <button class="shader-card" on:click={loadShader(name, shaderData)}>
                    <span class="shader-name">{name}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <div class="panel-header">Discover Users</div>
          <div class="panel-content">
            {#if (firebaseState.userList?.length || 0) == 0}
              <p class="empty-state">No other users have created public shaders yet.</p>
            {:else}
              <div class="shader-grid">
                {#each (firebaseState.userList || []) as userInfo}
                  {#if userInfo.publicShadersCount > 0}
                    <button class="shader-card user-card" on:click={selectDiscoverUser(userInfo.uid)}>
                      <span class="shader-name">{userInfo.name}</span>
                      <span class="shader-badge public">{userInfo.publicShadersCount} shaders</span>
                    </button>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <!-- ABOUT TAB -->
    <div class="tab hidden shader-list-tab" id="aboutTab">
      <div class="control-panel">
        <div class="panel-content">
          <div class="about-content">
            <p>Created by <a href="https://maxpleaner.com" target="_blank" rel="noopener noreferrer">Max Pleaner</a></p>

            <p>
              <a href="https://github.com/maxpleaner/ShaderWeb" target="_blank" rel="noopener noreferrer">View source code on GitHub</a>
            </p>

            <p>
              This site was originally intended to feed camera effects into an Android/iOS app.
              That project remains incomplete. If you're interested in building such an application,
              please feel free to contact me.
            </p>
          </div>
        </div>
      </div>
    </div>

  </div>
  <hr>
</container>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: #0a0a0a;
    color: #e0e0e0;
    font-size: 14px;
    line-height: 1.5;
  }

  :global(#page) {
    margin: 0 auto;
    padding: 20px;
  }

  @media (max-width: 600px) {
    :global(#page) {
      padding: 10px;
    }

    :global(.control-panel) {
      width: 100% !important;
      max-width: 100% !important;
    }

    :global(#canvas) {
      max-width: 100%;
    }
  }

  :global(hr) {
    border: none;
    border-top: 1px solid #2a2a2a;
    margin: 20px 0;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  /* Control Panel Structure */
  :global(.control-panel) {
    background: linear-gradient(180deg, #161616 0%, #121212 100%);
    border: 1px solid #2a2a2a;
    border-radius: 10px;
    margin-bottom: 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    max-width: 800px;
    width: fit-content;
  }

  :global(.panel-header) {
    background: linear-gradient(180deg, #1e1e1e 0%, #1a1a1a 100%);
    padding: 14px 20px;
    border-bottom: 1px solid #2a2a2a;
    font-weight: 600;
    font-size: 14px;
    color: #f0f0f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  :global(.panel-content) {
    padding: 20px;
  }

  @media (max-width: 600px) {
    :global(.panel-content) {
      padding: 12px;
    }

    :global(#params li) {
      padding: 12px;
    }

    :global(.shaderParam) {
      gap: 6px;
    }

    :global(.shaderParam input),
    :global(.shaderParam select) {
      font-size: 13px;
      padding: 6px 8px;
    }

    :global(.shaderParam .paramName) {
      width: 120px;
    }

    :global(.shaderParam .type-select) {
      width: 90px;
    }

    :global(.float-param-slider) {
      width: 100%;
      min-width: 150px;
    }

    :global(.param-group) {
      gap: 4px;
    }
  }

  :global(.form-row) {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }

  :global(.form-row:last-child) {
    margin-bottom: 0;
  }

  :global(.form-row label) {
    font-weight: 500;
    min-width: 60px;
    color: #d0d0d0;
  }

  :global(.checkbox-group) {
    display: flex;
    gap: 20px;
    flex: 1;
  }

  :global(.checkbox-group label) {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    min-width: auto;
  }

  :global(.text-link) {
    font-size: 13px;
    margin-left: auto;
  }

  :global(.button-row) {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  /* Shader Grid Layout */
  :global(.shader-grid) {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }

  :global(.shader-card) {
    background: linear-gradient(180deg, #1e1e1e 0%, #1a1a1a 100%);
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    text-align: left;
    transition: all 0.2s ease;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  }

  :global(.shader-card:hover) {
    background: linear-gradient(180deg, #252525 0%, #202020 100%);
    border-color: #3a3a3a;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    transform: translateY(-2px);
  }

  :global(.shader-name) {
    font-weight: 500;
    font-size: 14px;
    color: #f0f0f0;
  }

  :global(.shader-badge) {
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 4px;
    display: inline-block;
    font-weight: 500;
  }

  :global(.shader-badge.public) {
    background: rgba(74, 158, 255, 0.15);
    color: #4a9eff;
    border: 1px solid rgba(74, 158, 255, 0.3);
  }

  :global(.shader-badge.private) {
    background: rgba(255, 193, 7, 0.15);
    color: #ffc107;
    border: 1px solid rgba(255, 193, 7, 0.3);
  }

  :global(.empty-state) {
    text-align: center;
    color: #888;
    padding: 40px 20px;
    font-size: 14px;
  }

  :global(button) {
    background: linear-gradient(180deg, #1e1e1e 0%, #1a1a1a 100%);
    color: #e0e0e0;
    border: 1px solid #333;
    padding: 9px 18px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.2s ease;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }

  :global(button:hover) {
    background: linear-gradient(180deg, #2a2a2a 0%, #252525 100%);
    border-color: #555;
    box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    transform: translateY(-1px);
  }

  :global(button:active) {
    transform: translateY(0px);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  :global(.back-btn) {
    font-size: 12px;
    padding: 6px 12px;
  }

  :global(input[type="text"]),
  :global(input[type="number"]),
  :global(select) {
    background: #1a1a1a;
    color: #e0e0e0;
    border: 1px solid #333;
    padding: 7px 10px;
    border-radius: 6px;
    font-size: 13px;
    transition: all 0.2s ease;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
  }

  :global(input[type="text"]:focus),
  :global(input[type="number"]:focus),
  :global(select:focus) {
    outline: none;
    border-color: #4a9eff;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3), 0 0 0 3px rgba(74, 158, 255, 0.15);
  }

  :global(input[type="text"]:hover),
  :global(input[type="number"]:hover),
  :global(select:hover) {
    border-color: #444;
  }

  :global(input[type="checkbox"]) {
    accent-color: #4a9eff;
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  :global(a) {
    color: #4a9eff;
    text-decoration: none;
    transition: color 0.2s ease;
  }

  :global(a:hover) {
    color: #6ab0ff;
    text-decoration: underline;
  }

  :global(#shader-name) {
    width: 300px;
  }

  :global(#tab-nav) {
    display: flex;
    gap: 10px;
    margin: 0 auto 20px auto;
    padding: 6px;
    background: linear-gradient(180deg, #161616 0%, #121212 100%);
    border-radius: 10px;
    border: 1px solid #2a2a2a;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    flex-wrap: wrap;
    justify-content: center;
  }

  @media (max-width: 600px) {
    :global(#tab-nav) {
      gap: 6px;
      padding: 4px;
      margin-bottom: 10px;
    }

    :global(.nav-btn) {
      font-size: 12px;
      padding: 7px 14px;
    }
  }

  :global(#cameraTab) {
    display: grid;
    grid-template-columns: 800px 800px;
    grid-template-rows: 600px auto;
    gap: 20px;
    max-width: 1640px;
    margin: 0 auto;
    justify-content: center;
  }

  @media (max-width: 1679px) {
    :global(#cameraTab) {
      grid-template-columns: 1fr;
      justify-items: center;
    }
  }

  :global(.shader-list-tab .control-panel) {
    max-width: none;
    width: 100%;
  }

  :global(#canvas) {
    grid-column: 1;
    grid-row: 1;
  }

  :global(.controls-column) {
    display: flex;
    flex-direction: column;
    gap: 0;
    width: 100%;
    max-width: 800px;
    align-items: center;
  }

  :global(#cameraTab > .controls-column:nth-child(2)) {
    grid-column: 2;
    grid-row: 1 / 3;
  }

  :global(#cameraTab > .controls-column:nth-child(3)) {
    grid-column: 1;
    grid-row: 2;
  }

  @media (max-width: 1679px) {
    :global(.controls-column) {
      grid-column: 1 !important;
      grid-row: auto !important;
    }
  }

  :global(.control-panel) {
    width: 100%;
    max-width: 800px;
  }

  :global(#canvas) {
    border: 1px solid #2a2a2a;
    border-radius: 10px;
    margin-bottom: 0;
    background: #000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.03);
    max-width: 800px;
    width: 100%;
    aspect-ratio: 4 / 3;
    overflow: hidden;
  }

  :global(#canvas canvas) {
    display: block;
    width: 100% !important;
    height: 100% !important;
    object-fit: contain;
  }

  :global(#editorWrapper) {
    border: none;
    border-radius: 6px;
    overflow: hidden;
    min-height: 400px;
    width: 100%;
  }

  :global(#editorWrapper .cm-editor) {
    width: 100%;
  }

  :global(#params ol) {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  :global(#params li) {
    margin-bottom: 0;
    padding: 16px;
    background: linear-gradient(180deg, #1e1e1e 0%, #1a1a1a 100%);
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    transition: all 0.2s ease;
  }

  :global(#params li:hover) {
    border-color: #3a3a3a;
    box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4);
  }

  :global(#params li:last-child) {
    margin-bottom: 0;
  }

  :global(.shaderParam) {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  :global(.shaderParam input),
  :global(.shaderParam select) {
    margin: 0;
  }

  :global(.shaderParam .paramName) {
    width: 160px;
    font-weight: 600;
  }

  :global(.shaderParam .type-select) {
    width: 120px;
  }

  :global(.shaderOptions.inline-block) {
    display: contents;
  }

  :global(.shaderOptions b) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #b0b0b0;
    font-weight: 500;
  }

  :global(.param-group) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  :global(.param-label) {
    font-size: 12px;
    color: #b0b0b0;
    font-weight: 500;
  }

  :global(.float-param-slider) {
    width: 200px;
    cursor: pointer;
  }

  :global(.hidden) {
    display: none !important;
  }

  .inline-block {
    display: inline-block;
  }

  :global(.hidden.inline-block) {
    display: none !important;
  }

  .small-number-input {
    width: 70px;
  }

  .nav-btn {
    flex: 0 0 auto;
    font-weight: 500;
  }

  .nav-btn.selected {
    background: linear-gradient(180deg, #2a3a4a 0%, #1e2e3e 100%);
    border-color: #4a9eff;
    color: #4a9eff;
    box-shadow: 0 3px 8px rgba(74, 158, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }

  :global(#login),
  :global(#logout) {
    flex: 0 0 auto;
    font-weight: 500;
  }

  :global(.about-content) {
    max-width: 600px;
    line-height: 1.8;
  }

  :global(.about-content p) {
    margin: 16px 0;
  }

  :global(.about-content p:first-child) {
    margin-top: 0;
  }

  :global(.about-content p:last-child) {
    margin-bottom: 0;
  }

  :global(.cm-editor) {
    background: #1e1e1e;
  }

  :global(.cm-editor .cm-gutters) {
    background: #252525;
    border-right: 1px solid #333;
  }

  :global(.cm-editor .cm-activeLineGutter) {
    background: #2a2a2a;
  }

  :global(.cm-editor .cm-lineNumbers .cm-gutterElement) {
    color: #858585;
  }

  :global(.param-header-row) {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }

  :global(.param-description) {
    font-size: 13px;
    color: #888;
    font-style: italic;
  }

  :global(.delete-param) {
    background: linear-gradient(180deg, #2a1a1a 0%, #251515 100%);
    border-color: #553333;
    font-size: 12px;
    padding: 6px 12px;
    margin-left: auto;
  }

  :global(.delete-param:hover) {
    background: linear-gradient(180deg, #3a1a1a 0%, #351515 100%);
    border-color: #773333;
    box-shadow: 0 3px 6px rgba(119, 51, 51, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }

  :global(#save) {
    background: linear-gradient(180deg, #1a2e1a 0%, #152515 100%);
    border-color: #335533;
  }

  :global(#save:hover) {
    background: linear-gradient(180deg, #2a3e2a 0%, #253525 100%);
    border-color: #447744;
    box-shadow: 0 3px 6px rgba(68, 119, 68, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  :global(#update) {
    background: linear-gradient(180deg, #1a2a3a 0%, #152530 100%);
    border-color: #335577;
  }

  :global(#update:hover) {
    background: linear-gradient(180deg, #2a3a4a 0%, #253540 100%);
    border-color: #447799;
    box-shadow: 0 3px 6px rgba(68, 119, 153, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  :global(#delete) {
    background: linear-gradient(180deg, #2a1a1a 0%, #251515 100%);
    border-color: #553333;
  }

  :global(#delete:hover) {
    background: linear-gradient(180deg, #3a1a1a 0%, #351515 100%);
    border-color: #773333;
    box-shadow: 0 3px 6px rgba(119, 51, 51, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  :global(#clear) {
    background: linear-gradient(180deg, #2a2a1a 0%, #252515 100%);
    border-color: #555533;
  }

  :global(#clear:hover) {
    background: linear-gradient(180deg, #3a3a2a 0%, #353525 100%);
    border-color: #777755;
    box-shadow: 0 3px 6px rgba(119, 119, 85, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }
</style>
