# kotlinx.serialization이 리플렉션 없이 동작하도록 생성한 직렬화 코드를
# 유지한다.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.aistockbriefing.android.**$$serializer { *; }
-keepclassmembers class com.aistockbriefing.android.** {
    *** Companion;
}
-keepclasseswithmembers class com.aistockbriefing.android.** {
    kotlinx.serialization.KSerializer serializer(...);
}
