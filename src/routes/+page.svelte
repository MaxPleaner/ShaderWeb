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

  <!-- ACCOUNTS STUFF -->
  {#if firebaseState.user}
    <span>Logged in as {firebaseState.user.email}</span>
    <button on:click={initLogout} id="logout">Logout</button>
  {:else}
    <button on:click={initLogin} id="login">Login</button>
  {/if}
  <hr>

  <!-- NAV BUTTONS -->
  <div id="tab-nav">
    <button class="nav-btn selected" on:click={switchTab} data-tab="cameraTab">Camera</button>
    <button class="nav-btn" on:click={switchTab} data-tab="templateShadersTab">Template Shaders</button>
    <button class="nav-btn" on:click={switchTab} data-tab="userShadersTab">My Shaders</button>
    <button class="nav-btn" on:click={switchTab} data-tab="discoverShadersTab">Discover Shaders</button>
  </div>
  <hr>

  <div id="tabs">

    <!-- CAMERA VIEW -->
    <div class="tab hidden" id="cameraTab">
      <div id="canvas"></div>
      <input id="shader-name" type="text" placeholder="Shader name" />
      <button on:click={updateButtonClick} id="update">Update Preview</button>
      <button on:click={saveButtonClick} id="save">Save</button>
      <button on:click={deleteButtonClick} id="delete">Delete</button>
      <br>
      <label for="isPublic">Public</label>
      <input type="checkbox" id="isPublic" checked={isShaderPublic} value="Public" />
      {#if firebaseState.isAdmin}
        <label for="isTemplate">Template</label>
        <input type="checkbox" id="isTemplate" value="Template" />
      {/if}
      <br>
      <a href="#" on:click={clearShaderOnClick}>Clear Active Shader</a>
      <!-- EDITOR -->
      <div id="params">
        <!-- PARAM EDITOR -->
        <p>Parameters</p>
        <button on:click={addParam} class="add-param">Add Parameter</button>
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
              <div
                class={`shaderOptions inline-block ${param.type.includes("TextureShaderParam") ? "" : "hidden"}`}
                data-param-type="TextureShaderParam"
              >
                <b>Value:
                  <input
                    class="texture-param-val-direct-set small-number-input"
                    type="text"
                    value={param.default || ""}
                    on:input={textureParamDirectSet}
                  />
                </b>
                <b>Default:
                  <input
                    class="texture-param-default small-number-input"
                    type="text"
                    value={param.default || ""}
                    on:input={textureParamDefaultChanged}
                  />
                </b>
              </div>
              <div
                class={`shaderOptions inline-block ${param.type.includes("BooleanShaderParam") ? "" : "hidden"}`}
                data-param-type="BooleanShaderParam"
              >
                <b>Value:
                  <input
                    class="boolean-param-val-direct-set small-number-input"
                    type="checkbox"
                    checked={param.default || false}
                    on:input={booleanParamDirectSet}
                  />
                </b>
                <b>Default:
                  <input
                    class="boolean-param-default small-number-input"
                    type="checkbox"
                    checked={param.default}
                    on:input={booleanParamDefaultChanged}
                  />
                </b>
              </div>
              <div
                class={`shaderOptions inline-block ${param.type.includes("ColorShaderParam") ? "" : "hidden"}`}
                data-param-type="ColorShaderParam"
              >
                <b>Value:
                  <input
                    class="color-picker color-param-val-direct-set small-number-input"
                    type="text"
                    value={param.default || ""}
                    on:input={colorParamDirectSet}
                  />
                </b>
                <b>Default:
                  <input
                    class="color-picker color-param-default small-number-input"
                    type="text"
                    value={param.default || ""}
                    on:input={colorParamDefaultChanged}
                  />
                </b>
              </div>
              <div
                class={`shaderOptions inline-block ${param.type.includes("FloatShaderParam") ? "" : "hidden"}`}
                data-param-type="FloatShaderParam"
              >
                <b>Value:
                  <input
                    class="float-param-val-direct-set small-number-input"
                    type="number"
                    step="0.001"
                    value={param.type.includes("FloatShaderParam") ? (param.default || 0.5) : 0.5}
                    on:change={floatParamDirectSet}
                  />
                </b>
                <b>Default:
                  <input
                    class="float-param-default small-number-input"
                    type="number"
                    step="0.001"
                    value={param.type.includes("FloatShaderParam") ? (param.default || 0.5) : 0.5}
                    on:change={floatParamDefaultChanged}
                  />
                </b>
                <b>Min:
                  <input
                    class="float-param-min small-number-input"
                    type="number"
                    step="0.001"
                    value={param.type.includes("FloatShaderParam") ? (param.min || 0.0) : 0.0}
                    on:change={floatParamMinChanged}
                  />
                </b>
                <b>Max:
                  <input
                    class="float-param-max small-number-input"
                    type="number"
                    step="0.001"
                    value={param.type.includes("FloatShaderParam") ? (param.max || 1.0) : 1.0}
                    on:change={floatParamMaxChanged}
                  />
                </b>
                <input
                  class="float-param-slider"
                  type="range"
                  step="0.001"
                  min={param.type.includes("FloatShaderParam") ? (param.min || 0.0) : 0.0}
                  max={param.type.includes("FloatShaderParam") ? (param.max || 1.0) : 1.0}
                  value={param.default || 1.0}
                  on:input={floatParamSliderChanged}
                />
              </div>
              <button
                on:click={deleteParam}
                class="delete-param"
              >Delete</button>
            </li>
          {/each}
        </ol>
      </div>
      <div id="editorWrapper"></div>
    </div>

    <!-- TEMPLATE SHADER LIST -->
    <div class="tab hidden" id="templateShadersTab">
      <ul>
        {#if Object.keys(firebaseState.templateShaders || {}).length == 0}
          <p>No template shaders found.</p>
        {:else}
          {#each Object.entries(firebaseState.templateShaders || {}).sort(([k,v]) => k) as [name, shaderData]}
            <li><button on:click={loadShader(name, shaderData)}>{name}</button>
          {/each}
        {/if}
      </ul>
    </div>

    <!-- MY SHADER LIST -->
    <div class="tab hidden" id="userShadersTab">
      <ul>
        {#if Object.keys(firebaseState.userShaders || {}).length == 0}
          <p>No saved shaders found.</p>
        {:else}
          {#each Object.entries(firebaseState.userShaders || {}) as [name, shaderData]}
            <li><button on:click={loadShader(name, shaderData)}>{name} ({shaderData.isPublic ? "Public": "Private"})</button>
          {/each}
        {/if}
      </ul>
    </div>

    <!-- DISCOVER SHADER LIST -->
    <div class="tab hidden" id="discoverShadersTab">
      {#if discoverUserUid}
        <button on:click={unselectDiscoverUser}>Back to user list</button>
        <ul>
          {#if Object.keys(firebaseState.discoverShaders[discoverUserUid] || {}).length == 0}
            <p>No saved shaders found.</p>
          {:else}
            <br>
            {#if Object.keys(firebaseState.discoverShaders[discoverUserUid] || {}).length == 0}
              <p> This user has no public shaders </p>
            {:else}
              {#each Object.entries(firebaseState.discoverShaders[discoverUserUid] || {}) as [name, shaderData]}
                <li><button on:click={loadShader(name, shaderData)}>{name}</button>
              {/each}
            {/if}
          {/if}
        </ul>
      {:else}
        <ul>
          {#if (firebaseState.userList?.length || 0) == 0}
            <p> No other users have created public shaders. So sad!</p>
          {:else}
            {#each (firebaseState.userList || []) as userInfo}
              {#if userInfo.publicShadersCount > 0}
                <li><button on:click={selectDiscoverUser(userInfo.uid)}>{userInfo.name}</button>
              {/if}
            {/each}
          {/if}
        </ul>
      {/if}
    </div>

  </div>
  <hr>
</container>

<style>

  .hidden {
    display: none;
  }

  .inline-block {
    display: inline-block;
  }

  .hidden.inline-block {
    display: none
  }

  .small-number-input {
    width: 50px;
  }

  .nav-btn.selected {
    outline: 3px solid lightblue;
  }


  #page {
    background: #000;
  }

  #login {
    border: none;
    padding: 7px 20px;
    font-weight: 300;
    font-size: 18px;
    background-color: #205fbd;
    color: #fff;
    border-radius: 10px;
    cursor: pointer;
  }

  .nav-btn {
    border: none;
    padding: 3px 7px;
    margin-bottom: 10px;
    font-weight: 400;
    font-size: 14px;
    background-color: #205fbd;
    color: #fff;
    border-radius: 3px;
    cursor: pointer;
    margin-right: 10px; 
  }

  #canvas {
  margin-bottom: 20px;
  }

  #editorWrapper {
  background-color: #fff;
  }

  @media screen and (min-width: 375px) {
  .nav-btn {
    padding: 5px 10px;
    margin-bottom: 10px;
    font-weight: 400;
    font-size: 16px;
    border-radius: 5px;
  }

  

  input[type=text] {
    width: 200px;
    height: 35px;
    border: none;
    border-radius: 5px;
    background-color: #131414;
    color: #fff;
    padding: 0 5px;
    margin-right: 20px;
  }

  input[type=text]:focus {
    outline: 1px solid #4f5252;
  }

  #update,
  #save,
  #delete {
    border: none;
    padding: 5px 10px;
    font-weight: 400;
    font-size: 16px;
    background-color: #205fbd;
    color: #fff;
    border-radius: 5px;
    cursor: pointer;
    margin-right: 10px;
  }

  label {
    color: #fff;
    margin:10px 8px;
    display: inline-block;
    font-family: arial, san-serif;
}

  a {
    display: inline-block;
    color: #205fbd;
    margin-left: 8px;
    font-weight: bold;
  }

  #params {
    color: #fff;
    margin-left: 8px;
    text-transform: uppercase;
    text-decoration: underline;
  }

  #params p {
    font-size: 18px;
    font-family: arial, san-serif;
  }

  .add-param {
    border: none;
    padding: 3px 6px;
    font-weight: 400;
    font-size: 14px;
    background-color: #205fbd;
    color: #fff;
    border-radius: 5px;
    cursor: pointer;
    margin-right: 10px;
  }

  .type-select {
    height: 30px;
    border: none;
    border-radius: 5px;
    background-color: #131414;
    color: #fff;
  }

  .small-number-input {
    height: 30px;
    width: 60px;
    border: none;
    border-radius: 5px;
    background-color: #131414;
    color: #fff;
  }

  .delete-param {
    border: none;
    padding: 5px 10px;
    font-weight: 400;
    font-size: 16px;
    background-color: #205fbd;
    color: #fff;
    border-radius: 5px;
    cursor: pointer;
  }

  #templateShadersTab li{
    list-style: none;
  }

  #templateShadersTab li > button {
    border: none;
    outline: none;
    padding: 8px 10px;
    font-size: 16px;
    background-color: #205fbd;
    color: #fff;
    margin: 3px 0;
    border-radius: 3px;
    cursor: pointer;
  }

  #userShadersTab p {
    font-size: 16px;
    color: #fff;
    font-family: arial, san-serif;
  }

  #discoverShadersTab li {
    list-style: none;
  }

  #discoverShadersTab li > button {
    border: none;
    outline: none;
    padding: 8px 10px;
    font-size: 16px;
    background-color: #205fbd;
    color: #fff;
    margin: 3px 0;
    border-radius: 3px;
    cursor: pointer;
  }
  }
</style>
