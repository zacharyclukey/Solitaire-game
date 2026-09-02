# ---------------------------------------------------------------------------
# Facedown — R8 / ProGuard rules for the release build.
#
# The whole game is web code inside a Capacitor WebView. The only Java/Kotlin
# on the release classpath is Capacitor itself, its four plugins and AndroidX.
# Capacitor discovers plugins and dispatches every JS -> native call by
# *reflection* (annotations + method names), so R8 must not rename or remove
# any of it. Everything below exists for that reason.
# ---------------------------------------------------------------------------

# Annotations, generic signatures and inner-class metadata are all consumed at
# runtime by Capacitor's plugin registry and by its JSON <-> Java bridging.
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses,EnclosingMethod
-keepattributes Exceptions

# --- Capacitor bridge ------------------------------------------------------
# Plugin classes are looked up by name from capacitor.plugins.json and their
# @PluginMethod methods are invoked reflectively from JavaScript.
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public <methods>;
}

# The plugins actually bundled in this app (App, Haptics, SplashScreen,
# StatusBar) all live under these package roots.
-keep class com.capacitorjs.plugins.** { *; }

# --- Cordova compatibility layer ------------------------------------------
# capacitor-cordova-android-plugins is on the classpath even with zero Cordova
# plugins installed; Cordova also resolves classes by name.
-keep class org.apache.cordova.** { *; }
-keep public class * extends org.apache.cordova.CordovaPlugin

# --- WebView JavaScript interfaces ----------------------------------------
# Any method exposed to JS via @JavascriptInterface must keep its name.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class * extends android.webkit.WebChromeClient {
    public void *(android.webkit.WebView, java.lang.String);
}

# --- App entry point -------------------------------------------------------
-keep class com.facedown.game.MainActivity { *; }

# --- Misc ------------------------------------------------------------------
# Capacitor builds JSObject on top of org.json; keep the enum machinery it and
# AndroidX rely on.
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}

# Drop the WebView's own verbose logging from the shipped binary.
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
}

# Keep line numbers so Play Console crash reports are readable, but hide the
# original source file names.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
