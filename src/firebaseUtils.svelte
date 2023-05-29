<script context="module" lang="coffee">
  import { initializeApp } from 'firebase/app';
  import { getDatabase, ref, onValue, get, set, remove, child } from 'firebase/database';
  import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
  import PubSub from 'pubsub-js'
  # import {  } from "firebase/firestore"

  _firebaseState = {}

  provider = new GoogleAuthProvider()

  firebaseConfig =
    apiKey: "AIzaSyBiC68RVONr8MrNN6032hLHLp2jWh_WD-A",
    authDomain: "shadercam-fabcd.firebaseapp.com",
    databaseURL: "https://shadercam-fabcd-default-rtdb.firebaseio.com",
    projectId: "shadercam-fabcd",
    storageBucket: "shadercam-fabcd.appspot.com",
    messagingSenderId: "225470326967",
    appId: "1:225470326967:web:65cd4f40b8778bbe170532"

  firebaseApp = initializeApp(firebaseConfig)
  db = getDatabase();
  auth = getAuth()

  updateState = (key, val) ->
    _firebaseState[key] = val
    PubSub.publish("firebaseStateUpdated")

  onAuthStateChanged auth, (user) =>
    updateState "user", user
    userShaders = if user then await getUserShaders(user.uid) else {}
    updateState "userShaders", userShaders
    isAdmin = user?.uid == "X8Seokq0dqaDUfNciKJC4LOeBe13"
    updateState "isAdmin", isAdmin

  initLogin = ->
    signInWithPopup(auth, provider)

  initLogout = ->
    auth.signOut()

  getTemplateShaders = ->
    dbRef = ref(db)
    templateShaders = {}
    dataSnapshot = await get(child(dbRef, "templateShaders"))
    if dataSnapshot.exists()
      Object.assign(templateShaders, dataSnapshot.val())
    updateState "templateShaders", templateShaders

  getUserShaders = (userId, onlyPublic = false) ->
    dbRef = ref(db)
    userShaders = {}
    publicDataSnapshot = await get(child(dbRef, "userShaders/#{userId}/shaders/public"))
    if publicDataSnapshot.exists()
      shaders = publicDataSnapshot.val()
      for name, data of shaders
        data.isPublic = true
      Object.assign(userShaders, shaders)
    if _firebaseState.user?.uid == userId && !onlyPublic
      privateDataSnapshop = await get(child(dbRef, "userShaders/#{userId}/shaders/private"))
      if privateDataSnapshop.exists()
        shaders = privateDataSnapshop.val()
        for name, data of shaders
          data.isPublic = false
        Object.assign(userShaders, shaders)
    return userShaders

  getUserList = ->
    dbRef = ref(db)
    userList = []
    publicDataSnapshot = await get(child(dbRef, "usernames"))
    if publicDataSnapshot.exists()
      for uid, { name, publicShadersCount } of publicDataSnapshot.val()
        if uid != _firebaseState.user?.uid && publicShadersCount > 0
          userList.push({uid, name, publicShadersCount})
    updateState "userList", userList

  updateUserShaderCount = ->
    return unless _firebaseState.user
    userShaders = await getUserShaders(_firebaseState.user.uid, true)
    count = Object.keys(userShaders).length
    key = "usernames/#{_firebaseState.user.uid}/publicShadersCount"
    set ref(db, key), count

  saveShader = (name, shaderText, params, isPublic, isTemplate) ->
    return [null, "Not logged in; cannot save"] unless _firebaseState.user
    if name.length == 0
      return [null, "shader name is empty"]
    if name.includes("/")
      return [null, "shader name cannot contain slashes"]

    result = if isTemplate
      saveTemplateShader(name, shaderText, params)
    else
      bucket = if isPublic then "public" else "private"
      otherBucket = if isPublic then "private" else "public"
      key = "userShaders/#{_firebaseState.user.uid}/shaders/#{bucket}/#{name}"
      removeKey = "userShaders/#{_firebaseState.user.uid}/shaders/#{otherBucket}/#{name}"
      remove(ref(db, removeKey))
      shaderObj = {
        shaderMainText: shaderText,
        paramsJson: JSON.stringify(params)
        isPublic: isPublic
      }
      set ref(db, key), shaderObj
      [shaderObj, null]

    updateUserShaderCount()
    result

  saveTemplateShader = (name, shaderText, params) ->
    key = "templateShaders/#{name}"
    shaderObj = {
      shaderMainText: shaderText,
      paramsJson: JSON.stringify(params)
    }
    set ref(db, key), shaderObj
    return [shaderObj, null]

  deleteShader = (name, isTemplate) ->
    return "Not logged in; cannot delete" unless _firebaseState.user
    if isTemplate
      deleteTemplateShader(name)
    else
      ["public", "private"].forEach (bucket) ->
        key = "userShaders/#{_firebaseState.user.uid}/shaders/#{bucket}/#{name}"
        remove(ref(db, key))
      updateUserShaderCount()
    null

  deleteTemplateShader = (name) ->
    key = "templateShaders/#{name}"
    remove(ref(db, key))

  export {
    firebaseApp,
    db,
    initLogin,
    initLogout
    _firebaseState,
    getUserShaders,
    getTemplateShaders,
    getUserList,
    saveShader,
    deleteShader
  }
</script>
