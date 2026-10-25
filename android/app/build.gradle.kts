plugins {
    id("com.android.application")
}

android {
    namespace = "com.mou.imagestudio"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.mou.imagestudio"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf("META-INF/DEPENDENCIES")
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    constraints {
        implementation("org.jetbrains.kotlin:kotlin-stdlib:2.0.21") {
            because("对齐 kotlin-stdlib 与 jdk8 扩展，避免重复类")
        }
    }
}
